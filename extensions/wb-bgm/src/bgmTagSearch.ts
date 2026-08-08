import bgmTagCatalogJson from '../data/bgm-tag-catalog.json';

export type BgmTagStrength = 'hard' | 'soft' | 'unknown';
export type BgmMatchLevel = 'exact' | 'relaxed' | 'partial';

export interface BgmTag {
  id: string;
  source: string;
  strength: BgmTagStrength;
  confidence?: number;
  evidence?: string;
}

export interface BgmCatalogTrack {
  assetId: string;
  displayName: string;
  version: string;
  scene: BgmTag;
  mood: BgmTag[];
  energy: BgmTag;
  world: BgmTag;
  technical: {
    loopableFromName: boolean;
    stingerFromName: boolean;
    durationFromName: number | null;
    variantGroup: string;
    variantIndex: number | null;
    durationSeconds: number | null;
    windowCount: number;
  };
}

interface BgmTagCatalog {
  count: number;
  labels: Record<'scene' | 'mood' | 'energy' | 'world', Record<string, string>>;
  tracks: BgmCatalogTrack[];
}

export interface BgmSearchCriteria {
  queryText?: string;
  scene?: string;
  moodIds?: string[];
  energy?: string;
  world?: string;
}

export interface BgmRankedTrack {
  track: BgmCatalogTrack;
  score: number;
  matchLevel: BgmMatchLevel;
  matchedFields: string[];
  relaxedFields: string[];
  unknownFields: string[];
  hardConstraintsVerified: boolean;
}

export interface BgmTagOption {
  id: string;
  label: string;
  count: number;
}

const catalog = bgmTagCatalogJson as BgmTagCatalog;

export const BGM_TAG_LABELS = catalog.labels;
export const BGM_CATALOG_TRACKS = catalog.tracks;

