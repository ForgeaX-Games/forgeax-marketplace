/**
 * 图存储客户端 —— 保存模型（2026-07-09 用户定案，v4）：
 *   · **出厂原始 demo = 插件内只读 `demo/nodia.graph.json`**（见 demo.ts），永不被编辑改动。
 *   · **主动保存的版本落盘**：`保存` → 写 `.forgeax/games/<slug>/game-video/scenarios.graph.json`（权威最新）
 *     + 版本快照到 `scenarios.graph.versions/`（留最近 10），经服务端 `/__graph__` 端点。
 *   · **未保存草稿只在 localStorage**（轻量 autosave，不落盘、不参与执行）。
 *   · **进入优先级**：localStorage 草稿 > 磁盘最新已保存版本 > demo（由 store 回落）。
 *   · **重置** = 用 demo 替换当前编辑内容。
 */
import type { GameScenario } from '../../runtime/schema/graph-schema'

export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** 磁盘最新已保存版本（canonical scenarios.graph.json）。 */
  scenario: GameScenario | null
  /** localStorage 未保存草稿。 */
  draft: GameScenario | null
  /** 磁盘版本索引（最近 10，最新在前）。 */
  versions: VersionEntry[]
}

const BASE = '/__graph__'
const gq = (game?: string) => (game ? `?game=${encodeURIComponent(game)}` : '')
const draftKey = (game?: string) => `gamevideo:graph:${game ?? 'default'}:draft`

function readLocal<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key)
    return s ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}
function writeLocal(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* quota / SSR：best-effort */
  }
}
function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* best-effort */
  }
}

/** boot：磁盘取最新已保存版本 + 版本索引；localStorage 取未保存草稿（demo 回落由 store 处理）。 */
export async function loadStore(game?: string): Promise<GraphStore> {
  let scenario: GameScenario | null = null
  let versions: VersionEntry[] = []
  try {
    const r = await fetch(`${BASE}/store${gq(game)}`)
    if (r.ok) {
      const j = (await r.json()) as { scenario?: GameScenario | null; versions?: VersionEntry[] }
      scenario = j.scenario ?? null
      versions = j.versions ?? []
    }
  } catch {
    /* 离线/无端点 → 无磁盘数据 */
  }
  return { scenario, draft: readLocal<GameScenario>(draftKey(game)), versions }
}

/**
 * 保存：把当前图作为**新版本落盘**到 `.forgeax/games/<slug>/game-video/`（权威 scenarios.graph.json +
 * 版本快照，留最近 10）并清掉未保存草稿。返回磁盘版本索引。
 */
export async function saveScenario(scenario: GameScenario, game?: string): Promise<VersionEntry[]> {
  removeLocal(draftKey(game))
  try {
    const r = await fetch(`${BASE}/store${gq(game)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario, id: 'nodia-graph', title: '战斗蓝图(graph)' }),
    })
    if (r.ok) return ((await r.json()) as { versions?: VersionEntry[] }).versions ?? []
  } catch {
    /* 离线/无端点 → best-effort */
  }
  return []
}

/** 轻量草稿：编辑期把当前图写进 localStorage（不写盘、不参与执行）。 */
export function saveDraft(scenario: GameScenario, game?: string): void {
  writeLocal(draftKey(game), scenario)
}

/** 丢弃未保存草稿（如重置为 demo 后）。 */
export function clearDraft(game?: string): void {
  removeLocal(draftKey(game))
}

/** 取回 localStorage 未保存草稿（供"未保存草稿"下拉项重新载入）。 */
export function loadDraft(game?: string): GameScenario | null {
  return readLocal<GameScenario>(draftKey(game))
}

/** 从磁盘版本快照取回某版本的完整 scenario。 */
export async function loadVersion(id: string, game?: string): Promise<GameScenario | null> {
  try {
    const qs = new URLSearchParams({ ...(game ? { game } : {}), id }).toString()
    const r = await fetch(`${BASE}/version?${qs}`)
    if (r.ok) return ((await r.json()) as { scenario?: GameScenario | null }).scenario ?? null
  } catch {
    /* best-effort */
  }
  return null
}
