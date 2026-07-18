import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { IconDelivery, NormalizeIconResult } from '../shared/types';
import { ICON_NORMALIZE_REV } from '../shared/catalog';
import { applyIconCutout } from './icon-cutout';
import { inspectCanvas } from './icon-inspect';
import { projectRoot } from './item-store';

export { inspectCanvas } from './icon-inspect';

const ALPHA_THRESHOLD = 16;
/** 统一视觉占比 — 与 default/scripts/normalize-icons-48.py 金标批处理一致 */
const ICON_CONTENT_FILL_PIXEL = 0.88;
const ICON_CONTENT_FILL_PAINTED = 0.82;
/** 低于此文件体积的 48px 图标多为 nearest 压坏，需从 raw 重跑 */
const LOW_QUALITY_ICON_BYTES = 1800;
/** 低于此面积占比视为未规范化，list 时会自动重跑 normalize */
const MIN_ACCEPTABLE_FILL_RATIO = 0.45;

interface RawStats {
  width: number;
  height: number;
  data: Buffer;
}

async function loadRgba(path: string): Promise<RawStats> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

function bbox(data: Buffer, width: number, height: number): { left: number; top: number; right: number; bottom: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

export function isPixelSource(width: number, height: number, fileSize: number): boolean {
  // 与金标 normalize-icons-48.py 一致：≤64px 且小文件视为原生像素源
  return Math.max(width, height) <= 64 && fileSize < 80_000;
}

export interface NormalizeIconOptions {
  targetSize?: number;
  delivery?: IconDelivery;
}

/** 大图缩小用 lanczos；原生小像素源或整数放大用 nearest */
export function chooseResizeKernel(
  pixel: boolean,
  _pixelDelivery: boolean,
  cropW: number,
  cropH: number,
  dstW: number,
  dstH: number,
): 'nearest' | 'lanczos3' {
  const srcMax = Math.max(cropW, cropH);
  const dstMax = Math.max(dstW, dstH);
  const upscaling = dstW > cropW || dstH > cropH;
  const heavyDownscale = srcMax > dstMax * 3;
  if (pixel && upscaling) return 'nearest';
  if (pixel && srcMax <= 64) return 'nearest';
  if (heavyDownscale) return 'lanczos3';
  return 'lanczos3';
}

function midMaxFor(srcMax: number, dstMax: number): number {
  return Math.max(dstMax * 2, Math.round(srcMax * 0.35));
}

export async function normalizeIconFile(
  inputPath: string,
  outputPath: string,
  targetSizeOrOpts: number | NormalizeIconOptions = 48,
  maybeOpts?: NormalizeIconOptions,
): Promise<NormalizeIconResult> {
  const opts: NormalizeIconOptions = typeof targetSizeOrOpts === 'number'
    ? { targetSize: targetSizeOrOpts, ...maybeOpts }
    : targetSizeOrOpts;
  const targetSize = opts.targetSize ?? 48;

  const meta = await sharp(inputPath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const fileStat = await stat(inputPath);
  const pixelNative = isPixelSource(width, height, fileStat.size);
  const pixel = pixelNative;

  const raw = await loadRgba(inputPath);
  applyIconCutout(raw.data, raw.width, raw.height);
  const box = bbox(raw.data, raw.width, raw.height);
  if (!box) {
    await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(outputPath);
    const qa = inspectCanvas(Buffer.alloc(targetSize * targetSize * 4), targetSize, targetSize, pixel);
    return {
      slug: '',
      source: inputPath,
      outputPath,
      sourceSize: [width, height],
      pixelSource: pixel,
      qa,
    };
  }

  const cropW = box.right - box.left;
  const cropH = box.bottom - box.top;
  if (!Number.isFinite(cropW) || !Number.isFinite(cropH) || cropW < 1 || cropH < 1) {
    throw new Error(`invalid crop bbox: ${cropW}x${cropH}`);
  }
  const fill = pixelNative ? ICON_CONTENT_FILL_PIXEL : ICON_CONTENT_FILL_PAINTED;
  const maxContent = Math.max(1, Math.floor(targetSize * fill));
  const scale = Math.min(maxContent / cropW, maxContent / cropH);
  const nw = Math.max(1, Math.round(cropW * scale));
  const nh = Math.max(1, Math.round(cropH * scale));
  const ox = Math.floor((targetSize - nw) / 2);
  const oy = Math.floor((targetSize - nh) / 2);

  const kernel = chooseResizeKernel(pixel, false, cropW, cropH, nw, nh);
  const cutoutBuf = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  }).png().toBuffer();

  const srcMax = Math.max(cropW, cropH);
  const dstMax = Math.max(nw, nh);

  const extracted = sharp(cutoutBuf).extract({ left: box.left, top: box.top, width: cropW, height: cropH });
  let resized: sharp.Sharp;
  if (kernel === 'lanczos3' && srcMax > dstMax * 4) {
    resized = extracted
      .resize(midMaxFor(srcMax, dstMax), midMaxFor(srcMax, dstMax), { fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .resize(nw, nh, { kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.65, m1: 0.5, m2: 0.25 });
  } else {
    resized = extracted.resize(nw, nh, { kernel: sharp.kernel[kernel] });
    if (kernel === 'lanczos3' && srcMax > dstMax * 2) {
      resized = resized.sharpen({ sigma: 0.5, m1: 0.4, m2: 0.2 });
    }
  }

  const cropped = await resized
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  applyIconCutout(cropped.data, cropped.info.width, cropped.info.height);
  const croppedPng = await sharp(cropped.data, {
    raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 },
  }).png().toBuffer();

  await sharp({
    create: {
      width: targetSize,
      height: targetSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: croppedPng, left: ox, top: oy }])
    .png()
    .toFile(outputPath);

  const outRaw = await loadRgba(outputPath);
  applyIconCutout(outRaw.data, outRaw.width, outRaw.height);
  await sharp(outRaw.data, {
    raw: { width: outRaw.width, height: outRaw.height, channels: 4 },
  }).png().toFile(outputPath);
  const qa = inspectCanvas(outRaw.data, outRaw.width, outRaw.height, pixel);

  return {
    slug: '',
    source: inputPath,
    outputPath,
    sourceSize: [width, height],
    pixelSource: pixel,
    qa,
  };
}

export interface IconContentMetrics {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  fillRatio: number;
  whitePixels: number;
}

export async function measureIconContent(iconPath: string): Promise<IconContentMetrics> {
  const raw = await loadRgba(iconPath);
  return measureContentFromRgba(raw.data, raw.width, raw.height, countWhitePixels(raw.data));
}

/** 抠底后的真实主体占比 — 用于评估生图阶段主体是否过小 */
export async function measureIconContentAfterCutout(iconPath: string): Promise<IconContentMetrics> {
  const raw = await loadRgba(iconPath);
  applyIconCutout(raw.data, raw.width, raw.height);
  return measureContentFromRgba(raw.data, raw.width, raw.height, 0);
}

function countWhitePixels(data: Buffer): number {
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a > ALPHA_THRESHOLD && r > 235 && g > 235 && b > 235) whitePixels++;
  }
  return whitePixels;
}

