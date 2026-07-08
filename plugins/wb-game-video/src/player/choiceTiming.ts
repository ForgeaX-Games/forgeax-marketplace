import { qteTimeoutDeadlineMs } from '../qte/QTEEngine'
import type { Interaction, QTESpec, Scene, TimeWindow } from '../scenario/types'

/**
 * 交互形态判别 —— 从 presence 派生（不落库 type）。
 * 优先级：boss > qte > calc > choice；四者皆空 = none。脏数据（多个非空）
 * 按此优先级取一，lintScenario 另行报警。
 */
export function resolveInteraction(scene: Scene | null | undefined): Interaction {
  if (!scene) return { type: 'none' }
  if (scene.boss) return { type: 'boss', boss: scene.boss }
  if (scene.qte) return { type: 'qte', qte: scene.qte }
  if (scene.calc) return { type: 'calc', calc: scene.calc }
  if (scene.choice) return { type: 'choice', choice: scene.choice }
  return { type: 'none' }
}

/** 当前交互生效时窗 —— qte / choice 各自的 window。 */
function interactionWindow(scene: Scene): TimeWindow | undefined {
  return scene.qte?.window ?? scene.choice?.window
}

/** 场景视频是否循环 —— loop 模式边播边交互。 */
export function isLoopScene(scene: Scene): boolean {
  return scene.mediaPlayMode === 'loop'
}

export function choiceWindowStart(scene: Scene): number {
  return interactionWindow(scene)?.startMs ?? 0
}

export function choiceWindowEnd(scene: Scene): number {
  return interactionWindow(scene)?.endMs ?? scene.durationMs
}

/**
 * QTE 交互窗结束时刻 —— 必须盖住最后一个 cue 的判定尾窗 + 整段超时，
 * 不能只用 scene.durationMs（否则第二个按键点尚未出现 QTE 层就被关掉）。
 */
export function qteInteractionWindowEnd(scene: Scene, spec: QTESpec | undefined = scene.qte): number {
  const base = choiceWindowEnd(scene)
  const cues = spec?.cues ?? []
  if (!spec || cues.length === 0) return base
  const good = spec.tolerance?.good ?? 480
  const lastLiveEnd = Math.max(...cues.map((c) => c.targetAt + good))
  const deadline = qteTimeoutDeadlineMs(spec)
  return Math.max(base, lastLiveEnd, deadline ?? 0)
}

/** 逻辑播放上限 —— 画面轨 effectiveEnd 之上，QTE 还需盖住整段交互窗。 */
export function resolvePlaybackCapMs(scene: Scene, baseEndMs: number): number {
  if (scene.qte && (scene.qte.cues?.length ?? 0) > 0) {
    return Math.max(baseEndMs, qteInteractionWindowEnd(scene))
  }
  return baseEndMs
}

/** 播放中是否应弹出选项层（非 scene-end 路径）。 */
export function shouldOpenChoiceDuringPlayback(scene: Scene, elapsedMs: number): boolean {
  if (scene.qte) return false // QTE 由 shouldActivateTimedQte 负责
  const hasChoice = scene.branches.some((b) => b.kind === 'choice')
  if (!hasChoice) return false
  const choice = scene.choice

  // 经典「场景结束后出选项」：无 choice spec、非限时、非 loop、无窗口起点 → 只在 scene end 弹
  const endOnly =
    !choice || (!choice.timed && !isLoopScene(scene) && choice.window?.startMs == null)
  if (endOnly) return false

  const start = choiceWindowStart(scene)
  const end = choiceWindowEnd(scene)
  return elapsedMs >= start && elapsedMs < end
}

/** 弹出选项时是否暂停视频（loop / 限时选择保持播放）。 */
export function shouldPauseVideoForChoice(scene: Scene): boolean {
  if (isLoopScene(scene)) return false
  if (scene.choice?.timed) return false
  return true
}

/** QTE 窗口内是否激活 QTE 层。 */
export function shouldActivateTimedQte(scene: Scene, elapsedMs: number): boolean {
  const qte = scene.qte
  if (!qte?.cues?.length) return false
  const w = qte.window
  const windowed = w != null && (w.startMs != null || w.endMs != null || w.timeoutMs != null)
  if (windowed) {
    const start = choiceWindowStart(scene)
    const end = qteInteractionWindowEnd(scene)
    return elapsedMs >= start && elapsedMs < end
  }
  // 无窗口的 QTE → 全场景有效
  return true
}

/** fireAt 缺省：loop 场景选完等视频段结束再跳。 */
export function resolveFireAt(scene: Scene): 'on_pick' | 'video_end' {
  if (scene.choice?.fireAt) return scene.choice.fireAt
  if (isLoopScene(scene)) return 'video_end'
  return 'on_pick'
}
