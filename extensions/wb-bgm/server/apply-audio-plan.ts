import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  attachAudio,
  BgmError,
  gameRoot,
  readManifest,
  writeJsonAtomic,
  type BgmConfig,
} from './core.ts';
import { localAudioLibrary } from './local-audio-library.ts';
import { resolveCustomAudio } from './custom-audio-library.ts';

interface ApplyVariant {
  assetId?: string;
  name?: string;
  version?: string;
  resUrl?: string;
  filename?: string;
}

interface ApplySelectedFamily {
  familyId?: string;
  variants?: ApplyVariant[];
}

export interface ApplyAudioPlanItem {
  eventId?: string;
  status?: string;
  familyId?: string;
  variants?: ApplyVariant[];
  selectedFamily?: ApplySelectedFamily;
}

export interface ApplyAudioPlanOptions {
  slug?: string;
  planId?: string;
  items?: ApplyAudioPlanItem[];
}

interface AppliedAsset {
  assetId: string;
  name: string;
  version: string;
  file: string;
  reused: boolean;
}

export interface AppliedAudioPlanItem {
  eventId: string;
  familyId: string;
  status: 'applied' | 'reused' | 'partial' | 'failed';
  assets: AppliedAsset[];
  errors: string[];
  cueWritten: boolean;
}

export interface ApplyAudioPlanResult {
  ok: true;
  schemaVersion: 'applied-audio-plan/1';
  planId: string;
  slug: string;
  summary: {
    requested: number;
    applied: number;
    reused: number;
    partial: number;
    failed: number;
  };
  items: AppliedAudioPlanItem[];
  pendingBindings: string[];
  manifest: string;
  cueMap: string;
}

interface CueBindingAsset {
  assetId: string;
  name: string;
  version: string;
  file: string;
}

interface CueBinding {
  familyId: string;
  strategy: 'random-no-repeat';
  assets: CueBindingAsset[];
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BgmError('bad-audio-plan', `${field} is required`, 400);
  return normalized;
}

function variantsOf(item: ApplyAudioPlanItem): ApplyVariant[] {
  if (Array.isArray(item.variants)) return item.variants;
  if (Array.isArray(item.selectedFamily?.variants)) return item.selectedFamily.variants;
  return [];
}

function familyIdOf(item: ApplyAudioPlanItem): string {
  return String(item.familyId ?? item.selectedFamily?.familyId ?? '').trim();
}

async function readCueDocument(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) {
    return {
      schemaVersion: 'audio-cue-map/1',
      kind: 'audio-cue-map',
      assetBindings: {},
    };
  }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('cue map root must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new BgmError(
      'cue-map-invalid',
      `audio cue map is invalid: ${(error as Error).message}`,
      409,
    );
  }
}

function existingBindings(document: Record<string, unknown>): Record<string, CueBinding> {
  const value = document.assetBindings;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, CueBinding>;
}

function concurrencyLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) {
      active += 1;
    } else {
      await new Promise<void>((ready) => waiting.push(ready));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export async function applyAudioPlan(
  cfg: BgmConfig,
  opts: ApplyAudioPlanOptions,
  projectRoot: string,
  addedBy: 'human' | 'ai' = 'ai',
): Promise<ApplyAudioPlanResult> {
  const slug = requiredText(opts.slug, 'slug');
  const planId = requiredText(opts.planId, 'planId');
  const rawItems = Array.isArray(opts.items) ? opts.items : [];
  if (!rawItems.length) {
    throw new BgmError('bad-audio-plan', 'items must contain at least one resolved event', 400);
  }
  if (rawItems.length > 50) {
    throw new BgmError('bad-audio-plan', 'items cannot contain more than 50 events', 400);
  }
  const eventIds = rawItems.map((item, index) =>
    requiredText(item.eventId, `items[${index}].eventId`));
  const duplicateEventId = eventIds.find((eventId, index) =>
    eventIds.indexOf(eventId) !== index);
  if (duplicateEventId) {
    throw new BgmError(
      'bad-audio-plan',
      `duplicate eventId is not allowed: ${duplicateEventId}`,
      400,
    );
  }

  const root = gameRoot(projectRoot, slug);
  if (!existsSync(root)) {
    throw new BgmError('unknown-slug', `game not found: ${slug}`, 400);
  }

  // Preflight both documents before downloading anything. A broken existing
  // manifest/cue file is never silently replaced.
  const manifest = await readManifest(projectRoot, slug);
  const cuePath = resolve(root, 'audio', 'cues.json');
  const cueDocument = await readCueDocument(cuePath);
  const bindings = existingBindings(cueDocument);
  const limitDownload = concurrencyLimiter(6);
  const attachmentsByAsset = new Map<string, Promise<AppliedAsset>>();

  const attachVariant = (
    eventId: string,
    variant: ApplyVariant,
    variantIndex: number,
  ): Promise<AppliedAsset> => {
    const assetId = String(variant.assetId ?? '').trim();
    const name = String(variant.name ?? '').trim() || `${eventId}.${variantIndex + 1}`;
    const version = String(variant.version ?? '').trim();
    const existing = manifest.tracks.find((track) => track.assetId === assetId);
    if (existing && existsSync(resolve(root, existing.file))) {
      return Promise.resolve({
        assetId,
        name: existing.name,
        version: existing.version,
        file: existing.file,
        reused: true,
      });
    }

    const inFlight = attachmentsByAsset.get(assetId);
    if (inFlight) return inFlight;
    const attachment = limitDownload(async () => {
      const resolved = await localAudioLibrary.resolveAsset(assetId)
        ?? await resolveCustomAudio(projectRoot, assetId);
      if (!resolved) {
        throw new BgmError(
          'asset-not-found',
          `assetId '${assetId}' is not present in the packaged or registered custom audio library`,
          404,
        );
      }
      if (resolved.kind !== 'sfx') {
        throw new BgmError(
          'invalid-kind',
          `audio-plan asset '${assetId}' is '${resolved.kind}', not 'sfx'`,
          400,
        );
      }
      const attached = await attachAudio({
        projectRoot,
        slug,
        assetId,
        kind: 'sfx',
        version: resolved.version,
        resUrl: resolved.previewUrl,
        sourcePath: resolved.absolutePath,
        name,
        filename: variant.filename ?? resolved.fileName,
        depot: assetId.startsWith('custom:') ? 'custom' : cfg.depot,
        addedBy,
      });
      return {
        assetId,
        name,
        version: resolved.version,
        file: attached.file,
        reused: attached.reused,
      };
    });
    attachmentsByAsset.set(assetId, attachment);
    return attachment;
  };

  const results = await Promise.all(rawItems.map(async (
    item,
    index,
  ): Promise<AppliedAudioPlanItem> => {
    const eventId = eventIds[index];
    const familyId = familyIdOf(item);
    const errors: string[] = [];

    if (item.status === 'gap' || item.status === 'error') {
      return {
        eventId,
        familyId,
        status: 'failed',
        assets: [],
        errors: [`resolved item status is '${item.status}'`],
        cueWritten: false,
      };
    }
    if (!familyId) errors.push('familyId is required');

    const variants = variantsOf(item);
    const seenAssets = new Set<string>();
    const callable = variants.filter((variant) => {
      const assetId = String(variant.assetId ?? '').trim();
      const valid = assetId && String(variant.resUrl ?? '').trim();
      if (!valid || seenAssets.has(assetId)) return false;
      seenAssets.add(assetId);
      return true;
    });
    if (!callable.length) errors.push('no live variants with assetId and resUrl');
    if (callable.length < variants.length) {
      errors.push('one or more variants were invalid or duplicated');
    }

    const settled = await Promise.all(callable.map(async (variant, variantIndex) => {
      try {
        return await attachVariant(eventId, variant, variantIndex);
      } catch (error) {
        const assetId = String(variant.assetId ?? '').trim();
        const name = String(variant.name ?? '').trim() || `${eventId}.${variantIndex + 1}`;
        errors.push(`${assetId || name}: ${(error as Error).message}`);
        return undefined;
      }
    }));
    const assets = settled.filter((asset): asset is AppliedAsset => Boolean(asset));

    const cueWritten = assets.length > 0 && Boolean(familyId);
    if (cueWritten) {
      bindings[eventId] = {
        familyId,
        strategy: 'random-no-repeat',
        assets: assets.map(({ assetId, name, version, file }) => ({
          assetId,
          name,
          version,
          file,
        })),
      };
    }

    const allReused = assets.length > 0 && assets.every((asset) => asset.reused);
    const status: AppliedAudioPlanItem['status'] =
      !assets.length ? 'failed'
        : errors.length ? 'partial'
          : allReused ? 'reused'
            : 'applied';
    return { eventId, familyId, status, assets, errors, cueWritten };
  }));

  await writeJsonAtomic(cuePath, {
    ...cueDocument,
    planId,
    updatedAt: new Date().toISOString(),
    assetBindings: bindings,
  });

  const pendingBindings = results
    .filter((item) => item.cueWritten)
    .map((item) => item.eventId);

  return {
    ok: true,
    schemaVersion: 'applied-audio-plan/1',
    planId,
    slug,
    summary: {
      requested: results.length,
      applied: results.filter((item) => item.status === 'applied').length,
      reused: results.filter((item) => item.status === 'reused').length,
      partial: results.filter((item) => item.status === 'partial').length,
      failed: results.filter((item) => item.status === 'failed').length,
    },
    items: results,
    pendingBindings,
    manifest: `.forgeax/games/${slug}/audio/manifest.json`,
    cueMap: `.forgeax/games/${slug}/audio/cues.json`,
  };
}
