/**
 * scenarioTrash —— 持久化的「误删保护 / 回收站」。
 *
 * 背景（作者诉求 2026-06）：
 *   - zundo 的撤销栈是内存栈，刷新即清空 → 误删后只要刷过页面就找不回。
 *   - 「历史」下拉按 scenario.id upsert 覆盖，同一本剧本里的删改不会留版本，也救不回。
 *
 * 本模块做的事（与 zundo 解耦、跨刷新存活）：
 *   1) 监听剧本变化，一旦「实质内容缩水」（删场景 / 删镜 / 删台词 / 清时间轴 …），
 *      就把**删除前**那一份整本剧本拍一张快照，存进一个有上限的环形缓冲（localStorage）。
 *   2) 提供 listTrash() / restoreSnapshot(id) 给 UI：一键回滚到删除前的版本，
 *      回滚本身也先给当前态拍照，所以「恢复」也可逆。
 *
 * 为什么用「内容缩水检测」而不是逐个 hook 删除 action：
 *   - 删除入口很多（removeScene/removeShot/removeDialogue/removeBranch/clearSceneTimeline…），
 *     逐个埋点既漏又乱。用 scoreSubstantive(prev) > scoreSubstantive(next) 一处判定，
 *     任何让内容变少的操作都会被自动兜住。
 *
 * 存储：localStorage（按 game 隔离），刷新/重开都在；剧本 JSON 只存 mediaId 引用（不内联
 * 二进制），单份约几十 KB，环上限 DEFAULT_MAX 张总量可控；写超配额时自动减半（与 saveDb 一致）。
 */
import type { Scenario } from './types'
import { scoreSubstantive } from './scenarioPersist'
import { sanitizeScenarioForIO } from './sanitize'
import { gameKeySuffix } from '../shell/gameScope'
import { useScenarioStore } from './scenarioStore'

const STORAGE_KEY = 'reel-studio:trash:v1'
const DEFAULT_MAX = 15

export interface TrashSnapshot {
  /** 快照唯一 id */
  id: string
  /** 来源剧本 id（恢复时只覆盖同一本剧本的当前态） */
  scenarioId: string
  title: string
  /** 拍照时间戳（ms） */
  takenAt: number
  /** 人话描述「这次删了什么」，如「删除前备份 · 场景 5→4」 */
  reason: string
  /** 拍照时的实质内容评分（scoreSubstantive），UI 可用来提示丰满度 */
  score: number
  scenario: Scenario
}

export interface TrashDb {
  version: 1
  snapshots: TrashSnapshot[]
}

