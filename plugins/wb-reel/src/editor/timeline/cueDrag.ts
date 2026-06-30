import type { QTECue } from '../../scenario/types'
import { clampMs } from './timelineMath'

/**
 * QTECue 拖拽 · 计算 patch
 *
 *   1. moveCuePatch            —— 拖 pin 整体（appearAt + targetAt 同步）
 *   2. moveCueTargetOnlyPatch  —— 仅拖目标点（appearAt 不动；targetAt ≥ appearAt）
 *   3. resizeTrigBandLeadInPatch —— 拖 TRIG band 左边缘改 leadInMs
 *
 * 边界：
 *   0 ≤ appearAt ≤ targetAt ≤ sceneDurationMs
 *   leadInMs ∈ [0, appearAt]   （band 起点 = appearAt - leadInMs ≥ 0）
 *
 * 返回 `Partial<QTECue>`：
 *   - 不变 → `{}`，上层跳过 dispatch
 *   - 变了 → 仅返回变化字段
 *   - slowMo 子字段单独变更也作为整段写回（保留其他子字段）
 */

export function moveCuePatch(
  cue: QTECue,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<QTECue> {
  if (deltaMs === 0) return {}
  // 退化数据保护：appearAt 不应大于 targetAt
  if (cue.appearAt > cue.targetAt) return {}

  const span = cue.targetAt - cue.appearAt
  const minAppear = 0
  const maxAppear = Math.max(0, sceneDurationMs - span)
  const nextAppear = clampMs(cue.appearAt + deltaMs, minAppear, maxAppear)
  const nextTarget = nextAppear + span
  if (nextAppear === cue.appearAt && nextTarget === cue.targetAt) return {}
  return { appearAt: nextAppear, targetAt: nextTarget }
}

export function moveCueTargetOnlyPatch(
  cue: QTECue,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<QTECue> {
  if (deltaMs === 0) return {}

  const minTarget = cue.appearAt
  const maxTarget = sceneDurationMs
  const next = clampMs(cue.targetAt + deltaMs, minTarget, maxTarget)
  if (next === cue.targetAt) return {}
  return { targetAt: next }
}

/**
 * 拖 TRIG band 的左边缘 = 改 leadInMs。
 * 视觉关系：band 起点 = appearAt - leadInMs。
 *   - 把 band 边缘往左拖（deltaMs 负）= 起点变小 = leadInMs 增大
 *   - 把 band 边缘往右拖（deltaMs 正）= 起点变大 = leadInMs 减小
 */
export function resizeTrigBandLeadInPatch(
  cue: QTECue,
  deltaMs: number,
): Partial<QTECue> {
  if (!cue.slowMo) return {}
  if (deltaMs === 0) return {}

  const cur = cue.slowMo.leadInMs ?? 0
  const next = clampMs(cur - deltaMs, 0, Math.max(0, cue.appearAt))
  if (next === cur) return {}
  return {
    slowMo: {
      ...cue.slowMo,
      leadInMs: next,
    },
  }
}
