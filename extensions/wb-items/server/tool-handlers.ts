import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildItemFromSlug,
  buildStylePrompt,
  DEFAULT_ICON_SIZE,
  getStylePreset,
  ICON_NORMALIZE_REV,
  slugifyFileName,
  STYLE_PRESETS,
  toAsciiSlug,
} from '../shared/catalog';
import type {
  GenerateIconsResult,
  GenerateStylePlanResult,
  ItemsDocument,
  ListItemsResult,
  NormalizeBatchResult,
  ItemRecord,
  ProposedItem,
  RunPipelineResult,
  SummarizeRequirementsResult,
} from '../shared/types';
import { ensureIconNormalizedInPlace, normalizeIconFile } from './icon-normalize';
import { validateRawIconBuffer } from './icon-audit';
import { generateIconImage, litellmImageConfigured, saveRawIcon } from './image-gen';
import { summarizeRequirementsText } from './requirements-parser';
import {
  ensureGameDirs,
  gameRoot,
  iconsDir,
  listIconFiles,
  deleteItem,
  mergeItemsFromIcons,
  projectRoot,
  readItemsDocument,
  removeDuplicateNames,
  upsertItem,
  workspaceBatchDir,
  writeItemsDocument,
} from './item-store';

function itemSlugFromPng(name: string): string {
  return slugifyFileName(name).replace(/-raw$/, '');
}

function requireSlug(slug: string | undefined): string {
  const s = slug?.trim();
  if (!s) throw Object.assign(new Error('no active game (slug is required)'), { code: 'missing_game' });
  return s;
}

