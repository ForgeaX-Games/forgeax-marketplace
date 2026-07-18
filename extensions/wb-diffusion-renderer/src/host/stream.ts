// wb-diffusion-renderer streaming controller. Pumps the live viewport through the encode
// worker -> same-origin WS relay -> FluxRT -> jitter buffer -> output panel.
// Uplink never queues (drop-to-newest); downlink plays at a steady display FPS.

import { paintDiffusionRendererOutput, setDiffusionRendererOutputVisible } from './output-store';

export interface StreamParams { prompt?: string; steps?: number; interp?: number; seed?: number }
export type StreamGameOverrides = Partial<StreamParams>;
export interface StreamControlSnapshot {
  base: StreamParams;
  game: StreamGameOverrides;
  effective: StreamParams;
}
export type StreamState = 'connecting' | 'live' | 'stopped' | 'error' | 'busy' | 'unauthorized';
export interface StreamStatus {
  state: StreamState;
  fps?: number;
  modelFps?: number;
  e2eMs?: number;
  serverMs?: number;
  dropped?: number;
  error?: string;
}

const TARGET_FPS = 10, MAX_INFLIGHT = 2, OUT_W = 576, OUT_H = 320, DISPLAY_FPS = 30, MAX_QUEUE = 4;

let running = false;
let ws: WebSocket | null = null;
let worker: Worker | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let track: MediaStreamTrack | null = null;
let displayTimer: ReturnType<typeof setInterval> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;

let seq = 0, lastShownSeq = -1, pending = 0, netInflight = 0, dropped = 0;
let lastE2E: number | null = null, lastSrv: number | null = null;
let completed: number[] = [];
let shown: number[] = [];
let queue: string[] = [];
let lastUrl: string | null = null;
let sentParams: StreamParams = {};
let onStatus: (s: StreamStatus) => void = () => {};
let lastStatus: StreamStatus = { state: 'stopped' };
let baseParams: StreamParams = {};
let gameOverrides: StreamGameOverrides = {};
// One-shot: set when the GLOBAL style prompt is (re)applied so the next uplink
// frame carries reset_cache:true and the backend rebuilds its KV cache. Game
// fragment updates deliberately never set this — they are prompt-only and keep
// the cache to stay temporally coherent.
let pendingCacheReset = false;
const statusListeners = new Set<(s: StreamStatus) => void>();
const controlListeners = new Set<() => void>();
const MAX_GAME_PROMPT_CHARS = 600;

export function isStreaming(): boolean { return running; }

function findCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas#app');
}

function emit(state: StreamState, error?: string): void {
  const status = { state, fps: shown.length, modelFps: completed.length, e2eMs: lastE2E ?? undefined, serverMs: lastSrv ?? undefined, dropped, error };
  lastStatus = status;
  onStatus(status);
  statusListeners.forEach((fn) => fn(status));
}

function notifyControl(): void {
  controlListeners.forEach((fn) => fn());
}

