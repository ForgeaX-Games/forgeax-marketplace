import { create } from 'zustand'

/**
 * narrativeProgressStore —— 影游 × 叙事「分阶段协作」的实时进度镜像。
 *
 * 背景：Reia 在前期文字工作上借用叙事工坊 (wb-narrative) 的专业管线，按 4 个里程碑
 * (梗概 / 三幕大纲 / 剧情树 / 剧本) 分阶段推进。叙事后端逐步落盘 + SSE 推送进度。
 * 这个 store 让影游工坊左侧面板「过程可见」：
 *   - 轮询同源代理 `/api/narrative/history` 发现最近一条叙事 run（粗粒度里程碑进度）；
 *   - 若该 run 仍在内存中 running，再开 SSE `/api/narrative/stream/:id` 订阅细粒度步骤进度；
 *   - 里程碑产出后，scenario 由 scenarioPersistBoot 的磁盘轮询自动 reload，面板随之增量渲染。
 *
 * 不持久化：纯瞬时进度镜像。boot 由 ForgeStudio 挂载时启动、卸载时清理。
 */

export type Milestone = 'logline' | 'outline_acts' | 'branched_beats' | 'screenplay'

export interface MilestoneMeta {
  id: Milestone
  /** narrative pipeline stepId that marks this milestone complete. */
  stepId: string
  label: string
}

/** 4 个里程碑断点（与 agent-reia persona / wb-narrative stopAfterStep 对齐）。 */
export const MILESTONES: MilestoneMeta[] = [
  { id: 'logline', stepId: 'vn_logline', label: '梗概' },
  { id: 'outline_acts', stepId: 'vn_outline_acts', label: '三幕大纲' },
  { id: 'branched_beats', stepId: 'vn_branched_beats', label: '剧情树' },
  { id: 'screenplay', stepId: 'vn_screenplay', label: '剧本' },
]

export interface NarrativeProgressState {
  /** 是否有正在/最近被追踪的叙事 run。 */
  active: boolean
  runId: string | null
  /** 运行目录名（history key），里程碑数据落盘位置。 */
  runKey: string | null
  status: 'running' | 'paused' | 'completed' | 'failed' | 'idle'
  /** 当前正在执行的步骤人话（来自 SSE message），用于一行进度提示。 */
  currentStepMessage: string
  /** 已完成的 narrative stepId 列表。 */
  completedSteps: string[]
  /** 已到达的里程碑（派生）。 */
  reachedMilestones: Milestone[]
  /** 当前所处/正在生成的里程碑（派生）。 */
  activeMilestone: Milestone | null
  /** 是否停在里程碑断点等待用户确认。 */
  pausedAtMilestone: boolean

  _ingestProgress: (p: NarrativeFrame) => void
  _setRun: (runId: string | null, runKey: string | null) => void
  _setStatus: (status: NarrativeProgressState['status']) => void
  _setCompletedSteps: (steps: string[]) => void
  reset: () => void
}

export interface NarrativeFrame {
  type?: string
  stage?: string
  stepId?: string
  step?: number
  totalSteps?: number
  status?: string
  message?: string
  // {type:"done"} frame
  error?: string | null
}

function deriveMilestones(completedSteps: string[]): {
  reached: Milestone[]
  active: Milestone | null
} {
  const reached: Milestone[] = []
  for (const m of MILESTONES) {
    if (completedSteps.includes(m.stepId)) reached.push(m.id)
  }
  // active = the first milestone not yet reached, or null when all done.
  const active = MILESTONES.find((m) => !reached.includes(m.id))?.id ?? null
  return { reached, active }
}

