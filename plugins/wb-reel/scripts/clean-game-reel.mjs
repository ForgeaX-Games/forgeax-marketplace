#!/usr/bin/env node
// @ts-check
/**
 * clean-game-reel —— 清理被污染的 per-game 影游工作目录。
 *
 * 背景（防污染）：
 *   新建 game 时 store 初值曾停在共享内置 demo（demo-001），用户在"看似新工程"的
 *   画布上生成图/视频，assetStore 把它们打上 meta.scenarioId='demo-001' 落进该
 *   game 的 reel/assets —— 于是新工程凭空多出几百张 demo-001 资产
 *   （1234 工程 745 张的来源）。boot 端已修复（新建 game 改用全新空白剧本），
 *   本脚本负责清理**已经被污染**的历史 game 目录。
 *
 * 清理规则（principled）：
 *   - 一个 game 目录里，资产只在 meta.scenarioId ∈ 该 game 自己的剧本 id 时才保留。
 *   - 共享内置 demo（demo-001）**永远不属于任何 game** —— 它的剧本条目和资产一律清掉。
 *   - 其余 meta.scenarioId 不在该 game 剧本列表里的资产 = 孤儿/污染 → 清掉。
 *
 * 安全：
 *   - 默认 dry-run，只打印将删除的内容，不动磁盘。
 *   - --apply 才真正执行；执行前先把整个 reel/ 备份到 .forgeax/reel-trash/<slug>-<ts>/。
 *
 * 用法：
 *   node scripts/clean-game-reel.mjs --root <projectRoot> --slug 1234            # dry-run
 *   node scripts/clean-game-reel.mjs --root <projectRoot> --slug 1234 --apply    # 执行
 *   node scripts/clean-game-reel.mjs --root <projectRoot> --slug 1234 --keep-demo # 保留 demo 资产
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  statSync,
} from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const BUNDLED_DEMO_ID = 'demo-001'

function parseArgs(argv) {
  const args = { root: '', slug: '', apply: false, keepDemo: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--keep-demo') args.keepDemo = true
    else if (a === '--root') args.root = argv[++i] ?? ''
    else if (a === '--slug') args.slug = argv[++i] ?? ''
  }
  return args
}

/** 从脚本位置向上找含 `.forgeax/games` 的工程根。 */
function autoDetectRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, '.forgeax', 'games'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return ''
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return fallback
  }
}

