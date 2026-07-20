import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VisualPresentationManifestSchema,
  type VisualPresentationEntry,
} from '@forgeax/types/visual-generation';
import { evaluateVisualPresentation, mergeLatchedPrompts } from '../behavior-evaluator';
import { LingbotWorld2Adapter } from './lingbot-world-2';
import type { ResolvedVisualRequest } from '../adapter';

const REPO_ROOT = resolve(import.meta.dir, '../../../../../../');
const PRESENTATION_MANIFEST_PATH = resolve(
  REPO_ROOT,
  '.forgeax/games/visual-probe/visual-presentation/manifest.json',
);
const REFERENCE_CASES_ROOT = resolve(
  REPO_ROOT,
  'reference/js-sdk/examples/lingbot-world-2/lib/lingbot-cases',
);

function entry(continuityKey: string): VisualPresentationEntry {
  const manifest = VisualPresentationManifestSchema.parse(
    JSON.parse(readFileSync(PRESENTATION_MANIFEST_PATH, 'utf8')),
  );
  return manifest.entries.find((candidate) => candidate.continuityKey === continuityKey)!;
}

function evaluate(
  presentation: VisualPresentationEntry,
  options: {
    readonly behaviors?: Array<{
      recipeKey: string;
      instanceId: string;
      order?: number;
      actorId?: string;
    }>;
    readonly triggers?: Array<{
      recipeKey: string;
      instanceId: string;
      order?: number;
    }>;
    readonly exits?: Array<{
      recipeKey: string;
      instanceId: string;
      order?: number;
    }>;
    readonly signals?: Record<string, number>;
    readonly waterline?: number;
    readonly actors?: Array<{ id: string; name?: string }>;
  } = {},
) {
  let sequence = 1;
  const journalEntries = [
    ...(options.triggers ?? []).map((instance) => ({
      sequence: sequence++,
      operationId: `trigger:${instance.instanceId}`,
      programRevision: 1,
      type: 'behavior-trigger' as const,
      instance,
    })),
    ...(options.exits ?? []).map((instance) => ({
      sequence: sequence++,
      operationId: `exit:${instance.instanceId}`,
      programRevision: 1,
      type: 'behavior-exit' as const,
      instanceId: instance.instanceId,
      instance,
    })),
  ];
  return evaluateVisualPresentation({
    available: true,
    stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: sequence - 1 },
    intent: {
      revision: 1,
      value: {
        scene: {
          continuityKey: presentation.continuityKey,
          actors: (options.actors ?? []).map((actor) => ({
            id: actor.id,
            ...(actor.name ? { name: actor.name } : {}),
            stateTags: [],
          })),
        },
      },
    },
    program: {
      version: 1,
      revision: 1,
      lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
      signals: options.signals ?? {},
      activeBehaviors: options.behaviors ?? [],
      journal: { nextSequence: sequence, dropped: 0, entries: journalEntries },
      operations: [],
    },
  }, presentation, {
    prompt: true,
    motionTargets: new Set([
      'navigation.forward-rate',
      'navigation.strafe-rate',
      'camera.rotation.pitch-rate',
      'camera.rotation.yaw-rate',
      'camera.rotation.roll-rate',
      'camera.translation.y-rate',
      'camera.orbit.radius',
    ]),
  }, options.waterline ?? 0);
}

