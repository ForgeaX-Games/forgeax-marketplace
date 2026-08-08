import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import localIndex from '../data/local-library-index.json';
import type { AudioLibraryProvider } from './audio-library-provider.ts';
import { searchAudio, type BgmConfig } from './core.ts';
import {
  LocalAudioLibraryProvider,
  localAudioLibrary,
} from './local-audio-library.ts';
import { searchBgm } from './search-bgm.ts';
import { searchAudioV2 } from './search-v2.ts';
import tools from './tool-handlers.ts';

const UI_CANCEL_ID =
  'local:sfx:sha256:3f684b20b44d0365aa89d6c4b1f502de18832426c95d740bcfe76ed06445f9fa';
const RPG_CANCEL_ID =
  'local:sfx:sha256:96c5b48f3982d3c4834428f1e5def5af3add080609c1b8d88555008fd426c867';
const UI_CONFIRM_ID =
  'local:sfx:sha256:b2ed3d3de970bd7b88d1bf30e5f0c5e889840be6f171e7cedc33c000b5de13a0';
const RPG_CONFIRM_ID =
  'local:sfx:sha256:15af125141bc8fee62cbda46753a25732ea5554a4d9870debb6760aebefdaef5';

describe('LocalAudioLibraryProvider', () => {
  test('implements the provider contract over all 130 packaged assets', async () => {
    const provider: AudioLibraryProvider = new LocalAudioLibraryProvider();
    const result = await provider.findAssets({ page: 1, pageSize: 200 });

    expect(result.total).toBe(130);
    expect(result.assets).toHaveLength(130);
    expect(new Set(result.assets.map((asset) => asset.asset_id)).size).toBe(130);
    expect(result.assets.every((asset) => asset.asset_id?.startsWith('local:'))).toBe(true);
  });

  test('filters BGM and SFX while preserving the current AssetMeta shape', async () => {
    const bgm = await localAudioLibrary.findAssets({ kind: 'bgm', page: 1, pageSize: 200 });
    const sfx = await localAudioLibrary.findAssets({ kind: 'sfx', page: 1, pageSize: 200 });

    expect(bgm.total).toBe(30);
    expect(bgm.assets.every((asset) => asset.type === 3)).toBe(true);
    expect(sfx.total).toBe(100);
    expect(sfx.assets.every((asset) => asset.type === 7)).toBe(true);
    expect(sfx.assets[0]).toMatchObject({
      id: 'local:sfx:sha256:ef600ea152ad7126e53b961467c3492188ef43c0176a02b8ac349099beb9c867',
      asset_id: 'local:sfx:sha256:ef600ea152ad7126e53b961467c3492188ef43c0176a02b8ac349099beb9c867',
      name: 'sfx/10_cyber/scan/scan360_00.mp3',
      display_name: 'sfx/10_cyber/scan/scan360_00.mp3',
      type: 7,
      current_version: 'ef600ea152ad',
    });
    expect(sfx.assets[0]?.versions?.[0]).toMatchObject({
      version_name: 'ef600ea152ad',
      display_version_name: 'ef600ea152ad',
      res_url: '/extensions/wb-bgm/library/builtin/sfx/10_cyber/scan/scan360_00.mp3',
    });
  });

  test('matches filename tokens and paginates the filtered order', async () => {
    const matching = await localAudioLibrary.findAssets({
      kind: 'sfx',
      query: 'impact blade',
      page: 1,
      pageSize: 10,
    });
    const secondPage = await localAudioLibrary.findAssets({
      kind: 'sfx',
      page: 2,
      pageSize: 3,
    });

    expect(matching.total).toBe(3);
    expect(matching.assets.map((asset) => asset.name)).toEqual([
      'sfx/3_combat/melee/impact_blade_00.mp3',
      'sfx/3_combat/melee/impact_blade_01.mp3',
      'sfx/3_combat/melee/impact_blade_02.mp3',
    ]);
    expect(secondPage.total).toBe(100);
    expect(secondPage.assets.map((asset) => asset.asset_id)).toEqual([
      'local:sfx:sha256:ca0e1a18935b951aa6b3b70effe295f7bd53c2d9a5edd805799bd5d7e73d7b72',
      'local:sfx:sha256:0ff726633abf4738ca9ca15deb3dc591f8699355af5da74d085d8d51cb035491',
      'local:sfx:sha256:ec5207450f25cf34809490db327f853b3ca4c2f38d0f3171aca943b685dec68a',
    ]);
  });

  test('uses full path tokens to disambiguate duplicate cancel and confirm names', async () => {
    const uiCancel = await localAudioLibrary.findAssets({
      kind: 'sfx', query: 'ui common cancel', page: 1, pageSize: 10,
    });
    const rpgCancel = await localAudioLibrary.findAssets({
      kind: 'sfx', query: 'rpg turn cancel', page: 1, pageSize: 10,
    });
    const uiConfirm = await localAudioLibrary.findAssets({
      kind: 'sfx', query: 'ui common confirm 00', page: 1, pageSize: 10,
    });
    const rpgConfirm = await localAudioLibrary.findAssets({
      kind: 'sfx', query: 'rpg turn confirm', page: 1, pageSize: 10,
    });

    expect(uiCancel.assets.map((asset) => asset.asset_id)).toEqual([UI_CANCEL_ID]);
    expect(rpgCancel.assets.map((asset) => asset.asset_id)).toEqual([RPG_CANCEL_ID]);
    expect(uiConfirm.assets.map((asset) => asset.asset_id)).toEqual([UI_CONFIRM_ID]);
    expect(rpgConfirm.assets.map((asset) => asset.asset_id)).toEqual([RPG_CONFIRM_ID]);
  });

  test('resolves indexed IDs beneath the packaged library and rejects invented IDs', async () => {
    const resolved = await localAudioLibrary.resolveAsset(RPG_CONFIRM_ID);

    expect(resolved).toMatchObject({
      assetId: RPG_CONFIRM_ID,
      kind: 'sfx',
      fileName: 'confirm_00.mp3',
      version: '15af125141bc',
      previewUrl:
        '/extensions/wb-bgm/library/builtin/sfx/20_rpg/turn/confirm_00.mp3',
    });
    expect(resolved?.absolutePath).toContain('/public/library/builtin/sfx/20_rpg/turn/confirm_00.mp3');
    expect(existsSync(resolved?.absolutePath ?? '')).toBe(true);
    expect(await localAudioLibrary.resolveAsset('local:sfx:sha256:not-real')).toBeNull();
    expect(await localAudioLibrary.resolveAsset('/tmp/confirm_00.mp3')).toBeNull();
  });
});

