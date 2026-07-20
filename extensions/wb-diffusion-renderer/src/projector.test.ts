import { describe, expect, test } from 'bun:test';
import { projectLingbotControls } from './projector';

describe('LingBot effect projection', () => {
  test('projects closed motion targets without gameplay vocabulary', () => {
    const controls = projectLingbotControls({
      stamp: { epoch: 1, run: 'play', transitionSequence: 0 },
      manifestRevision: 'test',
      prompt: [],
      continuousMotion: [
        { target: 'navigation.forward-rate', value: 1 },
        { target: 'camera.rotation.yaw-rate', value: -1 },
      ],
      timelines: [],
      signals: {},
      transitions: [],
      lifecycle: { desiredPlayback: 'running' },
      diagnostics: [],
    });
    expect(controls).toEqual({
      moveLongitudinal: 'forward',
      moveLateral: 'idle',
    });
    expect('lookHorizontal' in controls).toBe(false);
    expect('lookVertical' in controls).toBe(false);
  });
});
