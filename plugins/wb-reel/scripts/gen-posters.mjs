#!/usr/bin/env node
/**
 * gen-posters.mjs —— 一次性生成「风格 / UI」预制海报样张并落盘成静态资源。
 *
 * 背景（2026-06 数据持久化重构）：
 *   风格 / UI 海报以前靠浏览器运行时实时调 Azure gpt-image-2 生成 + IndexedDB 缓存，
 *   表现为「图基本是空的 / 各端不一致 / 清缓存就丢」。改为：本脚本一次性把所有预设
 *   海报跑出来，写入 `src/assets/posters/{style-<id>,ui-<id>}.jpg` 随插件入仓分发；
 *   运行时由 `src/media/prebuiltPosters.ts` 通过 import.meta.glob 直接读静态图，
 *   零成本、所有人一致、不再实时生成（缺图才回落到实时生成兜底）。
 *
 * 用法：
 *   node scripts/gen-posters.mjs            # 仅生成缺失的（增量）
 *   node scripts/gen-posters.mjs --force    # 全部重生成（覆盖已有）
 *   node scripts/gen-posters.mjs --only style   # 只生成风格
 *   node scripts/gen-posters.mjs --only ui      # 只生成 UI
 *
 * key 来源：与 vite.config.ts 一致，读 `key/llm_key.json` 的 azure-openai-image 块。
 * Node 直连 Azure 端点（无浏览器 CORS 问题），不经 /__img__ 反代。
 *
 * 安全：脚本绝不打印 api_key；出错只回显 HTTP 状态码与脱敏的 body 摘要。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'src/assets/posters')

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const ONLY = (() => {
  const i = args.indexOf('--only')
  return i >= 0 ? args[i + 1] : null
})()

// ── key ────────────────────────────────────────────────────────────────────
function loadImageKey() {
  const keyPath = resolve(ROOT, 'key/llm_key.json')
  if (!existsSync(keyPath)) {
    console.error(`[gen-posters] 找不到 key 文件：${keyPath}`)
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(keyPath, 'utf8'))
  const img =
    data['azure-openai-image'] ||
    data['gpt-image-2'] ||
    data['gpt-image'] ||
    data['image'] ||
    null
  if (!img || !img.api_key || !img.api_base) {
    console.error('[gen-posters] key 文件缺 azure-openai-image.{api_key,api_base}')
    process.exit(1)
  }
  return {
    apiKey: img.api_key,
    apiBase: String(img.api_base).replace(/\/$/, ''),
    apiVersion: img.api_version || '2024-02-01',
    deployment: 'gpt-image-2',
  }
}

// ── 从 preset 源文件解析 id → posterPrompt（避免和 UI 代码重复维护 prompt） ──
//   两个文件结构稳定（id: '...' 后面跟 posterPrompt: '...' 或多行拼接）。
//   解析策略：按 `id:` 切块，块内取 posterPrompt 的字符串字面量（支持 + 拼接多行）。
function extractPresetPrompts(srcPath, idKey = 'id') {
  const src = readFileSync(srcPath, 'utf8')
  const out = []
  // 匹配每个对象里的 id 与其后最近的 posterPrompt。
  const idRe = new RegExp(`${idKey}:\\s*'([^']+)'`, 'g')
  let m
  const ids = []
  while ((m = idRe.exec(src))) ids.push({ id: m[1], at: m.index })
  for (let i = 0; i < ids.length; i++) {
    const start = ids[i].at
    const end = i + 1 < ids.length ? ids[i + 1].at : src.length
    const block = src.slice(start, end)
    const pm = block.match(/posterPrompt:\s*([\s\S]*?),\n\s*(?:tagline|swatch|authoringHint|\})/)
    if (!pm) continue
    // 把 'a' + 'b' + 'c' 形式的拼接字面量合成一条字符串
    const literal = pm[1]
    const parts = [...literal.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) =>
      x[1].replace(/\\'/g, "'"),
    )
    const prompt = parts.join('')
    if (prompt) out.push({ id: ids[i].id, posterPrompt: prompt })
  }
  return out
}

// ── 调 Azure gpt-image-2（Node 直连，带简单退避重试） ──────────────────────
async function generate(cfg, prompt, size) {
  const url =
    `${cfg.apiBase}/openai/deployments/${cfg.deployment}/images/generations` +
    `?api-version=${encodeURIComponent(cfg.apiVersion)}`
  const body = JSON.stringify({ prompt, n: 1, size, quality: 'medium' })
  const MAX = 6
  for (let attempt = 0; attempt < MAX; attempt++) {
    let resp, raw
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': cfg.apiKey,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body,
      })
      raw = await resp.text()
    } catch (e) {
      if (attempt === MAX - 1) throw new Error(`网络错误：${e.message}`)
      await sleep(2000 * 2 ** attempt)
      continue
    }
    if (resp.ok) {
      const data = JSON.parse(raw)
      const b64 = data?.data?.[0]?.b64_json
      if (!b64) throw new Error(`响应无 b64_json：${raw.slice(0, 160)}`)
      return Buffer.from(b64, 'base64')
    }
    // 429/5xx 退避重试；其余直接抛（脱敏只留状态 + 摘要）
    if ((resp.status === 429 || resp.status >= 500) && attempt < MAX - 1) {
      const wait = Math.min(30000, 3000 * 2 ** attempt)
      console.warn(`  HTTP ${resp.status}，${Math.round(wait / 1000)}s 后重试…`)
      await sleep(wait)
      continue
    }
    throw new Error(`HTTP ${resp.status} · ${raw.slice(0, 200)}`)
  }
  throw new Error('重试耗尽')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const cfg = loadImageKey()
  mkdirSync(OUT_DIR, { recursive: true })

  const styleSrc = resolve(ROOT, 'src/llm/visualStylePresets.ts')
  const uiSrc = resolve(ROOT, 'src/llm/uiStylePresets.ts')
  const directorSrc = resolve(ROOT, 'src/llm/directorPersonas.ts')

  /** @type {{file:string, prompt:string, size:string}[]} */
  const jobs = []
  if (ONLY !== 'ui') {
    for (const { id, posterPrompt } of extractPresetPrompts(styleSrc)) {
      jobs.push({ file: `style-${id}.jpg`, prompt: posterPrompt, size: '1024x1536' })
    }
  }
  if (ONLY !== 'style') {
    for (const { id, posterPrompt } of extractPresetPrompts(uiSrc)) {
      jobs.push({ file: `ui-${id}.jpg`, prompt: posterPrompt, size: '1536x1024' })
    }
  }
  if (!ONLY || ONLY === 'director') {
    for (const { id, posterPrompt } of extractPresetPrompts(directorSrc)) {
      jobs.push({ file: `director-${id}.jpg`, prompt: posterPrompt, size: '1024x1536' })
    }
  }
  if (!ONLY || ONLY === 'director') {
    for (const { id, posterPrompt } of extractPresetPrompts(directorSrc)) {
      jobs.push({ file: `director-${id}.jpg`, prompt: posterPrompt, size: '1024x1536' })
    }
  }
  if (!ONLY || ONLY === 'director') {
    for (const { id, posterPrompt } of extractPresetPrompts(directorSrc)) {
      jobs.push({ file: `director-${id}.jpg`, prompt: posterPrompt, size: '1024x1536' })
    }
  }

  console.log(
    `[gen-posters] 计划生成 ${jobs.length} 张 · 输出 ${OUT_DIR} · ${FORCE ? '强制覆盖' : '增量'}`,
  )

  let done = 0
  let skipped = 0
  let failed = 0
  for (const job of jobs) {
    const outPath = resolve(OUT_DIR, job.file) // 最终 .jpg
    if (!FORCE && existsSync(outPath)) {
      skipped++
      console.log(`  · 跳过（已存在）${job.file}`)
      continue
    }
    process.stdout.write(`  → 生成 ${job.file} (${job.size}) …`)
    try {
      const buf = await generate(cfg, job.prompt, job.size)
      // gpt-image-2 产 ~2.5MB PNG，直接入仓太重（11 张 ~24MB）。
      // 用 macOS sips 缩放到长边 1080 + JPEG q82 压到 ~200KB/张（卡片最大显示
      // 仅 ~520px，1080 长边在 retina 下仍清晰）。落临时 png → sips 转 jpg → 删 png。
      const tmpPng = outPath.replace(/\.jpg$/, '.tmp.png')
      writeFileSync(tmpPng, buf)
      try {
        execFileSync(
          'sips',
          [
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', '82',
            '--resampleHeightWidthMax', '1080',
            tmpPng, '--out', outPath,
          ],
          { stdio: 'ignore' },
        )
        rmSync(tmpPng, { force: true })
        const { size } = await import('node:fs').then((m) => m.statSync(outPath))
        done++
        console.log(` ✓ ${(size / 1024).toFixed(0)} KiB`)
      } catch {
        // 无 sips（非 macOS）→ 退回直接落原始 PNG（glob 仍能识别 png 兜底）
        rmSync(tmpPng, { force: true })
        const pngPath = outPath.replace(/\.jpg$/, '.png')
        writeFileSync(pngPath, buf)
        done++
        console.log(` ✓ ${(buf.length / 1024).toFixed(0)} KiB (png · 无 sips)`)
      }
    } catch (e) {
      failed++
      console.log(` ✗ ${e.message}`)
    }
  }

  console.log(
    `\n[gen-posters] 完成 · 新生成 ${done} · 跳过 ${skipped} · 失败 ${failed}`,
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('[gen-posters] 未捕获错误：', e.message)
  process.exit(1)
})
