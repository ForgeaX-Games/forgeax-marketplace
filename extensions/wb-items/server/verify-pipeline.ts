/**
 * 独立验证道具图标管线：生图 → 抠底 → 规范化 → 输出质量指标。
 *
 * Usage (在 wb-items 目录):
 *   bun server/verify-pipeline.ts                     # 验证 demo 工程全部 raw
 *   bun server/verify-pipeline.ts --slug demo
 *   bun server/verify-pipeline.ts --raw path/to/x-raw.png
 *   bun server/verify-pipeline.ts --gold                  # 验证金标库 default/assets/icons
 *   bun server/verify-pipeline.ts --compare               # 金标 vs demo 对比摘要
 */
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';

import { buildStylePrompt, DEFAULT_ICON_SIZE, getStylePreset } from '../shared/catalog';
import {
  evaluateIconQuality,
  evaluatePipelineQuality,
  evaluateRawQuality,
  GOLD_BATCH_ID,
  type QualityVerdict,
} from '../shared/pipeline-quality';
import { applyIconCutout } from './icon-cutout';
import { countUniqueColorsAtSize, readIconQualityInputInPlace, readRawQualityInput } from './icon-audit';
import {
  chooseResizeKernel,
  isPixelSource,
  measureIconContent,
  measureIconContentAfterCutout,
  normalizeIconFile,
} from './icon-normalize';
import { generateIconImage, litellmImageConfigured } from './image-gen';
import { projectRoot } from './item-store';

const TARGET = DEFAULT_ICON_SIZE;

interface StageMetrics {
  path: string;
  width: number;
  height: number;
  bytes: number;
  contentWidth: number;
  contentHeight: number;
  fillRatio: number;
  pixelSource: boolean;
  uniqueColors?: number;
}

interface PipelineReport {
  slug: string;
  targetSize: number;
  raw: StageMetrics;
  rawAfterCutout: StageMetrics;
  normalized: StageMetrics & { kernel: string; qaPassed: boolean; uniqueColors: number };
  verdict: {
    generation: QualityVerdict;
    normalize: QualityVerdict;
    qualified: QualityVerdict;
    notes: string[];
  };
  deltas: {
    cutoutFillPct: number;
    normalizeFillPct: number;
    bytesRatio: number;
  };
  artifacts: {
    rawCopy: string;
    rawCutoutPreview: string;
    normalized: string;
    preview96: string;
    preview240: string;
    sheet: string;
  };
}

