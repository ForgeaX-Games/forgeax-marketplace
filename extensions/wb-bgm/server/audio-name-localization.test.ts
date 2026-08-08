import { describe, expect, test } from 'bun:test';

import audioSearchIndex from '../data/audio-search-index.json';
import {
  hasBareLatinName,
  localizedVariantName,
  localizeFallbackFamilyName,
  localizeSupplierFamilyName,
} from '../src/audioNameLocalization.ts';
import { buildHumanFamilyIndex } from '../src/humanSearch.ts';
import type { AssetMeta } from '../src/state.ts';

function asset(id: string, path: string): AssetMeta {
  const filename = path.split('/').pop() ?? path;
  return {
    asset_id: id,
    display_name: path,
    current_version: 'v1',
    versions: [{
      version_name: 'v1',
      display_version_name: '1.0',
      res_url: `https://assets.example.test/${filename}`,
      state: 1,
    }],
  };
}

describe('SFX Chinese display names', () => {
  test('normalizes the remaining supplier abbreviations into Chinese', () => {
    expect(localizeSupplierFamilyName('EMP_电磁脉冲爆炸_小范围'))
      .toBe('电磁脉冲·电磁脉冲爆炸·小范围');
    expect(localizeSupplierFamilyName('判定_PERFECT')).toBe('判定·完美');
    expect(localizeSupplierFamilyName('永久死亡_Boss击杀')).toBe('永久死亡·首领击杀');
  });

  test('leaves no bare Latin letters in any supplier display name', () => {
    const names = audioSearchIndex.families.map((family) =>
      localizeSupplierFamilyName(family.displayName));
    expect(names).toHaveLength(455);
    expect(names.filter(hasBareLatinName)).toEqual([]);
  });

  test('creates readable Chinese names for live assets outside the supplier table', () => {
    const cases: Array<[string, string]> = [
      ['sfx/3_combat/melee/impact_blade_00.wav', '战斗·近战·刀刃命中'],
      ['sfx/3_combat/melee/swing_heavy_weapon_02.wav', '战斗·近战·重型武器挥动'],
      ['sfx/2_character/footstep/run_earth_03.wav', '角色·脚步·跑步·土地'],
      ['sfx/4_magic/fire/magic_fire_burst_00.wav', '魔法·火焰·火焰魔法爆发'],
      ['sfx/7_ambient/urban/ambient_city_traffic_00.wav', '环境·城市·城市交通环境'],
      ['sfx/11_stinger/combo/x20_00.wav', '提示短音·连击·连击提示·20倍'],
      ['sfx/instrument/guqin_3_c_00.wav', '古琴·第3组·多音'],
    ];
    for (const [path, expected] of cases) {
      const name = localizeFallbackFamilyName(path);
      expect(name).toBe(expected);
      expect(hasBareLatinName(name)).toBe(false);
    }
  });

  test('uses a Chinese fallback even when a filename contains unknown vocabulary', () => {
    expect(localizeFallbackFamilyName('sfx/3_combat/melee/foobar_quux_00.wav'))
      .toBe('战斗·近战·未命名音效');
  });

  test('keeps the original file identity while adding a localized family name', () => {
    const originalPath = 'sfx/3_combat/melee/impact_blade_00.wav';
    const rows = buildHumanFamilyIndex([asset('blade-00', originalPath)]);
    const row = rows[0];

    expect(row?.family.displayName).toBe('战斗·近战·刀刃命中');
    expect(row?.family.nameSource).toBe('rule');
    expect(row?.family.reviewStatus).toBe('自动中文名·需试听确认');
    expect(row?.variants[0]?.name).toBe(originalPath);
    expect(row?.variants[0]?.filename).toBe('impact_blade_00.wav');
    expect(localizedVariantName(row?.family.displayName ?? '', 0))
      .toBe('战斗·近战·刀刃命中·变体01');
  });
});