function measureContentFromRgba(
  data: Buffer,
  width: number,
  height: number,
  whitePixels: number,
): IconContentMetrics {
  const box = bbox(data, width, height);
  if (!box) {
    return {
      width,
      height,
      contentWidth: 0,
      contentHeight: 0,
      fillRatio: 0,
      whitePixels,
    };
  }
  const contentWidth = box.right - box.left;
  const contentHeight = box.bottom - box.top;
  return {
    width,
    height,
    contentWidth,
    contentHeight,
    fillRatio: (contentWidth * contentHeight) / (width * height),
    whitePixels,
  };
}

export function iconNeedsRenormalize(
  metrics: IconContentMetrics,
  targetSize = 48,
  fileBytes = 0,
): boolean {
  return metrics.width !== targetSize
    || metrics.height !== targetSize
    || metrics.fillRatio < MIN_ACCEPTABLE_FILL_RATIO
    || metrics.whitePixels >= 8
    || (metrics.width === targetSize && metrics.height === targetSize && fileBytes > 0 && fileBytes < LOW_QUALITY_ICON_BYTES);
}

export async function findLatestRawIcon(itemSlug: string): Promise<string | null> {
  const base = resolve(projectRoot(), 'workspace', 'images', 'items');
  if (!existsSync(base)) return null;
  let best: { path: string; mtimeMs: number } | null = null;
  for (const batch of await readdir(base)) {
    const candidate = resolve(base, batch, `${itemSlug}-raw.png`);
    if (!existsSync(candidate)) continue;
    const st = await stat(candidate);
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: candidate, mtimeMs: st.mtimeMs };
  }
  return best?.path ?? null;
}

