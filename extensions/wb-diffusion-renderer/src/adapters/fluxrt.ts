import type {
  VisualBackendDescriptor,
  VisualPresentationStatus,
} from '@forgeax/types/visual-generation';
import type {
  VisualBackendAdapter,
  VisualBackendSession,
  VisualDirection,
  ResolvedVisualRequest,
  VisualViewportLease,
} from '../adapter';
import type { AppliedEffectFrame } from '../effect-frame';

const DISPLAY_FPS = 30;
const OUTPUT_WIDTH = 576;
const OUTPUT_HEIGHT = 320;
/** Exported for hermetic lifecycle tests that assert backpressure thresholds. */
export const FLUXRT_MAX_INFLIGHT = 2;
export const FLUXRT_MAX_QUEUE = 4;

export interface FluxRtTransport {
  createWorker(scriptUrl: URL, options: WorkerOptions): Worker;
  createWebSocket(url: string): WebSocket;
  createCanvas(): HTMLCanvasElement;
  getLocation(): { readonly protocol: string; readonly host: string };
  MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => {
    readable: ReadableStream<VideoFrame>;
  };
}

const defaultTransport = (): FluxRtTransport => ({
  createWorker: (scriptUrl, options) => new Worker(scriptUrl, options),
  createWebSocket: (url) => new WebSocket(url),
  createCanvas: () => document.createElement('canvas'),
  getLocation: () => ({ protocol: location.protocol, host: location.host }),
  MediaStreamTrackProcessor: (globalThis as unknown as {
    MediaStreamTrackProcessor?: FluxRtTransport['MediaStreamTrackProcessor'];
  }).MediaStreamTrackProcessor,
});

export const FLUXRT_DESCRIPTOR: VisualBackendDescriptor = {
  id: 'fluxrt',
  label: 'FluxRT',
  profiles: [{
    id: 'viewport-enhancement',
    label: 'Viewport-conditioned rendering',
    requiredInputs: ['viewport-track', 'semantic-intent'],
    optionalInputs: ['camera-pose'],
    outputs: ['presentation-stream', 'telemetry'],
    controls: ['prompt', 'seed', 'quality'],
  }],
};

const FLUXRT_CAPABILITIES = {
  prompt: true,
  motionTargets: new Set<never>(),
} as const;

type FluxParams = {
  prompt: string;
  steps: number;
  interp: number;
  seed: number;
};

type EncodedFrame = {
  readonly seq: number;
  readonly ts: number;
  readonly jpeg: ArrayBuffer | null;
};

export function packFluxRtUplink(
  sequence: number,
  timestamp: number,
  params: FluxParams,
  jpeg: ArrayBuffer,
): ArrayBuffer {
  const header = new TextEncoder().encode(JSON.stringify({
    seq: sequence,
    ts: timestamp,
    ...params,
  }));
  const buffer = new Uint8Array(4 + header.length + jpeg.byteLength);
  new DataView(buffer.buffer).setUint32(0, header.length, true);
  buffer.set(header, 4);
  buffer.set(new Uint8Array(jpeg), 4 + header.length);
  return buffer.buffer;
}

function reasonForWsClose(event: CloseEvent): string {
  return event.reason || `FluxRT relay closed (${event.code})`;
}

function qualityToSteps(quality: VisualDirection['quality']): number {
  if (quality === 'quality') return 4;
  if (quality === 'balanced') return 3;
  return 2;
}

/**
 * FluxRT keeps its distinct JPEG/WS protocol internally. The rest of Studio
 * sees only a current MediaStream and the portable session contract.
 */
