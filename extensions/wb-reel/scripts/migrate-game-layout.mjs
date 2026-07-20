#!/usr/bin/env node
// @ts-check
/**
 * migrate-game-layout —— 把 per-game 旧布局搬到新布局（assets/ + workbench/），
 * 并把全局散落素材（包内 .reel-assets）按 scenarioId 归并进所属 game。
 *
 * 旧 → 新（见 docs/STORAGE-LAYOUT.md / src/storage/gameLayout.ts）：
 *   games/<slug>/reel/scenarios.json   → workbench/reel/scenarios.json
 *   games/<slug>/reel/versions/**       → workbench/reel/versions/**
 *   games/<slug>/reel/*-queue.json      → workbench/reel/*-queue.json
 *   games/<slug>/reel/assets/blobs/*    → workbench/<kind>/blobs/*  (按 MIME 拆 image/video/audio)
 *   games/<slug>/reel/assets/manifest   → 按 kind 拆成 workbench/<kind>/manifest.json
 *   <pkg>/.reel-assets 里 meta.scenarioId 属于某 game 的记录 → 并入该 game 的 workbench/<kind>/
 *
 * 归并规则（散落素材）：
 *   - 用 meta.scenarioId 匹配「唯一一个」game 的剧本 id 才并入；
 *   - demo-001（内置 demo，多 game 共有）一律跳过，避免污染；
 *   - 一个 sid 命中多个 game（歧义）→ 跳过并报告。
 *
 * 为什么按 MIME 而非记录里的 kind 拆：旧 manifest 的 record.kind 只有 image|video，
 * 音频历史上被误判成 image；这里用 mimeType 重新归类，音频正确落 audio 桶。
 *
 * 安全 / 可回滚：
 *   - 默认 dry-run，只打印计划。
 *   - --apply 执行：移动都是同盘 rename（瞬时），写 journal
 *     `workbench/.migration-journal.json` 记录每步（含全局归并），供回滚。
 *   - --rollback 按 journal 逆序还原（移回 reel/、回填全局 manifest、删空目录）。
 *   - 去重：dry-run 报告各 kind 桶内字节相同的重复 blob 数，但**不**破坏性合并。
 *
 * 用法：
 *   node scripts/migrate-game-layout.mjs --root <projectRoot> --all                 # dry-run 全部
 *   node scripts/migrate-game-layout.mjs --root <projectRoot> --slug 1234 --apply   # 执行单个
 *   node scripts/migrate-game-layout.mjs --root <projectRoot> --slug 1234 --rollback
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs'
import { resolve, dirname, basename, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const JOURNAL_NAME = '.migration-journal.json'
const BUNDLED_DEMO_ID = 'demo-001'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
/** 包根（含全局 .reel-assets）= wb-reel 目录。 */
const PKG_ROOT = resolve(SCRIPT_DIR, '..')

function parseArgs(argv) {
  const args = { root: '', slug: '', all: false, apply: false, rollback: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--rollback') args.rollback = true
    else if (a === '--all') args.all = true
    else if (a === '--root') args.root = argv[++i] ?? ''
    else if (a === '--slug') args.slug = argv[++i] ?? ''
  }
  return args
}

function autoDetectRoot() {
  let dir = SCRIPT_DIR
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

/** 按 mime 归类到 workbench 媒体桶（音频即便旧记录误标 image 也能纠正）。 */
function mediaKindOf(mime, fallbackKind) {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('image/')) return 'image'
  if (fallbackKind === 'video' || fallbackKind === 'audio' || fallbackKind === 'image') return fallbackKind
  return 'image'
}