async function writeNormalizedIcon(
  sourcePath: string,
  iconPath: string,
  targetSize: number,
  delivery?: IconDelivery,
): Promise<void> {
  const tmp = `${iconPath}.renorm.tmp.png`;
  try {
    await normalizeIconFile(sourcePath, tmp, { targetSize, delivery });
    await rename(tmp, iconPath);
  } catch {
    await unlink(tmp).catch(() => undefined);
    throw new Error(`normalize failed: ${sourcePath}`);
  }
}

/** 裁剪、统一缩放占比、抠底，修复旧图白底与主体过小/发糊问题。 */
export async function renormalizeIconInPlace(
  iconPath: string,
  targetSize = 48,
  delivery?: IconDelivery,
): Promise<boolean> {
  try {
    await writeNormalizedIcon(iconPath, iconPath, targetSize, delivery);
    return true;
  } catch {
    return false;
  }
}

export interface EnsureIconOptions {
  itemSlug?: string;
  /** items.json meta.iconNormalizeRev，缺省视为 0 */
  normalizeRev?: number;
  delivery?: IconDelivery;
}

/** list / 预览前：白底、未规范化或低清晰度图标自动修复；优先从 workspace raw 重跑。 */
export async function ensureIconNormalizedInPlace(
  iconPath: string,
  targetSize = 48,
  opts: EnsureIconOptions = {},
): Promise<boolean> {
  const fileStat = await stat(iconPath).catch(() => null);
  const metrics = fileStat ? await measureIconContent(iconPath) : null;
  const fileBytes = fileStat?.size ?? 0;
  const revStale = (opts.normalizeRev ?? 0) < ICON_NORMALIZE_REV;

  let rawPath: string | null = null;
  if (opts.itemSlug) rawPath = await findLatestRawIcon(opts.itemSlug);
  if (rawPath) {
    const rawMeta = await sharp(rawPath).metadata();
    const rawMax = Math.max(rawMeta.width ?? 0, rawMeta.height ?? 0);
    if (rawMax > targetSize * 2) {
      const lowQuality = metrics && iconNeedsRenormalize(metrics, targetSize, fileBytes);
      if (revStale || lowQuality || !fileStat) {
        try {
          await writeNormalizedIcon(rawPath, iconPath, targetSize, opts.delivery);
          return true;
        } catch {
          // fall through to in-place fix
        }
      }
    }
  }

  if (!metrics || !fileStat) return false;
  if (!iconNeedsRenormalize(metrics, targetSize, fileBytes)) return false;
  try {
    await writeNormalizedIcon(iconPath, iconPath, targetSize, opts.delivery);
    return true;
  } catch {
    return false;
  }
}

/** @deprecated 使用 ensureIconNormalizedInPlace */
export async function reprocessIconInPlace(iconPath: string): Promise<boolean> {
  return ensureIconNormalizedInPlace(iconPath);
}
