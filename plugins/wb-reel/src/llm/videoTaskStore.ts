/**
 * `videoTaskStore` —— 视频生成任务的**全局持久化**状态机。
 *
 * 为什么新增：
 *   · 作者反馈："我在视频生成点击视频生成，翻了个页面，回来就没进度了"
 *   · 原因：VideoProvider.generate() 是一个 async 长流程，只在调用它的组件
 *     生命周期内存活；切 tab / unmount → poll 循环消亡 → 进度丢失。
 *   · 修复：把"某场景/shot 正在生成视频"视为应用级状态，存 localStorage，
 *     刷新 / 切面板都能拿回来，组件订阅即可渲染最新进度。
 *
 * 字段设计：
 *   · 以 `taskId`（本地 Flask 服务给的 YYYYMMDD_HHMMSS_xxx）为主键
 *   · 同时冗余 `sceneId` / `shotId` 让组件按场景筛
 *   · `status` 与后端 app.py 约定一致：
 *       queued | generating | downloading | completed | failed | interrupted
 *   · `lastMessage` / `elapsedMs` 供 UI 显示"status=running · 38s"这种
 *
 * 保留策略：
 *   · completed / failed 保留最近 20 条（作者可以事后看最近一次生成耗时）
 *   · 只在"客户端主动 dismiss"时才删；默认 LRU 清理
 *   · 大体积字段（prompt / image_urls）**不进 store**，避免把 localStorage
 *     撑爆；只存到本地 history.json（后端）。客户端想看 prompt 可 fetch
 *     /api/video/status/:id
 */
import { create } from 'zustand'

export type VideoTaskStatus =
  | 'queued'
  | 'generating'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface VideoTaskEntry {
  taskId: string
  /** 后端代理到 Seedance 的任务 id（可用于手动在 Seedance 控制台查） */
  remoteTaskId?: string
  sceneId?: string
  shotId?: string
  status: VideoTaskStatus
  apiStatus?: string
  lastMessage?: string
  /** 已经耗时（毫秒）—— 后台 poll 更新 */
  elapsedMs?: number
  /** 任务入 store 的时间戳 */
  createdAt: number
  /** 完成/失败时间戳 */
  finishedAt?: number
  /** 成功时的本地视频 URL（`${apiBase}/api/video/file/<id>`） */
  videoUrl?: string
  /** 失败原因 */
  error?: string
  /** 是否已经被 mediaStore 吸收（避免重复 ingest） */
  ingested?: boolean
  /**
   * v6（P3-C）· 用哪个 Provider 创建/轮询这个任务；resume 时据此重建
   * Provider。缺省视作 'local'（老数据兼容，老 taskId 全都是本地的）。
   *
   *   · 'local'    —— LocalSeedanceProvider，走 reel-studio/server Flask
   *   · 'seedance' —— SeedanceProvider，浏览器直连火山方舟裸 API
   */
  providerKind?: 'local' | 'seedance'
}

interface VideoTaskState {
  tasks: Record<string, VideoTaskEntry>
  /** 按 sceneId → taskIds 的倒排索引，组件查"当前 scene 有没有在跑的任务"用 */
  sceneIndex: Record<string, string[]>

  upsert: (entry: VideoTaskEntry) => void
  patch: (taskId: string, patch: Partial<VideoTaskEntry>) => void
  remove: (taskId: string) => void
  /** 清掉所有已完成/失败/打断的历史（作者可以手动调，默认不会被自动触发） */
  clearFinished: () => void
}

const STORAGE_KEY = 'reel-studio.videoTasks.v1'
const MAX_FINISHED = 20 // 已终态任务保留条数

interface Persisted {
  v: 1
  tasks: Record<string, VideoTaskEntry>
}

