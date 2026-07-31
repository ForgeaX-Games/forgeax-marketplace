/**
 * 图存储客户端 —— 走 handshake 绑定的 Workbench package client。
 *
 *   · 唯一真相（玩法）= `GraphLibraryDocument`，落盘为游戏仓 `blueprint.json`。
 *   · 保存：写入完整 package 的 blueprint patch。
 *   · 读取：返回 `{ project, blueprint, assetsManifest }`。
 *   · 未保存草稿只在 localStorage。
 *
 */
import { getWorkbenchHost } from '../../lib/workbench-host'
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'

/** 保留类型以兼容既有 import；game-host 版本载体是 git tag。 */
export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** 磁盘最新已保存文档（package.blueprint）。 */
  project: GraphLibraryDocument | null
  /** localStorage 未保存草稿。 */
  draft: GraphLibraryDocument | null
  /** 兼容字段；game-host 下恒为空，版本查询走独立的 git-tag API。 */
  versions: VersionEntry[]
}

export interface CurrentVersion {
  tag: string | null
  commitHash: string | null
  dirty: boolean
}

/** 游戏仓 git 版本条目（tag = vN）。 */
export interface GameVersion {
  tag: string
  commitHash: string
  createdAt: string
  message: string
}

function acceptedGameId(game: string): string {
  if (typeof game !== 'string' || game.length === 0) {
    throw new TypeError('Accepted game id is required')
  }
  return game
}

const draftKey = (game: string) => `wb-game-video:graph:${acceptedGameId(game)}:draft`

function packageBlueprint(value: unknown): GraphLibraryDocument | null {
  if (!value || typeof value !== 'object') return null
  const blueprint = (value as { blueprint?: unknown }).blueprint
  return blueprint && typeof blueprint === 'object' ? blueprint as GraphLibraryDocument : null
}

function isLibraryDocument(value: unknown): value is GraphLibraryDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = (value as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const candidate = manifest as { mainPackId?: unknown; packs?: unknown }
  return (
    typeof candidate.mainPackId === 'string'
    && candidate.mainPackId.length > 0
    && candidate.packs !== null
    && typeof candidate.packs === 'object'
    && !Array.isArray(candidate.packs)
  )
}

function currentVersionValue(value: unknown): CurrentVersion | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { tag?: unknown; commitHash?: unknown; dirty?: unknown }
  if (typeof candidate.tag !== 'string' || typeof candidate.commitHash !== 'string') return null
  return {
    tag: candidate.tag,
    commitHash: candidate.commitHash,
    dirty: candidate.dirty === true,
  }
}

function gameVersionValue(value: unknown): GameVersion | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    tag?: unknown
    commitHash?: unknown
    createdAt?: unknown
    message?: unknown
  }
  if (
    typeof candidate.tag !== 'string'
    || typeof candidate.commitHash !== 'string'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.message !== 'string'
  ) return null
  return {
    tag: candidate.tag,
    commitHash: candidate.commitHash,
    createdAt: candidate.createdAt,
    message: candidate.message,
  }
}

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

export async function loadStore(game: string): Promise<GraphStore> {
  acceptedGameId(game)
  const project = packageBlueprint(await getWorkbenchHost().gamePackage.load())
  if (!isLibraryDocument(project)) {
    throw new TypeError('Host package blueprint is missing or invalid')
  }
  return { project, draft: readLocal<GraphLibraryDocument>(draftKey(game)), versions: [] }
}

/**
 * 原子 patch blueprint；宿主在 package lock 内只改对应文件，不覆盖 project/manifest。
 * 返回 { ok } —— PUT 成功清草稿。失败保留草稿由调用方回滚 UI。
 */
export async function saveProject(project: GraphLibraryDocument, game: string): Promise<{ ok: boolean }> {
  acceptedGameId(game)
  try {
    await getWorkbenchHost().gamePackage.save({ blueprint: project })
    removeLocal(draftKey(game))
    return { ok: true }
  } catch {
    /* 离线/无宿主 → best-effort */
  }
  return { ok: false }
}

/** 打一个新版本（游戏仓 git annotated tag vN）。返回新 tag 或 null。 */
export async function commitVersion(game: string, message?: string): Promise<CurrentVersion | null> {
  acceptedGameId(game)
  const versions = getWorkbenchHost().versions
  if (!versions.supported()) return null
  try {
    const created = currentVersionValue(await versions.create(message ?? ''))
    return created ? { ...created, dirty: false } : null
  } catch {
    return null
  }
}

/** 读当前最新版本（tag + hash + dirty）。无宿主/无仓 → 全 null。 */
export async function currentVersion(game: string): Promise<CurrentVersion> {
  acceptedGameId(game)
  const versions = getWorkbenchHost().versions
  if (!versions.supported()) return { tag: null, commitHash: null, dirty: false }
  try {
    return currentVersionValue(await versions.current()) ?? { tag: null, commitHash: null, dirty: false }
  } catch {
    return { tag: null, commitHash: null, dirty: false }
  }
}

/** 列出该游戏所有版本（vN，最新在前）。无宿主/无仓 → []。 */
export async function listVersions(game: string): Promise<GameVersion[]> {
  acceptedGameId(game)
  const versions = getWorkbenchHost().versions
  if (!versions.supported()) return []
  try {
    const value = await versions.list()
    return Array.isArray(value)
      ? value.map(gameVersionValue).filter((entry): entry is GameVersion => entry !== null)
      : []
  } catch {
    return []
  }
}

/**
 * 读某个版本 tag 的 blueprint（只读 `git show`，不 checkout、不改历史）。
 * 用于「载入旧版到编辑器」——载入后由用户再保存成新版本。
 */
export async function loadVersionProject(game: string, tag: string): Promise<GraphLibraryDocument | null> {
  acceptedGameId(game)
  const versions = getWorkbenchHost().versions
  if (!versions.supported()) return null
  try {
    return packageBlueprint(await versions.loadPackage(tag))
  } catch {
    return null
  }
}

export function saveDraft(project: GraphLibraryDocument, game: string): void {
  writeLocal(draftKey(game), project)
}

export function clearDraft(game: string): void {
  removeLocal(draftKey(game))
}

export function loadDraft(game: string): GraphLibraryDocument | null {
  return readLocal<GraphLibraryDocument>(draftKey(game))
}
