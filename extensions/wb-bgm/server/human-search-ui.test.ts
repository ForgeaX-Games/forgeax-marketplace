import { describe, expect, test } from 'bun:test';

import {
  buildHumanFamilyIndex,
  filterHumanFamiliesByDirectory,
  rankSimilarHumanFamilies,
} from '../src/humanSearch.ts';
import {
  markFamilyAttached,
  markFamilyPreviewed,
  playerCandidateState,
  sortPlayerCandidates,
} from '../src/playerDiscovery.ts';
import type { AssetMeta } from '../src/state.ts';
import {
  buildSfxTagCatalog,
  contextualMaterialLabel,
  expandChineseSfxQueryTerms,
  parseChineseSfxQuery,
} from '../src/tagCatalog.ts';
import type { HumanFamilyResult } from '../src/humanSearchTypes.ts';
import {
  auditOnlineSfxDirectory,
  buildSfxDirectoryCatalog,
  categoryLabel,
  onlineSfxDirectory,
  subcategoryLabel,
} from '../src/sfxDirectoryCatalog.ts';

describe('player SFX directory catalog', () => {
  const onlineAssets = [
    asset('ui-click', 'sfx/1_ui/common/click_00.wav'),
    asset('ui-popup', 'sfx/1_ui/popup/alert_00.wav'),
    asset('vehicle-land', 'sfx/5_vehicle/land/engine_00.wav'),
    asset('vehicle-car', 'sfx/7_vehicle/car/engine_00.wav'),
    asset('rhythm-drum', 'sfx/21_rhythm/drum/face_00.wav'),
    asset('bianzhong', 'sfx/bianzhong_3oct_36_solfege_suffix/bianzhong_4_A.wav'),
    asset('guqin', 'sfx/guqin_3oct_36_solfege_suffix/guqin_4_A.wav'),
    asset('avg', 'sfx/26_avg/typewriter/mechanical_00.wav'),
  ];

  test('builds first- and second-level filters from real online paths', () => {
    const catalog = buildSfxDirectoryCatalog(onlineAssets);
    expect(catalog.categories.map((option) => option.id)).toEqual([
      '1_ui',
      '7_vehicle',
      '21_rhythm',
      '26_avg',
    ]);
    expect(catalog.categories.reduce((sum, option) => sum + option.count, 0)).toBe(8);
    expect(buildSfxDirectoryCatalog(onlineAssets, '1_ui').subcategories).toEqual([
      { id: 'popup', label: '弹窗', count: 1 },
      { id: 'common', label: '通用界面', count: 1 },
    ]);
    expect(buildSfxDirectoryCatalog(onlineAssets, '7_vehicle').subcategories)
      .toEqual([
        { id: 'land', label: '陆地载具', count: 1 },
        { id: 'car', label: '汽车', count: 1 },
      ]);
    expect(auditOnlineSfxDirectory(onlineAssets)).toEqual([]);
  });

  test('normalizes legacy online categories and keeps all shallow instrument assets', () => {
    expect(onlineSfxDirectory(onlineAssets[2]!)).toMatchObject({
      category: '7_vehicle',
      subcategory: 'land',
      sourceCategory: '5_vehicle',
    });
    expect(onlineSfxDirectory(onlineAssets[5]!)).toMatchObject({
      category: '21_rhythm',
      subcategory: 'bianzhong',
    });
    expect(onlineSfxDirectory(onlineAssets[6]!)).toMatchObject({
      category: '21_rhythm',
      subcategory: 'guqin',
    });
  });

  test('uses delivery wording while keeping approved broad labels for 16–26', () => {
    expect(categoryLabel('1_ui')).toBe('用户界面 UI');
    expect(categoryLabel('15_narrative')).toBe('剧情叙事与过场');
    expect(categoryLabel('16_farm')).toBe('建造、生产与采集');
    expect(categoryLabel('17_era')).toBe('时代与世界风格');
    expect(categoryLabel('18_board')).toBe('桌面物件与操作反馈');
    expect(categoryLabel('19_stg')).toBe('载具、武器与战斗反馈');
    expect(categoryLabel('26_avg')).toBe('对话、剧情与选择反馈');
    expect(subcategoryLabel('1_ui', 'btn')).toBe('按键音');
    expect(subcategoryLabel('2_foley', 'footstep')).toBe('脚步');
    expect(subcategoryLabel('24_platform', 'grapple')).toBe('抓钩');
    expect(subcategoryLabel('26_avg', 'typewriter')).toBe('对话打字机音');
  });

  test('player UI uses directory selection and does not invoke natural-language SFX parsing', async () => {
    const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
    const main = await Bun.file(new URL('../src/main.ts', import.meta.url)).text();

    expect(html).toContain('一级分类');
    expect(html).toContain('二级标签');
    expect(html).toContain('结果严格来自对应目录，不进行自动推断');
    expect(html).toContain('class="audio-chip-grid" id="categoryChips"');
    expect(html).not.toContain('toggleAllCategories');
    expect(main).not.toContain('is-collapsed');
    expect(html).not.toContain('我不太会描述，按分类找');
    expect(main).not.toContain('parseChineseSfxQuery(');
    expect(main).toContain('当前目录暂无可用资产');
  });
});

