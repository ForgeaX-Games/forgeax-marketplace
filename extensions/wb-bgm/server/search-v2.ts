import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import audioSearchIndex from '../data/audio-search-index.json';
import worldProfileIndex from '../data/world-profiles.json';
import {
  categoryLabel,
  onlineSfxDirectory,
  onlineSfxFallbackFamilyId,
  onlineSfxFamilyStem,
  subcategoryLabel,
} from '../src/sfxDirectoryCatalog.ts';
import type { AssetMetaLike } from './audio-library-provider.ts';
import { BgmError, type BgmConfig } from './core.ts';
import {
  listCustomAudio,
  resolveCustomAudio,
  type ResolvedCustomAudio,
} from './custom-audio-library.ts';
import { localAudioLibrary } from './local-audio-library.ts';

export interface SearchAudioV2Options {
  kind?: string;
  cue?: string;
  directoryCategory?: string;
  directorySubcategory?: string;
  source?: string;
  targetMaterial?: string;
  intensity?: string;
  exclude?: string[];
  projectId?: string;
  topK?: number;
  dryRun?: boolean;
}

interface AudioFamily {
  category: string;
  categoryName: string;
  subfolder: string;
  displayName: string;
  filePattern: string;
  quantity: number;
  description: string;
  kind: 'sfx';
  cue: string;
  layerRole: string;
  source: string[];
  targetMaterial: string[];
  element: string[];
  intensity: string[];
  distance: string[];
  styleTags: string[];
  containsTags: string[];
  loopable: boolean;
  familyId: string;
  mustMatch: string[];
  boostTerms: string[];
  defaultExclude: string[];
  aliases: string[];
  reviewStatus: string;
}

interface WorldProfile {
  preferredStyles: string[];
  forbiddenStyles: string[];
  defaultExclude: string[];
}

interface VersionLike {
  version_name?: string;
  display_version_name?: string;
  res_url?: string;
  state?: number;
  update_time?: number | string;
  create_time?: number | string;
}

interface LiveAudioAsset {
  assetId: string;
  name: string;
  kind: 'sfx';
  type: 7;
  description: string;
  customTags: string[];
  generatedTags: string[];
  version: string;
  resUrl: string;
}

export interface NormalizedAudioIntent {
  kind: 'sfx';
  cue: string;
  directoryCategory?: string;
  directorySubcategory?: string;
  source?: string;
  targetMaterial?: string;
  intensity?: string;
  exclude: string[];
  projectId: string;
  topK: number;
}

export interface RankedAudioFamily {
  familyId: string;
  category: string;
  subfolder: string;
  displayName: string;
  filePattern: string;
  description: string;
  cue: string;
  layerRole: string;
  source: string[];
  targetMaterial: string[];
  intensity: string[];
  styleTags: string[];
  containsTags: string[];
  loopable: boolean;
  score: number;
  rawScore: number;
  maxScore: number;
  reasons: string[];
  relaxed: string[];
  reviewStatus: string;
  aliases: string[];
}

export interface SearchAudioV2Result {
  ok: true;
  mode: 'index-only' | 'live';
  normalizedIntent: NormalizedAudioIntent;
  count: number;
  candidates: Array<
    RankedAudioFamily & {
      availability: 'index-only' | 'live';
      assetId?: string;
      name?: string;
      version?: string;
      resUrl?: string;
      variants: Array<{
        assetId?: string;
        name: string;
        version?: string;
        resUrl?: string;
      }>;
    }
  >;
  diagnostics: {
    indexedFamilies: number;
    declaredAssets: number;
    liveAssets?: number;
    matchedLiveAssets?: number;
    staticMatchedLiveAssets?: number;
    inferredLiveAssets?: number;
    directoryMappedLiveAssets?: number;
    directoryUnmappedLiveAssets?: number;
    matchedFamilies?: number;
    registeredCustomAssets?: number;
    matchedCustomAssets?: number;
  };
  warnings: string[];
}

const families = audioSearchIndex.families as AudioFamily[];
const profiles = worldProfileIndex.profiles as Record<string, WorldProfile>;

const cueAliases: Record<string, string> = {
  hit: 'combat.attack.impact',
  impact: 'combat.attack.impact',
  strike: 'combat.attack.impact',
  'attack-hit': 'combat.attack.impact',
  命中: 'combat.attack.impact',
  击中: 'combat.attack.impact',
  swing: 'combat.attack.swing',
  slash: 'combat.attack.swing',
  whoosh: 'combat.attack.swing',
  挥砍: 'combat.attack.swing',
  挥动: 'combat.attack.swing',
  footstep: 'movement.footstep',
  脚步: 'movement.footstep',
  jump: 'movement.jump',
  跳跃: 'movement.jump',
  land: 'movement.land',
  落地: 'movement.land',
  pickup: 'item.pickup',
  拾取: 'item.pickup',
  cast: 'magic.cast',
  spell: 'magic.cast',
  施法: 'magic.cast',
};

