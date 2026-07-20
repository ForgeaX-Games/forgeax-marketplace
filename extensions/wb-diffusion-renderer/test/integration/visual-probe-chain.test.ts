import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VisualPresentationManifestSchema,
  VisualPriorManifestSchema,
  type VisualPresentationEntry,
} from '@forgeax/types/visual-generation';
import {
  createEditorVisualSource,
  registerEditorVisualHost,
} from '../../../../../editor/packages/edit-runtime/src/viewport/visual-source';
import type { VisualSource, VisualSourceSnapshot } from '../../src/adapter';
import { LingbotWorld2Adapter } from '../../src/adapters/lingbot-world-2';
import { GenerativeVisualsPresenter } from '../../src/presenter';
import { firstSelection } from '../../src/selection';
import { evaluateVisualPresentation } from '../../src/behavior-evaluator';

const REPO_ROOT = resolve(import.meta.dir, '../../../../../../');
const VISUAL_PROBE_ROOT = '.forgeax/games/visual-probe';
const MANIFEST_PATH = resolve(REPO_ROOT, VISUAL_PROBE_ROOT, 'visual-priors/manifest.json');
const PRESENTATION_MANIFEST_PATH = resolve(
  REPO_ROOT,
  VISUAL_PROBE_ROOT,
  'visual-presentation/manifest.json',
);
const REFERENCE_CASES_ROOT = resolve(
  REPO_ROOT,
  'reference/js-sdk/examples/lingbot-world-2/lib/lingbot-cases',
);

const originalFetch = globalThis.fetch;
const cleanups: Array<() => void | Promise<void>> = [];

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = setTimeout(() => callback(Date.now()), 0);
    return id as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    clearTimeout(id);
  }) as typeof cancelAnimationFrame;
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

function mockLingbotClient(calls: string[]) {
  let messageListener: ((message: {
    type: string;
    has_image?: boolean;
    has_prompt?: boolean;
  }) => void) | undefined;
  let statusListener: ((status: 'ready' | 'disconnected') => void) | undefined;
  let mainVideoListener: ((track: unknown, stream: MediaStream) => void) | undefined;
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
    onMainVideo: (listener: typeof mainVideoListener) => {
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
      return { uploadId: 'seed', name: 'seed.jpg', mimeType: 'image/jpeg', size: 4 };
    },
    reset: async () => {
      calls.push('reset');
      messageListener?.({ type: 'generation_reset' });
    },
    setImage: async () => {
      calls.push('image');
      messageListener?.({ type: 'image_accepted' });
    },
    setPrompt: async () => {
      calls.push('prompt');
      messageListener?.({ type: 'conditions_ready', has_image: true, has_prompt: true });
    },
    setCameraPose: async () => {},
    setMoveLongitudinal: async () => { calls.push('longitudinal'); },
    setMoveLateral: async () => {},
    setLookHorizontal: async () => {},
    setLookVertical: async () => {},
    start: async () => { calls.push('start'); },
    emitMainVideo: (stream: MediaStream) => mainVideoListener?.({}, stream),
  };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3_000) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Presenter-facing source that keeps the Editor-resolved prior blob while
 * supplying the camera/intent snapshot LingBot requires. Camera ECS components
 * live in the engine package and are not resolvable from this marketplace test
 * graph without pulling `@forgeax/engine-runtime` into the plugin package.
 */
