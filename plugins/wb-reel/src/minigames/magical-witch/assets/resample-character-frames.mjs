#!/usr/bin/env node
/**
 * 从 `game-character-sprites/<action>/right_XX.png`（1626×1626 原始像素风）
 * 下采样到 `character/frames/<action>/right_XX.png`（192×192，游戏运行时加载）。
 *
 * 原始素材目录 `game-character-sprites/` 被 .gitignore 排除（单包 16MB 不入仓），
 * 而下采样后的 `character/frames/` ≈ 570KB 入仓，游戏运行时直接用后者。
 *
 * 需要在不同机器上重建 frames/ 时：
 *   1. 把原始 sprite 包复制到 assets/game-character-sprites/
 *   2. `node resample-character-frames.mjs` （依赖 macOS 的 `sips`）
 *
 * meta 驱动：每个 action 的帧数来自 `sprite-meta.json`，新增动作只需更新 meta。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, 'game-character-sprites')
const DST = resolve(__dirname, 'character/frames')
const TARGET_PX = 192

if (!existsSync(SRC)) {
  console.error(`[resample] source not found: ${SRC}`)
  console.error(`  copy/extract game-character-sprites.zip into the assets dir first.`)
  process.exit(1)
}

const meta = JSON.parse(readFileSync(join(SRC, 'sprite-meta.json'), 'utf8'))

if (existsSync(DST)) rmSync(DST, { recursive: true })

let total = 0
for (const [action, info] of Object.entries(meta)) {
  const nframes = info.directions?.right?.frames ?? 0
  if (!nframes) continue
  const srcDir = join(SRC, action)
  const dstDir = join(DST, action)
  mkdirSync(dstDir, { recursive: true })
  for (let i = 0; i < nframes; i++) {
    const idx = String(i).padStart(2, '0')
    const src = join(srcDir, `right_${idx}.png`)
    const dst = join(dstDir, `right_${idx}.png`)
    execFileSync('sips', ['-z', String(TARGET_PX), String(TARGET_PX), src, '--out', dst], {
      stdio: 'ignore',
    })
    total++
  }
  console.log(`  ${action}: ${nframes}`)
}
console.log(`total: ${total} frames → ${DST}`)