class FluxRtSession implements VisualBackendSession {
  readonly descriptor = FLUXRT_DESCRIPTOR;
  readonly profileId = 'viewport-enhancement';
  private readonly listeners = new Set<() => void>();
  private readonly transport: FluxRtTransport;
  private outputCanvas?: HTMLCanvasElement;
  private outputStream?: MediaStream;
  private worker?: Worker;
  private ws?: WebSocket;
  private lease?: VisualViewportLease;
  private reader?: ReadableStreamDefaultReader<VideoFrame>;
  private displayTimer?: ReturnType<typeof setInterval>;
  private statusTimer?: ReturnType<typeof setInterval>;
  private queue: Blob[] = [];
  private pending = 0;
  private inflight = 0;
  private sequence = 0;
  private sessionEpoch?: number;
  private consumedContinuityResetToken?: string;
  private manualRestartRequired = false;
  private disposed = false;
  private running = false;
  private current?: ResolvedVisualRequest;
  private status: VisualPresentationStatus = {
    phase: 'idle',
    backendId: 'fluxrt',
    profileId: 'viewport-enhancement',
  };

  constructor(transport: FluxRtTransport = defaultTransport()) {
    this.transport = transport;
  }

  get output(): MediaStream | undefined {
    return this.outputStream;
  }

  getStatus(): VisualPresentationStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reconcile(input: ResolvedVisualRequest): Promise<AppliedEffectFrame> {
    if (this.disposed) throw new Error('FluxRT session is disposed');
    this.current = input;
    const stamp = input.snapshot.stamp;
    if (!input.snapshot.available || !stamp || !input.snapshot.viewport) {
      this.stop('source-lost', 'The Studio viewport is unavailable');
      throw new Error('The Studio viewport is unavailable');
    }
    if (this.sessionEpoch !== undefined && this.sessionEpoch !== stamp.epoch) {
      this.stop('stale-epoch', 'The game world changed; restarting FluxRT');
    }
    const resetRequested = input.continuityReset !== undefined
      && input.continuityReset.token !== this.consumedContinuityResetToken;
    if (resetRequested && this.running) {
      this.stop();
    }
    this.sessionEpoch = stamp.epoch;
    if (!this.running) {
      if (this.manualRestartRequired) {
        throw new Error('FluxRT requires an explicit restart after the previous failure');
      }
      await this.start(input, stamp.epoch);
      if (resetRequested && input.continuityReset) {
        this.consumedContinuityResetToken = input.continuityReset.token;
      }
      return this.applied(input);
    }
    this.publishStatus({
      phase: 'live',
      appliedIntentRevision: stamp.intentRevision,
      appliedTransitionSequence: stamp.transitionSequence,
    });
    return this.applied(input);
  }

  private applied(input: ResolvedVisualRequest): AppliedEffectFrame {
    return {
      transitionSequence: input.effectFrame?.transitions.at(-1)?.sequence
        ?? input.snapshot.stamp?.transitionSequence
        ?? 0,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const track of this.outputStream?.getTracks() ?? []) track.stop();
    this.outputStream = undefined;
    this.listeners.clear();
  }

  private params(): FluxParams {
    const direction = this.current?.direction;
    return {
      prompt: [
        direction?.prompt ?? '',
        ...(this.current?.effectFrame?.prompt.map((contribution) => contribution.text) ?? []),
      ].filter(Boolean).join(', '),
      steps: qualityToSteps(direction?.quality),
      interp: 1,
      seed: direction?.seed ?? 42,
    };
  }