const sourceAliases: Record<string, string> = {
  sword: 'sword',
  blade: 'sword',
  剑: 'sword',
  刀剑: 'sword',
  bow: 'bow',
  弓: 'bow',
  rifle: 'rifle',
  步枪: 'rifle',
  pistol: 'pistol',
  手枪: 'pistol',
  creature: 'creature',
  monster: 'creature',
  怪物: 'creature',
};

const materialAliases: Record<string, string> = {
  flesh: 'flesh',
  肉体: 'flesh',
  血肉: 'flesh',
  armor: 'metal',
  metal: 'metal',
  盔甲: 'metal',
  金属: 'metal',
  wood: 'wood',
  木材: 'wood',
  stone: 'stone',
  rock: 'stone',
  石头: 'stone',
  glass: 'glass',
  玻璃: 'glass',
  dirt: 'dirt',
  soil: 'dirt',
  泥土: 'dirt',
  grass: 'grass',
  草地: 'grass',
  sand: 'sand',
  沙地: 'sand',
  snow: 'snow',
  雪地: 'snow',
  water: 'water',
  水面: 'water',
};

const intensityAliases: Record<string, string> = {
  light: 'light',
  weak: 'light',
  轻: 'light',
  medium: 'medium',
  mid: 'medium',
  中: 'medium',
  heavy: 'heavy',
  strong: 'heavy',
  重: 'heavy',
  强: 'heavy',
};

const excludeAliases: Record<string, string> = {
  voice: 'voice',
  vocal: 'voice',
  人声: 'voice',
  music: 'music',
  音乐: 'music',
  reverb_long: 'reverb_long',
  'long-reverb': 'reverb_long',
  长混响: 'reverb_long',
  cartoon: 'cartoon',
  卡通: 'cartoon',
  sci_fi: 'sci_fi',
  'sci-fi': 'sci_fi',
  科幻: 'sci_fi',
};

const intensityRank: Record<string, number> = { light: 0, medium: 1, heavy: 2 };

const cueCategoryPrefixes: Array<[string, string[]]> = [
  ['combat.', ['3_combat', '19_stg', '20_rpg', '22_tower', '23_rogue']],
  ['movement.', ['2_foley', '2_character', '20_rpg', '24_platform']],
  ['ui.', ['1_ui', '14_casual', '18_board', '26_avg']],
  ['magic.', ['5_magic', '20_rpg', '22_tower']],
  ['item.', ['6_item', '20_rpg', '23_rogue']],
  ['vehicle.', ['7_vehicle']],
  ['ambient.', ['4_ambient']],
  ['stinger.', ['11_stinger']],
];