async function listItems(args: { slug?: string }): Promise<ListItemsResult> {
  const slug = requireSlug(args.slug);
  await ensureGameDirs(slug);
  const document = await readItemsDocument(slug);
  const normalizeRev = document.meta?.iconNormalizeRev ?? 0;
  const delivery = getStylePreset(document.meta?.iconStyle ?? 'pixel-48')?.delivery ?? 'png-pixel';
  const iconPaths = await listIconFiles(slug);
  let normalizedAny = false;
  for (const rel of iconPaths) {
    const file = rel.split('/').pop() ?? rel;
    const itemSlug = itemSlugFromPng(file);
    const changed = await ensureIconNormalizedInPlace(resolve(iconsDir(slug), file), document.meta?.iconSize ?? DEFAULT_ICON_SIZE, {
      itemSlug,
      normalizeRev,
      delivery,
    });
    if (changed) normalizedAny = true;
  }
  const merged = mergeItemsFromIcons(document, iconPaths);
  const needsRevBump = normalizeRev < ICON_NORMALIZE_REV || normalizedAny;
  if (needsRevBump) {
    merged.meta = { ...merged.meta, iconNormalizeRev: ICON_NORMALIZE_REV, updatedAt: Date.now() };
  }
  if (merged.items.length !== document.items.length || needsRevBump) {
    await writeItemsDocument(slug, merged);
  }
  const icons = await Promise.all(merged.items.map(async (item) => {
    const iconRel = item.icon.replace(/^\.?\//, '');
    const iconPath = resolve(gameRoot(slug), iconRel);
    let cacheV = merged.meta?.updatedAt ?? Date.now();
    try {
      cacheV = (await stat(iconPath)).mtimeMs;
    } catch {
      /* icon may not exist yet */
    }
    return {
      slug: item.slug,
      path: item.icon,
      previewUrl: `/api/game-assets/${encodeURIComponent(slug)}/${iconRel}?v=${cacheV}`,
    };
  }));
  return {
    ok: true,
    slug,
    gameRoot: gameRoot(slug),
    document: merged,
    icons,
  };
}

async function saveDocument(args: { slug?: string; document: ItemsDocument }): Promise<{ ok: true; document: ItemsDocument }> {
  const slug = requireSlug(args.slug);
  if (!args.document || !Array.isArray(args.document.items)) {
    throw Object.assign(new Error('document.items is required'), { code: 'invalid_document' });
  }
  await writeItemsDocument(slug, args.document);
  return { ok: true, document: args.document };
}

async function upsertItemTool(args: { slug?: string; item: ItemRecord }): Promise<{ ok: true; document: ItemsDocument }> {
  const slug = requireSlug(args.slug);
  if (!args.item?.slug) throw Object.assign(new Error('item.slug is required'), { code: 'invalid_item' });
  const document = await upsertItem(slug, args.item);
  return { ok: true, document };
}

async function deleteItemTool(args: {
  slug?: string;
  itemSlug: string;
  deleteIcon?: boolean;
}): Promise<{ ok: true; document: ItemsDocument; deletedSlug: string }> {
  const slug = requireSlug(args.slug);
  const itemSlug = args.itemSlug?.trim();
  if (!itemSlug) throw Object.assign(new Error('itemSlug is required'), { code: 'invalid_item_slug' });
  const document = await deleteItem(slug, itemSlug, { deleteIcon: args.deleteIcon });
  return { ok: true, document, deletedSlug: itemSlug };
}

interface NormalizeSourcesArgs {
  slug?: string;
  sourceDir?: string;
  targetSize?: number;
  batchId?: string;
}

async function normalizeSources(args: NormalizeSourcesArgs): Promise<NormalizeBatchResult> {
  const slug = requireSlug(args.slug);
  const targetSize = args.targetSize ?? DEFAULT_ICON_SIZE;
  const batchId = args.batchId ?? `pixel-${targetSize}-${Date.now()}`;
  const sourceDir = args.sourceDir?.trim()
    ? (existsSync(args.sourceDir.trim())
      ? resolve(args.sourceDir.trim())
      : resolve(projectRoot(), args.sourceDir.trim()))
    : args.batchId
      ? workspaceBatchDir(batchId)
      : gameRoot(slug);

  if (!existsSync(sourceDir)) {
    throw Object.assign(new Error(`sourceDir not found: ${sourceDir}`), { code: 'source_not_found' });
  }

  await ensureGameDirs(slug);
  const batchDir = workspaceBatchDir(batchId);
  await mkdir(batchDir, { recursive: true });
  await mkdir(iconsDir(slug), { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const isBatchWorkspace = sourceDir.replace(/\\/g, '/').includes('/workspace/images/items/');
  const pngs = entries.filter((e) => {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.png')) return false;
    if (e.name === 'icon-preview.png') return false;
    if (isBatchWorkspace) return e.name.toLowerCase().endsWith('-raw.png');
    return true;
  });
  const normalized = [];
  const failed: Array<{ slug: string; error: string }> = [];

  let doc = await readItemsDocument(slug);

  for (const entry of pngs) {
    if (entry.name === 'icon-preview.png' || entry.name === 'manifest.json') continue;
    const itemSlug = itemSlugFromPng(entry.name);
    const srcPath = resolve(sourceDir, entry.name);
    // skip already normalized outputs sitting in assets/icons
    if (sourceDir === iconsDir(slug)) continue;

    try {
      const rawCopy = resolve(batchDir, `${itemSlug}-raw.png`);
      const batchOut = resolve(batchDir, `${itemSlug}.png`);
      const finalOut = resolve(iconsDir(slug), `${itemSlug}.png`);
      if (srcPath !== rawCopy) await copyFile(srcPath, rawCopy);

      const rawBuf = await readFile(srcPath);
      const rawQa = await validateRawIconBuffer(rawBuf, { strict: true });
      if (!rawQa.ok) {
        failed.push({
          slug: itemSlug,
          error: `HD 生图未达金标，请重新生成（不做后处理修复）：${rawQa.error}`,
        });
        continue;
      }

      const result = await normalizeIconFile(srcPath, batchOut, { targetSize, delivery: 'png-pixel' });
      await copyFile(batchOut, finalOut);
      result.slug = itemSlug;
      result.outputPath = `assets/icons/${itemSlug}.png`;
      normalized.push(result);
      const draft = buildItemFromSlug(itemSlug, result.outputPath);
      const prev = doc.items.find((i) => i.slug === itemSlug);
      doc = await upsertItem(slug, {
        ...draft,
        name: prev?.name ?? draft.name,
        depicts: prev?.depicts ?? draft.depicts,
      });
    } catch (e) {
      failed.push({ slug: itemSlug, error: (e as Error).message });
    }
  }

  doc.meta = {
    ...doc.meta,
    iconStyle: 'pixel-48',
    iconSize: targetSize,
    iconNormalizeRev: ICON_NORMALIZE_REV,
    updatedAt: Date.now(),
  };
  await writeItemsDocument(slug, doc);

  const manifest = {
    batchId,
    style: `pixel-${targetSize}`,
    delivery: 'png-pixel',
    targetSize,
    generatedAt: new Date().toISOString(),
    items: normalized,
    failed,
    qa: {
      passed: normalized.filter((n) => n.qa.passed).length,
      warnings: normalized.filter((n) => !n.qa.passed).length,
      total: pngs.length,
    },
  };
  await writeFile(resolve(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    ok: true,
    batchId,
    targetSize,
    normalized,
    failed,
    itemsDocument: doc,
  };
}

interface GenerateStylePlanArgs {
  slug?: string;
  style?: string;
  slugs?: string[];
  proposedItems?: ProposedItem[];
  batchId?: string;
}

async function buildPlanFromItems(
  slug: string,
  preset: NonNullable<ReturnType<typeof getStylePreset>>,
  items: Array<{ slug: string; depicts: string; prompt?: string; name?: { zh: string; en: string } }>,
  batchId?: string,
): Promise<GenerateStylePlanResult> {
  const id = batchId ?? `${preset.id}-${Date.now()}`;
  const batchDir = workspaceBatchDir(id);
  await mkdir(batchDir, { recursive: true });

  const plan = items.map((item) => {
    const depicts = item.depicts;
    const outputPath = `workspace/images/items/${id}/${item.slug}-raw.png`;
    return {
      slug: item.slug,
      depicts,
      style: preset.id,
      outputPath,
      prompt: item.prompt ?? buildStylePrompt(depicts, preset),
    };
  });

  await writeFile(resolve(batchDir, 'plan.json'), `${JSON.stringify({ batchId: id, plan }, null, 2)}\n`, 'utf-8');

  return {
    ok: true,
    style: preset.id,
    batchId: id,
    plan,
    note: litellmImageConfigured()
      ? '已准备好生成计划，可继续生成图标。'
      : '描述已整理好，可继续生成图标。',
  };
}

async function generateStylePlan(args: GenerateStylePlanArgs): Promise<GenerateStylePlanResult> {
  const slug = requireSlug(args.slug);
  const styleId = args.style ?? 'pixel-48';
  const preset = getStylePreset(styleId);
  if (!preset) {
    throw Object.assign(new Error(`unknown style: ${styleId}`), { code: 'unknown_style' });
  }

  if (args.proposedItems?.length) {
    for (const p of args.proposedItems) {
      const iconPath = `assets/icons/${p.slug}.png`;
      await upsertItem(slug, {
        ...buildItemFromSlug(p.slug, iconPath),
        name: p.name,
        depicts: p.depicts,
      });
    }
    return buildPlanFromItems(slug, preset, args.proposedItems, args.batchId);
  }

  const { document } = await listItems({ slug });
  const selected = args.slugs?.length
    ? document.items.filter((i) => args.slugs!.includes(i.slug))
    : document.items;

  return buildPlanFromItems(
    slug,
    preset,
    selected.map((item) => ({
      slug: item.slug,
      depicts: item.depicts || item.name.en || item.slug,
      name: item.name,
    })),
    args.batchId,
  );
}

interface SummarizeRequirementsArgs {
  slug?: string;
  requirements: string;
  style?: string;
}

async function summarizeRequirements(args: SummarizeRequirementsArgs): Promise<SummarizeRequirementsResult> {
  requireSlug(args.slug);
  const styleId = args.style ?? 'pixel-48';
  const preset = getStylePreset(styleId);
  if (!preset) {
    throw Object.assign(new Error(`unknown style: ${styleId}`), { code: 'unknown_style' });
  }
  const { items, source } = await summarizeRequirementsText(args.requirements, preset);
  return { ok: true, source, style: preset.id, items };
}

interface GenerateIconsArgs {
  slug?: string;
  batchId: string;
  items: ProposedItem[];
}

async function generateIcons(args: GenerateIconsArgs): Promise<GenerateIconsResult> {
  const slug = requireSlug(args.slug);
  const batchDir = workspaceBatchDir(args.batchId);
  await mkdir(batchDir, { recursive: true });

  const generated: Array<{ slug: string; path: string }> = [];
  const failed: Array<{ slug: string; error: string }> = [];
  const canGenerate = litellmImageConfigured();

  for (const item of args.items) {
    if (!canGenerate) {
      failed.push({ slug: item.slug, error: '生图服务暂不可用' });
      continue;
    }
    const result = await generateIconImage(item.prompt);
    if (!result.ok) {
      failed.push({ slug: item.slug, error: result.error });
      continue;
    }
    await saveRawIcon(batchDir, item.slug, result.buffer);
    const rel = `workspace/images/items/${args.batchId}/${item.slug}-raw.png`;
    generated.push({ slug: item.slug, path: rel });
    await upsertItem(slug, {
      ...buildItemFromSlug(item.slug, `assets/icons/${item.slug}.png`),
      name: item.name,
      depicts: item.depicts,
    });
  }

  return {
    ok: true,
    batchId: args.batchId,
    generated,
    failed,
    imageBackend: generated.length > 0 ? 'litellm' : 'plan-only',
  };
}

interface RunPipelineArgs {
  slug?: string;
  requirements: string;
  style?: string;
  targetSize?: number;
  skipImageGen?: boolean;
  skipNormalize?: boolean;
}

function sanitizeProposedItems(items: ProposedItem[]): ProposedItem[] {
  const seen = new Set<string>();
  return items.map((item, index) => {
    const label = item.name?.zh ?? item.depicts ?? item.slug;
    let slug = /^[a-z0-9][a-z0-9-]*$/.test(item.slug) ? item.slug : toAsciiSlug(label, index);
    let n = 2;
    while (seen.has(slug)) {
      slug = `${toAsciiSlug(label, index)}-${n}`;
      n += 1;
    }
    seen.add(slug);
    return { ...item, slug };
  });
}

async function runPipeline(args: RunPipelineArgs): Promise<RunPipelineResult> {
  const slug = requireSlug(args.slug);
  const targetSize = args.targetSize ?? DEFAULT_ICON_SIZE;
  const styleId = args.style ?? 'pixel-48';

  const summarizeRaw = await summarizeRequirements({ slug, requirements: args.requirements, style: styleId });
  const summarize = { ...summarizeRaw, items: sanitizeProposedItems(summarizeRaw.items) };
  await removeDuplicateNames(
    slug,
    new Set(summarize.items.map((i) => i.slug)),
    new Set(summarize.items.map((i) => i.name.zh.trim())),
  );
  const batchId = `${summarize.style}-${Date.now()}`;
  const plan = await generateStylePlan({
    slug,
    style: styleId,
    proposedItems: summarize.items,
    batchId,
  });

  let icons: GenerateIconsResult | undefined;
  if (!args.skipImageGen) {
    icons = await generateIcons({ slug, batchId, items: summarize.items });
  }

  let normalize: NormalizeBatchResult | undefined;
  if (!args.skipNormalize) {
    const batchDir = workspaceBatchDir(batchId);
    const hasRaw = existsSync(batchDir)
      && (await readdir(batchDir)).some((f) => f.endsWith('-raw.png') || (f.endsWith('.png') && f !== 'manifest.json'));
    if (hasRaw) {
      normalize = await normalizeSources({ slug, sourceDir: batchDir, targetSize, batchId });
    }
  }

  const parts: string[] = [`整理了 ${summarize.items.length} 个道具`];
  if (icons?.generated.length) parts.push(`生成了 ${icons.generated.length} 张图`);
  if (normalize?.normalized.length) parts.push(`保存了 ${normalize.normalized.length} 个图标`);

  return {
    ok: true,
    batchId,
    targetSize,
    summarize,
    plan,
    icons,
    normalize,
    note: parts.join(' · '),
  };
}

async function listStyles(): Promise<{ ok: true; styles: typeof STYLE_PRESETS }> {
  return { ok: true, styles: STYLE_PRESETS };
}

export const tools = {
  'items:list': async (args: { slug?: string } = {}) => listItems(args),
  'items:save-document': async (args: { slug?: string; document: ItemsDocument }) => saveDocument(args),
  'items:upsert-item': async (args: { slug?: string; item: ItemRecord }) => upsertItemTool(args),
  'items:delete-item': async (args: { slug?: string; itemSlug: string; deleteIcon?: boolean }) => deleteItemTool(args),
  'items:normalize-sources': async (args: NormalizeSourcesArgs = {}) => normalizeSources(args),
  'items:generate-style-plan': async (args: GenerateStylePlanArgs = {}) => generateStylePlan(args),
  'items:summarize-requirements': async (args: SummarizeRequirementsArgs) => summarizeRequirements(args),
  'items:generate-icons': async (args: GenerateIconsArgs) => generateIcons(args),
  'items:run-pipeline': async (args: RunPipelineArgs) => runPipeline(args),
  'items:list-styles': async () => listStyles(),
};

export default tools;
