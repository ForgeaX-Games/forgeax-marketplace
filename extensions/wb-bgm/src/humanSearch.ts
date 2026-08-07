import audioSearchIndex from '../data/audio-search-index.json';
import { fetchAllAssetsOfType } from './api.ts';
import {
  bgmCatalogTrackForAsset,
  normalizeBgmCriteria,
  rankBgmTracks,
  type BgmCatalogTrack,
  type BgmRankedTrack,
} from './bgmTagSearch.ts';
import {
  localizeFallbackFamilyName,
  localizeSupplierFamilyName,
} from './audioNameLocalization.ts';
import { expandChineseSfxQueryTerms } from './tagCatalog.ts';
import {
  onlineSfxDirectory,
  onlineSfxFallbackFamilyId,
} from './sfxDirectoryCatalog.ts';
import type { AssetMeta } from './state.ts';
import { basename, getLatestVersion } from './utils.ts';
import type {
  HumanBgmIntent,
  AudioNameSource,
  HumanFamilyResult,
  HumanSearchIntent,
  HumanSearchResult,
  HumanSfxIntent,
  HumanVariant,
} from './humanSearchTypes.ts';

export interface IndexedFamily {
  category: string;
  subfolder: string;
  displayName: string;
  nameSource: AudioNameSource;
  description: string;
  cue: string;
  source: string[];
  targetMaterial: string[];
  intensity: string[];
  styleTags: string[];
  containsTags: string[];
  familyId: string;
  aliases: string[];
  reviewStatus: string;
}

export interface FamilyWithAssets {
  family: IndexedFamily;
  variants: HumanVariant[];
}

type SupplierIndexedFamily = Omit<IndexedFamily, 'nameSource'>;

const indexedFamilies = (audioSearchIndex.families as SupplierIndexedFamily[]).map((family) => ({
  ...family,
  displayName: localizeSupplierFamilyName(family.displayName),
  nameSource: 'supplier' as const,
}));

