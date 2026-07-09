/**
 * wb-game-video `entry.backend` for ToolRegistry —— **graph-native** 工具层。
 *
 * 新引擎（GameGraph）时代：AI 与视频游戏工坊沟通的唯一契约就是**直接读/改
 * GameGraph**（`.forgeax/games/<slug>/game-video/scenarios.graph.json`）。这里只暴露
 * 三个瘦工具，全部走 fs 直读写（沙箱内以 ctx.cwd 定位工程根），不再有旧 FMV 的
 * Seedance 视频生成 / scenario 锻造 / 素材上传那一大套。
 *
 *   ToolRegistry → tools["gvid:get-graph"](args, ctx) → 读盘/回退 demo → { scenario }
 *   ToolRegistry → tools["gvid:save-graph"](args, ctx) → 校验+落盘+版本快照 → { ok, versions }
 *   ToolRegistry → tools["gvid:list-videos"](args, ctx) → 内置演出视频库 basenames
 *
 * 盘上格式与 vite `/__graph__` 端点、前端 persist-client 完全一致：
 *   scenarios.graph.json = { version:1, activeId, items:[{ id, title, scenario }] }
 *   scenarios.graph.versions/<vid>.json + index.json（留最近 10 版）
 *
 * 沙箱契约：handlers 只用 ctx.env 取配置、ctx.cwd 定位工程根；绝不读 process.env。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

interface ToolCtx {
  caller: { kind: string; id?: string }
  toolId: string
  env?: Record<string, string | undefined>
  cwd?: string
}

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** 从 ctx.cwd（插件目录）向上找出含 `.forgeax/` 的工程根。找不到返回 null。 */
function findProjectRoot(ctx: ToolCtx): string | null {
  let dir = ctx.cwd ?? process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 读当前激活 game 的 slug（`.forgeax/active-game.json`）。无则 null（全局库）。 */
function resolveActiveGameSlug(ctx: ToolCtx): string | null {
  const root = findProjectRoot(ctx)
  if (!root) return null
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, '.forgeax', 'active-game.json'), 'utf-8')) as { slug?: unknown }
    const slug = typeof parsed.slug === 'string' ? parsed.slug : null
    return slug && GAME_SLUG_RE.test(slug) ? slug : null
  } catch {
    return null
  }
}

/** 取有效 slug：显式 args.gameSlug 优先，否则读 active-game。 */
function pickSlug(args: { gameSlug?: string }, ctx: ToolCtx): string | null {
  const explicit = (args.gameSlug ?? '').trim()
  if (explicit) return GAME_SLUG_RE.test(explicit) ? explicit : null
  return resolveActiveGameSlug(ctx)
}

/** GameGraph 落盘目录：仅 `.forgeax/games/<slug>/game-video/`；缺工程根或 slug 则 null。 */
function graphDir(ctx: ToolCtx, slug: string | null): string | null {
  const root = findProjectRoot(ctx)
  if (!slug || !root) return null
  return resolve(root, '.forgeax', 'games', slug, 'game-video')
}