describe('packaged-library search routing', () => {
  const cfg: BgmConfig = { depot: 'builtin' };
  const localIds = new Set(localIndex.assets.map((asset) => asset.assetId));

  test('searchAudio returns only attachable packaged IDs without a network backend', async () => {
    const results = await searchAudio(cfg, {
      kind: 'sfx',
      query: 'rpg turn cancel',
      limit: 10,
    });

    expect(results.map((result) => result.assetId)).toEqual([RPG_CANCEL_ID]);
    expect(results[0]).toMatchObject({
      kind: 'sfx',
      type: 7,
      version: '96c5b48f3982',
      resUrl: '/extensions/wb-bgm/library/builtin/sfx/20_rpg/turn/cancel_00.mp3',
    });
  });

  test('normal BGM search drops catalog ghosts and preserves catalog ranking metadata', async () => {
    const result = await searchBgm(cfg, {
      kind: 'bgm',
      scene: 'boss_combat',
      energy: 'high',
      topK: 20,
    });
    const ids = result.candidates.map((candidate) => candidate.assetId);

    expect(result.mode).toBe('live');
    expect(ids).toContain(
      'local:bgm:sha256:8626706502a654e223660a390aed96851cc35d8d553aad72fe91ff8070ffd879',
    );
    expect(ids.every((id) => localIds.has(id))).toBe(true);
    expect(ids).not.toContain('69b809c8e99eb7862e40939c');
    expect(result.candidates.every((candidate) => candidate.resUrl.startsWith('/extensions/wb-bgm/'))).toBe(true);
  });

  test('normal SFX v2 search never turns unavailable alias families into attachable variants', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'combat.attack.impact',
      targetMaterial: 'metal',
      projectId: 'default',
      topK: 20,
    });
    const variants = result.candidates.flatMap((candidate) => candidate.variants);

    expect(result.mode).toBe('live');
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((variant) => Boolean(variant.assetId && localIds.has(variant.assetId)))).toBe(true);
    expect(variants.some((variant) => variant.name.includes('hit_armor_'))).toBe(false);
  });

  test('bgm:backend keeps the read-only FindAssetMeta response used by the human SPA', async () => {
    const result = await tools['bgm:backend']({
      endpoint: 'FindAssetMeta',
      payload: {
        query: { asset_type: 7, tag: 'rpg turn confirm' },
        pagination: { page_num: 1, page_size: 5, is_need_total_num: true },
      },
    }, {
      caller: { kind: 'user' },
      toolId: 'bgm:backend',
    });

    expect(result.total).toBe(1);
    expect(result.asset_meta_info_list).toHaveLength(1);
    expect(result.asset_meta_info_list[0]).toMatchObject({
      asset_id: RPG_CONFIRM_ID,
      type: 7,
    });
  });

  test('attach-audio resolves packaged bytes by assetId and ignores caller URLs', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'wb-bgm-local-attach-'));
    try {
      await mkdir(join(projectRoot, '.forgeax', 'games', 'demo'), { recursive: true });
      const result = await tools['attach-audio']({
        assetId: RPG_CONFIRM_ID,
        kind: 'sfx',
        resUrl: 'https://caller.invalid/must-not-be-used.mp3',
        slug: 'demo',
      }, {
        caller: { kind: 'user' },
        toolId: 'attach-audio',
        env: { FORGEAX_PROJECT_ROOT: projectRoot },
      });
      const resolved = await localAudioLibrary.resolveAsset(RPG_CONFIRM_ID);

      expect(result.file).toBe('audio/confirm_00.mp3');
      expect(result.url).toBe(resolved?.previewUrl);
      expect(await readFile(join(projectRoot, '.forgeax', 'games', 'demo', result.file))).toEqual(
        await readFile(resolved!.absolutePath),
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
