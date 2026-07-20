import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { evaluateRawQuality, GOLD_RAW_SAMPLE_SIZE } from '../shared/pipeline-quality';
import type { IconQualityInput, RawQualityInput } from '../shared/pipeline-quality';
import {
  isPixelSource,
  measureIconContent,
  measureIconContentAfterCutout,
} from './icon-normalize';
import { inspectCanvas } from './icon-inspect';
import { projectRoot } from './item-store';

export async function countUniqueColorsAtSize(path: string, size = 48): Promise<number> {
  const { data } = await sharp(path)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 16) continue;
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return seen.size;
}

export async function readRawQualityInput(rawPath: string): Promise<RawQualityInput & { uniqueColors: number }> {
  const meta = await sharp(rawPath).metadata();
  const cut = await measureIconContentAfterCutout(rawPath);
  const sampleColors = await countUniqueColorsAtSize(rawPath, GOLD_RAW_SAMPLE_SIZE);
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    cutoutFillRatio: cut.fillRatio,
    sampleColors,
    uniqueColors: sampleColors,
  };
}

export async function readIconQualityInputInPlace(iconPath: string): Promise<IconQualityInput> {
  const metrics = await measureIconContent(iconPath);
  const { data, info } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fileStat = await stat(iconPath);
  const pixel = isPixelSource(info.width, info.height, fileStat.size);
  const qa = inspectCanvas(Buffer.from(data), info.width, info.height, pixel);
  return {
    width: metrics.width,
    height: metrics.height,
    fillRatio: metrics.fillRatio,
    uniqueColors: await countUniqueColorsAtSize(iconPath),
    qaPassed: qa.passed,
  };
}

export async function validateRawIconBuffer(
  buffer: Buffer,
  opts: { strict?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tmpDir = resolve(projectRoot(), 'workspace', 'images', 'items', '_raw-qa');
  await mkdir(tmpDir, { recursive: true });
  const tmp = resolve(tmpDir, `raw-qa-${Date.now()}.png`);
  try {
    await writeFile(tmp, buffer);
    const input = await readRawQualityInput(tmp);
    const evalResult = evaluateRawQuality(input, { strict: opts.strict ?? false });
    if (evalResult.verdict === 'fail') {
      return { ok: false, error: evalResult.notes.join('；') || '生图质量未达金标' };
    }
    if (opts.strict && evalResult.verdict === 'warn') {
      return { ok: false, error: evalResult.notes.join('；') || '生图质量未达金标（strict）' };
    }
    return { ok: true };
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
