import type { DialogueLine } from '../../scenario/types'
import { clampMs } from './timelineMath'

/**
 * 台词拖拽 · 计算「将要写回」的 patch
 *
 * 三个动作：
 *   1. moveDialoguePatch          —— 拖整个 clip（startMs / endMs 同步平移）
 *   2. resizeDialogueLeftPatch    —— 拖左 handle 改 startMs（不动 endMs）
 *   3. resizeDialogueRightPatch   —— 拖右 handle 改 endMs（不动 startMs）
 *
 * 全部返回 `Partial<DialogueLine>`：
 *   - 完全不变 → 返回 `{}` 让上层跳过 dispatch
 *   - 仅某些字段变 → 只列出该字段（精简 store 写入 + undo 噪声）
 *
 * 边界规则：
 *   - 0 ≤ startMs ≤ endMs - MIN_DURATION
 *   - startMs + MIN_DURATION ≤ endMs ≤ sceneDuration
 *   - endMs 缺省时（持续显示到下一句/场景结束）：右 handle 默认从 +2000ms 起算
 *     —— 与 Timeline 渲染回退保持一致
 */

export const DIALOGUE_MIN_DURATION_MS = 50

const FALLBACK_END_PADDING_MS = 2000

export function moveDialoguePatch(
  line: DialogueLine,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<DialogueLine> {
  if (deltaMs === 0) return {}

  if (line.endMs === undefined) {
    // 没有 endMs → 只动 startMs；范围 [0, sceneDuration]
    const next = clampMs(line.startMs + deltaMs, 0, sceneDurationMs)
    if (next === line.startMs) return {}
    return { startMs: next }
  }

  const span = line.endMs - line.startMs
  // 平移时 start 范围 = [0, sceneDuration - span]，自动保间隔
  const minStart = 0
  const maxStart = Math.max(0, sceneDurationMs - span)
  const nextStart = clampMs(line.startMs + deltaMs, minStart, maxStart)
  const nextEnd = nextStart + span
  if (nextStart === line.startMs && nextEnd === line.endMs) return {}
  return { startMs: nextStart, endMs: nextEnd }
}

export function resizeDialogueLeftPatch(
  line: DialogueLine,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<DialogueLine> {
  if (deltaMs === 0) return {}

  if (line.endMs === undefined) {
    // endMs 缺省时，左 handle 等价于「整体平移」（没有右边界限制）
    const next = clampMs(line.startMs + deltaMs, 0, sceneDurationMs)
    if (next === line.startMs) return {}
    return { startMs: next }
  }

  const minStart = 0
  const maxStart = Math.max(0, line.endMs - DIALOGUE_MIN_DURATION_MS)
  const next = clampMs(line.startMs + deltaMs, minStart, maxStart)
  if (next === line.startMs) return {}
  return { startMs: next }
}

export function resizeDialogueRightPatch(
  line: DialogueLine,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<DialogueLine> {
  if (deltaMs === 0) return {}

  // endMs 缺省 → 用渲染回退值作起点
  const baseEnd = line.endMs ?? Math.min(sceneDurationMs, line.startMs + FALLBACK_END_PADDING_MS)
  const minEnd = line.startMs + DIALOGUE_MIN_DURATION_MS
  const maxEnd = sceneDurationMs
  const next = clampMs(baseEnd + deltaMs, minEnd, maxEnd)
  if (next === line.endMs) return {}
  return { endMs: next }
}