function asset(id: string, filename: string): AssetMeta {
  const displayName = filename.includes('/')
    ? filename
    : `sfx/3_combat/melee/${filename}`;
  const basename = filename.split('/').at(-1) ?? filename;
  return {
    asset_id: id,
    display_name: displayName,
    current_version: 'v1',
    versions: [{
      version_name: 'v1',
      display_version_name: '1.0',
      res_url: `https://assets.example.test/${basename}`,
      state: 1,
    }],
  };
}

function candidate(
  familyId: string,
  matchLevel: HumanFamilyResult['matchLevel'] = 'exact',
): HumanFamilyResult {
  return {
    familyId,
    displayName: familyId,
    nameSource: 'rule',
    description: '',
    cue: 'combat.attack.impact',
    source: ['sword'],
    targetMaterial: ['metal'],
    intensity: ['heavy'],
    styleTags: ['realistic'],
    containsTags: [],
    variants: [],
    matchLevel,
    matchedFields: [],
    relaxedFields: [],
    unknownFields: [],
    hardConstraintsVerified: true,
    score: 80,
    reviewStatus: '需试听确认',
  };
}

describe('human SFX tag catalog', () => {
  test('lets the host resize the left search pane without leaving a fixed-width gap', async () => {
    const css = await Bun.file(new URL('../src/style.css', import.meta.url)).text();
    const splitPaneRule = css.match(
      /\[data-pane='left'\] \.audio-search-pane,\s*\[data-pane='center'\] \.audio-center-pane\s*\{([^}]+)\}/,
    )?.[1];

    expect(splitPaneRule).toContain('width: 100%');
    expect(splitPaneRule).toContain('min-width: 0');
    expect(splitPaneRule).toContain('max-width: none');
    expect(splitPaneRule).toContain('flex: 1 1 auto');
  });

  test('only exposes supported intensity values', () => {
    const ids = buildSfxTagCatalog().intensities.map((option) => option.id);
    expect(ids.every((id) => ['light', 'medium', 'heavy'].includes(id))).toBe(true);
    expect(ids).not.toContain('weak');
    expect(ids).not.toContain('multi');
  });

  test('changes available material tags with the selected cue', () => {
    const attackMaterials = buildSfxTagCatalog('combat.attack.impact').materials;
    const uiMaterials = buildSfxTagCatalog('ui.click').materials;

    expect(attackMaterials.some((option) => option.id === 'metal')).toBe(true);
    expect(uiMaterials).toHaveLength(0);
    expect(contextualMaterialLabel('movement.footstep')).toBe('踩在什么上');
    expect(contextualMaterialLabel('interaction.building.door')).toBe('物体是什么材质');
  });

  test('turns a plain Chinese request into editable frontend criteria', () => {
    expect(parseChineseSfxQuery('剑砍中铁甲的重击声，写实，不要人声')).toEqual({
      cue: 'combat.attack.impact',
      sourceId: 'sword',
      materialId: 'metal',
      intensity: 'heavy',
      preferredStyleIds: ['realistic'],
      hardExcludeIds: ['voice'],
    });
  });

  test('understands a broader player request and keeps negative clauses out of recall terms', () => {
    expect(parseChineseSfxQuery('沉重的枪声，不要长混响，避免科幻')).toEqual({
      cue: 'combat.ranged.fire',
      sourceId: 'gun',
      intensity: 'heavy',
      hardExcludeIds: ['reverb_long'],
      avoidStyleIds: ['sci_fi'],
    });

    const terms = expandChineseSfxQueryTerms('沉重的枪声，不要长混响，避免科幻');
    expect(terms).toContain('gunfire');
    expect(terms).toContain('heavy');
    expect(terms).not.toContain('sci-fi');
    expect(terms).not.toContain('reverb');
  });

  test('can refresh options from the live human-only family index', () => {
    const liveFamilies = buildHumanFamilyIndex([
      asset('blade-00', 'impact_blade_00.wav'),
      asset('blade-01', 'impact_blade_01.wav'),
    ]).map((row) => row.family);
    const sources = buildSfxTagCatalog('combat.attack.impact', liveFamilies).sources;

    expect(sources.some((option) => option.id === 'sword')).toBe(true);
  });

  test('shows a Chinese live name without changing the underlying asset filename', () => {
    const row = buildHumanFamilyIndex([
      asset('blade-live', 'impact_blade_00.wav'),
    ])[0];

    expect(row?.family.displayName).toBe('战斗·近战·刀刃命中');
    expect(row?.family.nameSource).toBe('rule');
    expect(row?.variants[0]?.filename).toBe('impact_blade_00.wav');
  });
});