describe('LingBot golden prompt parity', () => {
  const cases = [
    ['noir-alley-patrol.json', 'visual-probe/noir-alley'],
    ['battlefield-horseman.json', 'visual-probe/battlefield-horseman'],
    ['jet-ski-cruise.json', 'visual-probe/jet-ski-cruise'],
  ] as const;

  for (const [filename, continuityKey] of cases) {
    test(`${continuityKey}: idle / moving / all events / stacks / jump / crouch / stand`, () => {
      const reference = JSON.parse(readFileSync(resolve(REFERENCE_CASES_ROOT, filename), 'utf8')) as {
        scene: {
          base: { default: string };
          camera: { default: { static: string; dynamic: string } };
          movement: { default: { static: string; dynamic: string } };
          events: Array<{ detail: string }>;
          jumpPrompt?: string;
          crouchPrompt?: string;
          standPrompt?: string;
        };
      };
      const presentation = entry(continuityKey);
      const text = (frame: ReturnType<typeof evaluate>) => (
        frame.prompt.map((contribution) => contribution.text).join(' ')
      );

      expect(text(evaluate(presentation))).toBe([
        reference.scene.base.default,
        reference.scene.camera.default.static,
        reference.scene.movement.default.static,
      ].join(' '));

      expect(text(evaluate(presentation, {
        behaviors: [{ recipeKey: 'locomotion', instanceId: 'move', order: 0 }],
      }))).toBe([
        reference.scene.base.default,
        reference.scene.camera.default.dynamic,
        reference.scene.movement.default.dynamic,
      ].join(' '));

      for (const [index, event] of reference.scene.events.entries()) {
        expect(text(evaluate(presentation, {
          behaviors: [{ recipeKey: `event-${index + 1}`, instanceId: `event-${index + 1}`, order: 100 }],
        }))).toContain(event.detail);
      }

      // Press order 2 then 0 → event-3 prose before event-1 prose.
      if (reference.scene.events.length >= 3) {
        const stacked = text(evaluate(presentation, {
          behaviors: [
            { recipeKey: 'event-3', instanceId: 'event-3', order: 100 },
            { recipeKey: 'event-1', instanceId: 'event-1', order: 101 },
          ],
        }));
        const first = stacked.indexOf(reference.scene.events[2]!.detail);
        const second = stacked.indexOf(reference.scene.events[0]!.detail);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(second).toBeGreaterThan(first);
      }

      for (const level of [1, 2, 3] as const) {
        const jump = evaluate(presentation, {
          triggers: [{ recipeKey: `jump-${level}`, instanceId: `jump-${level}` }],
        });
        if (reference.scene.jumpPrompt) {
          expect(jump.timelines.flatMap((timeline) => timeline.boundPrompts.map((prompt) => prompt.text)))
            .toContain(reference.scene.jumpPrompt);
        }
        expect(jump.timelines).toEqual(expect.arrayContaining([
          expect.objectContaining({
            durationChunks: level,
            boundPrompts: reference.scene.jumpPrompt
              ? [expect.objectContaining({ text: reference.scene.jumpPrompt })]
              : [],
          }),
        ]));
      }

      const crouch = evaluate(presentation, {
        behaviors: [{ recipeKey: 'crouch-camera', instanceId: 'vertical-posture', order: 1 }],
      });
      if (reference.scene.crouchPrompt) {
        expect(text(crouch)).toContain(reference.scene.crouchPrompt);
      }

      const stand = evaluate(presentation, {
        exits: [{ recipeKey: 'crouch-camera', instanceId: 'vertical-posture' }],
      });
      if (reference.scene.standPrompt) {
        expect(stand.timelines.flatMap((timeline) => timeline.boundPrompts.map((prompt) => prompt.text)))
          .toContain(reference.scene.standPrompt);
        expect(stand.timelines[0]?.boundPrompts.map((prompt) => prompt.text)).toContain(
          reference.scene.standPrompt,
        );
      }

      // After waterline consumes the trigger, latched prompts must still reconstruct jump prose.
      const jumpFrame = evaluate(presentation, {
        triggers: [{ recipeKey: 'jump-2', instanceId: 'jump-2' }],
      });
      const afterWaterline = evaluate(presentation, {
        triggers: [{ recipeKey: 'jump-2', instanceId: 'jump-2' }],
        waterline: 1,
      });
      expect(text(afterWaterline)).not.toContain(reference.scene.jumpPrompt ?? '___');
      const latched = mergeLatchedPrompts(
        afterWaterline.prompt,
        jumpFrame.timelines.flatMap((timeline) => timeline.boundPrompts),
        presentation.promptOrder,
      );
      if (reference.scene.jumpPrompt) {
        expect(latched.map((prompt) => prompt.text).join(' ')).toContain(reference.scene.jumpPrompt);
      }
    });
  }

  test('resolves {actor.name} / {target.name} placeholders from intent actors', () => {
    const presentation: VisualPresentationEntry = {
      continuityKey: 'names',
      promptOrder: ['events'],
      signals: [],
      baseline: { prompt: [], motion: [] },
      recipes: [{
        key: 'greet',
        active: {
          prompt: [{
            id: 'line',
            slot: 'events',
            text: '{actor.name} waves at {target.name}',
            mode: 'append',
            priority: 1,
            required: true,
          }],
          motion: [],
        },
      }],
    };
    const frame = evaluate(presentation, {
      behaviors: [{
        recipeKey: 'greet',
        instanceId: 'greet',
        actorId: 'hero',
        order: 1,
      }],
      actors: [{ id: 'hero', name: 'Ava' }, { id: 'npc', name: 'Bo' }],
    });
    // targetId omitted → missing placeholder diagnostic for required effect.
    expect(frame.diagnostics.some((item) => item.code === 'missing-placeholder')).toBe(true);

    const ok = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 0 },
      intent: {
        revision: 1,
        value: {
          scene: {
            actors: [
              { id: 'hero', name: 'Ava', stateTags: [] },
              { id: 'npc', name: 'Bo', stateTags: [] },
            ],
          },
        },
      },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [{
          recipeKey: 'greet',
          instanceId: 'greet',
          actorId: 'hero',
          targetId: 'npc',
        }],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
    }, presentation, { prompt: true, motionTargets: new Set() });
    expect(ok.prompt.map((item) => item.text)).toEqual(['Ava waves at Bo']);
  });
});