function presenterSourceFromEditorPrior(
  continuityKey: string,
  prior: Blob,
  presentation: VisualPresentationEntry,
): VisualSource {
  const snapshot: VisualSourceSnapshot = {
    available: true,
    stamp: {
      epoch: 1,
      run: 'play',
      intentRevision: 1,
      programRevision: 1,
      transitionSequence: 1,
    },
    intent: {
      revision: 1,
      value: {
        scene: {
          summary: 'visual probe',
          tags: ['probe'],
          continuityKey,
          actors: [],
        },
        camera: { mode: 'third-person' },
      },
    },
    program: {
      version: 1,
      revision: 1,
      lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
      signals: {
        'input.move-forward': 1,
        'input.move-strafe': 0,
        'input.look-yaw': 0,
        'input.look-pitch': 0,
        'input.orbit-radius': 0,
      },
      activeBehaviors: [{
        recipeKey: 'locomotion',
        instanceId: 'locomotion',
        actorId: 'hero',
      }],
      journal: { nextSequence: 2, dropped: 0, entries: [] },
      operations: [],
    },
    camera: {
      entity: 1,
      position: [0, 1, 2],
      forward: [0, 0, -1],
    },
    viewport: { width: 640, height: 360 },
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    leaseViewportTrack: () => ({
      stream: { getTracks: () => [], getVideoTracks: () => [{}] } as unknown as MediaStream,
      release: () => {},
    }),
    hasPriorCatalog: async () => true,
    resolveSeedImage: async (key) => {
      if (key !== continuityKey) {
        throw new Error(`No visual prior is registered for continuity key "${key}"`);
      }
      return prior;
    },
    resolvePresentation: async (key) => {
      if (key !== continuityKey) {
        throw new Error(`No visual presentation is registered for continuity key "${key}"`);
      }
      return presentation;
    },
    dispose: () => {},
  };
}