const QUERY_ALIASES: Record<'scene' | 'mood' | 'energy' | 'world', Record<string, string[]>> = {
  scene: {
    menu_lobby: ['菜单', '大厅', '主界面', 'menu', 'lobby'],
    exploration_ambient: ['探索', '环境', '漫游', 'explore', 'ambient'],
    combat: ['战斗', '交战', 'combat', 'battle'],
    boss_combat: ['boss', '首领', '头目'],
    narrative_emotion: ['剧情', '叙事', '情感', 'story', 'narrative'],
    puzzle_casual: ['解谜', '休闲', '益智', 'puzzle', 'casual'],
    strategy_management: ['策略', '经营', '建设', 'strategy', 'management'],
    competition: ['竞技', '竞速', '比赛', 'competition', 'racing', 'sports'],
    result_event: ['胜利', '失败', '结算', '升级', '结果', 'victory', 'defeat', 'result'],
    general_theme: ['主题', '主旋律', '通用', 'theme'],
  },
  mood: {
    calm: ['平静', '安静', '舒缓', 'calm', 'peaceful'],
    tense: ['紧张', '压迫', '焦虑', 'tense', 'suspense'],
    dark: ['黑暗', '阴暗', '暗黑', 'dark'],
    mysterious: ['神秘', '悬疑', 'mysterious', 'mystery'],
    epic: ['宏大', '史诗', '壮阔', 'epic', 'heroic'],
    warm: ['温暖', '治愈', '温馨', 'warm', 'healing'],
    sad: ['悲伤', '伤感', '离别', 'sad', 'melancholy'],
    playful: ['轻松', '活泼', '欢乐', '可爱', 'playful', 'happy', 'cute'],
  },
  energy: {
    low: ['低能量', '低强度', '舒缓', '慢', 'low energy', 'slow'],
    medium: ['中能量', '中等强度', '稳定推进', 'medium energy'],
    high: ['高能量', '高强度', '激烈', '快速', 'high energy', 'intense', 'fast'],
  },
  world: {
    eastern_fantasy: ['东方幻想', '仙侠', '武侠', '国风', 'eastern fantasy', 'wuxia', 'xianxia'],
    western_fantasy: ['西方幻想', '魔幻', '魔法', 'western fantasy', 'medieval fantasy'],
    sci_fi_cyber: ['科幻', '赛博', '未来', '太空', 'sci-fi', 'cyber', 'space'],
    historical_culture: ['历史', '文化', '中世纪', '海盗', '蒸汽朋克', 'historical', 'viking', 'pirate', 'steampunk'],
    modern_urban: ['现代', '都市', '校园', '职场', 'modern', 'urban', 'school'],
    post_apocalyptic: ['末世', '废土', '灾后', 'post-apocalyptic', 'wasteland'],
    neutral_general: ['中性', '通用世界', 'neutral', 'general'],
  },
};

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
    // Keep malformed supplier paths searchable by their original spelling.
  }
  const segments = decoded
    .replace(/\\/g, '/')
    .split(/[?#]/, 1)[0]
    .split('/');
  return (segments[segments.length - 1] ?? '')
    .toLowerCase()
    .replace(/\.(wav|mp3|ogg|m4a)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function inferBgmCriteriaFromQuery(queryText: string): BgmSearchCriteria {
  const query = clean(queryText);
  if (!query) return {};
  const pick = (dimension: keyof typeof QUERY_ALIASES): string[] =>
    Object.entries(QUERY_ALIASES[dimension])
      .filter(([, aliases]) => aliases.some((alias) => query.includes(alias)))
      .map(([id]) => id);
  const scenes = pick('scene');
  const moods = pick('mood');
  const energies = pick('energy');
  const worlds = pick('world');
  return {
    scene: scenes.includes('boss_combat')
      ? 'boss_combat'
      : scenes[0],
    moodIds: moods.slice(0, 2),
    energy: energies[0],
    world: worlds[0],
  };
}

export function normalizeBgmCriteria(criteria: BgmSearchCriteria): Required<BgmSearchCriteria> {
  const inferred = inferBgmCriteriaFromQuery(criteria.queryText ?? '');
  return {
    queryText: String(criteria.queryText ?? '').trim(),
    scene: clean(criteria.scene) || inferred.scene || '',
    moodIds: unique(
      (criteria.moodIds?.length ? criteria.moodIds : inferred.moodIds ?? [])
        .map(clean),
    ).slice(0, 2),
    energy: clean(criteria.energy) || inferred.energy || '',
    world: clean(criteria.world) || inferred.world || '',
  };
}

function knownTag(tag: BgmTag | undefined, accepted: BgmTagStrength[]): string | undefined {
  return tag && accepted.includes(tag.strength) ? tag.id : undefined;
}

function queryMatchesTrack(track: BgmCatalogTrack, queryText: string): boolean {
  const terms = clean(queryText)
    .split(/[\s,，、/]+/)
    .filter((term) => term.length > 1 && !Object.values(QUERY_ALIASES)
      .some((dimension) => Object.values(dimension).some((aliases) => aliases.includes(term))));
  if (!terms.length) return false;
  const haystack = clean(track.displayName.replace(/[_/.-]+/g, ' '));
  return terms.every((term) => haystack.includes(term));
}

export function rankBgmTracks(
  criteriaInput: BgmSearchCriteria,
  tracks: readonly BgmCatalogTrack[] = BGM_CATALOG_TRACKS,
): BgmRankedTrack[] {
  const criteria = normalizeBgmCriteria(criteriaInput);
  return tracks
    .map((track): BgmRankedTrack => {
      const matchedFields: string[] = [];
      const relaxedFields: string[] = [];
      const unknownFields: string[] = [];
      let score = 0;
      let sceneConflict = false;

      if (criteria.scene) {
        const value = knownTag(track.scene, ['hard']);
        if (value === criteria.scene) {
          score += 45;
          matchedFields.push('使用场景');
        } else if (!value) {
          unknownFields.push('使用场景未标注');
        } else {
          sceneConflict = true;
          score -= 45;
          relaxedFields.push('使用场景已放宽');
        }
      }

      if (criteria.world) {
        const value = knownTag(track.world, ['hard']);
        if (value === criteria.world) {
          score += 20;
          matchedFields.push('世界观');
        } else if (!value) {
          unknownFields.push('世界观未标注');
        } else {
          score -= 16;
          relaxedFields.push('世界观已放宽');
        }
      }

      if (criteria.moodIds.length) {
        const values = new Map(
          track.mood
            .filter((tag) => tag.strength === 'hard' || tag.strength === 'soft')
            .map((tag) => [tag.id, tag.strength]),
        );
        let matches = 0;
        for (const mood of criteria.moodIds) {
          const strength = values.get(mood);
          if (strength) {
            matches += 1;
            score += strength === 'hard' ? 15 : 10;
          }
        }
        if (matches === criteria.moodIds.length) {
          matchedFields.push('情绪');
        } else if (matches > 0) {
          matchedFields.push('部分情绪');
          relaxedFields.push('次要情绪已放宽');
        } else {
          relaxedFields.push('情绪已放宽');
          score -= 8;
        }
      }

      if (criteria.energy) {
        const value = knownTag(track.energy, ['hard', 'soft']);
        if (value === criteria.energy) {
          score += track.energy.strength === 'hard' ? 15 : 11;
          matchedFields.push('能量');
        } else if (!value) {
          unknownFields.push('能量未标注');
        } else {
          score -= 10;
          relaxedFields.push('能量已放宽');
        }
      }

      if (criteria.queryText && queryMatchesTrack(track, criteria.queryText)) {
        score += 12;
        matchedFields.push('名称关键词');
      }

      const hasCriteria = Boolean(
        criteria.scene
        || criteria.world
        || criteria.energy
        || criteria.moodIds.length
        || criteria.queryText,
      );
      if (!hasCriteria) score = 1;
      const matchLevel: BgmMatchLevel = sceneConflict
        ? 'partial'
        : relaxedFields.length || unknownFields.length
          ? 'relaxed'
          : 'exact';
      return {
        track,
        score,
        matchLevel,
        matchedFields: unique(matchedFields),
        relaxedFields: unique(relaxedFields),
        unknownFields: unique(unknownFields),
        hardConstraintsVerified: !sceneConflict
          && !unknownFields.some((field) => field.startsWith('使用场景')),
      };
    })
    .sort((left, right) => {
      const levels: Record<BgmMatchLevel, number> = {
        exact: 0,
        relaxed: 1,
        partial: 2,
      };
      return levels[left.matchLevel] - levels[right.matchLevel]
        || right.score - left.score
        || left.track.displayName.localeCompare(right.track.displayName);
    });
}

export function bgmCatalogTrackForAsset(asset: {
  asset_id?: string;
  id?: string;
  display_name?: string;
  name?: string;
  versions?: Array<{ res_url?: string }>;
}): BgmCatalogTrack | undefined {
  const assetId = asset.asset_id || asset.id || '';
  if (assetId) {
    const direct = BGM_CATALOG_TRACKS.find((track) => track.assetId === assetId);
    if (direct) return direct;
  }
  const keys = unique([
    normalizeAssetKey(asset.display_name || asset.name || ''),
    ...((asset.versions ?? []).map((version) => normalizeAssetKey(version.res_url || ''))),
  ]);
  return BGM_CATALOG_TRACKS.find((track) =>
    keys.includes(normalizeAssetKey(track.displayName)));
}

export function buildBgmTagOptions(): Record<
  'scene' | 'mood' | 'energy' | 'world',
  BgmTagOption[]
> {
  const counts = {
    scene: new Map<string, number>(),
    mood: new Map<string, number>(),
    energy: new Map<string, number>(),
    world: new Map<string, number>(),
  };
  for (const track of BGM_CATALOG_TRACKS) {
    if (track.scene.strength === 'hard') {
      counts.scene.set(track.scene.id, (counts.scene.get(track.scene.id) ?? 0) + 1);
    }
    for (const tag of track.mood) {
      if (tag.strength !== 'hard' && tag.strength !== 'soft') continue;
      counts.mood.set(tag.id, (counts.mood.get(tag.id) ?? 0) + 1);
    }
    if (track.energy.strength === 'hard' || track.energy.strength === 'soft') {
      counts.energy.set(track.energy.id, (counts.energy.get(track.energy.id) ?? 0) + 1);
    }
    if (track.world.strength === 'hard') {
      counts.world.set(track.world.id, (counts.world.get(track.world.id) ?? 0) + 1);
    }
  }
  const options = (dimension: keyof typeof counts): BgmTagOption[] =>
    Object.entries(BGM_TAG_LABELS[dimension]).map(([id, label]) => ({
      id,
      label,
      count: counts[dimension].get(id) ?? 0,
    }));
  return {
    scene: options('scene'),
    mood: options('mood'),
    energy: options('energy'),
    world: options('world'),
  };
}

export function bgmTagLabel(
  dimension: 'scene' | 'mood' | 'energy' | 'world',
  id: string,
): string {
  return BGM_TAG_LABELS[dimension][id] ?? id;
}