function listGameSlugs(root) {
  const dir = resolve(root, '.forgeax', 'games')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/** 读某 game 的剧本库（迁移后在 workbench/reel，未迁在 reel/）。 */
function readGameScenarios(root, slug) {
  const gameDir = resolve(root, '.forgeax', 'games', slug)
  for (const p of [
    resolve(gameDir, 'workbench', 'reel', 'scenarios.json'),
    resolve(gameDir, 'reel', 'scenarios.json'),
  ]) {
    if (existsSync(p)) return readJson(p, { items: [] })
  }
  return { items: [] }
}

/** sid → slug（仅唯一归属、非 demo）。多归属记为歧义跳过。 */
function buildSidOwner(root, slugs) {
  /** @type {Map<string, Set<string>>} */
  const sidSlugs = new Map()
  for (const slug of slugs) {
    const db = readGameScenarios(root, slug)
    for (const it of db.items ?? []) {
      for (const sid of [it?.id, it?.scenario?.id]) {
        if (typeof sid !== 'string' || !sid) continue
        if (!sidSlugs.has(sid)) sidSlugs.set(sid, new Set())
        sidSlugs.get(sid).add(slug)
      }
    }
  }
  /** @type {Map<string, string>} */
  const owner = new Map()
  const ambiguous = new Set()
  for (const [sid, set] of sidSlugs) {
    if (sid === BUNDLED_DEMO_ID) continue
    if (set.size === 1) owner.set(sid, [...set][0])
    else ambiguous.add(sid)
  }
  return { owner, ambiguous }
}

/**
 * 计算单个 game 的迁移计划。
 * ctx = { globalAssetsDir, globalRecords, sidOwner }
 */
function planGame(root, slug, ctx) {
  const gameDir = resolve(root, '.forgeax', 'games', slug)
  const reelDir = resolve(gameDir, 'reel')
  const workbenchDir = resolve(gameDir, 'workbench')
  const workbenchReel = resolve(workbenchDir, 'reel')
  const assetsLegacy = resolve(reelDir, 'assets')
  const legacyManifestPath = resolve(assetsLegacy, 'manifest.json')

  const plan = {
    slug,
    gameDir,
    workbenchDir,
    needsMigration: false,
    /** @type {{from:string,to:string}[]} */ moves: [],
    /** 新建 per-kind manifest（reel/assets 拆出来的）。 */
    /** @type {{path:string, assets:any[]}[]} */ manifests: [],
    /** 全局归并：把记录 append 进对应 kind manifest，并移动 blob。 */
    /** @type {{kind:string, record:any, from:string, to:string}[]} */ globalAdds: [],
    /** @type {Record<string, number>} */ dupReport: {},
    movedBytes: 0,
    globalBytes: 0,
    globalAssetsDir: ctx.globalAssetsDir,
    globalManifestPath: resolve(ctx.globalAssetsDir, 'manifest.json'),
  }

  const reelExists = existsSync(reelDir)
  const alreadyMigrated =
    existsSync(resolve(workbenchReel, 'scenarios.json')) &&
    !existsSync(resolve(reelDir, 'scenarios.json'))

  // ── reel/ → workbench/（仅未迁移时）──
  if (reelExists && !alreadyMigrated) {
    for (const entry of readdirSync(reelDir, { withFileTypes: true })) {
      if (entry.name === 'assets') continue
      plan.moves.push({ from: resolve(reelDir, entry.name), to: resolve(workbenchReel, entry.name) })
    }
    const legacyManifest = readJson(legacyManifestPath, { assets: [] })
    const records = Array.isArray(legacyManifest.assets) ? legacyManifest.assets : []
    /** @type {Record<string, any[]>} */ const byKind = {}
    /** @type {Record<string, Record<string, number>>} */ const hashSeen = {}
    for (const rec of records) {
      const kind = mediaKindOf(rec?.mimeType, rec?.kind)
      const blobName = basename(rec?.filename ?? '')
      if (!blobName) continue
      const src = resolve(assetsLegacy, rec.filename)
      if (existsSync(src)) {
        try {
          plan.movedBytes += statSync(src).size
          const h = createHash('sha1').update(readFileSync(src)).digest('hex')
          hashSeen[kind] = hashSeen[kind] ?? {}
          hashSeen[kind][h] = (hashSeen[kind][h] ?? 0) + 1
        } catch { /* ignore */ }
        plan.moves.push({ from: src, to: resolve(workbenchDir, kind, 'blobs', blobName) })
      }
      byKind[kind] = byKind[kind] ?? []
      byKind[kind].push({ ...rec, kind, filename: `blobs/${blobName}` })
    }
    for (const kind of Object.keys(byKind)) {
      plan.manifests.push({ path: resolve(workbenchDir, kind, 'manifest.json'), assets: byKind[kind] })
      let dups = 0
      for (const c of Object.values(hashSeen[kind] ?? {})) if (c > 1) dups += c - 1
      if (dups > 0) plan.dupReport[kind] = dups
    }
    if (existsSync(legacyManifestPath)) {
      plan.moves.push({ from: legacyManifestPath, to: resolve(workbenchDir, JOURNAL_NAME + '.reel-assets-manifest.json') })
    }
  }

  // ── 全局散落素材归并（无论是否已迁移都尝试，按 sid 归属本 slug）──
  for (const gr of ctx.globalRecords) {
    const sid = gr?.meta?.scenarioId
    if (typeof sid !== 'string' || ctx.sidOwner.get(sid) !== slug) continue
    const blobName = basename(gr?.filename ?? '')
    if (!blobName) continue
    const src = resolve(ctx.globalAssetsDir, gr.filename)
    if (!existsSync(src)) continue
    const kind = mediaKindOf(gr?.mimeType, gr?.kind)
    try { plan.globalBytes += statSync(src).size } catch { /* ignore */ }
    plan.globalAdds.push({
      kind,
      record: { ...gr, kind, filename: `blobs/${blobName}` },
      from: src,
      to: resolve(workbenchDir, kind, 'blobs', blobName),
    })
  }

  plan.needsMigration = plan.moves.length > 0 || plan.manifests.length > 0 || plan.globalAdds.length > 0
  return plan
}

/** 创建目录并把「本次新建的」目录（含中间层）登记进 journal。 */
function ensureDirTracked(dir, journal) {
  /** @type {string[]} */ const toCreate = []
  let d = dir
  while (!existsSync(d)) {
    toCreate.unshift(d)
    const parent = resolve(d, '..')
    if (parent === d) break
    d = parent
  }
  if (toCreate.length) mkdirSync(dir, { recursive: true })
  for (const c of toCreate) journal.mkdirs.push(c)
}

function applyPlan(plan) {
  const journal = {
    migratedAt: new Date().toISOString(),
    slug: plan.slug,
    /** @type {string[]} */ mkdirs: [],
    /** @type {{from:string,to:string}[]} */ renames: [],
    /** @type {string[]} */ writes: [],
    /** @type {{path:string, ids:string[]}[]} */ manifestAppends: [],
    globalManifestPath: plan.globalManifestPath,
    /** @type {any[]} */ globalRemovedRecords: [],
  }
  const freshManifests = new Set()

  // 1) reel meta + reel-assets blob 移动
  for (const mv of plan.moves) {
    if (!existsSync(mv.from)) continue
    ensureDirTracked(dirname(mv.to), journal)
    renameSync(mv.from, mv.to)
    journal.renames.push(mv)
  }
  // 2) reel/assets 拆出的 per-kind manifest（整文件新建）
  for (const m of plan.manifests) {
    ensureDirTracked(dirname(m.path), journal)
    writeFileSync(m.path, JSON.stringify({ version: 1, assets: m.assets }, null, 2))
    journal.writes.push(m.path)
    freshManifests.add(m.path)
  }
  // 3) 全局归并：移动 blob + append 进 kind manifest + 从全局 manifest 摘除
  if (plan.globalAdds.length) {
    /** @type {Record<string, any[]>} */ const addsByKind = {}
    for (const ga of plan.globalAdds) {
      ensureDirTracked(dirname(ga.to), journal)
      if (existsSync(ga.from)) {
        renameSync(ga.from, ga.to)
        journal.renames.push({ from: ga.from, to: ga.to })
      }
      addsByKind[ga.kind] = addsByKind[ga.kind] ?? []
      addsByKind[ga.kind].push(ga.record)
    }
    for (const kind of Object.keys(addsByKind)) {
      const manifestPath = resolve(plan.workbenchDir, kind, 'manifest.json')
      const cur = existsSync(manifestPath) ? readJson(manifestPath, { version: 1, assets: [] }) : { version: 1, assets: [] }
      const have = new Set((cur.assets ?? []).map((a) => a.id))
      const addedIds = []
      for (const rec of addsByKind[kind]) {
        if (have.has(rec.id)) continue
        cur.assets.push(rec)
        addedIds.push(rec.id)
      }
      const existedBefore = existsSync(manifestPath)
      writeFileSync(manifestPath, JSON.stringify({ version: 1, assets: cur.assets }, null, 2))
      if (!existedBefore) journal.writes.push(manifestPath)
      else if (!freshManifests.has(manifestPath)) journal.manifestAppends.push({ path: manifestPath, ids: addedIds })
    }
    // 从全局 manifest 摘除已并入的记录（记录原始记录以便回滚回填）
    const gm = readJson(plan.globalManifestPath, null)
    if (gm && Array.isArray(gm.assets)) {
      const movedIds = new Set(plan.globalAdds.map((g) => g.record.id))
      journal.globalRemovedRecords = gm.assets.filter((a) => movedIds.has(a.id))
      gm.assets = gm.assets.filter((a) => !movedIds.has(a.id))
      writeFileSync(plan.globalManifestPath, JSON.stringify(gm, null, 2))
    }
  }

  ensureDirTracked(plan.workbenchDir, journal)
  const journalPath = resolve(plan.workbenchDir, JOURNAL_NAME)
  writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  return journalPath
}

/** 递归删除「完全不含文件」的空目录子树。 */
function removeEmptyTree(dir) {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) removeEmptyTree(resolve(dir, e.name))
  }
  try {
    // recursive:true 因目录此刻已空，等价于删空目录，且不会像 recursive:false 那样对目录抛错。
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
  } catch { /* ignore */ }
}

