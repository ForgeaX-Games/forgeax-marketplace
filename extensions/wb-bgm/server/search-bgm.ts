import {
  BGM_CATALOG_TRACKS,
  bgmCatalogTrackForAsset,
  normalizeBgmCriteria,
  rankBgmTracks,
  type BgmCatalogTrack,
  type BgmSearchCriteria,
} from '../src/bgmTagSearch.ts';
import type { AssetMetaLike } from './audio-library-provider.ts';
import { BgmError, type BgmConfig } from './core.ts';
import {
  listCustomAudio,
  resolveCustomAudio,
  type ResolvedCustomAudio,
} from './custom-audio-library.ts';
import { localAudioLibrary } from './local-audio-library.ts';

export interface SearchBgmOptions extends BgmSearchCriteria {
  kind?: string;
  topK?: number;
  dryRun?: boolean;
}

interface VersionLike {
  version_name?: string;
  display_version_name?: string;
  res_url?: string;
  state?: number;
  update_time?: number | string;
  create_time?: number | string;
}

interface LiveBgmAsset {
  assetId: string;
  name: string;
  description: string;
  version: string;
  resUrl: string;
  source: AssetMetaLike;
}

export interface SearchBgmResult {
  ok: true;
  mode: 'index-only' | 'live';
  normalizedIntent: Required<BgmSearchCriteria> & {
    kind: 'bgm';
    topK: number;
  };
  count: number;
  candidates: Array<{
    assetId: string;
    name: string;
    version: string;
    resUrl: string;
    scene?: string;
    mood: string[];
    energy?: string;
    world?: string;
    score: number;
    matchLevel: 'exact' | 'relaxed' | 'partial';
    reasons: string[];
    relaxed: string[];
    unknown: string[];
    tagSources: {
      scene?: string;
      mood: string[];
      energy?: string;
      world?: string;
    };
  }>;
  diagnostics: {
    catalogTracks: number;
    liveAssets?: number;
    mappedLiveAssets?: number;
    registeredCustomAssets?: number;
    matchedCustomAssets?: number;
  };
  warnings: string[];
}

function latestVersion(meta: AssetMetaLike): VersionLike | undefined {
  const usable = (meta.versions ?? []).filter((version) =>
    version.res_url && version.state !== 4);
  if (!usable.length) return undefined;
  return usable.reduce((best, version) => {
    const bestTime = Number(best.update_time ?? best.create_time ?? 0);
    const versionTime = Number(version.update_time ?? version.create_time ?? 0);
    return versionTime >= bestTime ? version : best;
  }, usable[0]);
}

function normalizeAsset(meta: AssetMetaLike): LiveBgmAsset | null {
  if (meta.type !== undefined && meta.type !== 3) return null;
  const version = latestVersion(meta);
  if (!version?.res_url) return null;
  return {
    assetId: meta.asset_id || meta.id || '',
    name: meta.display_name || meta.name || '(unnamed)',
    description: meta.description || '',
    version: version.display_version_name || version.version_name || '',
    resUrl: version.res_url,
    source: meta,
  };
}

async function fetchAllBgm(): Promise<LiveBgmAsset[]> {
  const { assets } = await localAudioLibrary.findAssets({
    kind: 'bgm',
    page: 1,
    pageSize: 200,
  });
  return assets
    .map(normalizeAsset)
    .filter((asset): asset is LiveBgmAsset => Boolean(asset));
}

function customNameMatches(fileName: string, queryText: string): boolean {
  const terms = queryText
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s,，、/_.-]+/)
    .filter((term) => term.length > 1);
  if (!terms.length) return false;
  const haystack = fileName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.(ogg|mp3|wav)$/i, '')
    .replace(/[\s,，、/_.-]+/g, ' ');
  const padded = ` ${haystack} `;
  return terms.every((term) =>
    /[^\x00-\x7F]/.test(term)
      ? haystack.includes(term)
      : padded.includes(` ${term} `));
}

async function matchingCustomBgm(
  projectRoot: string,
  queryText: string,
): Promise<{ registered: number; assets: ResolvedCustomAudio[] }> {
  const { assets } = await listCustomAudio(projectRoot, 'bgm');
  const matched = assets.filter((asset) => customNameMatches(asset.originalName, queryText));
  const resolved = await Promise.all(
    matched.map((asset) => resolveCustomAudio(projectRoot, asset.assetId)),
  );
  return {
    registered: assets.length,
    assets: resolved.filter((asset): asset is ResolvedCustomAudio => Boolean(asset)),
  };
}

function formalTags(track: BgmCatalogTrack): {
  scene?: string;
  mood: string[];
  energy?: string;
  world?: string;
  sources: SearchBgmResult['candidates'][number]['tagSources'];
} {
  const scene = track.scene.strength === 'hard' ? track.scene.id : undefined;
  const moodTags = track.mood
    .filter((tag) => tag.strength === 'hard' || tag.strength === 'soft');
  const energy =
    track.energy.strength === 'hard' || track.energy.strength === 'soft'
      ? track.energy.id
      : undefined;
  const world = track.world.strength === 'hard' ? track.world.id : undefined;
  return {
    scene,
    mood: moodTags.map((tag) => tag.id),
    energy,
    world,
    sources: {
      scene: scene ? 'filename' : undefined,
      mood: moodTags.map((tag) => tag.strength === 'hard' ? 'filename' : 'clap'),
      energy: energy
        ? track.energy.strength === 'hard' ? 'filename' : 'clap'
        : undefined,
      world: world ? 'filename' : undefined,
    },
  };
}

