import type { Branch } from '../../scenario/types'
import { clampMs } from './timelineMath'

/**
 * 分支 pin 拖拽 · 仅 showAt 一个字段。
 *
 * showAt 缺省时（renderer 用 sceneDuration 兜底），把 sceneDuration 视为
 * 起算点；这样作者第一次拖动也能"自然地往左拉"。
 */
export function moveBranchShowAtPatch(
  branch: Branch,
  deltaMs: number,
  sceneDurationMs: number,
): Partial<Branch> {
  if (deltaMs === 0) return {}
  const base = branch.showAt ?? sceneDurationMs
  const next = clampMs(base + deltaMs, 0, sceneDurationMs)
  if (next === branch.showAt) return {}
  return { showAt: next }
}