function rollbackGame(root, slug) {
  const gameDir = resolve(root, '.forgeax', 'games', slug)
  const workbenchDir = resolve(gameDir, 'workbench')
  const journalPath = resolve(workbenchDir, JOURNAL_NAME)
  if (!existsSync(journalPath)) {
    console.error(`✗ 无 journal，无法回滚：${journalPath}`)
    return false
  }
  const j = readJson(journalPath, null)
  if (!j) {
    console.error(`✗ journal 解析失败：${journalPath}`)
    return false
  }
  // 1) 删新建的整文件 manifest
  for (const w of j.writes ?? []) {
    try { if (existsSync(w)) rmSync(w) } catch { /* ignore */ }
  }
  // 2) 撤销 append 进既有 manifest 的记录
  for (const ap of j.manifestAppends ?? []) {
    try {
      const cur = readJson(ap.path, null)
      if (cur && Array.isArray(cur.assets)) {
        const rm = new Set(ap.ids)
        cur.assets = cur.assets.filter((a) => !rm.has(a.id))
        writeFileSync(ap.path, JSON.stringify(cur, null, 2))
      }
    } catch { /* ignore */ }
  }
  // 3) 逆序还原 rename（含 reel + 全局 blob 移回原位）
  for (const mv of [...(j.renames ?? [])].reverse()) {
    try {
      if (existsSync(mv.to)) {
        mkdirSync(dirname(mv.from), { recursive: true })
        renameSync(mv.to, mv.from)
      }
    } catch (e) {
      console.warn(`  ! 还原失败 ${mv.to} → ${mv.from}: ${(e && e.message) || e}`)
    }
  }
  // 4) 回填全局 manifest 被摘除的记录
  if (j.globalManifestPath && (j.globalRemovedRecords ?? []).length) {
    try {
      const gm = readJson(j.globalManifestPath, { version: 1, assets: [] })
      const have = new Set((gm.assets ?? []).map((a) => a.id))
      for (const rec of j.globalRemovedRecords) if (!have.has(rec.id)) gm.assets.push(rec)
      writeFileSync(j.globalManifestPath, JSON.stringify(gm, null, 2))
    } catch { /* ignore */ }
  }
  try { rmSync(journalPath) } catch { /* ignore */ }
  // 5) 删空目录子树（含遗留的中间层空目录）
  removeEmptyTree(workbenchDir)
  console.log(`✓ 已回滚 ${slug}`)
  return true
}