function fmtBytes(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`
  if (n > 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = args.root || autoDetectRoot()
  if (!root) {
    console.error('✗ 无法确定工程根（含 .forgeax/games）。请用 --root 指定。')
    process.exit(1)
  }
  if (!args.slug) {
    console.error('✗ 必须用 --slug 指定 game。')
    process.exit(1)
  }

  const reelDir = resolve(root, '.forgeax', 'games', args.slug, 'reel')
  if (!existsSync(reelDir)) {
    console.error(`✗ 找不到 ${reelDir}`)
    process.exit(1)
  }

  const scenariosPath = resolve(reelDir, 'scenarios.json')
  const manifestPath = resolve(reelDir, 'assets', 'manifest.json')
  const blobsDir = resolve(reelDir, 'assets', 'blobs')

  const db = readJson(scenariosPath, { version: 1, activeId: null, items: [] })
  const manifest = readJson(manifestPath, { version: 1, assets: [] })

  const items = Array.isArray(db.items) ? db.items : []
  // 该 game 自己的剧本 id（保留 demo 时把 demo 也算进来）
  const keptScenarioIds = new Set(
    items
      .map((it) => it?.id)
      .filter((id) => typeof id === 'string')
      .filter((id) => args.keepDemo || id !== BUNDLED_DEMO_ID),
  )

  const removeDemoItem = !args.keepDemo && items.some((it) => it?.id === BUNDLED_DEMO_ID)

  const assets = Array.isArray(manifest.assets) ? manifest.assets : []
  const orphanAssets = assets.filter((a) => {
    const sid = a?.meta?.scenarioId
    // 未标 scenarioId 的资产保守保留（可能是手动上传/全局参考）
    if (typeof sid !== 'string' || sid === '') return false
    return !keptScenarioIds.has(sid)
  })

  let orphanBytes = 0
  for (const a of orphanAssets) {
    const fp = resolve(reelDir, 'assets', a.filename ?? '')
    try {
      orphanBytes += statSync(fp).size
    } catch {
      orphanBytes += a.bytes ?? 0
    }
  }

  // ── 报告 ──────────────────────────────────────────────────────────────────
  console.log(`\n清理目标：${reelDir}`)
  console.log(`模式：${args.apply ? 'APPLY（将真正删除，删前备份）' : 'DRY-RUN（只预览）'}`)
  console.log(`\n剧本条目（${items.length}）：`)
  for (const it of items) {
    const drop = removeDemoItem && it?.id === BUNDLED_DEMO_ID
    console.log(`  ${drop ? '✗删除' : '✓保留'}  ${it?.id} | ${it?.title ?? ''}`)
  }
  console.log(`\n资产：共 ${assets.length}，污染/孤儿 ${orphanAssets.length}（${fmtBytes(orphanBytes)}）`)
  const byScenario = {}
  for (const a of orphanAssets) {
    const sid = a?.meta?.scenarioId ?? '(none)'
    byScenario[sid] = (byScenario[sid] ?? 0) + 1
  }
  for (const [sid, n] of Object.entries(byScenario)) {
    console.log(`  ✗ meta.scenarioId=${sid} → ${n} 个`)
  }

  if (orphanAssets.length === 0 && !removeDemoItem) {
    console.log('\n✓ 该 game 干净，无需清理。')
    return
  }

  if (!args.apply) {
    console.log(
      '\n（dry-run）加 --apply 真正执行；执行会把孤儿 blob 移动到 .forgeax/reel-trash/<slug>-<ts>/（可回滚）。',
    )
    return
  }

  // ── 备份（轻量、可回滚）──────────────────────────────────────────────────
  // 不复制 2GB 级 blob：只备份两个小 JSON，并把孤儿 blob **移动**（rename）到
  // trash —— 同盘 rename 是瞬时操作，要回滚把它们移回来即可。
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  const trashDir = resolve(root, '.forgeax', 'reel-trash', `${args.slug}-${ts}`)
  const trashBlobs = resolve(trashDir, 'blobs')
  mkdirSync(trashBlobs, { recursive: true })
  if (existsSync(scenariosPath)) {
    copyFileSync(scenariosPath, resolve(trashDir, 'scenarios.json'))
  }
  if (existsSync(manifestPath)) {
    copyFileSync(manifestPath, resolve(trashDir, 'manifest.json'))
  }
  console.log(`\n✓ 备份目录：${trashDir}（含原 scenarios.json/manifest.json + 被移出的 blob）`)

  // ── 移除孤儿资产 blob（移动到 trash，可回滚）──────────────────────────────
  let removed = 0
  for (const a of orphanAssets) {
    const fp = resolve(reelDir, 'assets', a.filename ?? '')
    if (a.filename && existsSync(fp) && fp.startsWith(blobsDir)) {
      try {
        renameSync(fp, resolve(trashBlobs, basename(a.filename)))
        removed++
      } catch (e) {
        console.warn(`  ! 移动失败 ${a.filename}: ${(e && e.message) || e}`)
      }
    }
  }
  const orphanIds = new Set(orphanAssets.map((a) => a.id))
  manifest.assets = assets.filter((a) => !orphanIds.has(a.id))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`✓ 删除 ${removed} 个 blob，manifest 现存 ${manifest.assets.length} 条。`)

  // ── 删除 demo 剧本条目 ────────────────────────────────────────────────────
  if (removeDemoItem) {
    db.items = items.filter((it) => it?.id !== BUNDLED_DEMO_ID)
    if (db.activeId === BUNDLED_DEMO_ID) {
      db.activeId = db.items[0]?.id ?? null
    }
    writeFileSync(scenariosPath, JSON.stringify(db, null, 2))
    console.log(`✓ 从 scenarios.json 移除内置 demo（demo-001）。activeId=${db.activeId}`)
  }

  console.log('\n✓ 清理完成。如需回滚，从上面的备份目录恢复 reel/。')
}

main()
