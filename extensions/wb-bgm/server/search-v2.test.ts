import { describe, expect, test } from 'bun:test';

import localIndex from '../data/local-library-index.json';
import { BgmError, type BgmConfig } from './core.ts';
import { rankAudioFamilies, searchAudioV2 } from './search-v2.ts';

const cfg: BgmConfig = { depot: 'builtin' };
const localIds = new Set(localIndex.assets.map((asset) => asset.assetId));

describe('search-audio-v2 structured SFX ranking', () => {
  test('normalizes aliases and keeps impact separate from swing', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'hit',
      source: '剑',
      targetMaterial: '盔甲',
      intensity: '重',
      exclude: ['人声', '音乐'],
      projectId: 'default',
      topK: 3,
      dryRun: true,
    });

    expect(result.normalizedIntent).toMatchObject({
      cue: 'combat.attack.impact',
      source: 'sword',
      targetMaterial: 'metal',
      intensity: 'heavy',
    });
    expect(result.candidates.map((candidate) => candidate.familyId)).toEqual([
      'combat.melee.hit_armor',
    ]);
    expect(result.candidates[0]?.layerRole).toBe('impact');
    expect(result.candidates[0]?.variants).toHaveLength(4);
  });

  test('rejects an explicitly opposite intensity instead of filling Top K', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'swing',
      source: 'sword',
      intensity: 'light',
      projectId: 'default',
      topK: 3,
      dryRun: true,
    });

    expect(result.candidates.map((candidate) => candidate.familyId)).toEqual([
      'combat.melee.swing_light',
    ]);
    expect(result.candidates[0]?.score).toBe(100);
  });

  test('returns structurally valid fallback families below the former score gate', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'combat.attack.impact',
      source: 'hammer',
      targetMaterial: 'rubber',
      intensity: 'crushing',
      projectId: 'default',
      topK: 3,
      dryRun: true,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      familyId: 'tower.wave.base_hit',
      score: 49,
    });
    expect(result.candidates[0]?.relaxed).toHaveLength(3);
    expect(result.diagnostics).not.toHaveProperty('minimumScore');
  });

  test('expands the footstep parent cue but preserves material as a hard condition', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'footstep',
      targetMaterial: 'wood',
      projectId: 'default',
      topK: 3,
      dryRun: true,
    });

    expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map((candidate) => candidate.familyId)).size).toBe(3);
    expect(result.candidates.every((candidate) => candidate.targetMaterial.includes('wood'))).toBe(true);
    expect(result.candidates.every((candidate) =>
      candidate.relaxed.some((item) => item.includes('未指定脚步动作')),
    )).toBe(true);
  });

  test('reports a fallback when projectId has no world profile', () => {
    const result = rankAudioFamilies({
      kind: 'sfx',
      cue: 'combat.attack.swing',
      projectId: 'unknown-project',
    });
    expect(result.warnings).toContain(
      "projectId 'unknown-project' 未配置声音世界，已使用 default profile",
    );
  });

  test('rejects BGM because v2 deliberately isolates the SFX protocol', () => {
    expect(() => rankAudioFamilies({
      kind: 'bgm',
      cue: 'battle',
      projectId: 'default',
    })).toThrow(BgmError);
  });

  test('joins ranked families only to packaged local asset IDs and URLs', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'combat.attack.impact',
      source: 'sword',
      projectId: 'default',
      topK: 3,
    });

    expect(result.mode).toBe('live');
    expect(result.candidates[0]).toMatchObject({
      familyId: 'online.3.combat.melee.impact.blade',
      assetId: 'local:sfx:sha256:21ecad752c9d8c2f6113252ca1e9b00d1b93282202c6296e93ec142a722ad62e',
      name: 'sfx/3_combat/melee/impact_blade_00.mp3',
      version: '21ecad752c9d',
      resUrl: '/extensions/wb-bgm/library/builtin/sfx/3_combat/melee/impact_blade_00.mp3',
    });
    const variants = result.candidates.flatMap((candidate) => candidate.variants);
    expect(variants.every((variant) => Boolean(variant.assetId && localIds.has(variant.assetId)))).toBe(true);
    expect(result.diagnostics).toMatchObject({
      liveAssets: 100,
      matchedLiveAssets: 100,
      directoryMappedLiveAssets: 100,
      directoryUnmappedLiveAssets: 0,
    });
  });

  test('generic footstep search excludes jump and landing families from the packaged set', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'movement.footstep',
      projectId: 'default',
      topK: 20,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) =>
      !candidate.familyId.includes('.jump') && !candidate.familyId.includes('.land'),
    )).toBe(true);
  });

  test('treats packaged directory category and subcategory IDs as hard filters', async () => {
    const result = await searchAudioV2(cfg, {
      kind: 'sfx',
      cue: 'combat.attack.impact',
      directoryCategory: '3_combat',
      directorySubcategory: 'melee',
      projectId: 'default',
      topK: 20,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) =>
      candidate.category === '3_combat' && candidate.subfolder === 'melee',
    )).toBe(true);
  });
});