describe('visual-probe production chain', () => {
  test('generated manifest preserves reference prompt prose and order', () => {
    const manifest = VisualPresentationManifestSchema.parse(
      JSON.parse(readFileSync(PRESENTATION_MANIFEST_PATH, 'utf8')),
    );
    const cases = [
      ['noir-alley-patrol.json', 'visual-probe/noir-alley'],
      ['battlefield-horseman.json', 'visual-probe/battlefield-horseman'],
      ['jet-ski-cruise.json', 'visual-probe/jet-ski-cruise'],
    ] as const;
    for (const [filename, continuityKey] of cases) {
      const reference = JSON.parse(readFileSync(resolve(REFERENCE_CASES_ROOT, filename), 'utf8')) as {
        scene: {
          base: { default: string };
          camera: { default: { static: string; dynamic: string } };
          movement: { default: { static: string; dynamic: string } };
          events: Array<{ detail: string }>;
        };
      };
      const entry = manifest.entries.find((candidate) => candidate.continuityKey === continuityKey)!;
      const evaluate = (behaviors: Array<{ recipeKey: string; instanceId: string; order?: number }>) => {
        const frame = evaluateVisualPresentation({
          available: true,
          stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 0 },
          program: {
            version: 1,
            revision: 1,
            lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
            signals: {},
            activeBehaviors: behaviors,
            journal: { nextSequence: 1, dropped: 0, entries: [] },
            operations: [],
          },
        }, entry, { prompt: true, motionTargets: new Set() });
        return frame.prompt.map((contribution) => contribution.text).join(' ');
      };
      expect(evaluate([])).toBe([
        reference.scene.base.default,
        reference.scene.camera.default.static,
        reference.scene.movement.default.static,
      ].join(' '));
      expect(evaluate([{ recipeKey: 'locomotion', instanceId: 'move' }])).toBe([
        reference.scene.base.default,
        reference.scene.camera.default.dynamic,
        reference.scene.movement.default.dynamic,
      ].join(' '));
      expect(evaluate([{ recipeKey: 'event-1', instanceId: 'event-1', order: 1 }])).toBe([
        reference.scene.base.default,
        reference.scene.camera.default.static,
        reference.scene.movement.default.static,
        reference.scene.events[0]!.detail,
      ].join(' '));
    }
  });

  test('the same app recipe key resolves to scene-owned semantics', () => {
    const presentationManifest = VisualPresentationManifestSchema.parse(
      JSON.parse(readFileSync(PRESENTATION_MANIFEST_PATH, 'utf8')),
    );
    const evaluate = (continuityKey: string) => evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 0 },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [{ recipeKey: 'event-1', instanceId: 'event-1', actorId: 'hero' }],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
    }, presentationManifest.entries.find((entry) => entry.continuityKey === continuityKey)!, {
      prompt: true,
      motionTargets: new Set(),
    }).prompt.map((contribution) => contribution.text).join(' ');

    expect(evaluate('visual-probe/noir-alley')).toContain('service pistol');
    expect(evaluate('visual-probe/jet-ski-cruise')).toContain('meteors');
  });

  test('manifest → Editor source prior → Presenter → production LingBot adapter → output', async () => {
    const manifest = VisualPriorManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
    expect(manifest.entries.map((entry) => entry.continuityKey)).toContain('visual-probe/noir-alley');
    const presentationManifest = VisualPresentationManifestSchema.parse(
      JSON.parse(readFileSync(PRESENTATION_MANIFEST_PATH, 'utf8')),
    );
    const presentation = presentationManifest.entries.find(
      (entry) => entry.continuityKey === 'visual-probe/noir-alley',
    )!;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/files?')) {
        const path = decodeURIComponent(new URL(url, 'http://localhost').searchParams.get('path') ?? '');
        const absolute = resolve(REPO_ROOT, path);
        return Response.json({ content: readFileSync(absolute, 'utf8') });
      }
      if (url.startsWith('/api/files/raw?')) {
        const path = decodeURIComponent(new URL(url, 'http://localhost').searchParams.get('path') ?? '');
        const absolute = resolve(REPO_ROOT, path);
        const bytes = readFileSync(absolute);
        return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
      }
      if (url.includes('/tokens')) {
        return Response.json({
          jwt: 'probe-jwt',
          leaseId: 'probe-lease',
          coordinatorUrl: 'https://api.reactor.inc',
        });
      }
      if (url.includes('/release')) {
        return Response.json({ released: true });
      }
      throw new Error(`Unexpected fetch in visual-probe chain test: ${url} ${init?.method ?? ''}`);
    }) as typeof fetch;

    const canvas = {
      width: 640,
      height: 360,
      captureStream: () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    } as unknown as HTMLCanvasElement;

    const unregister = registerEditorVisualHost({
      gateway: {
        activeWorld: {
          hasResource: () => false,
          getResource: () => {
            throw new Error('unused');
          },
          insertResource: () => {},
          get: () => ({ ok: false as const }),
        } as never,
        mode: 'play',
        subscribe: () => () => {},
      },
      canvas,
      gameRoot: VISUAL_PROBE_ROOT,
      getActiveCameraEntity: () => undefined,
    });
    cleanups.push(unregister);

    const editorSource = createEditorVisualSource();
    cleanups.push(() => editorSource.dispose());

    expect(await editorSource.hasPriorCatalog()).toBe(true);
    const prior = await editorSource.resolveSeedImage('visual-probe/noir-alley');
    const resolvedPresentation = await editorSource.resolvePresentation('visual-probe/noir-alley');
    expect(resolvedPresentation).toEqual(presentation);
    expect(prior.type.startsWith('image/')).toBe(true);
    expect(prior.size).toBeGreaterThan(0);

    const calls: string[] = [];
    const client = mockLingbotClient(calls);
    const adapter = new LingbotWorld2Adapter(() => client as never);
    const presenter = new GenerativeVisualsPresenter(
      presenterSourceFromEditorPrior('visual-probe/noir-alley', prior, resolvedPresentation!),
      [adapter],
    );
    cleanups.push(async () => {
      await presenter.dispose();
    });

    const selection = firstSelection({ adapters: [adapter] }, { priorCatalogAvailable: true });
    expect(selection.backendId).toBe('reactor-lingbot-world-2');

    await presenter.select({
      ...selection,
      direction: { prompt: 'probe direction' },
    });
    await waitFor(() => calls.includes('start'), 'production adapter start');
    expect(calls).toEqual(expect.arrayContaining([
      'connect',
      'upload',
      'image',
      'prompt',
      'start',
    ]));
    expect(presenter.getSnapshot().status.phase).toBe('waiting');

    client.emitMainVideo({} as MediaStream);
    await waitFor(() => presenter.getSnapshot().status.phase === 'live', 'panel live');
    expect(presenter.getSnapshot().output).toBeDefined();
  });
});
