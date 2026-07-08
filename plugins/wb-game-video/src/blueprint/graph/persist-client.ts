/**
 * 图存储客户端 —— 保存模型（2026-07-08 用户定案，v3）：
 *   · **出厂原始 demo = 插件内只读 `demo/nodia.graph.json`**（见 demo.ts），永不被编辑改动。
 *   · **用户的一切编辑（已保存版本(最近 5) + 未保存草稿）全在 localStorage**。
 *   · **进入优先级**：localStorage 草稿（正在编辑）> localStorage 最新版本 > demo（由 store 回落）。
 *   · **保存** = 把当前图作为一个新版本推入 localStorage（并清草稿），**不写磁盘**。
 *   · **重置** = 用 demo（= 原始数据）替换当前编辑内容。
 * game 目录下的 `scenarios.graph.json` 由运行时自动落盘，编辑器既不读也不写。
 */
import type { GameScenario } from './graph-schema'

export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** localStorage 未保存草稿。 */
  draft: GameScenario | null
  /** localStorage 最新已保存版本的完整 scenario。 */
  latestVersion: GameScenario | null
  /** localStorage 版本元信息（最近 5，最新在前）。 */
  versions: VersionEntry[]
}

const nsKey = (kind: 'draft' | 'versions', game?: string) => `gamevideo:graph:${game ?? 'default'}:${kind}`
const MAX_VERSIONS = 5

/** localStorage 里的完整版本快照（含 scenario；对上层只暴露 VersionEntry 元信息）。 */
interface LocalVersion extends VersionEntry {
  scenario: GameScenario
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

/** boot：localStorage 取草稿 + 最新版本 + 版本元信息（demo 回落由 store 处理）。 */
export async function loadStore(game?: string): Promise<GraphStore> {
  const draft = readLocal<GameScenario>(nsKey('draft', game))
  const localVersions = readLocal<LocalVersion[]>(nsKey('versions', game)) ?? []
  return {
    draft,
    latestVersion: localVersions[0]?.scenario ?? null,
    versions: localVersions.map(({ id, savedAt }) => ({ id, savedAt })),
  }
}

/**
 * 保存：把当前图作为**新版本推入 localStorage**（留最近 5）并清掉未保存草稿。
 * **绝不写磁盘** —— `scenarios.graph.json` 始终保持原始不变。返回最新版本列表（元信息）。
 */
export function saveScenario(scenario: GameScenario, game?: string): VersionEntry[] {
  const key = nsKey('versions', game)
  const prev = readLocal<LocalVersion[]>(key) ?? []
  const entry: LocalVersion = { id: `v-${Date.now().toString(36)}`, savedAt: Date.now(), scenario }
  const next = [entry, ...prev].slice(0, MAX_VERSIONS)
  writeLocal(key, next)
  removeLocal(nsKey('draft', game))
  return next.map(({ id: vid, savedAt }) => ({ id: vid, savedAt }))
}

/** 轻量草稿：编辑期把当前图写进 localStorage（不写盘、不参与执行）。 */
export function saveDraft(scenario: GameScenario, game?: string): void {
  writeLocal(nsKey('draft', game), scenario)
}

/** 丢弃未保存草稿（如重置为 demo 后）。 */
export function clearDraft(game?: string): void {
  removeLocal(nsKey('draft', game))
}

/** 取回 localStorage 未保存草稿（供"未保存草稿"下拉项重新载入）。 */
export function loadDraft(game?: string): GameScenario | null {
  return readLocal<GameScenario>(nsKey('draft', game))
}

/** 从 localStorage 版本栈取回某版本的完整 scenario。 */
export function loadVersion(id: string, game?: string): GameScenario | null {
  const versions = readLocal<LocalVersion[]>(nsKey('versions', game)) ?? []
  return versions.find((v) => v.id === id)?.scenario ?? null
}
