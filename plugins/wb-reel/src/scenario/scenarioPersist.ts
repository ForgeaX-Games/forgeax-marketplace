import type { Scenario } from './types'
import { sanitizeScenarioForIO } from './sanitize'
import { gameKeySuffix } from '../shell/gameScope'

/**
 * 剧本持久化 —— localStorage 适配层。
 *
 * 真实 bug 现场：用户辛苦贴 5K 字剧本、锻造、批量生图，浏览器一刷新整棵
 * 剧情树没了；assetStore 因为走后端 API 落到磁盘还在，但 store 内存状态消失。
 *
 * 修法：
 *   1) 每次 scenario 变化 debounce 写 localStorage（key = scenario.id 去重）
 *   2) boot 时读取最新一份恢复，没有再走 demo
 *   3) 历史下拉让作者主动切版本（每次锻造都 push 一份，按 id 唯一）
 *
 * 设计要点：
 *   - 这层是**纯函数库**：所有操作都是 (db, ...args) → newDb，方便单测
 *   - load/save 是薄壳，对外只暴露 loadDb()/saveDb(db)
 *   - max 默认 20：单个 scenario JSON ~50-200KB，20 个 ~1-4MB，远低于 5MB 上限
 */

const STORAGE_KEY = 'reel-studio:scenarios:v1'
const DEFAULT_MAX = 20

/**
 * 实际写入的 localStorage key —— 按当前 game 隔离。
 * 无 game（全局库）时退回基础 key，与历史完全一致；有 game 时加 `:game:<slug>`
 * 后缀，让每个工程拥有独立的剧本历史与 activeId。
 */
function storageKeyForGame(): string {
  return `${STORAGE_KEY}${gameKeySuffix()}`
}

export interface PersistedItem {
  id: string
  title: string
  scenario: Scenario
  /** 第一次保存时间 */
  createdAt: number
  /** 最近一次写入时间（按此排序） */
  updatedAt: number
}