describe('human SFX family index', () => {
  test('groups interchangeable variants instead of returning loose files', () => {
    const rows = buildHumanFamilyIndex([
      asset('armor-00', 'hit_armor_00.wav'),
      asset('armor-01', 'hit_armor_01.wav'),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.family.familyId).toBe('combat.melee.hit_armor');
    expect(rows[0]?.family.cue).toBe('combat.attack.impact');
    expect(rows[0]?.family.targetMaterial).toContain('metal');
    expect(rows[0]?.variants).toHaveLength(2);
  });

  test('strictly filters player results by the selected primary and secondary directory', () => {
    const rows = buildHumanFamilyIndex([
      asset('armor-00', 'hit_armor_00.wav'),
      asset('swing-00', 'swing_heavy_00.wav'),
    ]);
    const melee = filterHumanFamiliesByDirectory(rows, '3_combat', 'melee');
    const explosion = filterHumanFamiliesByDirectory(rows, '3_combat', 'explosion');

    expect(melee).toHaveLength(2);
    expect(melee.every((row) =>
      row.family.category === '3_combat' && row.family.subfolder === 'melee')).toBe(true);
    expect(explosion).toHaveLength(0);
  });

  test('finds related families without returning the selected family itself', () => {
    const rows = buildHumanFamilyIndex([
      asset('blade-00', 'impact_blade_00.wav'),
      asset('armor-00', 'hit_armor_00.wav'),
      asset('swing-00', 'swing_heavy_weapon_00.wav'),
    ]);
    const referenceRow = rows.find((row) => row.family.cue === 'combat.attack.impact');
    expect(referenceRow).toBeDefined();

    const reference = candidate(referenceRow!.family.familyId);
    reference.cue = referenceRow!.family.cue;
    reference.source = referenceRow!.family.source;
    reference.targetMaterial = referenceRow!.family.targetMaterial;
    reference.intensity = referenceRow!.family.intensity;
    reference.styleTags = referenceRow!.family.styleTags;

    const similar = rankSimilarHumanFamilies(rows, reference, [], 10);
    expect(similar.some((row) => row.familyId === reference.familyId)).toBe(false);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]!.score).toBeGreaterThanOrEqual(similar.at(-1)!.score);
  });
});

describe('player result discovery', () => {
  test('puts project-unused and unpreviewed families first', () => {
    const candidates = [
      candidate('used'),
      candidate('previewed'),
      candidate('new'),
    ];
    let stats = markFamilyAttached({ previewed: {}, attached: {} }, 'used');
    stats = markFamilyPreviewed(stats, 'previewed');

    const sorted = sortPlayerCandidates(candidates, 'unused', stats, 'seed');
    expect(sorted.map((row) => row.familyId)).toEqual(['new', 'previewed', 'used']);
    expect(playerCandidateState('used', stats)).toBe('attached');
    expect(playerCandidateState('previewed', stats)).toBe('previewed');
    expect(playerCandidateState('new', stats)).toBe('new');
  });

  test('keeps match quality ahead of exploration shuffling', () => {
    const candidates = [
      candidate('partial', 'partial'),
      candidate('exact-a', 'exact'),
      candidate('relaxed', 'relaxed'),
      candidate('exact-b', 'exact'),
    ];
    const sorted = sortPlayerCandidates(
      candidates,
      'explore',
      { previewed: {}, attached: {} },
      '2026-07-30:枪声',
    );

    expect(sorted.slice(0, 2).every((row) => row.matchLevel === 'exact')).toBe(true);
    expect(sorted[2]!.matchLevel).toBe('relaxed');
    expect(sorted[3]!.matchLevel).toBe('partial');
  });
});
