#!/usr/bin/env bun

import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const extensionsDir = resolve(import.meta.dir, '../extensions');
const force = process.argv.includes('--force');
let generated = 0;
let skipped = 0;

for (const extensionName of readdirSync(extensionsDir).sort()) {
  const avatarDir = join(extensionsDir, extensionName, 'avatar');
  if (!existsSync(avatarDir)) continue;

  for (const videoName of readdirSync(avatarDir).filter((name) => name.endsWith('.webm')).sort()) {
    const videoPath = join(avatarDir, videoName);
    const desktopPath = videoPath.replace(/\.webm$/, '.desktop.mov');
    if (!force && existsSync(desktopPath)) {
      skipped += 1;
      continue;
    }

    // WebM alpha is stored as a Matroska BlockAdditional stream. FFmpeg's
    // native VP9 decoder supplies colour, while libvpx exposes the alpha plane;
    // merge both before handing BGRA frames to VideoToolbox's HEVC-alpha encoder.
    const result = Bun.spawnSync([
      'ffmpeg',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', videoPath,
      '-c:v', 'libvpx-vp9',
      '-i', videoPath,
      '-filter_complex',
      '[0:v]format=rgba[color];[1:v]alphaextract[alpha];[color][alpha]alphamerge,scale=192:-2:flags=lanczos,format=bgra',
      '-c:v', 'hevc_videotoolbox',
      '-alpha_quality', '0.7',
      '-q:v', '60',
      '-tag:v', 'hvc1',
      '-an',
      desktopPath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`${basename(videoPath)}: ffmpeg failed\n${result.stderr.toString()}`);
    }
    generated += 1;
    console.log(`[desktop-avatar] ${extensionName}: ${basename(desktopPath)}`);
  }
}

console.log(`[desktop-avatar] complete: ${generated} generated, ${skipped} unchanged`);