function reportPlan(plan) {
  if (!plan.needsMigration) {
    console.log(`  ✓ ${plan.slug}: 无需迁移（已是新布局且无散落素材归属）`)
    return
  }
  console.log(`  ⟳ ${plan.slug}:`)
  const blobMoves = plan.moves.filter((m) => m.from.includes(`${join('assets', 'blobs')}`)).length
  const metaMoves = plan.moves.length - blobMoves
  if (metaMoves > 0 || blobMoves > 0) {
    console.log(`     reel/ 元数据移动 ${metaMoves} 项 → workbench/reel/`)
    console.log(`     媒体 blob 移动 ${blobMoves} 个（${fmtBytes(plan.movedBytes)}）→ workbench/<kind>/`)
  }
  for (const m of plan.manifests) {
    console.log(`     新建 ${basename(dirname(m.path))}/manifest.json（${m.assets.length} 条）`)
  }
  if (plan.globalAdds.length) {
    /** @type {Record<string, number>} */ const byKind = {}
    for (const ga of plan.globalAdds) byKind[ga.kind] = (byKind[ga.kind] ?? 0) + 1
    console.log(
      `     全局散落素材归并 ${plan.globalAdds.length} 个（${fmtBytes(plan.globalBytes)}）：` +
        Object.entries(byKind).map(([k, n]) => `${k}:${n}`).join(' '),
    )
  }
  const dupKinds = Object.entries(plan.dupReport)
  if (dupKinds.length) {
    console.log(`     ⚠ 重复 blob（未去重，仅报告）：${dupKinds.map(([k, n]) => `${k}:${n}`).join(' ')}`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = args.root || autoDetectRoot()
  if (!root) {
    console.error('✗ 无法确定工程根（含 .forgeax/games）。请用 --root 指定。')
    process.exit(1)
  }
  const slugs = args.all ? listGameSlugs(root) : args.slug ? [args.slug] : []
  if (slugs.length === 0) {
    console.error('✗ 必须用 --slug <slug> 或 --all 指定迁移范围。')
    process.exit(1)
  }

  if (args.rollback) {
    console.log(`\n回滚模式 · root=${root}`)
    for (const slug of slugs) rollbackGame(root, slug)
    return
  }

  // 全局散落素材上下文（按所有 game 的剧本 id 归属）。
  const allSlugs = listGameSlugs(root)
  const { owner: sidOwner, ambiguous } = buildSidOwner(root, allSlugs)
  const globalAssetsDir = resolve(PKG_ROOT, '.reel-assets')
  const globalManifest = readJson(resolve(globalAssetsDir, 'manifest.json'), { assets: [] })
  const globalRecords = Array.isArray(globalManifest.assets) ? globalManifest.assets : []
  const ctx = { globalAssetsDir, globalRecords, sidOwner }

  console.log(`\n迁移 ${args.apply ? 'APPLY' : 'DRY-RUN'} · root=${root} · ${slugs.length} 个 game`)
  console.log(`全局 .reel-assets：${globalRecords.length} 条 · 可归属 sid ${sidOwner.size} 个 · 歧义跳过 ${ambiguous.size} 个`)
  let migratedCount = 0
  for (const slug of slugs) {
    const plan = planGame(root, slug, ctx)
    reportPlan(plan)
    if (plan.needsMigration && args.apply) {
      const jp = applyPlan(plan)
      migratedCount++
      console.log(`     ✓ 已迁移，journal: ${jp}`)
    }
  }

  if (!args.apply) {
    console.log('\n（dry-run）加 --apply 真正执行；执行后可用 --rollback 还原。')
  } else {
    console.log(`\n✓ 完成，迁移 ${migratedCount} 个 game。回滚：--slug <slug> --rollback`)
  }
}

main()