async function countUniqueColors(path: string, sampleMax = 256): Promise<number> {
  const { data, info } = await sharp(path)
    .resize(sampleMax, sampleMax, { fit: 'inside', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= 16) continue;
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return seen.size;
}

async function stageMetrics(path: string): Promise<StageMetrics> {
  const meta = await sharp(path).metadata();
  const st = await stat(path);
  const m = await measureIconContent(path);
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  return {
    path,
    width,
    height,
    bytes: st.size,
    contentWidth: m.contentWidth,
    contentHeight: m.contentHeight,
    fillRatio: m.fillRatio,
    pixelSource: isPixelSource(width, height, st.size),
    uniqueColors: await countUniqueColors(path),
  };
}

async function writePreviews(normalizedPath: string, outDir: string, base: string): Promise<{ p96: string; p240: string; sheet: string }> {
  const p96 = resolve(outDir, `${base}-48x2.png`);
  const p240 = resolve(outDir, `${base}-48x5.png`);
  const sheet = resolve(outDir, `${base}-sheet.png`);

  await sharp(normalizedPath)
    .resize(TARGET * 2, TARGET * 2, { kernel: sharp.kernel.nearest })
    .png()
    .toFile(p96);
  await sharp(normalizedPath)
    .resize(TARGET * 5, TARGET * 5, { kernel: sharp.kernel.nearest })
    .png()
    .toFile(p240);

  const rawBuf = await sharp(normalizedPath).resize(TARGET, TARGET).png().toBuffer();
  const x2 = await sharp(normalizedPath).resize(TARGET * 2, TARGET * 2, { kernel: sharp.kernel.nearest }).png().toBuffer();
  const x5 = await sharp(normalizedPath).resize(TARGET * 5, TARGET * 5, { kernel: sharp.kernel.nearest }).png().toBuffer();

  await sharp({
    create: {
      width: TARGET + TARGET * 2 + TARGET * 5 + 32,
      height: TARGET * 5 + 24,
      channels: 4,
      background: { r: 32, g: 32, b: 36, alpha: 255 },
    },
  })
    .composite([
      { input: rawBuf, left: 8, top: 8 },
      { input: x2, left: TARGET + 16, top: 8 },
      { input: x5, left: TARGET + TARGET * 2 + 24, top: 8 },
    ])
    .png()
    .toFile(sheet);

  return { p96, p240, sheet };
}

async function writeCutoutPreview(rawPath: string, outPath: string): Promise<void> {
  const { data, info } = await sharp(rawPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(data);
  applyIconCutout(buf, info.width, info.height);
  await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(outPath);
}

async function auditRawToNormalized(rawPath: string, outDir: string, slug: string): Promise<PipelineReport> {
  const base = basename(rawPath).replace(/-raw\.png$/i, '');
  const rawCopy = resolve(outDir, `${base}-raw.png`);
  const cutoutPreview = resolve(outDir, `${base}-cutout-preview.png`);
  const normPath = resolve(outDir, `${base}-normalized-48.png`);

  await copyFile(rawPath, rawCopy);
  await writeCutoutPreview(rawPath, cutoutPreview);

  const rawInput = await readRawQualityInput(rawPath);
  const rawCut = await measureIconContentAfterCutout(rawPath);
  const raw = await stageMetrics(rawPath);
  raw.uniqueColors = rawInput.uniqueColors;
  const rawAfterCutout: StageMetrics = {
    path: cutoutPreview,
    width: rawCut.width,
    height: rawCut.height,
    bytes: raw.bytes,
    contentWidth: rawCut.contentWidth,
    contentHeight: rawCut.contentHeight,
    fillRatio: rawCut.fillRatio,
    pixelSource: raw.pixelSource,
    uniqueColors: rawInput.uniqueColors,
  };

  const cropW = rawCut.contentWidth;
  const cropH = rawCut.contentHeight;
  const maxContent = Math.max(1, Math.floor(TARGET * 0.86));
  const scale = Math.min(maxContent / Math.max(cropW, 1), maxContent / Math.max(cropH, 1));
  const nw = Math.max(1, Math.round(cropW * scale));
  const nh = Math.max(1, Math.round(cropH * scale));
  const kernel = chooseResizeKernel(raw.pixelSource, false, cropW, cropH, nw, nh);

  const normResult = await normalizeIconFile(rawPath, normPath, { targetSize: TARGET, delivery: 'png-pixel' });
  const normalized = await stageMetrics(normPath);
  const outColors = await countUniqueColorsAtSize(normPath, TARGET);
  const previews = await writePreviews(normPath, outDir, base);

    const genEval = evaluateRawQuality({
    width: rawInput.width,
    height: rawInput.height,
    cutoutFillRatio: rawCut.fillRatio,
    sampleColors: rawInput.uniqueColors,
  });
  const normEval = evaluateIconQuality({
    width: TARGET,
    height: TARGET,
    fillRatio: normalized.fillRatio,
    uniqueColors: outColors,
    qaPassed: normResult.qa.passed,
  });
  const qualifiedEval = evaluatePipelineQuality(
    { width: rawInput.width, height: rawInput.height, cutoutFillRatio: rawCut.fillRatio },
    {
      width: TARGET,
      height: TARGET,
      fillRatio: normalized.fillRatio,
      uniqueColors: outColors,
      qaPassed: normResult.qa.passed,
    },
  );

  const genVerdict = genEval.verdict;
  const normVerdict = normEval.verdict;

  return {
    slug,
    targetSize: TARGET,
    raw,
    rawAfterCutout,
    normalized: {
      ...normalized,
      kernel,
      qaPassed: normResult.qa.passed,
      uniqueColors: outColors,
    },
    verdict: {
      generation: genVerdict,
      normalize: normVerdict,
      qualified: qualifiedEval.verdict,
      notes: qualifiedEval.notes,
    },
    deltas: {
      cutoutFillPct: Number((rawCut.fillRatio * 100).toFixed(1)),
      normalizeFillPct: Number((normalized.fillRatio * 100).toFixed(1)),
      bytesRatio: Number((normalized.bytes / Math.max(raw.bytes, 1)).toFixed(4)),
    },
    artifacts: {
      rawCopy,
      rawCutoutPreview: cutoutPreview,
      normalized: normPath,
      preview96: previews.p96,
      preview240: previews.p240,
      sheet: previews.sheet,
    },
  };
}

async function collectRawPaths(slug: string): Promise<string[]> {
  const root = projectRoot();
  const iconsDir = resolve(root, '.forgeax', 'games', slug, 'assets', 'icons');
  const wsBase = resolve(root, 'workspace', 'images', 'items');
  const out: string[] = [];

  if (existsSync(iconsDir)) {
    for (const f of await readdir(iconsDir)) {
      if (!f.endsWith('.png')) continue;
      const itemSlug = f.replace(/\.png$/, '');
      const batches = existsSync(wsBase) ? await readdir(wsBase) : [];
      let best: string | null = null;
      let bestMtime = 0;
      for (const batch of batches) {
        const candidate = resolve(wsBase, batch, `${itemSlug}-raw.png`);
        if (!existsSync(candidate)) continue;
        const st = await stat(candidate);
        if (st.mtimeMs > bestMtime) {
          bestMtime = st.mtimeMs;
          best = candidate;
        }
      }
      if (best) out.push(best);
    }
  }

  if (!out.length && existsSync(wsBase)) {
    for (const batch of await readdir(wsBase)) {
      const batchDir = resolve(wsBase, batch);
      for (const f of await readdir(batchDir)) {
        if (f.endsWith('-raw.png')) out.push(resolve(batchDir, f));
      }
    }
  }

  return [...new Set(out)];
}

function printReport(r: PipelineReport): void {
  console.log(`\n── ${r.slug} ──`);
  console.log(`  RAW      ${r.raw.width}×${r.raw.height}  ${r.raw.bytes}B  colors≈${r.raw.uniqueColors}`);
  console.log(`  CUTOUT   fill=${(r.rawAfterCutout.fillRatio * 100).toFixed(1)}%  (${r.rawAfterCutout.contentWidth}×${r.rawAfterCutout.contentHeight})  [生图 ${r.verdict.generation}]`);
  console.log(`  NORM 48  fill=${(r.normalized.fillRatio * 100).toFixed(1)}%  colors=${r.normalized.uniqueColors}  kernel=${r.normalized.kernel}  [规范 ${r.verdict.normalize}]`);
  console.log(`  合格     [${r.verdict.qualified}]`);
  if (r.verdict.notes.length) console.log(`  NOTES    ${r.verdict.notes.join(' · ')}`);
  console.log(`  sheet    ${r.artifacts.sheet}`);
}

async function auditGoldIcons(outDir: string): Promise<PipelineReport[]> {
  const iconsDir = resolve(projectRoot(), 'default', 'assets', 'icons');
  const batchDir = resolve(projectRoot(), 'workspace', 'images', 'items', GOLD_BATCH_ID);
  const files = (await readdir(iconsDir)).filter((f) => f.endsWith('.png')).sort();
  const reports: PipelineReport[] = [];

  for (const file of files) {
    const slug = file.replace(/\.png$/, '');
    const iconPath = resolve(iconsDir, file);
    const rawPath = resolve(batchDir, `${slug}-raw.png`);
    if (existsSync(rawPath)) {
      reports.push(await auditRawToNormalized(rawPath, outDir, slug));
      continue;
    }

    const iconInput = await readIconQualityInputInPlace(iconPath);
    const iconEval = evaluateIconQuality(iconInput);
    const st = await stat(iconPath);
    const meta = await sharp(iconPath).metadata();
    reports.push({
      slug,
      targetSize: TARGET,
      raw: {
        path: iconPath,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        bytes: st.size,
        contentWidth: 0,
        contentHeight: 0,
        fillRatio: 0,
        pixelSource: false,
      },
      rawAfterCutout: {
        path: iconPath,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        bytes: st.size,
        contentWidth: 0,
        contentHeight: 0,
        fillRatio: 0,
        pixelSource: false,
      },
      normalized: {
        path: iconPath,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        bytes: st.size,
        contentWidth: 0,
        contentHeight: 0,
        fillRatio: iconInput.fillRatio,
        pixelSource: false,
        kernel: 'n/a',
        qaPassed: iconInput.qaPassed,
        uniqueColors: iconInput.uniqueColors,
      },
      verdict: {
        generation: 'pass',
        normalize: iconEval.verdict,
        qualified: iconEval.verdict,
        notes: [...iconEval.notes, '无 raw 存档，仅验证 48px 成品'],
      },
      deltas: {
        cutoutFillPct: 0,
        normalizeFillPct: Number((iconInput.fillRatio * 100).toFixed(1)),
        bytesRatio: 1,
      },
      artifacts: {
        rawCopy: iconPath,
        rawCutoutPreview: iconPath,
        normalized: iconPath,
        preview96: iconPath,
        preview240: iconPath,
        sheet: iconPath,
      },
    });
  }

  return reports;
}

function parseArgs(argv: string[]) {
  let slug = 'demo';
  let rawPath: string | null = null;
  let generate: string | null = null;
  let gold = false;
  let compare = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug' && argv[i + 1]) slug = argv[++i];
    else if (argv[i] === '--raw' && argv[i + 1]) rawPath = resolve(argv[++i]);
    else if (argv[i] === '--generate' && argv[i + 1]) generate = argv[++i];
    else if (argv[i] === '--gold') gold = true;
    else if (argv[i] === '--compare') compare = true;
  }
  return { slug, rawPath, generate, gold, compare };
}

function printSummary(reports: PipelineReport[], label: string): void {
  const genPass = reports.filter((r) => r.verdict.generation === 'pass').length;
  const normPass = reports.filter((r) => r.verdict.normalize === 'pass').length;
  const qualified = reports.filter((r) => r.verdict.qualified !== 'fail').length;
  const avgCutoutFill = reports.reduce((s, r) => s + r.rawAfterCutout.fillRatio, 0) / Math.max(reports.length, 1);
  const avgOutFill = reports.reduce((s, r) => s + r.normalized.fillRatio, 0) / Math.max(reports.length, 1);
  const avgColors = reports.reduce((s, r) => s + (r.normalized.uniqueColors ?? 0), 0) / Math.max(reports.length, 1);
  console.log(`\n=== ${label} ===`);
  console.log(`  items: ${reports.length}`);
  console.log(`  生图 pass: ${genPass}/${reports.length}  (抠底后平均 fill ${(avgCutoutFill * 100).toFixed(1)}%)`);
  console.log(`  规范 pass: ${normPass}/${reports.length}  (48px 平均 fill ${(avgOutFill * 100).toFixed(1)}%)`);
  console.log(`  金标合格: ${qualified}/${reports.length}  (48px 平均色数 ${avgColors.toFixed(0)})`);
}

async function main(): Promise<void> {
  const { slug, rawPath, generate, gold, compare } = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(root, 'workspace', 'images', 'items', `_pipeline-verify-${stamp}`);
  await mkdir(outDir, { recursive: true });

  console.log(`[verify-pipeline] projectRoot=${root}`);
  console.log(`[verify-pipeline] outputDir=${outDir}`);
  console.log(`[verify-pipeline] litellm=${litellmImageConfigured() ? 'yes' : 'no'}`);
  console.log(`[verify-pipeline] goldBar=batch ${GOLD_BATCH_ID} · default/assets/icons`);

  const reports: PipelineReport[] = [];
  let goldReports: PipelineReport[] = [];

  if (generate) {
    if (!litellmImageConfigured()) {
      console.error('[verify-pipeline] --generate 需要 LITELLM_PROXY_BASE_URL + LITELLM_PROXY_KEY');
      process.exit(1);
    }
    const preset = getStylePreset('pixel-48')!;
    const prompt = buildStylePrompt(generate, preset);
    console.log(`[verify-pipeline] generating: ${generate}`);
    const gen = await generateIconImage(prompt);
    if (!gen.ok) {
      console.error(`[verify-pipeline] generate failed: ${gen.error}`);
      process.exit(1);
    }
    const genRaw = resolve(outDir, `${slugify(generate)}-raw.png`);
    await writeFile(genRaw, gen.buffer);
    reports.push(await auditRawToNormalized(genRaw, outDir, slugify(generate)));
  }

  if (gold || compare) {
    goldReports = await auditGoldIcons(outDir);
    if (gold && !compare) {
      for (const r of goldReports) printReport(r);
    }
  }

  const raws = rawPath ? [rawPath] : (gold && !compare) ? [] : await collectRawPaths(slug);
  if (!raws.length && !reports.length && !goldReports.length) {
    console.error('[verify-pipeline] 未找到 *-raw.png，请用 --raw / --gold / --compare');
    process.exit(1);
  }

  for (const raw of raws) {
    const name = basename(raw).replace(/-raw\.png$/i, '');
    reports.push(await auditRawToNormalized(raw, outDir, name));
  }

  const summary = {
    verifiedAt: new Date().toISOString(),
    targetSize: TARGET,
    goldBatch: GOLD_BATCH_ID,
    count: reports.length,
    goldCount: goldReports.length,
    litellm: litellmImageConfigured(),
    goldReports: goldReports.length ? goldReports : undefined,
    reports,
  };
  const reportPath = resolve(outDir, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  if (compare) {
    printSummary(goldReports, `GOLD · default/assets/icons (${goldReports.length})`);
    for (const r of reports) printReport(r);
    printSummary(reports, `TARGET · ${slug} (${reports.length})`);
  } else if (!gold) {
    for (const r of reports) printReport(r);
    printSummary(reports, 'SUMMARY');
  } else {
    printSummary(goldReports, 'GOLD SUMMARY');
  }

  console.log(`  report: ${reportPath}`);
  console.log(`  open folder: ${outDir}`);
}

function slugify(label: string): string {
  const ascii = label.trim().toLowerCase().replace(/\s+/g, '-');
  return ascii || 'item-test';
}

main().catch((e) => {
  console.error('[verify-pipeline] fatal:', (e as Error).message);
  process.exit(1);
});