  private async start(input: ResolvedVisualRequest, expectedEpoch: number): Promise<void> {
    this.ensureOutput();
    this.running = true;
    this.publishStatus({
      phase: 'connecting',
      appliedIntentRevision: input.snapshot.stamp?.intentRevision,
      appliedTransitionSequence: input.snapshot.stamp?.transitionSequence,
    });

    try {
      this.worker = this.transport.createWorker(
        new URL('../host/encode-worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.postMessage({ type: 'init', w: OUTPUT_WIDTH, h: OUTPUT_HEIGHT, quality: 0.7 });
      this.worker.onmessage = (event: MessageEvent<EncodedFrame>) => {
        this.pending = 0;
        const frame = event.data;
        if (!frame.jpeg || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isCurrentEpoch(expectedEpoch)) return;
        this.inflight += 1;
        this.ws.send(packFluxRtUplink(frame.seq, frame.ts, this.params(), frame.jpeg));
      };

      const loc = this.transport.getLocation();
      const protocol = loc.protocol === 'https:' ? 'wss' : 'ws';
      const socket = this.transport.createWebSocket(`${protocol}://${loc.host}/ws/generative-visuals/fluxrt`);
      this.ws = socket;
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => this.openViewport(input, expectedEpoch);
      socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (!this.isCurrentEpoch(expectedEpoch)) return;
        if (typeof event.data === 'string') this.handleControl(event.data);
        else this.handleDownlink(event.data);
      };
      socket.onerror = () => this.fail('transport', 'FluxRT relay connection failed', expectedEpoch);
      socket.onclose = (event) => {
        if (
          event.code === 1008
          && /visual-access-denied|unauthorized|401/i.test(event.reason)
        ) {
          this.stop('unauthorized', event.reason || 'FluxRT relay access was denied');
          return;
        }
        this.fail('transport', reasonForWsClose(event), expectedEpoch);
      };
    } catch (error) {
      this.fail('backend-unavailable', error instanceof Error ? error.message : String(error), expectedEpoch);
    }
  }

  private openViewport(input: ResolvedVisualRequest, expectedEpoch: number): void {
    if (!this.isCurrentEpoch(expectedEpoch)) return;
    try {
      this.lease = input.viewportLease;
      if (!this.lease) throw new Error('Presenter did not provide a viewport track lease');
      const track = this.lease.stream.getVideoTracks()[0];
      if (!track) throw new Error('Studio viewport did not provide a video track');
      const Processor = this.transport.MediaStreamTrackProcessor;
      if (!Processor) throw new Error('MediaStreamTrackProcessor is unavailable in this browser');
      this.reader = new Processor({ track }).readable.getReader();
      this.displayTimer = setInterval(() => { void this.displayNext(); }, 1000 / DISPLAY_FPS);
      this.statusTimer = setInterval(() => {
        if (!this.running) return;
        this.publishStatus({ phase: 'live' });
      }, 500);
      this.publishStatus({ phase: 'live' });
      void this.pump(expectedEpoch);
    } catch (error) {
      this.fail('missing-input', error instanceof Error ? error.message : String(error), expectedEpoch);
    }
  }

  private async pump(expectedEpoch: number): Promise<void> {
    while (this.running && this.reader && this.isCurrentEpoch(expectedEpoch)) {
      const { value: frame, done } = await this.reader.read();
      if (done || !frame) return;
      if (this.pending > 0 || this.inflight >= FLUXRT_MAX_INFLIGHT) {
        frame.close();
        continue;
      }
      this.pending = 1;
      this.worker?.postMessage({
        type: 'frame',
        frame,
        seq: this.sequence++,
        ts: performance.now(),
        params: this.params(),
      }, [frame]);
    }
  }

  private handleControl(raw: string): void {
    let message: { type?: string; error?: string };
    try {
      message = JSON.parse(raw) as { type?: string; error?: string };
    } catch {
      return;
    }
    if (message.type === 'drop') {
      this.inflight = Math.max(0, this.inflight - 1);
      return;
    }
    const issue = message.type === 'unauthorized'
      ? 'unauthorized'
      : message.type === 'busy'
        ? 'busy'
        : 'transport';
    this.stop(issue, message.error ?? message.type ?? 'FluxRT reported an error');
  }

  private handleDownlink(buffer: ArrayBuffer): void {
    try {
      const view = new DataView(buffer);
      const headerLength = view.getUint32(0, true);
      if (headerLength < 2 || 4 + headerLength > buffer.byteLength) return;
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as {
        sizes?: unknown;
        server_ms?: unknown;
      };
      this.inflight = Math.max(0, this.inflight - 1);
      const sizes = Array.isArray(header.sizes) ? header.sizes : [];
      let offset = 4 + headerLength;
      for (const size of sizes) {
        if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.byteLength) return;
        this.queue.push(new Blob([buffer.slice(offset, offset + size)], { type: 'image/jpeg' }));
        offset += size;
      }
      while (this.queue.length > FLUXRT_MAX_QUEUE) this.queue.shift();
      this.publishStatus({
        phase: 'live',
        ...(typeof header.server_ms === 'number' ? { latencyMs: header.server_ms } : {}),
        droppedUpdates: Math.max(0, this.queue.length - 1),
      });
    } catch {
      // Malformed provider payload is dropped. A subsequent frame can recover.
    }
  }