function loadPersisted(): Pick<VideoTaskState, 'tasks' | 'sceneIndex'> {
  if (typeof window === 'undefined') return { tasks: {}, sceneIndex: {} }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tasks: {}, sceneIndex: {} }
    const p = JSON.parse(raw) as Persisted
    if (!p?.tasks) return { tasks: {}, sceneIndex: {} }
    // 启动时把 generating/downloading 但已超 6 小时的兜底标记为 interrupted —— 
    // 否则它们会永远"挂着"等 resume
    const SIX_HOURS = 6 * 3600 * 1000
    const now = Date.now()
    const cleaned: Record<string, VideoTaskEntry> = {}
    for (const [id, t] of Object.entries(p.tasks)) {
      const age = now - t.createdAt
      if (
        (t.status === 'generating' ||
          t.status === 'downloading' ||
          t.status === 'queued') &&
        age > SIX_HOURS
      ) {
        cleaned[id] = {
          ...t,
          status: 'interrupted',
          error: '超过 6 小时未完成，已放弃等待',
          finishedAt: now,
        }
      } else {
        cleaned[id] = t
      }
    }
    return { tasks: cleaned, sceneIndex: rebuildSceneIndex(cleaned) }
  } catch (e) {
    console.warn('[videoTaskStore] load failed:', e)
    return { tasks: {}, sceneIndex: {} }
  }
}

function rebuildSceneIndex(
  tasks: Record<string, VideoTaskEntry>,
): Record<string, string[]> {
  const idx: Record<string, string[]> = {}
  for (const t of Object.values(tasks)) {
    if (!t.sceneId) continue
    ;(idx[t.sceneId] ||= []).push(t.taskId)
  }
  return idx
}

function persistSnapshot(tasks: Record<string, VideoTaskEntry>): void {
  if (typeof window === 'undefined') return
  try {
    // 先 LRU 裁剪：只留最近 MAX_FINISHED 条已终态 + 全部未终态
    const active: VideoTaskEntry[] = []
    const finished: VideoTaskEntry[] = []
    for (const t of Object.values(tasks)) {
      if (isTerminal(t.status)) finished.push(t)
      else active.push(t)
    }
    finished.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    const keep = [...active, ...finished.slice(0, MAX_FINISHED)]
    const kept: Record<string, VideoTaskEntry> = {}
    for (const t of keep) kept[t.taskId] = t
    const payload: Persisted = { v: 1, tasks: kept }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('[videoTaskStore] persist failed:', e)
  }
}

export function isTerminal(s: VideoTaskStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'interrupted'
}

const initial = loadPersisted()

export const useVideoTaskStore = create<VideoTaskState>((set, get) => ({
  tasks: initial.tasks,
  sceneIndex: initial.sceneIndex,

  upsert: (entry) => {
    const prev = get().tasks[entry.taskId]
    const merged = { ...prev, ...entry }
    const tasks = { ...get().tasks, [entry.taskId]: merged }
    const sceneIndex = rebuildSceneIndex(tasks)
    set({ tasks, sceneIndex })
    persistSnapshot(tasks)
  },

  patch: (taskId, patchObj) => {
    const cur = get().tasks[taskId]
    if (!cur) return
    const merged: VideoTaskEntry = { ...cur, ...patchObj }
    // 自动打 finishedAt
    if (
      isTerminal(merged.status) &&
      !merged.finishedAt &&
      (patchObj.status === 'completed' ||
        patchObj.status === 'failed' ||
        patchObj.status === 'interrupted')
    ) {
      merged.finishedAt = Date.now()
    }
    const tasks = { ...get().tasks, [taskId]: merged }
    set({ tasks, sceneIndex: rebuildSceneIndex(tasks) })
    persistSnapshot(tasks)
  },

  remove: (taskId) => {
    const { [taskId]: _omit, ...rest } = get().tasks
    set({ tasks: rest, sceneIndex: rebuildSceneIndex(rest) })
    persistSnapshot(rest)
  },

  clearFinished: () => {
    const kept: Record<string, VideoTaskEntry> = {}
    for (const [id, t] of Object.entries(get().tasks)) {
      if (!isTerminal(t.status)) kept[id] = t
    }
    set({ tasks: kept, sceneIndex: rebuildSceneIndex(kept) })
    persistSnapshot(kept)
  },
}))
