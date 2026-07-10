import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

import {
  cutoutIconAsset,
  inspectUiAssetCanvas,
  isIconInspectionRejected,
  isIconInspectionRejectedRelaxed,
  normalizeStandaloneUiAsset,
  normalizeUiAssetForCanvas,
  type UiAssetCanvasInspection,
} from '@forgeax/ui-asset-cleanup';

import type { IconDelivery, NormalizeIconResult } from '../shared/types';
import { ICON_NORMALIZE_REV } from '../shared/catalog';
import { projectRoot } from './item-store';

export { inspectCanvas, inspectCanvasFromDataUrl } from './icon-inspect';

const ALPHA_THRESHOLD = 16;
/** 统一视觉占比 — 与 UI 工坊 icon mode 一致 */
const ICON_CONTENT_FILL_PIXEL = 0.88;
const ICON_CONTENT_FILL_PAINTED = 0.82;
/** 低于此文件体积的 48px 图标多为 nearest 压坏，需从 raw 重跑 */
const LOW_QUALITY_ICON_BYTES = 1800;
/** 低于此面积占比视为未规范化，list 时会自动重跑 normalize */
const MIN_ACCEPTABLE_FILL_RATIO = 0.45;

async function readPathAsDataUrl(path: string): Promise<string> {
  const buf = await readFile(path);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function writeDataUrlToPath(dataUrl: string, path: string): Promise<void> {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
  if (!match) throw new Error('invalid data url');
  await writeFile(path, Buffer.from(match[1], 'base64'));
}

function qaFromInspection(report: UiAssetCanvasInspection, pixelDelivery: boolean) {
  return {
    opaqueEdgePixels: report.opaqueEdgePixels,
    transparentCornerDirtyPixels: report.transparentCornerDirtyPixels,
    fragmentationRatio: report.fragmentationRatio,
    largestComponentRatio: report.largestComponentRatio,
    opaqueBoundsFillRatio: report.opaqueBoundsFillRatio,
    passed: pixelDelivery
      ? !isIconInspectionRejectedRelaxed(report)
      : !isIconInspectionRejected(report),
  };
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
  return Math.max(width, height) <= 64 && fileSize < 80_000;
}

export interface NormalizeIconOptions {
  targetSize?: number;
  delivery?: IconDelivery;
}

/** 大图缩小用 lanczos；原生小像素源或整数放大用 nearest */
export function chooseResizeKernel(
  pixel: boolean,
  pixelDelivery: boolean,
  cropW: number,
  cropH: number,
  dstW: number,
  dstH: number,
): 'nearest' | 'lanczos3' {
  const srcMax = Math.max(cropW, cropH);
  const dstMax = Math.max(dstW, dstH);
  const upscaling = dstW > cropW || dstH > cropH;
  if (pixelDelivery && !pixel && srcMax > dstMax * 2) return 'nearest';
  if (pixel && upscaling) return 'nearest';
  if (pixel && srcMax <= 64) return 'nearest';
  return 'lanczos3';
}

/** 与 UI 工坊组件库同一套抠图 + 质检 + 落盘尺寸规范化 */
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
  const pixelDelivery = opts.delivery === 'png-pixel';

  const meta = await sharp(inputPath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const fileStat = await stat(inputPath);
  const pixelNative = isPixelSource(width, height, fileStat.size);
  const pixel = pixelDelivery && pixelNative;
  const fill = pixelDelivery ? ICON_CONTENT_FILL_PIXEL : ICON_CONTENT_FILL_PAINTED;

  const dataUrl = await readPathAsDataUrl(inputPath);
  const cutoutDataUrl = await normalizeStandaloneUiAsset(dataUrl, { mode: 'icon', fillRatio: fill });
  const cutReport = await inspectUiAssetCanvas(cutoutDataUrl);

  const cropW = Math.max(1, cutReport.contentWidth);
  const cropH = Math.max(1, cutReport.contentHeight);
  const maxContent = Math.max(1, Math.floor(targetSize * fill));
  const scale = Math.min(maxContent / cropW, maxContent / cropH);
  const nw = Math.max(1, Math.round(cropW * scale));
  const nh = Math.max(1, Math.round(cropH * scale));
  const kernel = chooseResizeKernel(pixel, pixelDelivery, cropW, cropH, nw, nh);

  const finalDataUrl = await normalizeUiAssetForCanvas(cutoutDataUrl, {
    targetWidth: targetSize,
    targetHeight: targetSize,
    maxFillWidth: fill,
    maxFillHeight: fill,
    kernel: kernel === 'lanczos3' ? 'lanczos3' : 'nearest',
  });

  await writeDataUrlToPath(finalDataUrl, outputPath);
  const qaReport = await inspectUiAssetCanvas(finalDataUrl);

  return {
    slug: '',
    source: inputPath,
    outputPath,
    sourceSize: [width, height],
    pixelSource: pixel,
    qa: qaFromInspection(qaReport, pixelDelivery),
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
  const meta = await sharp(iconPath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const { data } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return measureContentFromRgba(Buffer.from(data), width, height, countWhitePixels(Buffer.from(data)));
}

/** 抠底后的真实主体占比 — 用于评估生图阶段主体是否过小 */
export async function measureIconContentAfterCutout(iconPath: string): Promise<IconContentMetrics> {
  const dataUrl = await readPathAsDataUrl(iconPath);
  const cutoutDataUrl = await cutoutIconAsset(dataUrl, { mode: 'icon' });
  const report = await inspectUiAssetCanvas(cutoutDataUrl);
  const area = Math.max(1, report.width * report.height);
  return {
    width: report.width,
    height: report.height,
    contentWidth: report.contentWidth,
    contentHeight: report.contentHeight,
    fillRatio: (report.contentWidth * report.contentHeight) / area,
    whitePixels: 0,
  };
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
