/**
 * 视频拖入时间轴的"时长规划" —— 纯函数，单独可测。
 *
 * 职责：输入落点、视频时长、当前场景总长 → 输出 shot 的 startMs/endMs，
 * 以及是否需要扩展场景总长（扩展后的新 sceneDurationMs）。
 *
 * 关键决策：
 *   - 视频比剩余时长长 → 扩展场景，不剪短视频（按作者本意完整放入）
 *   - 视频时长未知（probe 前拖） → 兜底 4 秒
 *   - startMs/视频时长异常输入一律夹到合理区间，不让下游 Branch/QTE 计算翻白眼
 */

export const MIN_SHOT_MS = 500
export const DEFAULT_VIDEO_SHOT_MS = 4000

export interface PlanVideoDropInput {
  startMs: number
  requestedMs: number
  sceneDurationMs: number
}

export interface PlanVideoDropResult {
  startMs: number
  endMs: number
  /**
   * 扩展后的场景总时长；若不需要扩展则等于入参 sceneDurationMs。
   * 调用方只有在 nextSceneDurationMs !== sceneDurationMs 时才写回 store，
   * 避免无意义的 state 变更触发重渲。
   */
  nextSceneDurationMs: number
}

export function planVideoDrop(input: PlanVideoDropInput): PlanVideoDropResult {
  const sceneDur = Math.max(0, input.sceneDurationMs)
  const rawDur = Number.isFinite(input.requestedMs) ? input.requestedMs : 0
  const durCandidate = rawDur > 0 ? rawDur : DEFAULT_VIDEO_SHOT_MS
  const dur = Math.max(MIN_SHOT_MS, durCandidate)

  const start = Math.max(0, Math.min(sceneDur, input.startMs))
  const end = start + dur
  const nextSceneDurationMs = end > sceneDur ? end : sceneDur
  return { startMs: start, endMs: end, nextSceneDurationMs }
}
