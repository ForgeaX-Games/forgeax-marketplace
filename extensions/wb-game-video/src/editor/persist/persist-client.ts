/**
 * 图存储客户端 —— 保存模型（v6，单文件蓝图库）：
 *   · **唯一真相 = `GraphLibraryDocument`**（原 scenario 形状 + `manifest`，含 main 与全部子蓝图）。
 *   · **出厂原始 demo = 插件内只读 `demo/nodia.graph.json`**，永不被编辑改动。
 *   · **主动保存**：写 `.forgeax/games/<slug>/game-video/scenarios.graph.json` + 版本快照（留 10）。
 *   · **未保存草稿只在 localStorage**。
 *   · **进入优先级**：草稿 > 磁盘最新 > demo。
 */
import { pluginFetch } from '../../lib/plugin-http'
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'

export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** 磁盘最新已保存文档。 */
  project: GraphLibraryDocument | null
  /** localStorage 未保存草稿。 */
  draft: GraphLibraryDocument | null
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

export async function loadStore(game?: string): Promise<GraphStore> {
  let project: GraphLibraryDocument | null = null
  let versions: VersionEntry[] = []
  try {
    const r = await pluginFetch(`${BASE}/store${gq(game)}`)
    if (r.ok) {
      const j = (await r.json()) as { project?: GraphLibraryDocument | null; versions?: VersionEntry[] }
      project = j.project ?? null
      versions = j.versions ?? []
    }
  } catch {
    /* 离线/无端点 → 无磁盘数据 */
  }
  return { project, draft: readLocal<GraphLibraryDocument>(draftKey(game)), versions }
}

export async function saveProject(project: GraphLibraryDocument, game?: string): Promise<VersionEntry[]> {
  try {
    const r = await pluginFetch(`${BASE}/store${gq(game)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, title: '战斗蓝图(graph)' }),
    })
    if (r.ok) {
      removeLocal(draftKey(game))
      return ((await r.json()) as { versions?: VersionEntry[] }).versions ?? []
    }
  } catch {
    /* 离线/无端点 → best-effort */
  }
  return []
}

export function saveDraft(project: GraphLibraryDocument, game?: string): void {
  writeLocal(draftKey(game), project)
}

export function clearDraft(game?: string): void {
  removeLocal(draftKey(game))
}

export function loadDraft(game?: string): GraphLibraryDocument | null {
  return readLocal<GraphLibraryDocument>(draftKey(game))
}

export async function loadVersion(id: string, game?: string): Promise<GraphLibraryDocument | null> {
  try {
    const qs = new URLSearchParams({ ...(game ? { game } : {}), id }).toString()
    const r = await pluginFetch(`${BASE}/version?${qs}`)
    if (r.ok) return ((await r.json()) as { project?: GraphLibraryDocument | null }).project ?? null
  } catch {
    /* best-effort */
  }
  return null
}
