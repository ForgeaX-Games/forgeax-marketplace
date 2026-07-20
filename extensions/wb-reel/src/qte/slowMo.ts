/**
 * 慢放 / 子弹时间 解算器 —— 纯函数，零 React/DOM 依赖。
 *
 * 责任：
 *   - 给定 scene 的所有 QTECue + window + 当前 elapsed + 已解算的 verdicts，
 *     输出"当前应该用什么 playbackRate"，以及当前活跃的 slowMo cue（用于 UI 渲染）。
 *   - 在 cue 的失败时刻识别 fail —— 由调用方决定如何跳分支 / 弹结算。
 *
 * 时间区间定义（每个有 slowMo 的 cue）：
 *   [enter, exit] =
 *     [ appearAt - leadInMs ,
 *       命中: hitAt + holdAfterHitMs   未命中: targetAt + window.good ]
 *
 * 命中后剩余尾巴：
 *   slowMo.holdAfterHitMs > 0 时，命中后仍保持慢放至 hitAt + holdAfterHitMs，
 *   营造"凯旋慢镜"。
 *
 * 设计约束：
 *   - 不读时钟；所有判定来自参数，便于单元测试。
 *   - cue 区间允许重叠，则取**速率最低（最慢）**的那个生效；UI 取最早进入的。
 */
import type { HitVerdict } from './QTEEngine'
import type { QTECue, QTEHitWindow } from '../scenario/types'

export interface SlowMoState {
  /** 当前是否处于任何 cue 的慢放区间 */
  active: boolean
  /** 当前生效的播放速率（active=false 时恒等于 1） */
  rate: number
  /** 当前主导慢放的 cue id（active=false 时为 null） */
  activeCueId: string | null
  /** 当前慢放窗口的进度 0..1，可用于画 HUD 进度条 */
  windowProgress: number
}

const SLOW_MO_INACTIVE: SlowMoState = {
  active: false,
  rate: 1,
  activeCueId: null,
  windowProgress: 0,
}

/**
 * 计算单个 cue 在 elapsedMs 时刻的慢放窗口（若 cue 没有 slowMo 则返回 null）。
 * 已命中过的 cue：尾巴在 hitAt+holdAfterHitMs 后立刻收掉。
 */
export interface CueSlowMoWindow {
  cueId: string
  rate: number
  enter: number
  exit: number
}

export function computeCueWindow(
  cue: QTECue,
  window: QTEHitWindow,
  verdict: HitVerdict | undefined,
): CueSlowMoWindow | null {
  if (!cue.slowMo) return null
  const rate = clamp(cue.slowMo.rate, 0.05, 1)
  if (rate >= 1) return null
  const leadIn = Math.max(0, cue.slowMo.leadInMs ?? 0)
  const enter = cue.appearAt - leadIn

  if (verdict && verdict.judgement !== 'MISS') {
    // 命中：从 targetAt + verdict.deltaMs 推算实际 hitAt
    const hitAt = cue.targetAt + (Number.isFinite(verdict.deltaMs) ? verdict.deltaMs : 0)
    const exit = hitAt + Math.max(0, cue.slowMo.holdAfterHitMs ?? 0)
    return { cueId: cue.id, rate, enter, exit }
  }

  // 未命中或 MISS：尾巴到判定窗末尾
  const exit = cue.targetAt + window.good
  return { cueId: cue.id, rate, enter, exit }
}

/**
 * 解算当前时刻的慢放状态。
 *   - 多个 cue 区间重叠时，取速率最低（最慢）的为生效；
 *   - UI 用的 activeCueId 取生效那一条。
 */
export function resolveActiveSlowMo(
  cues: readonly QTECue[],
  window: QTEHitWindow,
  verdicts: readonly HitVerdict[],
  elapsedMs: number,
): SlowMoState {
  const verdictMap = new Map(verdicts.map((v) => [v.cueId, v]))

  let chosen: CueSlowMoWindow | null = null
  for (const cue of cues) {
    const w = computeCueWindow(cue, window, verdictMap.get(cue.id))
    if (!w) continue
    if (elapsedMs < w.enter || elapsedMs > w.exit) continue
    // 取最慢（rate 最小）
    if (chosen == null || w.rate < chosen.rate) chosen = w
  }

  if (!chosen) return SLOW_MO_INACTIVE

  const span = Math.max(1, chosen.exit - chosen.enter)
  const progress = clamp((elapsedMs - chosen.enter) / span, 0, 1)
  return {
    active: true,
    rate: chosen.rate,
    activeCueId: chosen.cueId,
    windowProgress: progress,
  }
}

/**
 * 该 cue 是否因为"未命中且超出区间末尾"而构成 fail。
 *
 * 注意 verdict 的 MISS 通常由 QTEOverlay 的 cueIsExpired 触发，
 * 这里再独立判一次，覆盖 sweep / 自定义场景下手动写 verdict 的情况。
 */
export function cueSlowMoFailed(
  cue: QTECue,
  window: QTEHitWindow,
  verdict: HitVerdict | undefined,
  elapsedMs: number,
): boolean {
  if (!cue.slowMo) return false
  if (cue.slowMo.requireHit === false) return false // 氛围型，永远不 fail
  const exit = cue.targetAt + window.good
  if (elapsedMs < exit) return false
  if (!verdict) return true
  return verdict.judgement === 'MISS'
}

/**
 * 给定 cues + window + verdicts + elapsed，找出已经判定 fail 的那个 cue
 * （取时间上最早 fail 的，确保至多一次跳转）。
 */
export function firstFailedSlowMoCue(
  cues: readonly QTECue[],
  window: QTEHitWindow,
  verdicts: readonly HitVerdict[],
  elapsedMs: number,
): QTECue | null {
  const verdictMap = new Map(verdicts.map((v) => [v.cueId, v]))
  let earliest: QTECue | null = null
  for (const c of cues) {
    if (!cueSlowMoFailed(c, window, verdictMap.get(c.id), elapsedMs)) continue
    if (!earliest || c.targetAt < earliest.targetAt) earliest = c
  }
  return earliest
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