function clean(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function canonical(value: unknown, aliases: Record<string, string>): string | undefined {
  const normalized = clean(value);
  if (!normalized) return undefined;
  return aliases[normalized] ?? normalized.replace(/\s+/g, '_');
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function worldProfile(projectId: string): { profile: WorldProfile; usedFallback: boolean } {
  const direct = profiles[projectId];
  if (direct) return { profile: direct, usedFallback: false };
  return {
    profile: profiles.default ?? {
      preferredStyles: [],
      forbiddenStyles: [],
      defaultExclude: ['voice', 'music'],
    },
    usedFallback: projectId !== 'default',
  };
}

function normalizeIntent(opts: SearchAudioV2Options, profileOverride?: WorldProfile): {
  intent: NormalizedAudioIntent;
  profile: WorldProfile;
  usedFallbackProfile: boolean;
} {
  if (opts.kind !== 'sfx') {
    throw new BgmError('invalid-kind', "search-audio-v2 currently requires kind='sfx'", 400);
  }
  const cue = canonical(opts.cue, cueAliases);
  if (!cue) throw new BgmError('cue-required', 'cue is required', 400);
  const projectId = String(opts.projectId ?? '').trim();
  if (!projectId) throw new BgmError('project-required', 'projectId is required', 400);
  const configured = profileOverride
    ? { profile: profileOverride, usedFallback: false }
    : worldProfile(projectId);
  const topK = Math.min(Math.max(Math.trunc(opts.topK ?? 3), 1), 10);
  const directoryCategory = clean(opts.directoryCategory) || undefined;
  const directorySubcategory = clean(opts.directorySubcategory) || undefined;
  if (directorySubcategory && !directoryCategory) {
    throw new BgmError(
      'directory-category-required',
      'directoryCategory is required when directorySubcategory is provided',
      400,
    );
  }
  return {
    intent: {
      kind: 'sfx',
      cue,
      directoryCategory,
      directorySubcategory,
      source: canonical(opts.source, sourceAliases),
      targetMaterial: canonical(opts.targetMaterial, materialAliases),
      intensity: canonical(opts.intensity, intensityAliases),
      exclude: unique([
        ...configured.profile.defaultExclude.map((item) => canonical(item, excludeAliases)),
        ...(opts.exclude ?? []).map((item) => canonical(item, excludeAliases)),
      ]),
      projectId,
      topK,
    },
    profile: configured.profile,
    usedFallbackProfile: configured.usedFallback,
  };
}

function categoryMatchesCue(family: AudioFamily, cue: string): boolean {
  const rule = cueCategoryPrefixes.find(([prefix]) => cue.startsWith(prefix));
  return !rule || rule[1].includes(family.category);
}

function cueScore(familyCue: string, requestedCue: string): {
  score: number;
  reason: string;
  relaxed?: string;
} | null {
  if (familyCue === requestedCue) {
    return { score: 40, reason: 'cue 精确匹配' };
  }
  if (requestedCue === 'movement.footstep' && familyCue.startsWith('movement.footstep.')) {
    return {
      score: 35,
      reason: 'cue 脚步父级匹配',
      relaxed: `未指定脚步动作，候选为 ${familyCue}`,
    };
  }
  return null;
}

function intersects(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function adjacentIntensity(requested: string, offered: string[]): boolean {
  const requestedRank = intensityRank[requested];
  if (requestedRank === undefined) return false;
  return offered.some((item) => {
    const offeredRank = intensityRank[item];
    return offeredRank !== undefined && Math.abs(requestedRank - offeredRank) === 1;
  });
}

function rankFamilyCollection(
  opts: SearchAudioV2Options,
  collection: AudioFamily[],
  profileOverride?: WorldProfile,
): {
  intent: NormalizedAudioIntent;
  ranked: RankedAudioFamily[];
  warnings: string[];
} {
  const { intent, profile, usedFallbackProfile } = normalizeIntent(opts, profileOverride);
  const warnings: string[] = [];
  if (usedFallbackProfile) {
    warnings.push(`projectId '${intent.projectId}' 未配置声音世界，已使用 default profile`);
  }

  const ranked: RankedAudioFamily[] = [];
  for (const family of collection) {
    if (family.kind !== intent.kind) continue;
    if (intent.directoryCategory && family.category !== intent.directoryCategory) continue;
    if (intent.directorySubcategory && family.subfolder !== intent.directorySubcategory) continue;
    const cueMatch = cueScore(family.cue, intent.cue);
    if (!cueMatch) continue;
    if (!categoryMatchesCue(family, intent.cue)) continue;
    if (intersects(family.containsTags, intent.exclude).length) continue;
    if (intersects(family.styleTags, profile.forbiddenStyles).length) continue;

    const reasons = [cueMatch.reason];
    const relaxed: string[] = cueMatch.relaxed ? [cueMatch.relaxed] : [];
    let rawScore = cueMatch.score;
    let maxScore = 40;

    if (intent.targetMaterial) {
      maxScore += 20;
      if (family.targetMaterial.includes(intent.targetMaterial)) {
        rawScore += 20;
        reasons.push(`targetMaterial=${intent.targetMaterial} 匹配`);
      } else if (family.targetMaterial.length) {
        continue;
      } else {
        relaxed.push('素材缺少 targetMaterial 元数据');
      }
    }

    if (intent.source) {
      maxScore += 15;
      if (family.source.includes(intent.source)) {
        rawScore += 15;
        reasons.push(`source=${intent.source} 匹配`);
      } else if (family.source.length) {
        continue;
      } else {
        relaxed.push('素材缺少 source 元数据');
      }
    }

    if (intent.intensity) {
      maxScore += 6;
      if (family.intensity.includes(intent.intensity)) {
        rawScore += 6;
        reasons.push(`intensity=${intent.intensity} 匹配`);
      } else if (family.intensity.includes('multi')) {
        rawScore += 4;
        reasons.push('素材族含多个力度变体');
        relaxed.push('需在族内试听选择具体力度');
      } else if (adjacentIntensity(intent.intensity, family.intensity)) {
        rawScore += 3;
        relaxed.push(`力度降级：${intent.intensity} → ${family.intensity.join('|')}`);
      } else if (family.intensity.length) {
        continue;
      } else {
        relaxed.push('素材缺少 intensity 元数据');
      }
    }

    if (profile.preferredStyles.length) {
      maxScore += 10;
      const styleMatches = intersects(family.styleTags, profile.preferredStyles);
      if (styleMatches.length) {
        rawScore += 10;
        reasons.push(`项目风格匹配：${styleMatches.join('|')}`);
      } else {
        relaxed.push('未命中项目偏好风格');
      }
    }

    const score = Math.round((rawScore / maxScore) * 100);
    ranked.push({
      familyId: family.familyId,
      category: family.category,
      subfolder: family.subfolder,
      displayName: family.displayName,
      filePattern: family.filePattern,
      description: family.description,
      cue: family.cue,
      layerRole: family.layerRole,
      source: family.source,
      targetMaterial: family.targetMaterial,
      intensity: family.intensity,
      styleTags: family.styleTags,
      containsTags: family.containsTags,
      loopable: family.loopable,
      score,
      rawScore,
      maxScore,
      reasons: [
        ...reasons,
        `在线目录：${categoryLabel(family.category)} / ${subcategoryLabel(
          family.category,
          family.subfolder,
        )}`,
      ],
      relaxed,
      reviewStatus: family.reviewStatus,
      aliases: family.aliases,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aReview = a.reviewStatus === '可直接使用' ? 0 : 1;
    const bReview = b.reviewStatus === '可直接使用' ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    return a.familyId.localeCompare(b.familyId);
  });

  let preciseRanked = ranked;
  if (
    intent.targetMaterial
    && preciseRanked.some((family) =>
      family.targetMaterial.includes(intent.targetMaterial!),
    )
  ) {
    preciseRanked = preciseRanked.filter((family) =>
      family.targetMaterial.includes(intent.targetMaterial!),
    );
  }
  if (intent.source && preciseRanked.some((family) => family.source.includes(intent.source!))) {
    preciseRanked = preciseRanked.filter((family) => family.source.includes(intent.source!));
  }
  if (
    intent.intensity
    && preciseRanked.some((family) =>
      family.intensity.includes(intent.intensity!) || family.intensity.includes('multi'),
    )
  ) {
    preciseRanked = preciseRanked.filter((family) =>
      family.intensity.includes(intent.intensity!) || family.intensity.includes('multi'),
    );
  }

  return { intent, ranked: preciseRanked, warnings };
}

export function rankAudioFamilies(
  opts: SearchAudioV2Options,
): {
  intent: NormalizedAudioIntent;
  ranked: RankedAudioFamily[];
  warnings: string[];
} {
  return rankFamilyCollection(opts, families);
}

async function loadProjectWorldProfile(
  projectRoot: string | undefined,
  projectId: string | undefined,
): Promise<WorldProfile | undefined> {
  if (!projectRoot || !projectId || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(projectId)) return undefined;
  const profilePath = resolve(
    projectRoot,
    '.forgeax',
    'games',
    projectId,
    'audio',
    'world-profile.json',
  );
  try {
    const parsed = JSON.parse(await readFile(profilePath, 'utf8')) as Partial<WorldProfile>;
    return {
      preferredStyles: Array.isArray(parsed.preferredStyles)
        ? parsed.preferredStyles.map(clean).filter(Boolean)
        : [],
      forbiddenStyles: Array.isArray(parsed.forbiddenStyles)
        ? parsed.forbiddenStyles.map(clean).filter(Boolean)
        : [],
      defaultExclude: Array.isArray(parsed.defaultExclude)
        ? parsed.defaultExclude.map(clean).filter(Boolean)
        : ['voice', 'music'],
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return undefined;
    throw new BgmError(
      'bad-world-profile',
      `failed to read world profile for project '${projectId}': ${(error as Error).message}`,
      400,
    );
  }
}

function pickLatestVersion(meta: AssetMetaLike): VersionLike | undefined {
  const usable = (meta.versions ?? []).filter((version) => version.res_url);
  if (!usable.length) return undefined;
  return usable.reduce((best, version) => {
    const bestTime = Number(best.update_time ?? best.create_time ?? 0);
    const versionTime = Number(version.update_time ?? version.create_time ?? 0);
    return versionTime >= bestTime ? version : best;
  }, usable[0]);
}

function normalizeAsset(meta: AssetMetaLike): LiveAudioAsset | null {
  if (meta.type !== undefined && meta.type !== 7) return null;
  const version = pickLatestVersion(meta);
  if (!version?.res_url) return null;
  return {
    assetId: meta.asset_id || meta.id || '',
    name: meta.display_name || meta.name || '(unnamed)',
    kind: 'sfx',
    type: 7,
    description: meta.description || '',
    customTags: Array.isArray(meta.custom_tags) ? meta.custom_tags.map(clean).filter(Boolean) : [],
    generatedTags: Array.isArray(meta.gen_tags) ? meta.gen_tags.map(clean).filter(Boolean) : [],
    version: version.display_version_name || version.version_name || '',
    resUrl: version.res_url,
  };
}

async function fetchAllSfx(): Promise<LiveAudioAsset[]> {
  const { assets } = await localAudioLibrary.findAssets({
    kind: 'sfx',
    page: 1,
    pageSize: 200,
  });
  return assets
    .map(normalizeAsset)
    .filter((asset): asset is LiveAudioAsset => Boolean(asset));
}

function normalizeAssetKey(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original string when the URL contains malformed percent escapes.
  }
  return basename(decoded.split(/[?#]/, 1)[0])
    .toLowerCase()
    .replace(/\.(wav|mp3|ogg)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const aliasToFamilies = new Map<string, AudioFamily[]>();
for (const family of families) {
  for (const alias of family.aliases) {
    const key = normalizeAssetKey(alias);
    const current = aliasToFamilies.get(key) ?? [];
    current.push(family);
    aliasToFamilies.set(key, current);
  }
}

function staticFamilyForAsset(asset: LiveAudioAsset): AudioFamily | undefined {
  const directory = onlineSfxDirectory(asset);
  const keys = [normalizeAssetKey(asset.name), normalizeAssetKey(asset.resUrl)];
  for (const key of keys) {
    const candidates = aliasToFamilies.get(key) ?? [];
    const exactPath = candidates.find((family) =>
      directory
      && family.category === directory.category
      && family.subfolder === directory.subcategory,
    );
    if (exactPath) return exactPath;
    const categoryOnly = candidates.filter((family) =>
      directory && family.category === directory.category,
    );
    if (categoryOnly.length === 1) return categoryOnly[0];
  }
  return undefined;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferCue(text: string): string {
  if (includesAny(text, ['/voice/', ' voice', 'vocal', 'hurt', 'pain', 'groan', 'grunt'])) {
    if (includesAny(text, ['death', 'die', 'dead'])) return 'character.death';
      if (includesAny(text, ['hit', 'hurt', 'pain'])) return 'character.hurt';
  }
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
  if (includesAny(text, ['parry'])) return 'combat.defense.parry';
  if (includesAny(text, ['block', 'shield'])) return 'combat.defense.block';
  if (includesAny(text, ['reload'])) return 'combat.ranged.reload';
  if (includesAny(text, ['gunfire', '/firearms/', 'fire_', 'rifle', 'pistol', 'shotgun', 'shoot'])) {
    return 'combat.ranged.fire';
  }
  if (includesAny(text, ['explosion', 'explode', 'blast', 'grenade'])) return 'combat.explosion';
  if (includesAny(text, ['hit', 'impact', 'collision', 'smash', 'strike'])) return 'combat.attack.impact';
  if (includesAny(text, ['pickup', 'collect'])) return 'item.pickup';
  if (includesAny(text, ['drop'])) return 'item.drop';
  if (includesAny(text, ['spell', 'cast'])) return 'magic.cast';
  if (includesAny(text, ['button', 'click', '/ui/'])) return 'ui.click';
  if (includesAny(text, ['cancel', 'back'])) return 'ui.cancel';
  if (includesAny(text, ['ambient', 'ambience', 'atmosphere'])) return 'ambient.bed';
  return 'unclassified';
}

function inferTags(text: string, rules: Array<[string, string[]]>): string[] {
  return unique(rules.filter(([, terms]) => includesAny(text, terms)).map(([value]) => value));
}

const liveSourceRules: Array<[string, string[]]> = [
  ['sword', ['sword', 'blade']],
  ['bow', ['/bow/', ' bow', 'arrow']],
  ['rifle', ['rifle']],
  ['pistol', ['pistol']],
  ['shotgun', ['shotgun']],
  ['gun', ['gunfire', '/gun/']],
  ['shield', ['shield']],
  ['foot', ['footstep', '/footsteps/']],
  ['door', ['/door/', 'door_']],
  ['creature', ['creature', 'monster', 'beast']],
  ['magic', ['magic', 'spell']],
  ['interface', ['/ui/', 'button', 'click']],
];

const liveMaterialRules: Array<[string, string[]]> = [
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
];

const liveIntensityRules: Array<[string, string[]]> = [
  ['light', [' light', 'gentle', 'soft', 'weak']],
  ['medium', ['medium', 'moderate']],
  ['heavy', ['heavy', 'strong', 'powerful', 'forceful']],
];

const liveStyleRules: Array<[string, string[]]> = [
  ['sci_fi', ['sci-fi', 'sci_fi', 'cyber', 'futuristic']],
  ['fantasy', ['fantasy', 'magic', 'medieval']],
  ['dark_fantasy', ['dark fantasy', 'gothic']],
  ['cartoon', ['cartoon', 'comic']],
  ['casual', ['casual', 'cute']],
  ['realistic', ['realistic', 'naturalistic']],
  ['horror', ['horror', 'terrifying']],
];

const liveContainsRules: Array<[string, string[]]> = [
  ['voice', ['/voice/', ' voice', 'vocal', 'vocalization', 'speech']],
  ['music', ['/music/', ' music', 'stinger', 'jingle']],
  ['reverb_long', ['long reverb', 'long_reverb', 'long tail']],
];

function inferLiveFamily(asset: LiveAudioAsset): AudioFamily {
  const assetPath = clean(asset.name).replace(/\\/g, '/');
  const text = ` ${assetPath} ${clean(asset.description).replace(/,/g, ' ')} ${asset.customTags.join(' ')} ${asset.generatedTags.join(' ')} `;
  const directory = onlineSfxDirectory(asset);
  const category = directory?.category ?? 'live';
  const subfolder = directory?.subcategory ?? 'unclassified';
  const cue = inferCue(text);
  const source = inferTags(text, liveSourceRules);
  const targetMaterial = inferTags(text, liveMaterialRules);
  const intensity = inferTags(text, liveIntensityRules);
  const styleTags = inferTags(text, liveStyleRules);
  const containsTags = inferTags(text, liveContainsRules);
  const filename = basename(assetPath);
  const familyStem = onlineSfxFamilyStem(asset);
  const familyId = onlineSfxFallbackFamilyId(asset)
    ?? `online.unclassified.${familyStem.replace(/_/g, '.')}`;
  const layerRole =
    cue === 'combat.attack.swing' ? 'whoosh'
      : cue === 'combat.attack.impact' ? 'impact'
        : cue === 'character.hurt' ? 'hurt'
          : cue.startsWith('ambient.') ? 'ambience'
            : 'complete';
  return {
    category,
    categoryName: categoryLabel(category),
    subfolder,
    displayName: familyStem || filename,
    filePattern: filename.replace(/_\d{2}(\.(wav|mp3|ogg))$/i, '_NN$1'),
    quantity: 1,
    description: asset.description,
    kind: 'sfx',
    cue,
    layerRole,
    source,
    targetMaterial,
    element: [],
    intensity,
    distance: [],
    styleTags,
    containsTags,
    loopable: includesAny(text, [' loop', '_loop']),
    familyId,
    mustMatch: unique(['sfx', cue, ...targetMaterial]),
    boostTerms: unique([...source, ...intensity, ...styleTags]),
    defaultExclude: [],
    aliases: [filename],
    reviewStatus: 'Live标签推导',
  };
}

function mergeFamily(left: AudioFamily, right: AudioFamily): AudioFamily {
  return {
    ...left,
    quantity: left.quantity + right.quantity,
    description: left.description || right.description,
    source: unique([...left.source, ...right.source]),
    targetMaterial: unique([...left.targetMaterial, ...right.targetMaterial]),
    element: unique([...left.element, ...right.element]),
    intensity: unique([...left.intensity, ...right.intensity]),
    distance: unique([...left.distance, ...right.distance]),
    styleTags: unique([...left.styleTags, ...right.styleTags]),
    containsTags: unique([...left.containsTags, ...right.containsTags]),
    mustMatch: unique([...left.mustMatch, ...right.mustMatch]),
    boostTerms: unique([...left.boostTerms, ...right.boostTerms]),
    aliases: unique([...left.aliases, ...right.aliases]),
  };
}

function buildLiveFamilyIndex(liveAssets: LiveAudioAsset[]): {
  liveFamilies: AudioFamily[];
  assetsByFamily: Map<string, LiveAudioAsset[]>;
  staticMatchedAssets: number;
  inferredAssets: number;
  directoryMappedAssets: number;
} {
  const familyById = new Map<string, AudioFamily>();
  const assetsByFamily = new Map<string, LiveAudioAsset[]>();
  let staticMatchedAssets = 0;
  let inferredAssets = 0;
  let directoryMappedAssets = 0;

  for (const asset of liveAssets) {
    const directory = onlineSfxDirectory(asset);
    if (directory) directoryMappedAssets += 1;
    const staticFamily = staticFamilyForAsset(asset);
    const baseFamily = staticFamily
      ? { ...staticFamily, aliases: [basename(clean(asset.name))], quantity: 1 }
      : inferLiveFamily(asset);
    const family = directory
      ? {
        ...baseFamily,
        category: directory.category,
        categoryName: categoryLabel(directory.category),
        subfolder: directory.subcategory,
      }
      : baseFamily;
    if (staticFamily) staticMatchedAssets += 1;
    else inferredAssets += 1;

    const currentFamily = familyById.get(family.familyId);
    familyById.set(family.familyId, currentFamily ? mergeFamily(currentFamily, family) : family);
    const currentAssets = assetsByFamily.get(family.familyId) ?? [];
    currentAssets.push(asset);
    assetsByFamily.set(family.familyId, currentAssets);
  }

  return {
    liveFamilies: [...familyById.values()],
    assetsByFamily,
    staticMatchedAssets,
    inferredAssets,
    directoryMappedAssets,
  };
}

function aliasesFor(value: string, aliases: Record<string, string>): string[] {
  return unique([
    value,
    ...Object.entries(aliases)
      .filter(([, canonicalValue]) => canonicalValue === value)
      .map(([alias]) => alias),
  ]);
}

function customFileText(fileName: string): string {
  return ` ${fileName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.(ogg|mp3|wav)$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
}

function filenameIncludesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const normalized = term
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (normalized.length <= 1) return false;
    return /[^\x00-\x7F]/.test(normalized)
      ? text.includes(normalized)
      : text.includes(` ${normalized} `);
  });
}

function customSfxMatches(asset: ResolvedCustomAudio, intent: NormalizedAudioIntent): boolean {
  if (intent.directoryCategory || intent.directorySubcategory) return false;
  const text = customFileText(asset.fileName);
  if (!filenameIncludesAny(text, aliasesFor(intent.cue, cueAliases))) return false;
  if (intent.source && !filenameIncludesAny(text, aliasesFor(intent.source, sourceAliases))) {
    return false;
  }
  if (
    intent.targetMaterial
    && !filenameIncludesAny(text, aliasesFor(intent.targetMaterial, materialAliases))
  ) {
    return false;
  }
  if (
    intent.intensity
    && !filenameIncludesAny(text, aliasesFor(intent.intensity, intensityAliases))
  ) {
    return false;
  }
  return !intent.exclude.some((excluded) =>
    filenameIncludesAny(text, aliasesFor(excluded, excludeAliases)));
}

async function matchingCustomSfx(
  projectRoot: string,
  intent: NormalizedAudioIntent,
): Promise<{ registered: number; assets: ResolvedCustomAudio[] }> {
  const { assets } = await listCustomAudio(projectRoot, 'sfx');
  const resolved = await Promise.all(
    assets.map((asset) => resolveCustomAudio(projectRoot, asset.assetId)),
  );
  const available = resolved.filter((asset): asset is ResolvedCustomAudio => Boolean(asset));
  return {
    registered: assets.length,
    assets: available.filter((asset) => customSfxMatches(asset, intent)),
  };
}

function customSfxCandidate(
  asset: ResolvedCustomAudio,
  intent: NormalizedAudioIntent,
): SearchAudioV2Result['candidates'][number] {
  const explicit = [
    `cue=${intent.cue}`,
    intent.source ? `source=${intent.source}` : '',
    intent.targetMaterial ? `targetMaterial=${intent.targetMaterial}` : '',
    intent.intensity ? `intensity=${intent.intensity}` : '',
  ].filter(Boolean);
  return {
    familyId: `custom.sfx.${asset.assetId.split(':').at(-1)}`,
    category: 'custom',
    subfolder: 'registered',
    displayName: asset.fileName,
    filePattern: asset.fileName,
    description: '用户已登记的自定义音效，仅按文件名中的明确词语匹配',
    cue: intent.cue,
    layerRole: 'complete',
    source: intent.source ? [intent.source] : [],
    targetMaterial: intent.targetMaterial ? [intent.targetMaterial] : [],
    intensity: intent.intensity ? [intent.intensity] : [],
    styleTags: [],
    containsTags: [],
    loopable: filenameIncludesAny(customFileText(asset.fileName), ['loop', '循环']),
    score: 100,
    rawScore: explicit.length,
    maxScore: explicit.length,
    reasons: explicit.map((field) => `自定义文件名明确匹配 ${field}`),
    relaxed: [],
    reviewStatus: '用户明确导入',
    availability: 'live',
    assetId: asset.assetId,
    name: asset.fileName,
    version: asset.version,
    resUrl: asset.previewUrl,
    variants: [{
      assetId: asset.assetId,
      name: asset.fileName,
      version: asset.version,
      resUrl: asset.previewUrl,
    }],
  };
}

export async function searchAudioV2(
  cfg: BgmConfig,
  opts: SearchAudioV2Options,
  projectRoot?: string,
  includeCustom = false,
): Promise<SearchAudioV2Result> {
  const projectProfile = await loadProjectWorldProfile(projectRoot, opts.projectId);
  const staticRanking = rankFamilyCollection(opts, families, projectProfile);
  const { intent } = staticRanking;
  const warnings = [...staticRanking.warnings];
  // Search has no numeric quality gate. Structurally valid families are
  // returned and every missing/relaxed field remains explicit for the caller.
  const eligible = staticRanking.ranked;
  const diagnostics: SearchAudioV2Result['diagnostics'] = {
    indexedFamilies: audioSearchIndex.familyCount,
    declaredAssets: audioSearchIndex.declaredAssetCount,
  };

  if (opts.dryRun) {
    const candidates = eligible.slice(0, intent.topK).map((family) => ({
      ...family,
      availability: 'index-only' as const,
      variants: family.aliases.map((name) => ({ name })),
    }));
    if (candidates.length < intent.topK) warnings.push(`仅找到 ${candidates.length} 个符合硬条件的音效族`);
    return {
      ok: true,
      mode: 'index-only',
      normalizedIntent: intent,
      count: candidates.length,
      candidates,
      diagnostics,
      warnings,
    };
  }

  const [liveAssets, custom] = await Promise.all([
    fetchAllSfx(),
    includeCustom && projectRoot
      ? matchingCustomSfx(projectRoot, intent)
      : Promise.resolve({ registered: 0, assets: [] as ResolvedCustomAudio[] }),
  ]);
  const liveIndex = buildLiveFamilyIndex(liveAssets);
  const liveRanking = rankFamilyCollection(opts, liveIndex.liveFamilies, projectProfile);
  const liveEligible = liveRanking.ranked;
  diagnostics.liveAssets = liveAssets.length;
  diagnostics.matchedLiveAssets = liveAssets.length;
  diagnostics.staticMatchedLiveAssets = liveIndex.staticMatchedAssets;
  diagnostics.inferredLiveAssets = liveIndex.inferredAssets;
  diagnostics.directoryMappedLiveAssets = liveIndex.directoryMappedAssets;
  diagnostics.directoryUnmappedLiveAssets =
    liveAssets.length - liveIndex.directoryMappedAssets;
  diagnostics.matchedFamilies = liveIndex.assetsByFamily.size;
  if (includeCustom) {
    diagnostics.registeredCustomAssets = custom.registered;
    diagnostics.matchedCustomAssets = custom.assets.length;
  }

  const packagedCandidates = liveEligible
    .flatMap((family) => {
      const variants = liveIndex.assetsByFamily.get(family.familyId);
      if (!variants?.length) return [];
      const ordered = [...variants].sort((a, b) => a.name.localeCompare(b.name));
      const selected = ordered[0];
      return [{
        ...family,
        availability: 'live' as const,
        assetId: selected.assetId,
        name: selected.name,
        version: selected.version,
        resUrl: selected.resUrl,
        variants: ordered.map((asset) => ({
          assetId: asset.assetId,
          name: asset.name,
          version: asset.version,
          resUrl: asset.resUrl,
        })),
      }];
    });
  const candidates = [
    ...custom.assets.map((asset) => customSfxCandidate(asset, intent)),
    ...packagedCandidates,
  ].slice(0, intent.topK);

  if (liveAssets.length && liveIndex.staticMatchedAssets / liveAssets.length < 0.8) {
    warnings.push(
      `供应商映射表直接覆盖 ${Math.round((liveIndex.staticMatchedAssets / liveAssets.length) * 100)}% 的Live资产，其余资产已使用现有name/description标签推导并标记复核`,
    );
  }
  if (liveIndex.directoryMappedAssets < liveAssets.length) {
    warnings.push(
      `${liveAssets.length - liveIndex.directoryMappedAssets} 个Live资产未映射到共享一级/二级目录`,
    );
  }
  if (candidates.length < intent.topK) {
    warnings.push(`Live资产中仅找到 ${candidates.length} 个可调用的匹配音效族`);
  }

  return {
    ok: true,
    mode: 'live',
    normalizedIntent: intent,
    count: candidates.length,
    candidates,
    diagnostics,
    warnings,
  };
}
