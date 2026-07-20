import { describe, expect, test } from 'bun:test';
import { composeLingbotWorld2Prompt } from './lingbot-world-2-prompt';

describe('LingBot prompt serialization', () => {
  test('serializes only evaluator-owned contributions', () => {
    const prompt = composeLingbotWorld2Prompt({ prompt: 'cinematic' }, {
      stamp: { epoch: 1, run: 'play', transitionSequence: 0 },
      manifestRevision: 'test',
      prompt: [{
        slot: 'world',
        mode: 'append',
        text: 'A submarine descends.',
        sourceId: 'recipe',
      }],
      continuousMotion: [],
      timelines: [],
      signals: {},
      transitions: [],
      lifecycle: { desiredPlayback: 'running' },
      diagnostics: [],
    });
    expect(prompt.prompt).toContain('A submarine descends.');
    expect(prompt.prompt).toBe('cinematic A submarine descends.');
    expect(prompt.prompt).not.toContain('jump');
  });
});
