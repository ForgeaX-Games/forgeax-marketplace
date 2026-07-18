/**
 * queueProgress —— 生成队列「进度百分比」估算 + 计时 hook（UI 专用，纯展示）。
 *
 * 为什么是「估算」：Seedance/litellm 视频任务只回 status/api_status（queued /
 * in_progress / completed），**不给数值进度**。直接显示 "in_progress" 既占地方
 * 又看不出进展。这里用「已耗时 / 该类任务的经验时长」折算一个百分比，封顶 95%
 * （完成才跳 100），配进度条，既直观又不虚报完成。tooltip 里仍保留真实 stage。
 */
import { useEffect, useState } from 'react'
import type { GenJob } from './generationQueueStore'

/** 各类任务的经验时长（ms）——只用于进度条折算，不是硬超时。 */
function expectedMs(job: Pick<GenJob, 'kind' | 'recipe'>): number {
  if (job.recipe?.type === 'audition') return 200_000 // 试镜：图生视频 + 抽音轨，最长
  if (job.kind === 'video') return 120_000
  if (job.kind === 'audio') return 35_000
  return 30_000 // image
}

/**
 * 返回 0–100 的展示进度：
 *   · running：按已耗时折算，夹在 [2, 95]（绝不在完成前显示 100）
 *   · done：100
 *   · 其它（queued/failed/cancelled）：null（不画进度条）
 */
export function estimateProgress(job: GenJob, now: number): number | null {
  if (job.status === 'done') return 100
  if (job.status !== 'running' || !job.startedAt) return null
  const elapsed = Math.max(0, now - job.startedAt)
  const pct = Math.round((elapsed / expectedMs(job)) * 100)
  return Math.min(95, Math.max(2, pct))
}

/**
 * 每 `ms` 毫秒返回一个新的 Date.now()（仅 active 时计时）——驱动进度条平滑前进。
 * active=false 时停表，避免无意义的定时器与重渲染。
 */
export function useNowTick(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
