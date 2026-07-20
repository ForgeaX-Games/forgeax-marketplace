import { describe, expect, test } from 'bun:test';
import { evaluateVisualPresentation } from './behavior-evaluator';

describe('visual behavior evaluator', () => {
  test('merges declarative recipes deterministically', () => {
    const frame = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 1 },
      intent: { revision: 1, value: { scene: { continuityKey: 'scene', tags: [], actors: [] } } },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: { speed: 0.5 },
        activeBehaviors: [{ recipeKey: 'submarine-descend', instanceId: 'hero', actorId: 'hero' }],
        journal: { nextSequence: 2, dropped: 0, entries: [] },
        operations: [],
      },
    }, {
      continuityKey: 'scene',
      signals: [{ key: 'speed', type: 'number', default: 0, min: -1, max: 1 }],
      baseline: { prompt: [], motion: [] },
      recipes: [{
        key: 'submarine-descend',
        priority: 0,
        active: {
          prompt: [{
            id: 'descend',
            slot: 'world',
            text: '{actor.id} descends.',
            mode: 'append',
            priority: 0,
            required: false,
          }],
          motion: [{
            id: 'dive',
            target: 'camera.translation.y-rate',
            blend: 'add',
            priority: 0,
            required: false,
            scaleByIntensity: false,
            source: { kind: 'signal', key: 'speed', scale: -1, invert: false },
          }],
        },
      }],
    }, {
      prompt: true,
      motionTargets: new Set(['camera.translation.y-rate']),
    });
    expect(frame.prompt.map((item) => item.text)).toEqual(['hero descends.']);
    expect(frame.continuousMotion).toEqual([{ target: 'camera.translation.y-rate', value: -0.5 }]);
  });

  test('resolves replace priority per slot and preserves creative direction', () => {
    const frame = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 0 },
      program: {
        version: 1,
        revision: 1,
        creativeDirection: 'Keep the rain strongly backlit.',
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [{ recipeKey: 'moving', instanceId: 'movement' }],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
    }, {
      continuityKey: 'scene',
      signals: [],
      baseline: {
        prompt: [{ id: 'idle', slot: 'movement', text: 'stands still', mode: 'replace', priority: 0, required: false }],
        motion: [],
      },
      recipes: [{
        key: 'moving',
        priority: 20,
        active: {
          prompt: [{ id: 'walk', slot: 'movement', text: 'walks forward', mode: 'replace', priority: 20, required: false }],
          motion: [],
        },
      }],
    }, { prompt: true, motionTargets: new Set() });

    expect(frame.prompt.map((item) => item.text)).toEqual([
      'Keep the rain strongly backlit.',
      'walks forward',
    ]);
  });

  test('clamps declared signals, isolates required effects, and emits timeline descriptors', () => {
    const frame = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 1 },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: { speed: 4, undeclared: true },
        activeBehaviors: [{
          recipeKey: 'required-motion',
          instanceId: 'required-motion',
        }],
        journal: {
          nextSequence: 2,
          dropped: 0,
          entries: [{
            sequence: 1,
            operationId: 'enter',
            programRevision: 1,
            type: 'behavior-enter',
            instance: {
              recipeKey: 'timeline',
              instanceId: 'timeline',
              effectOverrides: {
                timelines: [{
                  phase: 'enter',
                  trackId: 'rise',
                  durationChunks: 1,
                  interpolation: 'step',
                  keyframes: [{ at: 0, value: -1 }, { at: 1, value: 1 }],
                }],
              },
            },
          }],
        },
        operations: [],
      },
    }, {
      continuityKey: 'scene',
      signals: [{ key: 'speed', type: 'number', default: 0, min: -1, max: 1 }],
      baseline: { prompt: [], motion: [] },
      recipes: [
        {
          key: 'required-motion',
          active: {
            prompt: [{ id: 'caption', slot: 'events', text: 'must not remain', mode: 'append', priority: 0, required: false }],
            motion: [{
              id: 'unsupported',
              target: 'camera.offset.x',
              blend: 'add',
              priority: 0,
              required: true,
              scaleByIntensity: false,
              source: { kind: 'signal', key: 'speed', scale: 1, invert: false },
            }],
          },
        },
        {
          key: 'timeline',
          enter: {
            motion: [{
              id: 'rise',
              target: 'camera.offset.y',
              blend: 'replace',
              priority: 1,
              required: false,
              scaleByIntensity: false,
              source: { kind: 'constant', value: 0 },
              timeline: {
                durationChunks: 2,
                interpolation: 'linear',
                keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
              },
            }],
            prompt: [{ id: 'rise-prompt', slot: 'vertical', text: 'rises', mode: 'append', priority: 1, required: false }],
          },
        },
      ],
    }, {
      prompt: true,
      motionTargets: new Set(['camera.offset.y']),
    });

    expect(frame.prompt.map((value) => value.text)).not.toContain('must not remain');
    expect(frame.timelines).toMatchObject([{
      target: 'camera.offset.y',
      durationChunks: 1,
      interpolation: 'step',
      keyframes: [{ at: 0, value: -1 }, { at: 1, value: 1 }],
      boundPrompts: [{ text: 'rises', slot: 'vertical' }],
    }]);
    expect(frame.diagnostics.map((value) => value.code)).toEqual(expect.arrayContaining([
      'invalid-signal',
      'instance-rejected',
    ]));
  });

  test('reports prompt budget overflow without silently truncating contributions', () => {
    const frame = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 0 },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
    }, {
      continuityKey: 'scene',
      signals: [],
      baseline: {
        prompt: [{
          id: 'large',
          slot: 'world',
          text: 'x'.repeat(2_001),
          mode: 'append',
          priority: 0,
          required: false,
        }],
        motion: [],
      },
      recipes: [],
    }, { prompt: true, motionTargets: new Set() });

    expect(frame.prompt[0]?.text.length).toBe(2_001);
    expect(frame.diagnostics.map((diagnostic) => diagnostic.code)).toContain('prompt-budget');
  });

  test('ignores a runtime timeline override that does not target a declared timeline', () => {
    const frame = evaluateVisualPresentation({
      available: true,
      stamp: { epoch: 1, run: 'play', programRevision: 1, transitionSequence: 1 },
      program: {
        version: 1,
        revision: 1,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: {},
        activeBehaviors: [],
        journal: {
          nextSequence: 2,
          dropped: 0,
          entries: [{
            sequence: 1,
            operationId: 'test',
            programRevision: 1,
            type: 'behavior-trigger',
            instance: {
              recipeKey: 'effect',
              instanceId: 'effect',
              effectOverrides: {
                timelines: [{
                  phase: 'trigger',
                  trackId: 'missing',
                  durationChunks: 1,
                  interpolation: 'step',
                  keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
                }],
              },
            },
          }],
        },
        operations: [],
      },
    }, {
      continuityKey: 'scene',
      signals: [],
      baseline: { prompt: [], motion: [] },
      recipes: [{
        key: 'effect',
        trigger: {
          prompt: [],
          motion: [{
            id: 'known',
            target: 'camera.offset.y',
            blend: 'replace',
            priority: 1,
            source: { kind: 'constant', value: 0 },
            timeline: {
              durationChunks: 1,
              interpolation: 'step',
              keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
            },
          }],
        },
      }],
    }, { prompt: true, motionTargets: new Set(['camera.offset.y']) });

    expect(frame.diagnostics.map((entry) => entry.code)).toContain('invalid-override');
    expect(frame.timelines[0]?.sourceId).toContain('known');
  });
});
