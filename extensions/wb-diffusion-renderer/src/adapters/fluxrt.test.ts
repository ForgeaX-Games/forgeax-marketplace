import { afterEach, describe, expect, test } from 'bun:test';
import type { ResolvedVisualRequest } from '../adapter';
import {
  FLUXRT_MAX_INFLIGHT,
  FLUXRT_MAX_QUEUE,
  FluxRtAdapter,
  packFluxRtUplink,
  type FluxRtTransport,
} from './fluxrt';

function fakeMediaStream(): MediaStream {
  return {
    getTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer | string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: ArrayBuffer[] = [];

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

class MockWorker {
  onmessage: ((event: MessageEvent<{ seq: number; ts: number; jpeg: ArrayBuffer | null }>) => void) | null = null;
  readonly posts: unknown[] = [];
  terminated = false;

  postMessage(payload: unknown): void {
    this.posts.push(payload);
    if (
      payload
      && typeof payload === 'object'
      && 'type' in payload
      && (payload as { type: string }).type === 'frame'
    ) {
      const frame = payload as { seq: number; ts: number };
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            seq: frame.seq,
            ts: frame.ts,
            jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
          },
        } as MessageEvent<{ seq: number; ts: number; jpeg: ArrayBuffer | null }>);
      });
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

function makeReadable(frameCount = 4): ReadableStream<VideoFrame> {
  let index = 0;
  return new ReadableStream<VideoFrame>({
    pull(controller) {
      if (index >= frameCount) {
        controller.close();
        return;
      }
      const id = index++;
      controller.enqueue({
        close: () => {},
        id,
      } as unknown as VideoFrame);
    },
  });
}

