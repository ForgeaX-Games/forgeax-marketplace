/**
 * 全屏 UI 页面触发时机(v11)—— 纯函数,给 Player 的 step 循环调用。
 *
 * 镜像 minigameHit:每个 ScreenClip 触发一次(caller 触发后把 id 加入 triggeredIds
 * 再传回);触发条件 = elapsed 已跨过 startMs 且未触发过。同帧多个取最早那个。
 *
 * 无 DOM / store 访问 —— 纯输入纯输出,便于单测。
 */

import type { ScreenClip } from '../scenario/types'

export interface ScreenHitInput {
  clips: ReadonlyArray<ScreenClip>
  /** 当前 scene 经历的毫秒。 */
  elapsedMs: number
  /** 已触发过(不再重触)的 clip id 集合。 */
  triggeredIds: ReadonlySet<string>
}

export function nextScreenToTrigger(input: ScreenHitInput): ScreenClip | null {
  if (!input.clips.length) return null
  const sorted = [...input.clips].sort((a, b) => a.startMs - b.startMs)
  for (const c of sorted) {
    if (input.triggeredIds.has(c.id)) continue
    if (input.elapsedMs + 1 >= c.startMs) return c
  }
  return null
}

/**
 * Scene 播到结尾时兜底触发:所有还没弹过的全屏页面 clip。
 * 与 pendingMinigamesAtEnd 同理(startMs 可能落在 effectiveEndMs 之后)。
 */
export function pendingScreensAtEnd(
  input: Omit<ScreenHitInput, 'elapsedMs'>,
): ScreenClip | null {
  if (!input.clips.length) return null
  const sorted = [...input.clips].sort((a, b) => a.startMs - b.startMs)
  for (const c of sorted) {
    if (!input.triggeredIds.has(c.id)) return c
  }
  return null
}