export async function searchBgm(
  cfg: BgmConfig,
  options: SearchBgmOptions,
  projectRoot?: string,
  includeCustom = false,
): Promise<SearchBgmResult> {
  if (options.kind !== 'bgm') {
    throw new BgmError('invalid-kind', "search-bgm requires kind='bgm'", 400);
  }
  const normalized = normalizeBgmCriteria(options);
  if (
    !normalized.queryText
    && !normalized.scene
    && !normalized.moodIds.length
    && !normalized.energy
    && !normalized.world
  ) {
    throw new BgmError(
      'bgm-criteria-required',
      'queryText or at least one of scene/moodIds/energy/world is required',
      400,
    );
  }
  const topK = Math.min(Math.max(Math.trunc(options.topK ?? 5), 1), 20);
  const hasStructuredCriteria = Boolean(
    normalized.scene
    || normalized.moodIds.length
    || normalized.energy
    || normalized.world,
  );
  const ranked = rankBgmTracks(normalized)
    .filter((row) =>
      hasStructuredCriteria
      || !normalized.queryText
      || row.matchedFields.includes('名称关键词'));
  const normalizedIntent = {
    kind: 'bgm' as const,
    ...normalized,
    topK,
  };
  const diagnostics: SearchBgmResult['diagnostics'] = {
    catalogTracks: BGM_CATALOG_TRACKS.length,
  };
  const warnings: string[] = [];

  if (options.dryRun) {
    const candidates = ranked.slice(0, topK).map((row) => {
      const tags = formalTags(row.track);
      return {
        assetId: row.track.assetId,
        name: row.track.displayName,
        version: row.track.version,
        resUrl: '',
        scene: tags.scene,
        mood: tags.mood,
        energy: tags.energy,
        world: tags.world,
        score: row.score,
        matchLevel: row.matchLevel,
        reasons: row.matchedFields,
        relaxed: row.relaxedFields,
        unknown: row.unknownFields,
        tagSources: tags.sources,
      };
    });
    return {
      ok: true,
      mode: 'index-only',
      normalizedIntent,
      count: candidates.length,
      candidates,
      diagnostics,
      warnings,
    };
  }

  const [liveAssets, custom] = await Promise.all([
    fetchAllBgm(),
    includeCustom && projectRoot && normalized.queryText
      ? matchingCustomBgm(projectRoot, normalized.queryText)
      : Promise.resolve({ registered: 0, assets: [] as ResolvedCustomAudio[] }),
  ]);
  const byCatalogId = new Map<string, LiveBgmAsset>();
  for (const asset of liveAssets) {
    const track = bgmCatalogTrackForAsset(asset.source);
    if (track) byCatalogId.set(track.assetId, asset);
  }
  diagnostics.liveAssets = liveAssets.length;
  diagnostics.mappedLiveAssets = byCatalogId.size;
  if (includeCustom) {
    diagnostics.registeredCustomAssets = custom.registered;
    diagnostics.matchedCustomAssets = custom.assets.length;
  }

  const packagedCandidates = ranked
    .flatMap((row) => {
      const asset = byCatalogId.get(row.track.assetId);
      if (!asset) return [];
      const tags = formalTags(row.track);
      return [{
        assetId: asset.assetId,
        name: asset.name,
        version: asset.version,
        resUrl: asset.resUrl,
        scene: tags.scene,
        mood: tags.mood,
        energy: tags.energy,
        world: tags.world,
        score: row.score,
        matchLevel: row.matchLevel,
        reasons: row.matchedFields,
        relaxed: row.relaxedFields,
        unknown: row.unknownFields,
        tagSources: tags.sources,
      }];
    });
  const customCandidates: SearchBgmResult['candidates'] = custom.assets.map((asset) => {
    const unknown = [
      normalized.scene ? '使用场景未标注' : '',
      normalized.moodIds.length ? '情绪未标注' : '',
      normalized.energy ? '能量未标注' : '',
      normalized.world ? '世界观未标注' : '',
    ].filter(Boolean);
    return {
      assetId: asset.assetId,
      name: asset.fileName,
      version: asset.version,
      resUrl: asset.previewUrl,
      mood: [],
      score: 100,
      matchLevel: unknown.length ? 'relaxed' : 'exact',
      reasons: ['自定义文件名明确匹配'],
      relaxed: [],
      unknown,
      tagSources: { mood: [] },
    };
  });
  // An explicitly matching user import is intentional and therefore precedes
  // packaged alternatives. No custom file is considered without registration.
  const candidates = [...customCandidates, ...packagedCandidates].slice(0, topK);

  if (byCatalogId.size < liveAssets.length) {
    warnings.push(`${liveAssets.length - byCatalogId.size} 首Live BGM尚未映射到标签目录`);
  }
  if (candidates.some((candidate) => candidate.matchLevel !== 'exact')) {
    warnings.push('精确结果不足时已逐级放宽；场景冲突仅作为最后一级候选');
  }
  if (candidates.length < topK) {
    warnings.push(`Live资产中仅找到 ${candidates.length} 首可调用曲目`);
  }

  return {
    ok: true,
    mode: 'live',
    normalizedIntent,
    count: candidates.length,
    candidates,
    diagnostics,
    warnings,
  };
}
