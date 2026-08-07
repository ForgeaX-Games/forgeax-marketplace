import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AudioProjectError,
  normalizeAudioProject,
  type AudioBinding,
} from '../shared/audio-project.ts';
import {
  patchAudioProject,
  readAudioProject,
} from './audio-project-store.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempGame(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-audio-project-'));
  roots.push(root);
  return root;
}

function binding(eventId = 'combat.attack.hit'): AudioBinding {
  return {
    eventId,
    label: '重击命中',
    enabled: true,
    kind: 'sfx',
    assets: [
      { assetId: 'hit-01', file: 'hit-01.wav', name: 'Hit 01' },
      { assetId: 'hit-02', file: 'hit-02.wav', name: 'Hit 02' },
    ],
    variation: { mode: 'random-no-repeat' },
    trigger: { delayMs: 35, cooldownMs: 120, probability: 0.75 },
    playback: {
      volume: 0.8,
      bus: 'sfx',
      spatial: '3d',
      mode: 'one-shot',
      fadeInMs: 0,
      fadeOutMs: 80,
    },
    conditions: [{ field: 'target.material', operator: 'eq', value: 'metal' }],
  };
}

describe('audio project contract', () => {
  test('normalizes editable defaults without changing the event or asset identity', () => {
    const project = normalizeAudioProject({
      schemaVersion: 'forgeax-audio-project/1',
      revision: 4,
      status: 'draft',
      bindings: [{
        eventId: 'ui.confirm',
        kind: 'sfx',
        assets: [{ assetId: 'ui-ok', file: 'ui/ok.wav' }],
      }],
    }, 'demo');

    expect(project).toEqual({
      schemaVersion: 'forgeax-audio-project/1',
      projectId: 'demo',
      revision: 4,
      status: 'draft',
      updatedAt: '',
      bindings: [{
        eventId: 'ui.confirm',
        label: 'ui.confirm',
        enabled: true,
        kind: 'sfx',
        assets: [{ assetId: 'ui-ok', file: 'ui/ok.wav' }],
        variation: { mode: 'single' },
        trigger: { delayMs: 0, cooldownMs: 0, probability: 1 },
        playback: {
          volume: 1,
          bus: 'sfx',
          spatial: '2d',
          mode: 'one-shot',
          fadeInMs: 0,
          fadeOutMs: 0,
        },
        conditions: [],
      }],
    });
  });

  test('accepts manifest-style audio paths and stores them relative to the audio directory', () => {
    const normalized = normalizeAudioProject({
      bindings: [{
        eventId: 'music.strategy',
        kind: 'music',
        assets: [{ assetId: 'strategy', file: 'audio/music/strategy_theme.wav' }],
      }],
    }, 'demo');

    expect(normalized.bindings[0]!.assets[0]!.file).toBe('music/strategy_theme.wav');
  });

  test('rejects duplicate events instead of silently replacing one binding', () => {
    expect(() => normalizeAudioProject({
      bindings: [binding('combat.hit'), binding('combat.hit')],
    }, 'demo')).toThrow(expect.objectContaining({
      code: 'invalid_project',
      message: "duplicate audio eventId 'combat.hit'",
    }));
  });

  test('rejects unsafe event IDs, asset traversal and out-of-range controls', () => {
    const invalid = [
      { ...binding('../combat.hit'), eventId: '../combat.hit' },
      { ...binding(), assets: [{ assetId: 'escape', file: '../secret.wav' }] },
      { ...binding(), trigger: { delayMs: -1, cooldownMs: 0, probability: 1 } },
      { ...binding(), playback: { ...binding().playback, volume: 4.1 } },
    ];

    for (const value of invalid) {
      expect(() => normalizeAudioProject({ bindings: [value] }, 'demo')).toThrow(AudioProjectError);
    }
  });
});

describe('revisioned audio project draft store', () => {
  test('returns an empty revision-zero draft for a game with no audio project', async () => {
    const gameDir = await tempGame();
    expect(await readAudioProject(gameDir, 'demo')).toEqual({
      schemaVersion: 'forgeax-audio-project/1',
      projectId: 'demo',
      revision: 0,
      status: 'draft',
      updatedAt: '',
      bindings: [],
    });
  });

  test('uses the applied document as the editable base when no draft exists', async () => {
    const gameDir = await tempGame();
    await mkdir(join(gameDir, 'audio'), { recursive: true });
    await writeFile(join(gameDir, 'audio/project.json'), JSON.stringify({
      schemaVersion: 'forgeax-audio-project/1',
      projectId: 'demo',
      revision: 7,
      status: 'applied',
      updatedAt: '2026-08-01T00:00:00.000Z',
      bindings: [binding()],
    }));

    const draft = await readAudioProject(gameDir, 'demo');
    expect(draft.status).toBe('draft');
    expect(draft.revision).toBe(7);
    expect(draft.bindings).toEqual([binding()]);
  });

  test('upserts and removes bindings in one atomic revision without touching applied state', async () => {
    const gameDir = await tempGame();
    await mkdir(join(gameDir, 'audio'), { recursive: true });
    const applied = {
      schemaVersion: 'forgeax-audio-project/1',
      projectId: 'demo',
      revision: 2,
      status: 'applied',
      updatedAt: '2026-08-01T00:00:00.000Z',
      bindings: [binding('old.event')],
    };
    await writeFile(join(gameDir, 'audio/project.json'), JSON.stringify(applied));

    const next = await patchAudioProject(gameDir, {
      projectId: 'demo',
      expectedRevision: 2,
      upsertBindings: [binding('new.event')],
      removeEventIds: ['old.event'],
    }, { now: () => new Date('2026-08-03T03:00:00.000Z') });

    expect(next.revision).toBe(3);
    expect(next.updatedAt).toBe('2026-08-03T03:00:00.000Z');
    expect(next.bindings.map((item) => item.eventId)).toEqual(['new.event']);
    expect(JSON.parse(await readFile(join(gameDir, 'audio/project.json'), 'utf8'))).toEqual(applied);
    expect(JSON.parse(await readFile(join(gameDir, 'audio/project.draft.json'), 'utf8'))).toEqual(next);
  });

  test('rejects a stale expected revision and preserves the current draft bytes', async () => {
    const gameDir = await tempGame();
    const first = await patchAudioProject(gameDir, {
      projectId: 'demo',
      expectedRevision: 0,
      upsertBindings: [binding()],
      removeEventIds: [],
    });
    const before = await readFile(join(gameDir, 'audio/project.draft.json'), 'utf8');

    await expect(patchAudioProject(gameDir, {
      projectId: 'demo',
      expectedRevision: 0,
      upsertBindings: [binding('stale.event')],
      removeEventIds: [],
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: first.revision });

    expect(await readFile(join(gameDir, 'audio/project.draft.json'), 'utf8')).toBe(before);
  });
});