export interface PersistedDb {
  version: 1
  /** 当前在编辑的 scenario id；null 表示作者还没存过任何剧本（demo 状态） */
  activeId: string | null
  /** 按 updatedAt desc 排序，最新在前 */
  items: PersistedItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数（可单测）
// ─────────────────────────────────────────────────────────────────────────────

export function emptyDb(): PersistedDb {
  return { version: 1, activeId: null, items: [] }
}

export interface UpsertOpts {
  /** 注入"现在时间"，方便测试 */
  now?: number
  /** history 上限，默认 20 */
  max?: number
}

/**
 * 写入或更新一份 scenario：
 *   - 如果 db 里已有同 id：覆盖原条目（updatedAt 更新，createdAt 保留）
 *   - 否则插到最前；如果超过 max 上限，按 updatedAt 升序剔除最老
 *   - activeId 自动指向新写入的 id
 *   - 副作用：剧本进库前 sanitize 一遍（防 apiKey/apiBase 留底）
 */
export function upsertScenario(
  db: PersistedDb,
  scenario: Scenario,
  opts: UpsertOpts = {},
): PersistedDb {
  const now = opts.now ?? Date.now()
  const max = opts.max ?? DEFAULT_MAX
  const clean = sanitizeScenarioForIO(scenario)

  const existing = db.items.find((it) => it.id === clean.id)
  let nextItem: PersistedItem
  if (existing) {
    nextItem = {
      ...existing,
      title: clean.title,
      scenario: clean,
      updatedAt: now,
    }
  } else {
    nextItem = {
      id: clean.id,
      title: clean.title,
      scenario: clean,
      createdAt: now,
      updatedAt: now,
    }
  }

  const others = db.items.filter((it) => it.id !== clean.id)
  let items = [nextItem, ...others].sort((a, b) => b.updatedAt - a.updatedAt)
  if (items.length > max) {
    items = items.slice(0, max)
  }

  return { version: 1, activeId: clean.id, items }
}

export function pickActive(db: PersistedDb): PersistedItem | null {
  if (!db.activeId) return null
  return db.items.find((it) => it.id === db.activeId) ?? null
}

export function pickRecent(db: PersistedDb, n = 10): PersistedItem[] {
  return db.items.slice(0, n)
}

export function setActive(db: PersistedDb, id: string): PersistedDb {
  if (!db.items.find((it) => it.id === id)) return db
  return { ...db, activeId: id }
}

export function removeFromDb(db: PersistedDb, id: string): PersistedDb {
  if (!db.items.find((it) => it.id === id)) return db
  const items = db.items.filter((it) => it.id !== id)
  let activeId = db.activeId
  if (activeId === id) {
    activeId = items[0]?.id ?? null
  }
  return { ...db, items, activeId }
}

/**
 * 估算一份 scenario 的"实质数据量"—— 用于冲突时倾向保留"有内容"的版本。
 *
 * 信号维度（加权和，权重纯粹凭 UX 重要度估）：
 *   - 每个场景有 media.ref（已挂载图/视频）+3
 *   - 每个 shot 有 keyframeMediaRef +2
 *   - 每个场景有非空 prompts.scene / prompts.video +1
 *   - 每个场景的 dialogue/branches 条数 +1 each
 *   - characters / locations 条数 +1 each
 *
 * 用来避免"一份刚 boot 的空壳 demo" 用更新的 updatedAt 盖掉"一份有数据但 updatedAt 早几秒"的版本。
 */
export function scoreSubstantive(scenario: Scenario): number {
  let score = 0
  const scenes = scenario.scenes ?? {}
  for (const scene of Object.values(scenes)) {
    const media = scene.media ?? {}
    if (typeof (media as { ref?: string }).ref === 'string' && (media as { ref?: string }).ref) {
      score += 3
    }
    const shots = (scene as { shots?: Array<{ keyframeMediaRef?: string }> }).shots ?? []
    for (const sh of shots) {
      if (sh.keyframeMediaRef) score += 2
    }
    const prompts = (scene as { prompts?: { scene?: string; video?: string } }).prompts ?? {}
    if (prompts.scene?.trim()) score += 1
    if (prompts.video?.trim()) score += 1
    const dialogue = (scene as { dialogue?: unknown[] }).dialogue ?? []
    score += dialogue.length
    const branches = (scene as { branches?: unknown[] }).branches ?? []
    score += branches.length
  }
  const characters = (scenario as { characters?: Record<string, unknown> }).characters ?? {}
  score += Object.keys(characters).length
  const locations = (scenario as { locations?: Record<string, unknown> }).locations ?? {}
  score += Object.keys(locations).length
  return score
}

/**
 * 合并两份 PersistedDb —— 给"磁盘层 + localStorage 层"用。
 *
 * 合并规则：
 *   - 按 item.id 去重
 *   - 同 id 冲突时：
 *     a) 实质性数据优先（scoreSubstantive 差距 >= 5）
 *     b) 否则按 updatedAt 较新者胜
 *   - activeId：优先 primary.activeId，不存在则回落 secondary
 *   - max 钳制：按 updatedAt 降序保留前 max 条
 */
export function mergeDbs(
  primary: PersistedDb,
  secondary: PersistedDb,
  opts: { max?: number } = {},
): PersistedDb {
  const max = opts.max ?? DEFAULT_MAX
  const byId = new Map<string, PersistedItem>()
  for (const it of secondary.items) byId.set(it.id, it)
  for (const it of primary.items) {
    const prev = byId.get(it.id)
    if (!prev) {
      byId.set(it.id, it)
      continue
    }
    const scorePrimary = scoreSubstantive(it.scenario)
    const scorePrev = scoreSubstantive(prev.scenario)
    const SUBSTANTIVE_GAP = 5
    let picked: PersistedItem
    if (scorePrimary - scorePrev >= SUBSTANTIVE_GAP) {
      picked = it
    } else if (scorePrev - scorePrimary >= SUBSTANTIVE_GAP) {
      picked = prev
    } else if (it.updatedAt >= prev.updatedAt) {
      picked = it
    } else {
      picked = prev
    }
    byId.set(it.id, picked)
  }
  let items = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  if (items.length > max) items = items.slice(0, max)

  let activeId: string | null = primary.activeId
  if (!activeId || !items.find((it) => it.id === activeId)) {
    activeId = secondary.activeId
  }
  if (!activeId || !items.find((it) => it.id === activeId)) {
    activeId = items[0]?.id ?? null
  }

  return { version: 1, activeId, items }
}

// ─────────────────────────────────────────────────────────────────────────────
// 序列化 / 反序列化（单测重点：损坏数据要降级为 emptyDb，不能让首屏崩）
// ─────────────────────────────────────────────────────────────────────────────

export function serialize(db: PersistedDb): string {
  return JSON.stringify(db)
}

export function deserialize(raw: string | null | undefined): PersistedDb {
  if (!raw) return emptyDb()
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDb>
    if (!parsed || typeof parsed !== 'object') return emptyDb()
    if (parsed.version !== 1) return emptyDb()
    if (!Array.isArray(parsed.items)) return emptyDb()
    const items: PersistedItem[] = []
    for (const it of parsed.items) {
      if (
        it &&
        typeof it.id === 'string' &&
        typeof it.title === 'string' &&
        it.scenario &&
        typeof it.createdAt === 'number' &&
        typeof it.updatedAt === 'number'
      ) {
        items.push(it as PersistedItem)
      }
    }
    return {
      version: 1,
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
      items,
    }
  } catch {
    return emptyDb()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IO 薄壳 —— localStorage 读写（只在浏览器侧调用）
// ─────────────────────────────────────────────────────────────────────────────

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadDb(): PersistedDb {
  const ls = getStorage()
  if (!ls) return emptyDb()
  try {
    return deserialize(ls.getItem(storageKeyForGame()))
  } catch {
    return emptyDb()
  }
}

export function saveDb(db: PersistedDb): void {
  const ls = getStorage()
  if (!ls) return
  const key = storageKeyForGame()
  try {
    ls.setItem(key, serialize(db))
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      const half = Math.max(1, Math.floor(db.items.length / 2))
      const trimmed: PersistedDb = {
        version: 1,
        activeId: db.activeId,
        items: db.items.slice(0, half),
      }
      try {
        ls.setItem(key, serialize(trimmed))
      } catch {
        const minimal = pickActive(db)
        ls.setItem(
          key,
          serialize(
            minimal
              ? { version: 1, activeId: minimal.id, items: [minimal] }
              : emptyDb(),
          ),
        )
      }
    }
  }
}

export const __PERSIST_KEY__ = STORAGE_KEY