export const useNarrativeProgressStore = create<NarrativeProgressState>((set, get) => ({
  active: false,
  runId: null,
  runKey: null,
  status: 'idle',
  currentStepMessage: '',
  completedSteps: [],
  reachedMilestones: [],
  activeMilestone: null,
  pausedAtMilestone: false,

  _ingestProgress: (p) => {
    if (p.type === 'done') {
      set({ status: p.error ? 'failed' : 'completed' })
      return
    }
    const patch: Partial<NarrativeProgressState> = {}
    if (p.message) patch.currentStepMessage = p.message
    if (p.stepId === 'milestone_stop') {
      patch.pausedAtMilestone = true
      patch.status = 'paused'
    }
    if (p.stepId && p.status === 'completed' && p.stepId !== 'pipeline_config') {
      const prev = get().completedSteps
      if (!prev.includes(p.stepId)) {
        const next = [...prev, p.stepId]
        const { reached, active } = deriveMilestones(next)
        patch.completedSteps = next
        patch.reachedMilestones = reached
        patch.activeMilestone = active
      }
    }
    if (Object.keys(patch).length > 0) set(patch)
  },

  _setRun: (runId, runKey) =>
    set({ runId, runKey, active: !!(runId || runKey) }),

  _setStatus: (status) => set({ status }),

  _setCompletedSteps: (steps) => {
    const { reached, active } = deriveMilestones(steps)
    set({
      completedSteps: steps,
      reachedMilestones: reached,
      activeMilestone: active,
    })
  },

  reset: () =>
    set({
      active: false,
      runId: null,
      runKey: null,
      status: 'idle',
      currentStepMessage: '',
      completedSteps: [],
      reachedMilestones: [],
      activeMilestone: null,
      pausedAtMilestone: false,
    }),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Boot: history poller (coarse milestone progress) + opportunistic SSE (fine).
// Works at module level; ForgeStudio starts/stops it on mount/unmount.
// ─────────────────────────────────────────────────────────────────────────────

const NARRATIVE_BASE = '/api/narrative'

interface HistoryItem {
  key: string
  id: string | null
  status?: string
  startedAt?: string
  completedSteps?: string[] | null
}

let _pollTimer: ReturnType<typeof setInterval> | null = null
let _es: EventSource | null = null
let _esRunId: string | null = null
let _booted = false

async function fetchLatestRun(): Promise<HistoryItem | null> {
  try {
    const res = await fetch(`${NARRATIVE_BASE}/history`, { cache: 'no-store' })
    if (!res.ok) return null
    const items = (await res.json()) as HistoryItem[]
    if (!Array.isArray(items) || items.length === 0) return null
    // history is sorted newest-first by startedAt; prefer a running one, else newest.
    const running = items.find((it) => it.status === 'running')
    return running ?? items[0] ?? null
  } catch {
    return null
  }
}

function openSse(runId: string): void {
  if (_esRunId === runId && _es) return
  closeSse()
  try {
    const es = new EventSource(`${NARRATIVE_BASE}/stream/${encodeURIComponent(runId)}`)
    _es = es
    _esRunId = runId
    const store = useNarrativeProgressStore.getState()
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as NarrativeFrame
        useNarrativeProgressStore.getState()._ingestProgress(frame)
        if (frame.type === 'done') closeSse()
      } catch {
        // ignore malformed frame
      }
    }
    es.onerror = () => {
      // SSE 404 (run not in memory / already done) or network hiccup → drop to
      // history polling for coarse progress. Don't spam reconnects.
      closeSse()
    }
    store._setStatus('running')
  } catch {
    closeSse()
  }
}

function closeSse(): void {
  if (_es) {
    try { _es.close() } catch { /* noop */ }
    _es = null
  }
  _esRunId = null
}

async function pollHistory(): Promise<void> {
  const store = useNarrativeProgressStore.getState()
  const latest = await fetchLatestRun()
  if (!latest) return
  store._setRun(latest.id, latest.key)
  if (Array.isArray(latest.completedSteps)) {
    store._setCompletedSteps(latest.completedSteps)
  }
  if (latest.status === 'running' && latest.id) {
    openSse(latest.id)
  } else if (latest.status === 'running') {
    store._setStatus('running')
  } else if (latest.status === 'completed') {
    // A milestone-gated run completes "early" but is resumable; the import tool
    // marks scenario.meta. Treat as paused-at-milestone unless all 4 reached.
    const all = store.reachedMilestones.length >= MILESTONES.length
    store._setStatus(all ? 'completed' : 'paused')
    closeSse()
  }
}

export function bootNarrativeProgress(): () => void {
  if (_booted) return () => undefined
  _booted = true
  void pollHistory()
  _pollTimer = setInterval(() => void pollHistory(), 3000)
  return () => {
    if (_pollTimer) {
      clearInterval(_pollTimer)
      _pollTimer = null
    }
    closeSse()
    _booted = false
  }
}
