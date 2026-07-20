import { afterEach, describe, expect, test } from 'bun:test';
import {
  ProductionLingbotSmokeHarness,
  type FixtureInput,
} from './production-smoke-harness';

const originalFetch = globalThis.fetch;
const harnesses: ProductionLingbotSmokeHarness[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    await harness.disconnect(false);
    harness.dispose();
  }
});

function fixture(id = '00'): FixtureInput {
  return {
    id,
    image: new Blob(['fixture-image'], { type: 'image/jpeg' }),
    prompt: 'A test fixture prompt.',
  };
}

function mockClient(calls: string[], options: { readonly autoConfirm?: boolean } = {}) {
  let mainVideoListener: ((track: unknown, stream: MediaStream) => void) | undefined;
  let messageListener: ((message: {
    type: string;
    has_image?: boolean;
    has_prompt?: boolean;
  }) => void) | undefined;
  let statusListener: ((status: 'ready' | 'disconnected') => void) | undefined;
  const autoConfirm = options.autoConfirm !== false;
  return {
    connect: async (getJwt: () => Promise<string>) => {
      calls.push('connect');
      await getJwt();
      statusListener?.('ready');
    },
    disconnect: async () => { calls.push('disconnect'); },
    getStatus: () => 'ready' as const,
    on: (event: string, listener: typeof statusListener) => {
      if (event === 'statusChanged') statusListener = listener;
    },
    off: () => {},
    onMainVideo: (listener: (track: unknown, stream: MediaStream) => void) => {
      mainVideoListener = listener;
      return () => { mainVideoListener = undefined; };
    },
    onCommandError: () => () => {},
    onMessage: (listener: typeof messageListener) => {
      messageListener = listener;
      return () => { messageListener = undefined; };
    },
    uploadFile: async () => {
      calls.push('upload');
      return { uploadId: 'file-ref', name: 'fixture.jpg', mimeType: 'image/jpeg', size: 4 };
    },
    reset: async () => {
      calls.push('reset');
      messageListener?.({ type: 'generation_reset' });
    },
    setImage: async () => {
      calls.push('image');
      if (autoConfirm) messageListener?.({ type: 'image_accepted' });
    },
    setPrompt: async ({ prompt }: { prompt: string }) => {
      calls.push(`prompt:${prompt}`);
      if (autoConfirm) {
        messageListener?.({ type: 'conditions_ready', has_image: true, has_prompt: true });
      }
    },
    setCameraPose: async () => {},
    setMoveLongitudinal: async ({ move_longitudinal }: { move_longitudinal: string }) => {
      calls.push(`longitudinal:${move_longitudinal}`);
    },
    setMoveLateral: async ({ move_lateral }: { move_lateral: string }) => {
      calls.push(`lateral:${move_lateral}`);
    },
    setLookHorizontal: async ({ look_horizontal }: { look_horizontal: string }) => {
      calls.push(`look-h:${look_horizontal}`);
    },
    setLookVertical: async ({ look_vertical }: { look_vertical: string }) => {
      calls.push(`look-v:${look_vertical}`);
    },
    start: async () => { calls.push('start'); },
    emitMainVideo: (stream: MediaStream) => mainVideoListener?.({}, stream),
    confirmImage: () => messageListener?.({ type: 'image_accepted' }),
    confirmConditions: () => messageListener?.({
      type: 'conditions_ready',
      has_image: true,
      has_prompt: true,
    }),
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

describe('ProductionLingbotSmokeHarness', () => {
  test('drives the production Presenter/Adapter seed path and releases on stop', async () => {
    const calls: string[] = [];
    const client = mockClient(calls);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/tokens')) {
        calls.push(`token:${init?.method}`);
        return Response.json({
          jwt: 'fixture-jwt',
          leaseId: 'fixture-lease',
          coordinatorUrl: 'https://api.reactor.inc',
        expiresAt: Math.floor(Date.now() / 1_000) + 600,
        });
      }
      calls.push(`release:${init?.method}`);
      return Response.json({ released: true });
    }) as typeof fetch;

    const harness = new ProductionLingbotSmokeHarness({
      createClient: () => client as never,
      onVideo: (stream) => {
        calls.push(stream ? 'main-video' : 'main-video-cleared');
      },
    });
    harnesses.push(harness);

    await harness.connect(fixture());
    await waitFor(() => calls.includes('start'), 'start');

    expect(calls).toContain('token:POST');
    expect(calls).toContain('connect');
    expect(calls).toContain('upload');
    expect(calls).toContain('image');
    expect(calls.some((call) => call.startsWith('prompt:') && call.includes('A test fixture prompt.'))).toBe(true);
    expect(calls).toContain('start');
    expect(calls.indexOf('token:POST')).toBeLessThan(calls.indexOf('connect'));
    expect(calls.indexOf('image')).toBeLessThan(calls.indexOf('start'));
    expect(harness.getCostState()).toMatchObject({
      state: 'billable',
    });

    client.emitMainVideo({} as MediaStream);
    await waitFor(() => harness.getPresenterStatus().phase === 'live', 'live after main_video');
    expect(calls).toContain('main-video');
    expect(harness.getState()).toMatchObject({
      phase: 'live',
      fixtureId: '00',
    });

    await harness.updatePrompt('A new prompt.');
    await waitFor(
      () => calls.some((call) => call.startsWith('prompt:') && call.includes('A new prompt.')),
      'prompt update',
    );

    await harness.disconnect();
    await waitFor(() => calls.includes('release:POST'), 'lease release');
    expect(calls).toContain('disconnect');
    expect(harness.getState().phase).toBe('stopped');
  });

  test('surfaces token failures before the adapter uploads a fixture', async () => {
    const calls: string[] = [];
    const client = mockClient(calls);
    globalThis.fetch = (async () => Response.json(
      { error: 'token rejected' },
      { status: 403 },
    )) as typeof fetch;

    const harness = new ProductionLingbotSmokeHarness({
      createClient: () => client as never,
    });
    harnesses.push(harness);

    await harness.connect(fixture());
    await waitFor(
      () => harness.getPresenterStatus().phase === 'failed',
      'failed status',
    );

    expect(calls).toEqual([]);
    expect(harness.getState()).toMatchObject({
      phase: 'failed',
      fixtureId: '00',
    });
    expect(harness.getPresenterStatus().issue?.message).toContain('token rejected');
  });

  test('waits for Reactor image+prompt acceptance before starting', async () => {
    const calls: string[] = [];
    const client = mockClient(calls, { autoConfirm: false });
    globalThis.fetch = (async () => Response.json({
      jwt: 'fixture-jwt',
      leaseId: 'fixture-lease',
      coordinatorUrl: 'https://api.reactor.inc',
    })) as typeof fetch;

    const harness = new ProductionLingbotSmokeHarness({
      createClient: () => client as never,
    });
    harnesses.push(harness);

    const connecting = harness.connect(fixture());
    await waitFor(() => calls.includes('image'), 'image upload');
    expect(calls).not.toContain('start');
    expect(calls).not.toContain('prompt:A test fixture prompt.');

    client.confirmImage();
    await waitFor(
      () => calls.some((call) => call.startsWith('prompt:') && call.includes('A test fixture prompt.')),
      'prompt',
    );
    expect(calls).not.toContain('start');

    client.confirmConditions();
    await connecting;
    await waitFor(() => calls.includes('start'), 'start');
    expect(calls).toContain('start');
  });
});
