import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { inspectAudioEvents } from './audio-event-inspector.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureGame(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-audio-events-'));
  roots.push(root);
  await mkdir(join(root, 'src/forgeax-audio'), { recursive: true });
  await mkdir(join(root, 'node_modules/ignored'), { recursive: true });
  await writeFile(join(root, 'src/combat.ts'), [
    "EventBus.instance.emit('combat:attack_hit', { attacker, target, damage });",
    "gameAudio.emit('player.level.up', { level });",
    "audio.play('ui.confirm');",
    'sfx.playExplosion();',
    'sfx.playShot(kind);',
  ].join('\n'));
  await writeFile(join(root, 'src/forgeax-audio/generated-bindings.ts'), "gameAudio.emit('generated.ignore')");
  await writeFile(join(root, 'node_modules/ignored/index.ts'), "gameAudio.emit('dependency.ignore')");
  return root;
}

describe('audio event inspector', () => {
  test('finds literal game, EventBus, legacy audio and direct SFX calls with stable anchors', async () => {
    const root = await fixtureGame();
    const result = await inspectAudioEvents(root);

    expect(result.scannedFiles).toBe(1);
    expect(result.candidates).toEqual([
      {
        eventId: 'combat:attack_hit',
        file: 'src/combat.ts',
        line: 1,
        source: 'event-bus',
        confidence: 'high',
        expression: "EventBus.instance.emit('combat:attack_hit'",
      },
      {
        eventId: 'player.level.up',
        file: 'src/combat.ts',
        line: 2,
        source: 'game-audio',
        confidence: 'high',
        expression: "gameAudio.emit('player.level.up'",
      },
      {
        eventId: 'ui.confirm',
        file: 'src/combat.ts',
        line: 3,
        source: 'legacy-audio',
        confidence: 'high',
        expression: "audio.play('ui.confirm'",
      },
      {
        eventId: 'sfx.explosion',
        file: 'src/combat.ts',
        line: 4,
        source: 'direct-sfx',
        confidence: 'medium',
        expression: 'sfx.playExplosion(',
      },
      {
        eventId: 'sfx.shot',
        file: 'src/combat.ts',
        line: 5,
        source: 'direct-sfx',
        confidence: 'medium',
        expression: 'sfx.playShot(',
      },
    ]);
  });

  test('keeps separate source locations for the same literal event', async () => {
    const root = await fixtureGame();
    await writeFile(join(root, 'src/ui.ts'), "gameAudio.emit('ui.confirm')\n");

    const result = await inspectAudioEvents(root);
    expect(result.candidates.filter((candidate) => candidate.eventId === 'ui.confirm')).toHaveLength(2);
    expect(result.candidates.map((candidate) => `${candidate.file}:${candidate.line}`)).toContain('src/ui.ts:1');
  });
});
