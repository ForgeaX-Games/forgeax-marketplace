/**
 * 图存储客户端 —— 走 forgeax 宿主 **game-host API**（不再是扩展 Vite `/__graph__`）。
 * SSOT：docs/superpowers/specs/2026-07-22-game-host-api-design.md
 *
 *   · 唯一真相（玩法）= `GraphLibraryDocument`，落盘为游戏仓 `blueprint.json`。
 *   · 保存：`PUT /api/game-host/games/<slug>/package`（一次事务写 project/blueprint/manifest）。
 *   · 读取：`GET .../package` → `{ project, blueprint, assetsManifest }`。
 *   · 打版本：`POST .../versions` → 游戏仓 annotated tag `vN`（产品只用最新，不回退）。
 *   · 未保存草稿只在 localStorage。
 *
 * dev 下扩展 iframe 由自身 vite 提供，`/api/*` 经 `vite.config.ts` proxy 转发到 forgeax
 * server；prod 下扩展由 server 静态托管（`/extensions/...`），`/api/*` 同源直达。
 */
import { pluginFetch } from '../../lib/plugin-http'
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'

/** 保留类型以兼容既有 import；game-host 版本载体是 git tag，不再是 keep-10 条目。 */
export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** 磁盘最新已保存文档（package.blueprint）。 */
  project: GraphLibraryDocument | null
  /** localStorage 未保存草稿。 */
  draft: GraphLibraryDocument | null
  /** 版本条目（game-host 下恒为空——版本走 git tag，UI 不再列 keep-10）。 */
  versions: VersionEntry[]
}

export interface CurrentVersion {
  tag: string | null
  commitHash: string | null
  dirty: boolean
}

const BASE = '/api/game-host/games'
const seg = (game?: string) => encodeURIComponent(game ?? 'default')
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
  try {
    const r = await pluginFetch(`${BASE}/${seg(game)}/package`)
    if (r.ok) {
      const j = (await r.json()) as { blueprint?: GraphLibraryDocument | null }
      project = j.blueprint ?? null
    }
  } catch {
    /* 离线/无宿主 → 无磁盘数据 */
  }
  return { project, draft: readLocal<GraphLibraryDocument>(draftKey(game)), versions: [] }
}

/**
 * 保存整包（当前只回写 blueprint；project/manifest 由宿主保留或补齐）。
 * 返回 { ok } —— PUT 成功清草稿。失败保留草稿由调用方回滚 UI。
 */
export async function saveProject(project: GraphLibraryDocument, game?: string): Promise<{ ok: boolean }> {
  try {
    const r = await pluginFetch(`${BASE}/${seg(game)}/package`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: project }),
    })
    if (r.ok) {
      removeLocal(draftKey(game))
      return { ok: true }
    }
  } catch {
    /* 离线/无宿主 → best-effort */
  }
  return { ok: false }
}

/** 打一个新版本（游戏仓 git annotated tag vN）。返回新 tag 或 null。 */
export async function commitVersion(game?: string, message?: string): Promise<CurrentVersion | null> {
  try {
    const r = await pluginFetch(`${BASE}/${seg(game)}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message ? { message } : {}),
    })
    if (r.ok) {
      const j = (await r.json()) as { tag?: string; commitHash?: string }
      return { tag: j.tag ?? null, commitHash: j.commitHash ?? null, dirty: false }
    }
  } catch {
    /* best-effort */
  }
  return null
}

/** 读当前最新版本（tag + hash + dirty）。无宿主/无仓 → 全 null。 */
export async function currentVersion(game?: string): Promise<CurrentVersion> {
  try {
    const r = await pluginFetch(`${BASE}/${seg(game)}/versions/current`)
    if (r.ok) return (await r.json()) as CurrentVersion
  } catch {
    /* best-effort */
  }
  return { tag: null, commitHash: null, dirty: false }
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