describe('LingBot adapter command trace', () => {
  test('accumulates mouse deltas until chunk_complete and packs per-latent jump arcs', async () => {
    const poses: number[][] = [];
    const prompts: string[] = [];
    let messageListener: ((message: Record<string, unknown>) => void) | undefined;
    let statusListener: ((status: 'ready' | 'disconnected') => void) | undefined;
    const client = {
      connect: async (getJwt: () => Promise<string>) => {
        await getJwt();
        statusListener?.('ready');
      },
      disconnect: async () => {},
      getStatus: () => 'ready' as const,
      on: (event: string, listener: typeof statusListener) => {
        if (event === 'statusChanged') statusListener = listener;
      },
      off: () => {},
      onMainVideo: () => () => {},
      onCommandError: () => () => {},
      onMessage: (listener: typeof messageListener) => {
        messageListener = listener;
        return () => { messageListener = undefined; };
      },
      uploadFile: async () => ({ uploadId: 'seed', name: 'seed.jpg', mimeType: 'image/jpeg', size: 4 }),
      reset: async () => { messageListener?.({ type: 'generation_reset' }); },
      setImage: async () => { messageListener?.({ type: 'image_accepted' }); },
      setPrompt: async (payload: { prompt: string }) => {
        prompts.push(payload.prompt);
        messageListener?.({ type: 'conditions_ready', has_image: true, has_prompt: true });
      },
      setCameraPose: async (payload: { camera_pose: number[] }) => {
        poses.push(payload.camera_pose);
      },
      setMoveLongitudinal: async () => {},
      setMoveLateral: async () => {},
      setLookHorizontal: async () => {},
      setLookVertical: async () => {},
      start: async () => {},
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/tokens')) {
        return Response.json({
          jwt: 'trace-jwt',
          leaseId: 'trace-lease',
          coordinatorUrl: 'https://api.reactor.inc',
        });
      }
      if (url.includes('/release')) return Response.json({ released: true });
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const presentation = entry('visual-probe/noir-alley');
      const adapter = new LingbotWorld2Adapter(() => client as never, async () => new Blob(['seed']));
      const session = adapter.createSession({
        profileId: 'navigable-world',
        direction: { prompt: '', seed: 42, rotationSpeedDeg: 5 },
      });

      const jumpFrame = evaluate(presentation, {
        triggers: [{ recipeKey: 'jump-1', instanceId: 'jump-1' }],
        signals: {
          'input.look-yaw': 0,
          'input.look-pitch': 0,
          'input.mouse-yaw-delta': 100,
          'input.mouse-pitch-delta': 50,
        },
      });

      const request: ResolvedVisualRequest = {
        snapshot: {
          available: true,
          stamp: { epoch: 1, run: 'play', intentRevision: 1, programRevision: 1, transitionSequence: 1 },
          intent: {
            revision: 1,
            value: {
              scene: { continuityKey: 'visual-probe/noir-alley', actors: [] },
              camera: { mode: 'third-person' },
            },
          },
          program: {
            version: 1,
            revision: 1,
            lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
            signals: jumpFrame.signals,
            activeBehaviors: [],
            journal: {
              nextSequence: 2,
              dropped: 0,
              entries: jumpFrame.transitions,
            },
            operations: [],
          },
          camera: {
            entity: 1,
            position: [0, 1, 2],
            forward: [0, 0, -1],
          },
        },
        direction: { prompt: '', seed: 42, rotationSpeedDeg: 5 },
        presentation,
        effectFrame: jumpFrame,
        seedImage: { continuityKey: 'visual-probe/noir-alley', blob: new Blob(['seed']) },
      };

      await session.reconcile(request);
      // Second reconcile adds more mouse before the chunk completes.
      await session.reconcile({
        ...request,
        effectFrame: {
          ...jumpFrame,
          signals: {
            ...jumpFrame.signals,
            'input.mouse-yaw-delta': 20,
            'input.mouse-pitch-delta': 0,
          },
        },
      });

      const jumpPrompt = jumpFrame.timelines[0]?.boundPrompts[0]?.text;
      expect(jumpPrompt).toBeDefined();
      expect(prompts.some((prompt) => prompt.includes(jumpPrompt!))).toBe(true);
      expect(poses).toHaveLength(0);
      messageListener?.({ type: 'chunk_complete', chunk_index: 0, active_action: 'still' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(poses.length).toBeGreaterThanOrEqual(1);
      const pose = poses[0]!;
      expect(pose).toHaveLength(18);
      // Per-latent ty for L1 default [1,0,-1] * JUMP_UP_SIGN → [-1, 0, 1]
      expect(pose[4]).toBeCloseTo(-1, 5);
      expect(pose[10]).toBeCloseTo(0, 5);
      expect(pose[16]).toBeCloseTo(1, 5);
      // Mouse 120px * 0.0003 = 0.036 yaw on every latent
      expect(pose[1]).toBeCloseTo(0.036, 5);
      expect(prompts.at(-1)).not.toContain(jumpPrompt!);

      await session.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
