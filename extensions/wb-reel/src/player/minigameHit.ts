/**
 * 小游戏触发时机 —— 纯函数，给 Player 的 step 循环调用。
 *
 * 设计要点：
 *   - 每个 MinigameClip 触发一次 —— 触发后由 caller 把 id 加入 triggeredIds
 *     再传回来；已触发的跳过（不重复阻断播放）
 *   - 触发条件：elapsed 已跨过 startMs（>= startMs），还没触发
 *   - 如果当前 elapsed 已经远远超过某个 clip 的 startMs（比如用户 seek），
 *     只要它没触发过，仍然算"到了"（不会"跳过"一个未玩的关卡）
 *   - 同一帧多个可触发，按 startMs 升序先返回最早那个
 *
 * 没有 DOM / store 访问 —— 纯输入纯输出，便于单测。
 */

import type { MinigameClip } from '../scenario/types'

export interface MinigameHitInput {
  clips: ReadonlyArray<MinigameClip>
  /** 当前 scene 经历的毫秒 */
  elapsedMs: number
  /** 已经触发过（不再重触）的 clip id 集合 */
  triggeredIds: ReadonlySet<string>
}

export function nextMinigameToTrigger(
  input: MinigameHitInput,
): MinigameClip | null {
  if (!input.clips.length) return null
  // 拷贝后按 startMs 升序
  const sorted = [...input.clips].sort((a, b) => a.startMs - b.startMs)
  for (const c of sorted) {
    if (input.triggeredIds.has(c.id)) continue
    if (input.elapsedMs + 1 >= c.startMs) return c
  }
  return null
}

/**
 * Scene 播到结尾时"兜底触发"：场景内所有还没玩过的小游戏，
 * 在 handleSceneEnd 之前一定要先玩。
 *
 * 设计理由：作者常把小游戏看作"跑完视频再做一件事"的闸门，
 * 但 UI 上 clip 的 startMs 很可能落在 effectiveEndMs 之后（视频比
 * scene.durationMs 短），这会让"正常 startMs 命中"触发分支完全失效。
 * 这个兜底保证：只要 scene 正常播完，剩下的 minigame 必须都玩。
 */
export function pendingMinigamesAtEnd(
  input: Omit<MinigameHitInput, 'elapsedMs'>,
): MinigameClip | null {
  if (!input.clips.length) return null
  const sorted = [...input.clips].sort((a, b) => a.startMs - b.startMs)
  for (const c of sorted) {
    if (!input.triggeredIds.has(c.id)) return c
  }
  return null
}
