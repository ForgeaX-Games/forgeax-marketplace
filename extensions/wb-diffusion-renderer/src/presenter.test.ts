import { describe, expect, test } from 'bun:test';
import type { VisualBackendAdapter, VisualSource } from './adapter';
import { GenerativeVisualsPresenter } from './presenter';

describe('GenerativeVisualsPresenter', () => {
  test('passes one evaluated batch and advances only after reconcile resolves', async () => {
    const received: number[] = [];
    const adapter: VisualBackendAdapter = {
      descriptor: {
        id: 'test',
        label: 'Test',
        profiles: [{
          id: 'default',
          label: 'Default',
          requiredInputs: [],
          outputs: ['presentation-stream'],
          controls: [],
        }],
      },
      capabilities: { prompt: true, motionTargets: new Set() },
      createSession: () => ({
        descriptor: adapter.descriptor,
        profileId: 'default',
        output: undefined,
        getStatus: () => ({ phase: 'live' }),
        subscribe: () => () => {},
        reconcile: async (input) => {
          received.push(input.effectFrame?.transitions.length ?? -1);
          return { transitionSequence: input.effectFrame?.transitions.at(-1)?.sequence ?? 0 };
        },
        dispose: async () => {},
      }),
    };
    const source: VisualSource = {
      getSnapshot: () => ({
        available: true,
        stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 1 },
        intent: { revision: 1, value: { scene: { continuityKey: 'scene', tags: [], actors: [] } } },
        program: {
          version: 1,
          revision: 1,
          lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
          signals: {},
          activeBehaviors: [],
          journal: { nextSequence: 2, dropped: 0, entries: [] },
          operations: [],
        },
      }),
      subscribe: () => () => {},
      leaseViewportTrack: () => { throw new Error('unused'); },
      hasPriorCatalog: async () => false,
      resolveSeedImage: async () => new Blob(),
      resolvePresentation: async () => ({
        continuityKey: 'scene',
        signals: [],
        baseline: { prompt: [], motion: [] },
        recipes: [],
      }),
      dispose: () => {},
    };
    const presenter = new GenerativeVisualsPresenter(source, [adapter]);
    await presenter.select({ backendId: 'test', profileId: 'default', direction: { prompt: '' } });
    for (let attempt = 0; attempt < 10 && received.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(received).toEqual([0]);
    await presenter.dispose();
  });

  test('retries an unacknowledged transition after adapter failure', async () => {
    const transition = {
      sequence: 1,
      operationId: 'enter',
      programRevision: 1,
      type: 'behavior-enter' as const,
      instance: { recipeKey: 'flash', instanceId: 'flash' },
    };
    let notify = () => {};
    const seen: number[] = [];
    let attempts = 0;
    const adapter: VisualBackendAdapter = {
      descriptor: {
        id: 'retry',
        label: 'Retry',
        profiles: [{ id: 'default', label: 'Default', requiredInputs: [], outputs: ['presentation-stream'], controls: [] }],
      },
      capabilities: { prompt: true, motionTargets: new Set() },
      createSession: () => ({
        descriptor: adapter.descriptor,
        profileId: 'default',
        output: undefined,
        getStatus: () => ({ phase: 'live' }),
        subscribe: () => () => {},
        reconcile: async (input) => {
          seen.push(input.effectFrame?.transitions[0]?.sequence ?? 0);
          attempts += 1;
          if (attempts === 1) throw new Error('temporary provider failure');
          return { transitionSequence: 1 };
        },
        dispose: async () => {},
      }),
    };
    const source: VisualSource = {
      getSnapshot: () => ({
        available: true,
        stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 1 },
        intent: { revision: 1, value: { scene: { continuityKey: 'scene', tags: [], actors: [] } } },
        program: {
          version: 1,
          revision: 1,
          lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
          signals: {},
          activeBehaviors: [],
          journal: { nextSequence: 2, dropped: 0, entries: [transition] },
          operations: [],
        },
      }),
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      leaseViewportTrack: () => { throw new Error('unused'); },
      hasPriorCatalog: async () => false,
      resolveSeedImage: async () => new Blob(),
      resolvePresentation: async () => ({ continuityKey: 'scene', signals: [], baseline: { prompt: [], motion: [] }, recipes: [{ key: 'flash' }] }),
      dispose: () => {},
    };
    const presenter = new GenerativeVisualsPresenter(source, [adapter]);
    await presenter.select({ backendId: 'retry', profileId: 'default', direction: { prompt: '' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    notify();
    for (let attempt = 0; attempt < 10 && attempts < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(seen).toEqual([1, 1]);
    await presenter.dispose();
  });
});