  private async displayNext(): Promise<void> {
    const blob = this.queue.shift();
    const canvas = this.outputCanvas;
    if (!blob || !canvas || typeof createImageBitmap !== 'function') return;
    try {
      const image = await createImageBitmap(blob);
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
    } catch {
      // Rendering a malformed JPEG should not tear down a healthy transport.
    }
  }

  private ensureOutput(): void {
    if (this.outputCanvas) return;
    const canvas = this.transport.createCanvas();
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    this.outputCanvas = canvas;
    this.outputStream = canvas.captureStream(DISPLAY_FPS);
    this.notify();
  }

  private fail(
    code: 'backend-unavailable' | 'missing-input' | 'transport',
    message: string,
    expectedEpoch: number,
  ): void {
    if (!this.isCurrentEpoch(expectedEpoch)) return;
    this.stop(code, message);
  }

  private stop(
    code?: 'backend-unavailable' | 'missing-input' | 'transport' | 'source-lost' | 'stale-epoch' | 'unauthorized' | 'busy',
    message?: string,
  ): void {
    const wasRunning = this.running;
    this.running = false;
    if (code === 'unauthorized') this.manualRestartRequired = true;
    // Invalidate every socket/worker callback before closing its resources.
    this.sessionEpoch = undefined;
    if (this.displayTimer) clearInterval(this.displayTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.displayTimer = undefined;
    this.statusTimer = undefined;
    try { void this.reader?.cancel(); } catch { /* disposal is best effort */ }
    // The presenter owns the viewport lease because it resolves all required
    // inputs before an adapter is invoked and must release it on epoch changes.
    try { this.ws?.close(); } catch { /* disposal is best effort */ }
    this.worker?.terminate();
    this.reader = undefined;
    this.lease = undefined;
    this.ws = undefined;
    this.worker = undefined;
    this.queue = [];
    this.pending = 0;
    this.inflight = 0;
    this.sequence = 0;
    if (code && message) {
      this.publishStatus({
        phase: code === 'source-lost' || code === 'stale-epoch' ? 'degraded' : 'failed',
        issue: { code, message, retryable: code !== 'unauthorized' },
      });
    } else if (wasRunning) {
      this.publishStatus({ phase: 'stopped' });
    }
  }

  private isCurrentEpoch(epoch: number): boolean {
    return !this.disposed && this.sessionEpoch === epoch;
  }

  private publishStatus(next: Partial<VisualPresentationStatus>): void {
    this.status = {
      ...this.status,
      ...next,
      ...((next.phase === 'live' || next.phase === 'connecting') ? { issue: undefined } : {}),
      backendId: 'fluxrt',
      profileId: 'viewport-enhancement',
      ...(this.current?.snapshot.stamp?.intentRevision !== undefined
        ? { appliedIntentRevision: this.current.snapshot.stamp.intentRevision } : {}),
      ...(this.current?.snapshot.stamp
        ? { appliedTransitionSequence: this.current.snapshot.stamp.transitionSequence } : {}),
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export class FluxRtAdapter implements VisualBackendAdapter {
  readonly descriptor = FLUXRT_DESCRIPTOR;
  readonly capabilities = FLUXRT_CAPABILITIES;

  constructor(private readonly transport: FluxRtTransport = defaultTransport()) {}

  createSession(options: { readonly profileId: string; readonly direction: VisualDirection }): VisualBackendSession {
    if (options.profileId !== 'viewport-enhancement') {
      throw new Error(`FluxRT does not provide profile ${options.profileId}`);
    }
    return new FluxRtSession(this.transport);
  }
}
