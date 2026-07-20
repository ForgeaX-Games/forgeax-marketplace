import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

import { measureIconContent, measureIconContentAfterCutout, normalizeIconFile } from './icon-normalize';

let root = '';
let prevRoot: string | undefined;

beforeEach(async () => {
  prevRoot = process.env.FORGEAX_PROJECT_ROOT;
  root = await mkdtemp(join(tmpdir(), 'wb-pipeline-verify-'));
  process.env.FORGEAX_PROJECT_ROOT = root;
  await mkdir(join(root, 'workspace', 'images', 'items', 'test-batch'), { recursive: true });
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.FORGEAX_PROJECT_ROOT;
  else process.env.FORGEAX_PROJECT_ROOT = prevRoot;
  await rm(root, { recursive: true, force: true });
});

/** 模拟 AI 1024 生图：主体偏小（常见质量问题） */
async function writeMockAiRaw(path: string): Promise<void> {
  const glyph = await sharp({
    create: {
      width: 280,
      height: 280,
      channels: 4,
      background: { r: 200, g: 60, b: 40, alpha: 255 },
    },
  }).png().toBuffer();
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .composite([{ input: glyph, left: 372, top: 372 }])
    .png()
    .toFile(path);
}

describe('pipeline quality (normalize only)', () => {
  test('1024 AI raw → 48px output reaches acceptable fill without tiny content', async () => {
    const rawPath = join(root, 'workspace', 'images', 'items', 'test-batch', 'potion-raw.png');
    const outPath = join(root, 'workspace', 'images', 'items', 'test-batch', 'potion-48.png');
    await writeMockAiRaw(rawPath);

    const before = await measureIconContentAfterCutout(rawPath);
    expect(before.width).toBe(1024);
    expect(before.fillRatio).toBeLessThan(0.1);

    await normalizeIconFile(rawPath, outPath, { targetSize: 48, delivery: 'png-pixel' });
    const after = await measureIconContent(outPath);
    expect(after.width).toBe(48);
    expect(after.height).toBe(48);
    expect(after.fillRatio).toBeGreaterThan(0.45);
    expect(after.fillRatio).toBeLessThan(0.85);
  });
});
