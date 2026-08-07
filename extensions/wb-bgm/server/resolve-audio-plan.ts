import {
  searchAudioV2,
  type RankedAudioFamily,
  type SearchAudioV2Result,
} from './search-v2.ts';
import type { BgmConfig } from './core.ts';

export interface AudioPlanIntent {
  eventId?: string;
  playerGoal?: string;
  kind?: string;
  cue?: string;
  directoryCategory?: string;
  directorySubcategory?: string;
  source?: string;
  targetMaterial?: string;
  intensity?: string;
  exclude?: string[];
  variantCount?: number;
  topK?: number;
  priority?: string;
}

export interface ResolveAudioPlanOptions {
  schemaVersion?: string;
  planId?: string;
  projectId?: string;
  slug?: string;
  topK?: number;
  dryRun?: boolean;
  items?: AudioPlanIntent[];
}

interface ResolvedVariant {
  assetId?: string;
  name: string;
  version?: string;
  resUrl?: string;
}

interface ResolvedFamily extends Omit<RankedAudioFamily, 'aliases'> {
  availability: 'index-only' | 'live';
  variants: ResolvedVariant[];
}

export interface ResolvedAudioPlanItem {
  eventId: string;
  playerGoal: string;
  priority: string;
  status: 'exact' | 'fallback' | 'gap' | 'error';
  familyId?: string;
  selectedFamily?: ResolvedFamily;
  alternatives: ResolvedFamily[];
  reasons: string[];
  relaxed: string[];
  warnings: string[];
  error?: string;
}

export interface ResolveAudioPlanResult {
  ok: true;
  schemaVersion: 'resolved-audio-plan/1';
  planId: string;
  projectId: string;
  slug?: string;
  mode: 'index-only' | 'live';
  summary: {
    requested: number;
    exact: number;
    fallback: number;
    gap: number;
    error: number;
  };
  items: ResolvedAudioPlanItem[];
  warnings: string[];
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toResolvedFamily(
  candidate: SearchAudioV2Result['candidates'][number],
  variantCount: number,
): ResolvedFamily {
  return {
    familyId: candidate.familyId,
    category: candidate.category,
    subfolder: candidate.subfolder,
    displayName: candidate.displayName,
    filePattern: candidate.filePattern,
    description: candidate.description,
    cue: candidate.cue,
    layerRole: candidate.layerRole,
    source: candidate.source,
    targetMaterial: candidate.targetMaterial,
    intensity: candidate.intensity,
    styleTags: candidate.styleTags,
    containsTags: candidate.containsTags,
    loopable: candidate.loopable,
    score: candidate.score,
    rawScore: candidate.rawScore,
    maxScore: candidate.maxScore,
    reasons: candidate.reasons,
    relaxed: candidate.relaxed,
    reviewStatus: candidate.reviewStatus,
    availability: candidate.availability,
    variants: candidate.variants.slice(0, variantCount).map((variant) => ({
      assetId: variant.assetId,
      name: variant.name,
      version: variant.version,
      resUrl: variant.resUrl,
    })),
  };
}

function emptyItem(
  eventId: string,
  playerGoal: string,
  priority: string,
  status: 'gap' | 'error',
  message: string,
): ResolvedAudioPlanItem {
  return {
    eventId,
    playerGoal,
    priority,
    status,
    alternatives: [],
    reasons: [],
    relaxed: [],
    warnings: status === 'gap' ? [message] : [],
    ...(status === 'error' ? { error: message } : {}),
  };
}

export async function resolveAudioPlan(
  cfg: BgmConfig,
  opts: ResolveAudioPlanOptions,
  projectRoot?: string,
): Promise<ResolveAudioPlanResult> {
  const projectId = requiredText(opts.projectId, 'projectId');
  const rawItems = Array.isArray(opts.items) ? opts.items : [];
  if (!rawItems.length) throw new Error('items must contain at least one audio intent');
  if (rawItems.length > 50) throw new Error('items cannot contain more than 50 audio intents');
  const eventIds = rawItems.map((item, index) =>
    requiredText(item.eventId, `items[${index}].eventId`));
  const duplicateEventId = eventIds.find((eventId, index) =>
    eventIds.indexOf(eventId) !== index);
  if (duplicateEventId) {
    throw new Error(`duplicate eventId is not allowed: ${duplicateEventId}`);
  }

  const planId = String(opts.planId ?? '').trim()
    || `audio-plan-${Date.now().toString(36)}`;
  const globalTopK = boundedInteger(opts.topK, 3, 1, 10);

  const items = await Promise.all(rawItems.map(async (item, index): Promise<ResolvedAudioPlanItem> => {
    const eventId = eventIds[index];
    const playerGoal = String(item.playerGoal ?? '').trim();
    const priority = String(item.priority ?? '').trim() || 'normal';
    try {
      requiredText(item.playerGoal, `items[${index}].playerGoal`);
      const cue = requiredText(item.cue, `items[${index}].cue`);
      const topK = boundedInteger(item.topK, globalTopK, 1, 10);
      const variantCount = boundedInteger(item.variantCount, 3, 1, 8);
      const result = await searchAudioV2(cfg, {
        kind: 'sfx',
        cue,
        directoryCategory: item.directoryCategory,
        directorySubcategory: item.directorySubcategory,
        source: item.source,
        targetMaterial: item.targetMaterial,
        intensity: item.intensity,
        exclude: item.exclude,
        projectId,
        topK,
        dryRun: opts.dryRun,
      }, projectRoot, !opts.dryRun);

      if (!result.candidates.length) {
        return emptyItem(
          eventId,
          playerGoal,
          priority,
          'gap',
          '没有找到满足核心事件与硬排除条件的可调用音效族',
        );
      }

      const families = result.candidates.map((candidate) =>
        toResolvedFamily(candidate, variantCount));
      const selectedFamily = families[0];
      return {
        eventId,
        playerGoal,
        priority,
        status: selectedFamily.relaxed.length ? 'fallback' : 'exact',
        familyId: selectedFamily.familyId,
        selectedFamily,
        alternatives: families.slice(1),
        reasons: selectedFamily.reasons,
        relaxed: selectedFamily.relaxed,
        warnings: result.warnings,
      };
    } catch (error) {
      return emptyItem(
        eventId,
        playerGoal,
        priority,
        'error',
        (error as Error).message,
      );
    }
  }));

  return {
    ok: true,
    schemaVersion: 'resolved-audio-plan/1',
    planId,
    projectId,
    slug: String(opts.slug ?? '').trim() || undefined,
    mode: opts.dryRun ? 'index-only' : 'live',
    summary: {
      requested: items.length,
      exact: items.filter((item) => item.status === 'exact').length,
      fallback: items.filter((item) => item.status === 'fallback').length,
      gap: items.filter((item) => item.status === 'gap').length,
      error: items.filter((item) => item.status === 'error').length,
    },
    items,
    warnings: unique(items.flatMap((item) => item.warnings)),
  };
}