export function emptyTrash(): TrashDb {
  return { version: 1, snapshots: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数（可单测）
// ─────────────────────────────────────────────────────────────────────────────

function newId(now: number): string {
  return `trash-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface PushOpts {
  reason: string
  now?: number
  max?: number
}

/**
 * 把一份 scenario 拍照压进环形缓冲（最新在前，超上限丢最老）。
 * 进库前 sanitize（防 apiKey/apiBase 留底，与历史库一致）。
 */
export function pushSnapshot(
  db: TrashDb,
  scenario: Scenario,
  opts: PushOpts,
): TrashDb {
  const now = opts.now ?? Date.now()
  const max = opts.max ?? DEFAULT_MAX
  const clean = sanitizeScenarioForIO(scenario)
  const snap: TrashSnapshot = {
    id: newId(now),
    scenarioId: clean.id,
    title: clean.title,
    takenAt: now,
    reason: opts.reason,
    score: scoreSubstantive(clean),
    scenario: clean,
  }
  const snapshots = [snap, ...db.snapshots].slice(0, Math.max(1, max))
  return { version: 1, snapshots }
}

/** 统计一份剧本的几项「条目数」，用于人话化「删了什么」。 */
function tallyScenario(s: Scenario): {
  scenes: number
  shots: number
  dialogue: number
  branches: number
  characters: number
  locations: number
  props: number
} {
  const scenes = s.scenes ?? {}
  let shots = 0
  let dialogue = 0
  let branches = 0
  for (const sc of Object.values(scenes)) {
    shots += (sc as { shots?: unknown[] }).shots?.length ?? 0
    dialogue += (sc as { dialogue?: unknown[] }).dialogue?.length ?? 0
    branches += (sc as { branches?: unknown[] }).branches?.length ?? 0
  }
  return {
    scenes: Object.keys(scenes).length,
    shots,
    dialogue,
    branches,
    characters: Object.keys((s as { characters?: object }).characters ?? {}).length,
    locations: Object.keys((s as { locations?: object }).locations ?? {}).length,
    props: Object.keys((s as { props?: object }).props ?? {}).length,
  }
}

const SHRINK_DIMS: Array<[keyof ReturnType<typeof tallyScenario>, string]> = [
  ['scenes', '场景'],
  ['characters', '角色'],
  ['locations', '场景设定'],
  ['props', '道具'],
  ['shots', '镜头'],
  ['dialogue', '台词'],
  ['branches', '分支'],
]

/**
 * prev→next 是否「内容缩水」（任一结构维度的条目数变少 = 发生了删除）。
 * 返回人话描述（挑第一个减少的维度），没缩水则返回 null。
 *
 * 不用 scoreSubstantive 判定缩水：它只数场景**内**的内容（media/keyframe/台词…），
 * 不数场景/镜头等**条目数**，删空场景、删无关键帧的镜头都漏判。结构化条目统计更稳。
 */
export function shrinkReason(prev: Scenario, next: Scenario): string | null {
  const a = tallyScenario(prev)
  const b = tallyScenario(next)
  for (const [k, label] of SHRINK_DIMS) {
    if (b[k] < a[k]) return `删除前备份 · ${label} ${a[k]}→${b[k]}`
  }
  return null
}

/** 描述 prev→next「变少了什么」（缩水时用）；没缩水回退通用文案。 */
export function describeShrink(prev: Scenario, next: Scenario): string {
  return shrinkReason(prev, next) ?? '删除前备份'
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage IO
// ─────────────────────────────────────────────────────────────────────────────

function storageKey(): string {
  return `${STORAGE_KEY}${gameKeySuffix()}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function deserialize(raw: string | null | undefined): TrashDb {
  if (!raw) return emptyTrash()
  try {
    const parsed = JSON.parse(raw) as Partial<TrashDb>
    if (!parsed || typeof parsed !== 'object') return emptyTrash()
    if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) return emptyTrash()
    const snapshots: TrashSnapshot[] = []
    for (const it of parsed.snapshots) {
      if (
        it &&
        typeof it.id === 'string' &&
        typeof it.scenarioId === 'string' &&
        typeof it.takenAt === 'number' &&
        it.scenario &&
        typeof it.scenario === 'object'
      ) {
        snapshots.push({
          id: it.id,
          scenarioId: it.scenarioId,
          title: typeof it.title === 'string' ? it.title : '未命名',
          takenAt: it.takenAt,
          reason: typeof it.reason === 'string' ? it.reason : '删除前备份',
          score: typeof it.score === 'number' ? it.score : 0,
          scenario: it.scenario,
        })
      }
    }
    return { version: 1, snapshots }
  } catch {
    return emptyTrash()
  }
}

export function loadTrash(): TrashDb {
  const ls = getStorage()
  if (!ls) return emptyTrash()
  try {
    return deserialize(ls.getItem(storageKey()))
  } catch {
    return emptyTrash()
  }
}

export function saveTrash(db: TrashDb): void {
  const ls = getStorage()
  if (!ls) return
  const key = storageKey()
  try {
    ls.setItem(key, JSON.stringify(db))
  } catch (e) {
    // 配额不足：环减半重试，再不行只留最新一张，绝不抛（误删保护是增强、不应阻断编辑）。
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      const half = Math.max(1, Math.floor(db.snapshots.length / 2))
      const trimmed: TrashDb = { version: 1, snapshots: db.snapshots.slice(0, half) }
      try {
        ls.setItem(key, JSON.stringify(trimmed))
      } catch {
        try {
          ls.setItem(
            key,
            JSON.stringify({
              version: 1,
              snapshots: db.snapshots.slice(0, 1),
            } satisfies TrashDb),
          )
        } catch {
          /* 放弃 —— 不影响编辑 */
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 捕获 hook（由 scenarioPersistBoot 的 store 订阅调用）
// ─────────────────────────────────────────────────────────────────────────────

/** 跳过下一次自动捕获 —— restore 时手动备份了当前态，避免订阅再重复拍一张。 */
let _skipNext = false

export function skipNextTrashCapture(): void {
  _skipNext = true
}

/**
 * 剧本从 prev 变到 next 时调用：仅当「同一本剧本 + 实质内容缩水」才把 prev 拍照入库。
 * 切换剧本（id 变）、内容没变少、系统驱动的恢复（_skipNext）都不拍。
 */
export function captureTrashOnChange(prev: Scenario, next: Scenario): void {
  if (_skipNext) {
    _skipNext = false
    return
  }
  if (!prev || !next) return
  if (prev.id !== next.id) return
  const reason = shrinkReason(prev, next)
  if (!reason) return
  const db = pushSnapshot(loadTrash(), prev, { reason })
  saveTrash(db)
}

// ─────────────────────────────────────────────────────────────────────────────
// 提供给 UI 的查询 / 恢复接口
// ─────────────────────────────────────────────────────────────────────────────

export function listTrash(): TrashSnapshot[] {
  return loadTrash().snapshots
}

/**
 * 恢复某张快照 = 把当前剧本回滚到拍照时那一份。
 *   - 恢复前先给「当前态」也拍一张（reason=恢复前自动备份），让恢复本身可逆。
 *   - 用普通 loadScenario（会被持久化订阅写盘），并 skipNextTrashCapture 避免重复入库。
 * 只允许恢复「与当前同一本剧本」的快照，避免一键把整个工坊换成另一本剧本造成困惑。
 */
export function restoreSnapshot(id: string): boolean {
  const db = loadTrash()
  const snap = db.snapshots.find((s) => s.id === id)
  if (!snap) return false
  const current = useScenarioStore.getState().scenario
  if (current.id !== snap.scenarioId) return false
  const withCurrent = pushSnapshot(db, current, { reason: '恢复前自动备份' })
  saveTrash(withCurrent)
  skipNextTrashCapture()
  useScenarioStore.getState().loadScenario(snap.scenario)
  return true
}

export function clearTrash(): void {
  saveTrash(emptyTrash())
}

export function __resetTrashForTest(): void {
  _skipNext = false
  const ls = getStorage()
  if (ls) {
    try {
      ls.removeItem(storageKey())
    } catch {
      /* ignore */
    }
  }
}