/** 内置 demo（无盘数据时回退的 SSOT 样例）。 */
function demoScenario(ctx: ToolCtx): unknown {
  try {
    const p = resolve(ctx.cwd ?? process.cwd(), 'src', 'editor', 'demo', 'nodia.graph.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

function readJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

interface GraphNodeLike { id?: unknown; type?: unknown; data?: unknown }
interface GraphEdgeLike { id?: unknown; source?: unknown; target?: unknown }
interface ScenarioLike { graph?: { nodes?: GraphNodeLike[]; edges?: GraphEdgeLike[] } }

/**
 * 结构机械校验（不做深层 kind 语义，那走前端 validate.ts）：
 *   - graph.nodes / graph.edges 是数组
 *   - 每个 node 有 string id
 *   - 每条 edge 的 source/target 指向存在的 node id
 * 返回 { errors, warnings }：errors 非空 → 拒绝落盘。
 */
function validateScenario(scenario: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const s = scenario as ScenarioLike | null
  const graph = s?.graph
  if (!graph || typeof graph !== 'object') {
    errors.push('scenario.graph 缺失或不是对象')
    return { errors, warnings }
  }
  const nodes = graph.nodes
  const edges = graph.edges
  if (!Array.isArray(nodes)) errors.push('graph.nodes 必须是数组')
  if (!Array.isArray(edges)) errors.push('graph.edges 必须是数组')
  if (errors.length) return { errors, warnings }

  const ids = new Set<string>()
  ;(nodes as GraphNodeLike[]).forEach((n, i) => {
    if (typeof n?.id !== 'string' || !n.id) {
      errors.push(`节点[${i}] 缺少 string id`)
      return
    }
    if (ids.has(n.id)) errors.push(`节点 id 重复：${n.id}`)
    ids.add(n.id)
  })
  ;(edges as GraphEdgeLike[]).forEach((e, i) => {
    if (typeof e?.source !== 'string' || typeof e?.target !== 'string') {
      errors.push(`边[${i}] 缺少 string source/target`)
      return
    }
    if (!ids.has(e.source)) errors.push(`边[${i}] source 指向不存在的节点：${e.source}`)
    if (!ids.has(e.target)) errors.push(`边[${i}] target 指向不存在的节点：${e.target}`)
  })
  if ((nodes as GraphNodeLike[]).length === 0) warnings.push('图为空（0 节点）')
  return { errors, warnings }
}

export const tools = {
  /**
   * 读取当前 game 的 GameGraph。无盘数据时回退到内置 demo。
   * args: { gameSlug? }
   */
  'gvid:get-graph': async (args: { gameSlug?: string }, ctx: ToolCtx) => {
    const slug = pickSlug(args, ctx)
    const dir = graphDir(ctx, slug)
    const container = dir
      ? (readJson(resolve(dir, 'scenarios.graph.json')) as { items?: { scenario?: unknown }[] } | null)
      : null
    const scenario = container?.items?.[0]?.scenario ?? demoScenario(ctx)
    return { scenario, source: container ? 'disk' : 'demo', gameSlug: slug }
  },

  /**
   * 覆盖写当前 game 的 GameGraph（整本），并压一版快照（留 10）。
   * 落盘前做结构校验，errors 非空则拒绝。
   * args: { gameSlug?, scenario, title? }
   */
  'gvid:save-graph': async (
    args: { gameSlug?: string; scenario: unknown; title?: string },
    ctx: ToolCtx,
  ) => {
    if (!args?.scenario) return { ok: false, errors: ['缺少 scenario'] }
    const { errors, warnings } = validateScenario(args.scenario)
    if (errors.length) return { ok: false, errors, warnings }

    const slug = pickSlug(args, ctx)
    const dir = graphDir(ctx, slug)
    if (!dir) return { ok: false, errors: ['无 .forgeax 工程根或无效 gameSlug，无法落盘'] }

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const canonical = resolve(dir, 'scenarios.graph.json')
    const vDir = resolve(dir, 'scenarios.graph.versions')
    const indexPath = resolve(vDir, 'index.json')

    const scenario = args.scenario as { id?: string }
    const id = scenario.id ?? 'graph'
    const title = (args.title ?? 'graph').slice(0, 120)
    writeFileSync(canonical, JSON.stringify({ version: 1, activeId: id, items: [{ id, title, scenario }] }, null, 2))
    if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true })
    const vid = `v-${Date.now().toString(36)}`
    writeFileSync(resolve(vDir, `${vid}.json`), JSON.stringify(scenario))
    const prev = (readJson(indexPath) as { id: string; savedAt: number }[]) ?? []
    const index = [{ id: vid, savedAt: Date.now() }, ...prev].slice(0, 10)
    writeFileSync(indexPath, JSON.stringify(index))
    return { ok: true, warnings, versions: index, gameSlug: slug }
  },

  /**
   * 列出内置演出视频库（`src/editor/assets/zhandou/*.mp4` 的 basename，去扩展名）——
   * 供 AI 编排时知道有哪些 media.ref 可绑。
   */
  'gvid:list-videos': async (_args: Record<string, never>, ctx: ToolCtx) => {
    try {
      const dir = resolve(ctx.cwd ?? process.cwd(), 'src', 'editor', 'assets', 'zhandou')
      const videos = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.mp4'))
        .map((f) => f.replace(/\.mp4$/i, ''))
        .sort()
      return { videos }
    } catch (e) {
      return { videos: [], error: String(e) }
    }
  },
}

export default tools