function clean(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeAssetKey(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep malformed URLs searchable by their original spelling.
  }
  return basename(decoded.split(/[?#]/, 1)[0])
    .toLowerCase()
    .replace(/\.(wav|mp3|ogg|m4a)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const aliasToFamilies = new Map<string, IndexedFamily[]>();
for (const family of indexedFamilies) {
  for (const alias of family.aliases) {
    const key = normalizeAssetKey(alias);
    const rows = aliasToFamilies.get(key) ?? [];
    rows.push(family);
    aliasToFamilies.set(key, rows);
  }
}

function assetPath(asset: AssetMeta): string {
  return String(asset.display_name || asset.name || '').replace(/\\/g, '/');
}

function staticFamilyForAsset(asset: AssetMeta): IndexedFamily | undefined {
  const directory = onlineSfxDirectory(asset);
  const version = getLatestVersion(asset);
  const keys = [
    normalizeAssetKey(assetPath(asset)),
    normalizeAssetKey(version?.res_url || ''),
  ];
  for (const key of keys) {
    const candidates = aliasToFamilies.get(key) ?? [];
    const exact = candidates.find((family) =>
      directory
      && family.category === directory.category
      && family.subfolder === directory.subcategory,
    );
    if (exact) return exact;
    const categoryOnly = candidates.filter((family) =>
      directory && family.category === directory.category,
    );
    if (categoryOnly.length === 1) return categoryOnly[0];
  }
  return undefined;
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferCue(text: string): string {
  if (includesAny(text, ['jump', 'takeoff']) && includesAny(text, ['land', 'landing'])) {
    return 'movement.jump_land';
  }
  if (includesAny(text, ['jump', 'takeoff'])) return 'movement.jump';
  if (includesAny(text, ['land', 'landing'])) return 'movement.land';
  if (includesAny(text, ['footstep', '/footsteps/', '/footstep_'])) {
    if (includesAny(text, ['run', 'running'])) return 'movement.footstep.run';
    if (includesAny(text, ['walk', 'walking'])) return 'movement.footstep.walk';
    return 'movement.footstep';
  }
  if (includesAny(text, ['swing', 'whoosh', 'swish'])) return 'combat.attack.swing';
  if (includesAny(text, ['parry', 'block'])) return 'combat.defense.parry';
  if (includesAny(text, ['reload'])) return 'combat.ranged.reload';
  if (includesAny(text, ['gunfire', 'rifle', 'pistol', 'shotgun', 'shoot'])) return 'combat.ranged.fire';
  if (includesAny(text, ['explosion', 'explode', 'blast', 'grenade'])) return 'combat.explosion';
  if (includesAny(text, ['hit', 'impact', 'collision', 'smash', 'strike'])) return 'combat.attack.impact';
  if (includesAny(text, ['pickup', 'collect'])) return 'item.pickup';
  if (includesAny(text, ['break', 'broken', 'shatter'])) return 'interaction.break';
  if (includesAny(text, ['door'])) return 'interaction.building.door';
  if (includesAny(text, ['teleport', 'portal'])) return 'magic.teleport';
  if (includesAny(text, ['spell', 'cast', 'magic'])) return 'magic.cast';
  if (includesAny(text, ['button', 'click', '/ui/'])) return 'ui.click';
  return 'unclassified';
}

function inferValues(text: string, rules: Array<[string, readonly string[]]>): string[] {
  return rules.filter(([, terms]) => includesAny(text, terms)).map(([id]) => id);
}

function fallbackFamily(
  asset: AssetMeta,
  directory: { category: string; subcategory: string },
): IndexedFamily {
  const path = assetPath(asset);
  const tags = [
    ...(asset.custom_tags ?? []),
    ...(asset.gen_tags ?? []),
  ].join(' ');
  const text = ` ${clean(`${path} ${asset.description || ''} ${tags}`)} `;
  const stem = normalizeAssetKey(path).replace(/_\d{2}$/i, '') || 'unclassified';
  return {
    category: directory.category,
    subfolder: directory.subcategory,
    displayName: localizeFallbackFamilyName(path),
    nameSource: 'rule',
    description: asset.description || '',
    cue: inferCue(text),
    source: inferValues(text, [
      ['sword', ['sword', 'blade']],
      ['bow', ['/bow/', 'arrow']],
      ['rifle', ['rifle']],
      ['pistol', ['pistol']],
      ['shotgun', ['shotgun']],
      ['gun', ['gunfire', '/gun/']],
      ['foot', ['footstep']],
      ['door', ['door']],
      ['creature', ['creature', 'monster', 'beast']],
      ['machine', ['machine', 'mechanical']],
      ['magic', ['magic', 'spell']],
      ['interface', ['/ui/', 'button', 'click']],
    ]),
    targetMaterial: inferValues(text, [
      ['flesh', ['flesh', 'organic']],
      ['metal', ['metal', 'metallic', 'armor', 'clang']],
      ['wood', ['wood', 'wooden']],
      ['stone', ['stone', 'rock', 'concrete']],
      ['glass', ['glass']],
      ['dirt', ['dirt', 'soil']],
      ['grass', ['grass']],
      ['sand', ['sand']],
      ['snow', ['snow']],
      ['water', ['water', 'wet']],
      ['fabric', ['fabric', 'cloth']],
      ['energy_shield', ['energy shield']],
    ]),
    intensity: inferValues(text, [
      ['light', [' light', 'gentle', 'soft', 'weak']],
      ['medium', ['medium', 'moderate']],
      ['heavy', ['heavy', 'strong', 'powerful', 'forceful']],
    ]),
    styleTags: inferValues(text, [
      ['sci_fi', ['sci-fi', 'sci_fi', 'cyber', 'futuristic']],
      ['fantasy', ['fantasy', 'magic', 'medieval']],
      ['dark_fantasy', ['dark fantasy', 'gothic']],
      ['casual', ['casual', 'cute']],
      ['realistic', ['realistic', 'naturalistic']],
      ['horror', ['horror', 'terrifying']],
      ['mechanical', ['mechanical', 'hydraulic']],
    ]),
    containsTags: inferValues(text, [
      ['voice', ['/voice/', ' voice', 'vocal', 'speech']],
      ['music', ['/music/', ' music', 'stinger', 'jingle']],
      ['reverb_long', ['long reverb', 'long_reverb', 'long tail']],
    ]),
    familyId: onlineSfxFallbackFamilyId(asset) ?? `online.unclassified.${stem}`,
    aliases: [basename(path)],
    reviewStatus: '自动中文名·需试听确认',
  };
}

function toVariant(asset: AssetMeta): HumanVariant | null {
  const version = getLatestVersion(asset);
  if (!version?.res_url) return null;
  const name = asset.display_name || asset.name || basename(version.res_url);
  return {
    assetId: asset.asset_id || asset.id || '',
    name,
    version: version.display_version_name || version.version_name || '',
    resUrl: version.res_url,
    filename: basename(name || version.res_url),
    asset,
  };
}

export function buildHumanFamilyIndex(assets: AssetMeta[]): FamilyWithAssets[] {
  const grouped = new Map<string, FamilyWithAssets>();
  for (const asset of assets) {
    const variant = toVariant(asset);
    if (!variant) continue;
    const directory = onlineSfxDirectory(asset);
    if (!directory) continue;
    const indexed = staticFamilyForAsset(asset);
    const family: IndexedFamily = indexed
      ? {
        ...indexed,
        category: directory.category,
        subfolder: directory.subcategory,
      }
      : fallbackFamily(asset, directory);
    const existing = grouped.get(family.familyId);
    if (existing) {
      if (!existing.variants.some((item) => item.assetId === variant.assetId && item.resUrl === variant.resUrl)) {
        existing.variants.push(variant);
      }
    } else {
      grouped.set(family.familyId, { family, variants: [variant] });
    }
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    variants: item.variants.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function filterHumanFamiliesByDirectory(
  rows: FamilyWithAssets[],
  categoryId: string,
  subcategoryId?: string,
): FamilyWithAssets[] {
  return rows.filter(({ family }) =>
    family.category === categoryId
    && (!subcategoryId || family.subfolder === subcategoryId));
}

function directoryCandidate(
  row: FamilyWithAssets,
  hasSubcategory: boolean,
): HumanFamilyResult {
  const family = row.family;
  return {
    familyId: family.familyId,
    displayName: family.displayName,
    nameSource: family.nameSource,
    description: family.description,
    cue: family.cue,
    source: family.source,
    targetMaterial: family.targetMaterial,
    intensity: family.intensity,
    styleTags: family.styleTags,
    containsTags: family.containsTags,
    variants: row.variants,
    matchLevel: 'exact',
    matchedFields: hasSubcategory ? ['一级分类', '二级标签'] : ['一级分类'],
    relaxedFields: [],
    unknownFields: [],
    hardConstraintsVerified: true,
    score: 100,
    reviewStatus: family.reviewStatus,
    directoryCategory: family.category,
    directorySubcategory: family.subfolder,
  };
}

function cueMatches(familyCue: string, requestedCue: string): boolean {
  if (familyCue === requestedCue) return true;
  return requestedCue === 'movement.footstep'
    && familyCue.startsWith('movement.footstep.');
}

const RELATED_CUE_GROUPS: readonly (readonly string[])[] = [
  ['combat.attack.impact', 'combat.attack.swing', 'combat.defense.parry'],
  ['combat.ranged.fire', 'combat.ranged.reload', 'combat.range'],
  ['movement.footstep', 'movement.footstep.walk', 'movement.footstep.run', 'movement.jump', 'movement.land'],
  ['ui.click', 'ui.confirm', 'ui.cancel', 'ui.hover', 'ui.error', 'ui.notification', 'ui.popup'],
  ['magic.cast', 'magic.element', 'magic.energy', 'magic.curse', 'magic.summon', 'magic.teleport'],
  ['interaction.open', 'interaction.close', 'interaction.activate', 'interaction.building.door'],
  ['item.pickup', 'item.drop', 'item.weapon', 'item.armor', 'item.food'],
  ['stinger.success', 'stinger.failure', 'stinger.levelup', 'stinger.mission', 'stinger.reveal'],
];

function cueRelationship(
  familyCue: string,
  requestedCue: string,
): 'exact' | 'parent' | 'related' | 'none' {
  if (familyCue === requestedCue) return 'exact';
  if (cueMatches(familyCue, requestedCue)) return 'parent';
  const related = RELATED_CUE_GROUPS.some((group) =>
    group.includes(familyCue) && group.includes(requestedCue));
  return related ? 'related' : 'none';
}

function intersects(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function rankFamily(
  row: FamilyWithAssets,
  intent: HumanSfxIntent,
): HumanFamilyResult | null {
  const family = row.family;
  const hasCue = Boolean(intent.cue);
  const cueRelation = hasCue ? cueRelationship(family.cue, intent.cue) : 'none';
  if (hasCue && cueRelation === 'none') return null;
  if (intersects(family.containsTags, intent.hardExcludeIds).length) return null;

  const matchedFields = cueRelation === 'exact' || cueRelation === 'parent'
    ? ['核心事件']
    : [];
  const relaxedFields: string[] = cueRelation === 'related'
    ? ['核心事件相近，供玩家扩大试听']
    : [];
  const unknownFields: string[] = [];
  let score = hasCue
    ? cueRelation === 'exact' ? 70
      : cueRelation === 'parent' ? 66
        : 34
    : 20;

  const terms = expandChineseSfxQueryTerms(intent.queryText ?? '');
  if (terms.length) {
    const haystack = clean([
      family.displayName,
      family.description,
      family.category,
      family.subfolder,
      family.cue,
      ...family.aliases,
      ...family.source,
      ...family.targetMaterial,
      ...family.styleTags,
      ...family.containsTags,
    ].join(' '));
    const lexicalMatches = terms.filter((term) => haystack.includes(term));
    if (lexicalMatches.length) {
      matchedFields.push('文字描述');
      score += Math.min(hasCue ? 12 : 24, lexicalMatches.length * (hasCue ? 3 : 8));
    } else if (!hasCue) {
      unknownFields.push('核心事件');
      relaxedFields.push('根据相邻分类扩大搜索');
    }
  } else if (!hasCue) {
    unknownFields.push('核心事件');
    relaxedFields.push('根据相邻分类扩大搜索');
  }

  if (intent.sourceId) {
    if (family.source.includes(intent.sourceId)) {
      matchedFields.push('声音来源');
      score += 12;
    } else if (family.source.length) {
      relaxedFields.push(`声源已放宽为 ${family.source.join('/')}`);
      score -= 18;
    } else {
      unknownFields.push('声音来源');
      score -= 8;
    }
  }

  if (intent.materialId) {
    if (family.targetMaterial.includes(intent.materialId)) {
      matchedFields.push('材质');
      score += 12;
    } else if (family.targetMaterial.length) {
      relaxedFields.push(`材质已放宽为 ${family.targetMaterial.join('/')}`);
      score -= 18;
    } else {
      unknownFields.push('材质');
      score -= 8;
    }
  }

  if (intent.intensity) {
    if (family.intensity.includes(intent.intensity)) {
      matchedFields.push('力度');
      score += 6;
    } else if (family.intensity.includes('multi')) {
      relaxedFields.push('需要在音效族内选择对应力度');
      score += 3;
    } else if (family.intensity.length) {
      relaxedFields.push(`力度已放宽为 ${family.intensity.join('/')}`);
      score -= 8;
    } else {
      unknownFields.push('力度');
      score -= 5;
    }
  }

  if (intent.requireIntensityVariants) {
    if (family.intensity.includes('multi')) {
      matchedFields.push('包含多个力度变体');
      score += 4;
    } else {
      relaxedFields.push('未确认包含多个力度变体');
      score -= 6;
    }
  }

  if (intent.preferredStyleIds.length) {
    const styleMatches = intersects(family.styleTags, intent.preferredStyleIds);
    if (styleMatches.length) {
      matchedFields.push('听感偏好');
      score += 5;
    } else {
      relaxedFields.push('未命中听感偏好');
      score -= 4;
    }
  }

  const avoided = intersects(family.styleTags, intent.avoidStyleIds);
  if (avoided.length) {
    relaxedFields.push(`包含尽量避免的风格：${avoided.join('/')}`);
    score -= 10;
  }

  if (intent.hardExcludeIds.length && family.reviewStatus !== '可直接使用') {
    unknownFields.push('硬排除项元数据');
    score -= 6;
  }

  score = Math.max(0, Math.min(100, score));
  const matchLevel =
    unknownFields.length > 0 ? 'partial'
      : relaxedFields.length > 0 ? 'relaxed'
        : 'exact';

  return {
    familyId: family.familyId,
    displayName: family.displayName,
    nameSource: family.nameSource,
    description: family.description,
    cue: family.cue,
    source: family.source,
    targetMaterial: family.targetMaterial,
    intensity: family.intensity,
    styleTags: family.styleTags,
    containsTags: family.containsTags,
    variants: row.variants,
    matchLevel,
    matchedFields,
    relaxedFields,
    unknownFields: unique(unknownFields),
    hardConstraintsVerified: unknownFields.length === 0,
    score,
    reviewStatus: family.reviewStatus,
  };
}

function similarityScore(reference: HumanFamilyResult, family: IndexedFamily): {
  score: number;
  matched: string[];
} {
  let score = 0;
  const matched: string[] = [];
  const cueRelation = cueRelationship(family.cue, reference.cue);
  if (cueRelation === 'exact') {
    score += 48;
    matched.push('同类事件');
  } else if (cueRelation === 'parent') {
    score += 42;
    matched.push('相同事件族');
  } else if (cueRelation === 'related') {
    score += 22;
    matched.push('相近事件');
  }
  if (intersects(family.source, reference.source).length) {
    score += 18;
    matched.push('相同声源');
  }
  if (intersects(family.targetMaterial, reference.targetMaterial).length) {
    score += 16;
    matched.push('相同材质');
  }
  if (intersects(family.styleTags, reference.styleTags).length) {
    score += 10;
    matched.push('相近听感');
  }
  if (intersects(family.intensity, reference.intensity).length) {
    score += 6;
    matched.push('相近力度');
  }
  return { score: Math.min(100, score), matched };
}

export function rankSimilarHumanFamilies(
  rows: FamilyWithAssets[],
  reference: HumanFamilyResult,
  hardExcludeIds: string[] = [],
  topK = 12,
): HumanFamilyResult[] {
  return rows
    .filter((row) => row.family.familyId !== reference.familyId)
    .filter((row) => !intersects(row.family.containsTags, hardExcludeIds).length)
    .map((row): HumanFamilyResult | null => {
      const similarity = similarityScore(reference, row.family);
      if (similarity.score < 28) return null;
      const matchLevel = similarity.score >= 60 ? 'exact'
        : similarity.score >= 38 ? 'relaxed'
          : 'partial';
      return {
        familyId: row.family.familyId,
        displayName: row.family.displayName,
        nameSource: row.family.nameSource,
        description: row.family.description,
        cue: row.family.cue,
        source: row.family.source,
        targetMaterial: row.family.targetMaterial,
        intensity: row.family.intensity,
        styleTags: row.family.styleTags,
        containsTags: row.family.containsTags,
        variants: row.variants,
        matchLevel,
        matchedFields: similarity.matched,
        relaxedFields: matchLevel === 'exact' ? [] : ['基于现有标签寻找相近素材'],
        unknownFields: [],
        hardConstraintsVerified: true,
        score: similarity.score,
        reviewStatus: row.family.reviewStatus,
      };
    })
    .filter((candidate): candidate is HumanFamilyResult => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.familyId.localeCompare(b.familyId))
    .slice(0, topK);
}

export async function runHumanSimilarSearch(
  requestId: string,
  reference: HumanFamilyResult,
  projectId: string,
  hardExcludeIds: string[] = [],
  topK = 12,
): Promise<HumanSearchResult> {
  const assets = await fetchAllAssetsOfType(7);
  const candidates = rankSimilarHumanFamilies(
    buildHumanFamilyIndex(assets),
    reference,
    hardExcludeIds,
    topK,
  );
  return {
    requestId,
    intent: {
      schemaVersion: 'human-audio-search/1',
      kind: 'sfx',
      cue: reference.cue,
      sourceId: reference.source[0],
      materialId: reference.targetMaterial[0],
      preferredStyleIds: reference.styleTags.slice(0, 2),
      hardExcludeIds: [...hardExcludeIds],
      avoidStyleIds: [],
      projectId,
      topK,
    },
    candidates,
    totalFamilies: candidates.length,
    warnings: [
      `正在按“${reference.displayName}”的事件、声源、材质和听感标签寻找相近素材`,
      '当前“找相似”基于资产标签，尚未使用声音内容模型',
    ],
  };
}

async function searchSfx(requestId: string, intent: HumanSfxIntent): Promise<HumanSearchResult> {
  const assets = await fetchAllAssetsOfType(7);
  const rows = buildHumanFamilyIndex(assets);
  if (intent.directoryCategory) {
    const matched = filterHumanFamiliesByDirectory(
      rows,
      intent.directoryCategory,
      intent.directorySubcategory,
    );
    const candidates = matched
      .map((row) => directoryCandidate(row, Boolean(intent.directorySubcategory)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
      .slice(0, intent.topK);
    return {
      requestId,
      intent,
      candidates,
      totalFamilies: matched.length,
      warnings: candidates.length
        ? []
        : ['当前目录没有可用的在线音频资产'],
    };
  }
  const allCandidates = rows
    .map((row) => rankFamily(row, intent))
    .filter((row): row is HumanFamilyResult => Boolean(row))
    .sort((a, b) => {
      const level = { exact: 0, relaxed: 1, partial: 2 };
      return level[a.matchLevel] - level[b.matchLevel]
        || b.score - a.score
        || a.familyId.localeCompare(b.familyId);
    });
  const candidates = allCandidates.slice(0, intent.topK);
  const warnings: string[] = [];
  if (!candidates.length) warnings.push('没有找到满足当前描述、声源与材质条件的音效族');
  if (!intent.cue && candidates.length) {
    warnings.push('未识别出明确事件，已扩大到相关音效族供试听确认');
  }
  if (candidates.some((candidate) => candidate.matchLevel === 'partial')) {
    warnings.push('部分候选的元数据不完整，需要试听确认');
  }
  return {
    requestId,
    intent,
    candidates,
    totalFamilies: allCandidates.length,
    warnings,
  };
}

function bgmCandidate(
  asset: AssetMeta,
  track: BgmCatalogTrack,
  ranked: BgmRankedTrack,
): HumanFamilyResult | null {
  const variant = toVariant(asset);
  if (!variant) return null;
  const scene = track.scene.strength === 'hard' ? track.scene.id : undefined;
  const mood = track.mood
    .filter((tag) => tag.strength === 'hard' || tag.strength === 'soft');
  const energy =
    track.energy.strength === 'hard' || track.energy.strength === 'soft'
      ? track.energy.id
      : undefined;
  const world = track.world.strength === 'hard' ? track.world.id : undefined;
  return {
    familyId: `bgm.${variant.assetId || normalizeAssetKey(variant.name)}`,
    displayName: asset.display_name || asset.name || variant.filename,
    nameSource: 'original',
    description: asset.description || '',
    cue: scene ? `bgm.${scene}` : 'bgm.unclassified',
    source: [],
    targetMaterial: [],
    intensity: energy ? [energy] : [],
    styleTags: unique([
      ...mood.map((tag) => tag.id),
      ...(world ? [world] : []),
    ]),
    containsTags: [],
    variants: [variant],
    matchLevel: ranked.matchLevel,
    matchedFields: ranked.matchedFields,
    relaxedFields: ranked.relaxedFields,
    unknownFields: ranked.unknownFields,
    hardConstraintsVerified: ranked.hardConstraintsVerified,
    score: ranked.score,
    reviewStatus: mood.some((tag) => tag.strength === 'soft')
      ? '文件名硬标签 + CLAP软标签'
      : '文件名硬标签',
    bgmTags: {
      scene,
      mood: mood.map((tag) => tag.id),
      energy,
      world,
      sources: {
        scene: scene ? 'filename' : undefined,
        mood: mood.map((tag) => tag.strength === 'hard' ? 'filename' : 'clap'),
        energy: energy
          ? track.energy.strength === 'hard' ? 'filename' : 'clap'
          : undefined,
        world: world ? 'filename' : undefined,
      },
    },
  };
}

async function searchBgm(requestId: string, intent: HumanBgmIntent): Promise<HumanSearchResult> {
  const assets = await fetchAllAssetsOfType(3);
  const liveByCatalogId = new Map<string, AssetMeta>();
  for (const asset of assets) {
    const track = bgmCatalogTrackForAsset(asset);
    if (track) liveByCatalogId.set(track.assetId, asset);
  }
  const criteria = normalizeBgmCriteria(intent);
  const hasStructuredCriteria = Boolean(
    criteria.scene || criteria.moodIds.length || criteria.energy || criteria.world,
  );
  const ranked = rankBgmTracks(intent)
    .filter((row) => liveByCatalogId.has(row.track.assetId))
    .filter((row) =>
      hasStructuredCriteria
      || !criteria.queryText
      || row.matchedFields.includes('名称关键词'));
  const candidates = ranked
    .map((row) =>
      bgmCandidate(liveByCatalogId.get(row.track.assetId)!, row.track, row))
    .filter((row): row is HumanFamilyResult => Boolean(row))
    .slice(0, intent.topK);
  const warnings: string[] = [];
  if (liveByCatalogId.size < assets.length) {
    warnings.push(
      `${assets.length - liveByCatalogId.size} 首在线BGM尚未映射到结构化标签目录`,
    );
  }
  if (!candidates.length) {
    warnings.push('没有找到符合当前BGM标签组合的在线曲目');
  } else if (candidates.some((candidate) => candidate.matchLevel !== 'exact')) {
    warnings.push('精确结果不足时已按世界观、次要情绪和能量逐级放宽；场景冲突排在最后');
  }
  return {
    requestId,
    intent,
    candidates,
    totalFamilies: ranked.length,
    warnings,
  };
}

export async function runHumanSearch(
  requestId: string,
  intent: HumanSearchIntent,
): Promise<HumanSearchResult> {
  return intent.kind === 'sfx'
    ? searchSfx(requestId, intent)
    : searchBgm(requestId, intent);
}
