import { getVideoClip } from '../scenario/gameAssetCatalog'
import type { Scene } from '../scenario/types'

/**
 * 试玩 / 时间轴共用的节点演出时长。
 * - **loop 待机**：取 scene / 素材库 / 视频元数据 max（整段 loop 周期）。
 * - **非 loop**：`scene.durationMs` 为状态机 SSOT（隐藏计算节点可短于完整素材，如 pjudge/my-done 用 idle 但只停 500ms）。
 */
export function resolveScenePlaybackDurationMs(
  scene: Scene | undefined,
  opts?: { fallbackMs?: number; videoEl?: HTMLVideoElement | null; loop?: boolean },
): number {
  const sceneMs = scene?.durationMs ?? 0
  const catalogDur = getVideoClip(scene?.clipId)?.durMs ?? 0
  const videoEl = opts?.videoEl
  const videoDur =
    videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0.1
      ? Math.round(videoEl.duration * 1000)
      : 0
  const loop = opts?.loop === true || scene?.mediaPlayMode === 'loop'

  if (loop) {
    return Math.max(1, sceneMs, catalogDur, videoDur, opts?.fallbackMs ?? 2600)
  }

  if (sceneMs > 0) {
    return Math.max(1, sceneMs, opts?.fallbackMs ?? 0)
  }

  return Math.max(1, catalogDur, videoDur, opts?.fallbackMs ?? 2600)
}
