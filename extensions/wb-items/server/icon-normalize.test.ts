import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { chooseResizeKernel, ensureIconNormalizedInPlace, iconNeedsRenormalize, measureIconContent } from './icon-normalize';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wb-icon-norm-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTinyCenteredIcon(path: string): Promise<void> {
  const glyph = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 200, g: 80, b: 40, alpha: 255 },
    },
  })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, left: 20, top: 20 }])
    .png()
    .toFile(path);
}

describe('icon normalize', () => {
  test('chooseResizeKernel uses lanczos for heavy AI painted downscale', () => {
    expect(chooseResizeKernel(false, false, 1024, 1024, 39, 39)).toBe('lanczos3');
  });

  test('chooseResizeKernel uses nearest for native pixel upscale', () => {
    expect(chooseResizeKernel(true, false, 8, 8, 42, 42)).toBe('nearest');
  });

  test('iconNeedsRenormalize flags tiny legacy icons', async () => {
    const path = join(dir, 'tiny.png');
    await writeTinyCenteredIcon(path);
    const metrics = await measureIconContent(path);
    expect(metrics.fillRatio).toBeLessThan(0.1);
    expect(iconNeedsRenormalize(metrics, 48)).toBe(true);
  });

  test('ensureIconNormalizedInPlace upscales content to consistent fill', async () => {
    const path = join(dir, 'tiny.png');
    await writeTinyCenteredIcon(path);
    const changed = await ensureIconNormalizedInPlace(path, 48);
    expect(changed).toBe(true);
    const after = await measureIconContent(path);
    expect(after.width).toBe(48);
    expect(after.height).toBe(48);
    expect(after.fillRatio).toBeGreaterThan(0.45);
    expect(iconNeedsRenormalize(after, 48)).toBe(false);
  });
});