function makeRequest(
  epoch: number,
  readable: ReadableStream<VideoFrame> = makeReadable(),
): ResolvedVisualRequest {
  return {
    snapshot: {
      available: true,
      stamp: { epoch, run: 'play', intentRevision: epoch, transitionSequence: 0 },
      intent: {
        revision: epoch,
        value: {
          scene: { tags: ['city'], actors: [] },
          camera: { mode: 'third-person' },
        },
      },
      program: {
        version: 1,
        revision: epoch,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
      viewport: { width: 640, height: 360 },
    },
    direction: { prompt: 'city street', seed: 7, quality: 'realtime' },
    viewportLease: {
      stream: {
        getVideoTracks: () => [{} as MediaStreamTrack],
      } as MediaStream,
      release: () => {},
    },
  };
}

function makeTransport(options: {
  readonly sockets?: MockWebSocket[];
  readonly workers?: MockWorker[];
  readonly readable?: ReadableStream<VideoFrame>;
  readonly createReadable?: () => ReadableStream<VideoFrame>;
} = {}): FluxRtTransport {
  const sockets = options.sockets ?? [];
  const workers = options.workers ?? [];
  const createReadable = options.createReadable
    ?? (() => options.readable ?? makeReadable());
  return {
    createWorker: () => {
      const worker = new MockWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    createWebSocket: (url) => {
      const socket = new MockWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    createCanvas: () => {
      const canvas = {
        width: 0,
        height: 0,
        captureStream: () => fakeMediaStream(),
        getContext: () => ({ drawImage: () => {} }),
      };
      return canvas as unknown as HTMLCanvasElement;
    },
    getLocation: () => ({ protocol: 'http:', host: 'localhost:18920' }),
    MediaStreamTrackProcessor: class {
      readable: ReadableStream<VideoFrame>;
      constructor(_options: { track: MediaStreamTrack }) {
        this.readable = createReadable();
      }
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const sessions: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  while (sessions.length > 0) {
    await sessions.pop()!.dispose();
  }
});

describe('FluxRT adapter protocol', () => {
  test('preserves FRFP JSON-header plus JPEG binary framing', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
    const packet = packFluxRtUplink(7, 123.5, {
      prompt: 'city street',
      steps: 2,
      interp: 1,
      seed: 42,
    }, jpeg);
    const headerLength = new DataView(packet).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(packet, 4, headerLength)));

    expect(header).toEqual({
      seq: 7,
      ts: 123.5,
      prompt: 'city street',
      steps: 2,
      interp: 1,
      seed: 42,
    });
    expect([...new Uint8Array(packet, 4 + headerLength)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });
});

describe('FluxRT session lifecycle', () => {
  test('starts live and stops cleanly on dispose', async () => {
    const sockets: MockWebSocket[] = [];
    const workers: MockWorker[] = [];
    const transport = makeTransport({ sockets, workers, readable: makeReadable(3) });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: 'city street', seed: 7, quality: 'realtime' },
    });
    sessions.push(session);

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'live');
    expect(sockets[0]?.url).toBe('ws://localhost:18920/ws/generative-visuals/fluxrt');
    expect(session.output).toBeDefined();

    await session.dispose();
    expect(session.getStatus().phase).toBe('stopped');
    expect(workers[0]?.terminated).toBe(true);
  });

  test('marks stale epochs degraded then restarts on the new epoch', async () => {
    const sockets: MockWebSocket[] = [];
    const phases: string[] = [];
    const transport = makeTransport({
      sockets,
      createReadable: () => makeReadable(2),
    });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '', seed: 1 },
    });
    sessions.push(session);
    session.subscribe(() => { phases.push(session.getStatus().phase); });

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'first live');

    await session.reconcile(makeRequest(2));
    await waitFor(() => phases.includes('degraded'), 'stale-epoch degraded');
    await waitFor(() => session.getStatus().phase === 'live', 'second live');
    expect(phases).toContain('degraded');
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    sockets[0]?.onmessage?.({ data: 'not-json' } as MessageEvent<string>);
    expect(session.getStatus().phase).toBe('live');
  });

  test('maps unauthorized relay close to a non-retryable failure', async () => {
    const sockets: MockWebSocket[] = [];
    const transport = makeTransport({ sockets, readable: makeReadable(2) });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '' },
    });
    sessions.push(session);

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'live');
    sockets[0]?.close(1008, 'unauthorized: visual-access-denied');
    await waitFor(() => session.getStatus().phase === 'failed', 'unauthorized failure');
    expect(session.getStatus().issue).toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });
  });

  test('maps busy control messages to busy failures', async () => {
    const sockets: MockWebSocket[] = [];
    const transport = makeTransport({ sockets, readable: makeReadable(2) });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '' },
    });
    sessions.push(session);

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'live');
    sockets[0]?.onmessage?.({
      data: JSON.stringify({ type: 'busy', error: 'provider saturated' }),
    } as MessageEvent<string>);
    await waitFor(() => session.getStatus().phase === 'failed', 'busy failure');
    expect(session.getStatus().issue?.code).toBe('busy');
  });

  test('fails closed when the presenter omits a viewport lease', async () => {
    const sockets: MockWebSocket[] = [];
    const transport = makeTransport({ sockets });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '' },
    });
    sessions.push(session);

    const request = makeRequest(1);
    delete (request as { viewportLease?: unknown }).viewportLease;
    await session.reconcile(request);
    await waitFor(() => session.getStatus().phase === 'failed', 'missing lease');
    expect(session.getStatus().issue?.code).toBe('missing-input');
  });

  test('drops frames while pending or at inflight capacity', async () => {
    const sockets: MockWebSocket[] = [];
    const workers: MockWorker[] = [];
    const closed: string[] = [];
    let pullCount = 0;
    const readable = new ReadableStream<VideoFrame>({
      pull(controller) {
        if (pullCount >= 6) {
          controller.close();
          return;
        }
        const id = `frame-${pullCount++}`;
        controller.enqueue({
          close: () => { closed.push(id); },
        } as unknown as VideoFrame);
      },
    });
    const transport = makeTransport({ sockets, workers, readable });
    transport.createWorker = () => {
      const worker = new MockWorker();
      workers.push(worker);
      worker.postMessage = (payload: unknown) => {
        worker.posts.push(payload);
      };
      return worker as unknown as Worker;
    };

    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '' },
    });
    sessions.push(session);

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'live');
    await waitFor(() => closed.length >= 1, 'dropped frames');
    expect(closed.length).toBeGreaterThan(0);
    expect(FLUXRT_MAX_INFLIGHT).toBe(2);
    expect(FLUXRT_MAX_QUEUE).toBe(4);
  });

  test('trims the downlink display queue to FLUXRT_MAX_QUEUE', async () => {
    const sockets: MockWebSocket[] = [];
    const transport = makeTransport({ sockets, readable: makeReadable(1) });
    const session = new FluxRtAdapter(transport).createSession({
      profileId: 'viewport-enhancement',
      direction: { prompt: '' },
    });
    sessions.push(session);

    await session.reconcile(makeRequest(1));
    await waitFor(() => session.getStatus().phase === 'live', 'live');

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const sizes = Array.from({ length: FLUXRT_MAX_QUEUE + 3 }, () => jpeg.byteLength);
    const header = new TextEncoder().encode(JSON.stringify({ sizes, server_ms: 12 }));
    const buffer = new Uint8Array(4 + header.length + sizes.reduce((sum, size) => sum + size, 0));
    new DataView(buffer.buffer).setUint32(0, header.length, true);
    buffer.set(header, 4);
    let offset = 4 + header.length;
    for (const size of sizes) {
      buffer.set(jpeg, offset);
      offset += size;
    }
    sockets[0]?.onmessage?.({ data: buffer.buffer } as MessageEvent<ArrayBuffer>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.getStatus().phase).toBe('live');
    expect(session.getStatus().droppedUpdates).toBeLessThanOrEqual(FLUXRT_MAX_QUEUE);
  });
});
