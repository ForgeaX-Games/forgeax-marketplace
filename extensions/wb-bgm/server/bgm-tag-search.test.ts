import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import localIndex from '../data/local-library-index.json';
import {
  BGM_CATALOG_TRACKS,
  buildBgmTagOptions,
  inferBgmCriteriaFromQuery,
  rankBgmTracks,
} from '../src/bgmTagSearch.ts';
import type { BgmConfig } from './core.ts';
import { importCustomAudio } from './custom-audio-library.ts';
import { searchBgm } from './search-bgm.ts';

const config: BgmConfig = { depot: 'builtin' };
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('BGM structured tag retrieval', () => {
  test('loads all 181 catalog tracks and exposes the approved four dimensions', () => {
    const options = buildBgmTagOptions();
    expect(BGM_CATALOG_TRACKS).toHaveLength(181);
    expect(options.scene).toHaveLength(10);
    expect(options.mood).toHaveLength(8);
    expect(options.energy.map((option) => option.id)).toEqual(['low', 'medium', 'high']);
    expect(options.world).toHaveLength(7);
  });

  test('ranks a dark high-energy Boss track as an exact match', () => {
    const ranked = rankBgmTracks({
      scene: 'boss_combat',
      moodIds: ['dark', 'tense'],
      energy: 'high',
    });
    expect(ranked[0]?.track.displayName).toContain('Boss_Battle_Dark');
    expect(ranked[0]?.matchLevel).toBe('exact');
    expect(ranked[0]?.matchedFields).toEqual(
      expect.arrayContaining(['使用场景', '情绪', '能量']),
    );
  });

  test('uses CLAP only for mood and energy, never for formal scene or world', () => {
    const boss = BGM_CATALOG_TRACKS.find((track) =>
      track.displayName.includes('Boss_Battle_Dark_01'))!;
    const result = rankBgmTracks(
      {
        scene: boss.scene.id === 'boss_combat'
          ? 'exploration_ambient'
          : 'boss_combat',
        world: 'post_apocalyptic',
      },
      [boss],
    )[0]!;
    expect(result.matchedFields).not.toContain('使用场景');
    expect(result.matchedFields).not.toContain('世界观');
    expect(result.matchLevel).toBe('partial');
  });

  test('understands common Chinese BGM descriptions without inventing extra dimensions', () => {
    expect(inferBgmCriteriaFromQuery('黑暗科幻 Boss 战，高强度')).toEqual({
      scene: 'boss_combat',
      moodIds: ['dark'],
      energy: 'high',
      world: 'sci_fi_cyber',
    });
  });

  test('returns index-only candidates without attachable URLs in dry-run mode', async () => {
    const result = await searchBgm(config, {
      kind: 'bgm',
      scene: 'boss_combat',
      moodIds: ['dark'],
      energy: 'high',
      topK: 3,
      dryRun: true,
    });
    expect(result.mode).toBe('index-only');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.resUrl).toBe('');
    expect(result.candidates[0]?.matchLevel).toBe('exact');
  });

  test('joins catalog ranking only to packaged local BGM IDs and URLs', async () => {
    const localIds = new Set(localIndex.assets.map((asset) => asset.assetId));
    const result = await searchBgm(config, {
      kind: 'bgm',
      scene: 'boss_combat',
      moodIds: ['dark'],
      energy: 'high',
      topK: 20,
    });

    expect(result.mode).toBe('live');
    expect(result.candidates[0]).toMatchObject({
      assetId: 'local:bgm:sha256:8626706502a654e223660a390aed96851cc35d8d553aad72fe91ff8070ffd879',
      resUrl: '/extensions/wb-bgm/library/builtin/bgm/04_Boss%E4%B8%8E%E9%AB%98%E6%BD%AE/Roguelike_EliteBoss_02.ogg',
      matchLevel: 'exact',
    });
    expect(result.candidates.every((candidate) => localIds.has(candidate.assetId))).toBe(true);
    expect(result.candidates.some((candidate) => candidate.assetId === '69b809c8e99eb7862e40939c')).toBe(false);
  });

  test('lets the Agent find registered custom BGM by filename without changing player search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-bgm-custom-search-'));
    temporaryRoots.push(root);
    const imported = await importCustomAudio({
      kind: 'bgm',
      fileName: '玩家专属主题.ogg',
      mimeType: 'audio/ogg',
      base64: Buffer.from('OggS-player-theme').toString('base64'),
    }, root);

    const playerResult = await searchBgm(config, {
      kind: 'bgm', queryText: '玩家专属主题', topK: 3,
    }, root, false);
    const agentResult = await searchBgm(config, {
      kind: 'bgm', queryText: '玩家专属主题', topK: 3,
    }, root, true);

    expect(playerResult.candidates.some((candidate) =>
      candidate.assetId === imported.asset.assetId)).toBe(false);
    expect(agentResult.candidates[0]).toMatchObject({
      assetId: imported.asset.assetId,
      name: '玩家专属主题.ogg',
      reasons: ['自定义文件名明确匹配'],
    });
    expect(agentResult.diagnostics).toMatchObject({
      registeredCustomAssets: 1,
      matchedCustomAssets: 1,
    });

    const rogue = resolve(root, '.forgeax/assets/audio-custom/bgm/never-registered.ogg');
    await mkdir(resolve(rogue, '..'), { recursive: true });
    await writeFile(rogue, 'OggS-rogue');
    const unregistered = await searchBgm(config, {
      kind: 'bgm', queryText: 'never registered', topK: 3,
    }, root, true);
    expect(unregistered.candidates.some((candidate) => candidate.name.includes('never-registered')))
      .toBe(false);
  });
});