function effectiveParams(): StreamParams {
  const basePrompt = baseParams.prompt?.trim() ?? '';
  const gamePrompt = gameOverrides.prompt?.trim() ?? '';
  const prompt = [basePrompt, gamePrompt].filter(Boolean).join(', ');
  const steps = gameOverrides.steps ?? baseParams.steps;
  const interp = gameOverrides.interp ?? baseParams.interp;
  const seed = gameOverrides.seed ?? baseParams.seed;
  return {
    ...(prompt ? { prompt } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(interp !== undefined ? { interp } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}

function changedParams(p: StreamParams): Record<string, unknown> | undefined {
  sentParams = { ...sentParams, ...p };
  // FluxRT currently reports stateful:false, so every frame must carry the
  // rendering knobs that affect output count/quality.
  const out: Record<string, unknown> = {};
  (['prompt', 'steps', 'interp', 'seed'] as const).forEach((k) => {
    if (p[k] !== undefined) out[k] = p[k];
  });
  return Object.keys(out).length ? out : undefined;
}

function packUplink(seqN: number, ts: number, params: Record<string, unknown> | undefined, jpeg: ArrayBuffer): ArrayBuffer {
  const meta = JSON.stringify({ seq: seqN, ts, ...(params ?? {}) });
  const mb = new TextEncoder().encode(meta);
  const buf = new Uint8Array(4 + mb.length + jpeg.byteLength);
  new DataView(buf.buffer).setUint32(0, mb.length, true);
  buf.set(mb, 4);
  buf.set(new Uint8Array(jpeg), 4 + mb.length);
  return buf.buffer;
}

function onDownlink(buf: ArrayBuffer): void {
  const dv = new DataView(buf);
  const headerLen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
  netInflight = Math.max(0, netInflight - 1);
  if (typeof header.ts === 'number') lastE2E = performance.now() - header.ts;
  if (typeof header.server_ms === 'number') lastSrv = header.server_ms;
  if (typeof header.seq === 'number' && header.seq <= lastShownSeq) return;
  if (typeof header.seq === 'number') lastShownSeq = header.seq;
  completed.push(performance.now());
  let off = 4 + headerLen;
  for (const sz of header.sizes ?? []) {
    const bytes = new Uint8Array(buf, off, sz); off += sz;
    queue.push(URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
  }
  while (queue.length > MAX_QUEUE) URL.revokeObjectURL(queue.shift() as string);
}

function onControl(text: string): void {
  let msg: { type?: string; error?: string };
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.type === 'drop') { netInflight = Math.max(0, netInflight - 1); dropped++; }
  else if (msg.type === 'unauthorized') { emit('unauthorized', 'bad API key'); stopStream({ emitStopped: false }); }
  else if (msg.type === 'busy') { emit('busy', 'another session active'); stopStream({ emitStopped: false }); }
  else if (msg.type === 'error') { emit('error', msg.error ?? 'server error'); stopStream({ emitStopped: false }); }
}

function displayLoop(): void {
  if (queue.length) {
    const url = queue.shift() as string;
    paintDiffusionRendererOutput(url);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = url;
    shown.push(performance.now());
  }
  const cutoff = performance.now() - 1000;
  completed = completed.filter((t) => t >= cutoff);
  shown = shown.filter((t) => t >= cutoff);
}

async function pump(): Promise<void> {
  if (!reader || !worker) return;
  while (running) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    if (pending > 0 || netInflight >= MAX_INFLIGHT) { frame.close(); continue; }
    pending = 1;
    let params = changedParams(effectiveParams());
    if (pendingCacheReset) {
      params = { ...(params ?? {}), reset_cache: true };
      pendingCacheReset = false;
    }
    worker.postMessage({ type: 'frame', frame, seq: seq++, ts: performance.now(), params }, [frame]);
  }
}

export function updateParams(p: StreamParams): void {
  // A change to the global style prompt triggers a cache reset on the next frame;
  // steps/interp/seed-only changes do not.
  if ((p.prompt ?? '') !== (baseParams.prompt ?? '')) pendingCacheReset = true;
  baseParams = { ...p };
  notifyControl();
}

export function getStreamControlSnapshot(): StreamControlSnapshot {
  return { base: { ...baseParams }, game: { ...gameOverrides }, effective: effectiveParams() };
}

export function subscribeStreamControl(listener: () => void): () => void {
  controlListeners.add(listener);
  return () => {
    controlListeners.delete(listener);
  };
}

export function subscribeStreamStatus(listener: (s: StreamStatus) => void): () => void {
  statusListeners.add(listener);
  listener(lastStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export function setGameOverrides(p: StreamGameOverrides): void {
  const next = { ...gameOverrides };
  if ('prompt' in p) {
    const prompt = p.prompt?.trim() ?? '';
    if (prompt) next.prompt = prompt.slice(0, MAX_GAME_PROMPT_CHARS);
    else delete next.prompt;
  }
  if ('steps' in p) {
    if (typeof p.steps === 'number' && Number.isFinite(p.steps)) next.steps = p.steps;
    else delete next.steps;
  }
  if ('interp' in p) {
    if (typeof p.interp === 'number' && Number.isFinite(p.interp)) next.interp = p.interp;
    else delete next.interp;
  }
  if ('seed' in p) {
    if (typeof p.seed === 'number' && Number.isFinite(p.seed)) next.seed = p.seed;
    else delete next.seed;
  }
  gameOverrides = next;
  notifyControl();
}

export function clearGameOverrides(): void {
  gameOverrides = {};
  notifyControl();
}

export async function startStream(params: StreamParams, statusCb: (s: StreamStatus) => void): Promise<void> {
  if (running) return;
  onStatus = statusCb;
  updateParams(params);
  sentParams = {};
  const canvas = findCanvas();
  if (!canvas) { emit('error', 'no viewport canvas'); return; }
  running = true;
  setDiffusionRendererOutputVisible(true);
  emit('connecting');

  try {
    worker = new Worker(new URL('./encode-worker.ts', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'init', w: OUT_W, h: OUT_H, quality: 0.7 });
    worker.onmessage = (e: MessageEvent<{ seq: number; ts: number; params?: Record<string, unknown>; jpeg: ArrayBuffer | null }>) => {
      pending = 0;
      const d = e.data;
      if (d.jpeg && ws && ws.readyState === WebSocket.OPEN) {
        netInflight++;
        ws.send(packUplink(d.seq, d.ts, d.params, d.jpeg));
      }
    };

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/diffusion-renderer?backend=fluxrt`);
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e));
    stopStream({ emitStopped: false });
    return;
  }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    if (!running) return;
    try {
      track = canvas.captureStream(TARGET_FPS).getVideoTracks()[0];
      const Proc = (globalThis as unknown as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor;
      if (typeof Proc !== 'function') { emit('error', 'MediaStreamTrackProcessor unavailable'); stopStream({ emitStopped: false }); return; }
      reader = new (Proc as new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> })({ track }).readable.getReader();
      displayTimer = setInterval(displayLoop, 1000 / DISPLAY_FPS);
      statusTimer = setInterval(() => emit('live'), 400);
      emit('live');
      void pump().catch((e) => {
        if (!running) return;
        emit('error', e instanceof Error ? e.message : String(e));
        stopStream({ emitStopped: false });
      });
    } catch (e) {
      emit('error', e instanceof Error ? e.message : String(e));
      stopStream({ emitStopped: false });
    }
  };
  ws.onmessage = (m: MessageEvent) => {
    if (typeof m.data === 'string') onControl(m.data);
    else onDownlink(m.data as ArrayBuffer);
  };
  ws.onerror = () => {
    if (!running) return;
    emit('error', 'ws error');
    stopStream({ emitStopped: false });
  };
  ws.onclose = () => {
    if (!running) return;
    emit('error', 'ws closed');
    stopStream({ emitStopped: false });
  };
}

export function stopStream(options: { emitStopped?: boolean } = {}): void {
  running = false;
  if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  try { void reader?.cancel(); } catch { /* ignore */ }
  try { track?.stop(); } catch { /* ignore */ }
  try { ws?.close(); } catch { /* ignore */ }
  try { worker?.terminate(); } catch { /* ignore */ }
  reader = null; track = null; ws = null; worker = null;
  queue.forEach((u) => URL.revokeObjectURL(u)); queue = [];
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  seq = 0; lastShownSeq = -1; pending = 0; netInflight = 0; dropped = 0; completed = []; shown = [];
  if (options.emitStopped !== false) emit('stopped');
}
