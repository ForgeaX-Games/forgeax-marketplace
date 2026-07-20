/**
 * videoTimelineSync —— playhead（毫秒）↔ HTMLVideoElement.currentTime（秒）
 * 之间的双向同步决策，以纯函数的形式实现，UI 只负责把 ref/状态喂进来。
 *
 * 为什么值得抽出来：
 *   - `StagePane` 里既要在「拖游标」时把视频 seek 到那一帧，又要在「播放中」把
 *     游标追上视频当前时间；两个方向一起做很容易写出回环（seek→timeupdate→
 *     setHoverMs→再触发 seek）。
 *   - 把"下一个动作是什么"的决策放在纯函数里，才好在不启动浏览器的情况下
 *     单测"回环""边界"这种容易踩的坑。
 *
 * 约束 / 设计：
 *   - 一律用 ms 做传输单位；只有在最后贴 `<video>` 的 API 时才换算成秒。
 *   - 容忍 ±EPSILON_MS 误差（视频解码帧的 currentTime 精度 ~20–40ms，没必要
 *     每个细微更新都 seek 回去，否则播放会一抖一抖）。
 *   - scene.durationMs 作为上限夹 —— 视频真长可能比 scene.durationMs 长/短，
 *     我们**以 scene 时长为准**（作者在时间轴上设定的就是最终输出长度）。
 */

/** 高于这个 ms 的差才触发 seek；比 30fps 的一帧略宽，避免播放抖回原点。 */
export const VIDEO_SYNC_EPSILON_MS = 60

export interface SyncInputs {
  /** 时间轴游标（ms），作者控制 */
  hoverMs: number
  /** 视频当前播放位置（ms），由 <video>.currentTime * 1000 读出来 */
  videoMs: number
  /** 是否正在播放；true 时游标追视频，false 时视频追游标 */
  isPlaying: boolean
  /** scene 的总时长（ms）；超过此值要夹住 */
  sceneMs: number
}

/**
 * 暂停状态下 — 决定是否要把 video.currentTime 改到 hoverMs。
 *
 * 返回 null = 不动（差距小于 EPSILON 或者播放中 / hoverMs 越界）；
 * 返回 number(秒) = 需要赋值给 `video.currentTime` 的目标秒数。
 *
 * hoverMs 会先被夹到 [0, sceneMs] 再换算成秒；负数 / NaN 一律走 0。
 */
export function decideSeekFromHover(input: SyncInputs): number | null {
  if (input.isPlaying) return null
  const clampedMs = clampMs(input.hoverMs, input.sceneMs)
  if (Math.abs(clampedMs - input.videoMs) < VIDEO_SYNC_EPSILON_MS) return null
  return clampedMs / 1000
}

/**
 * 播放中 — 视频 onTimeUpdate 之后，决定是否要把 hoverMs 写回到 videoMs 的 ms。
 *
 * 返回 null = 不动（暂停中 / 差距小）；
 * 返回 number(ms) = 新的 hoverMs（UI 应该调 setHoverMs 把游标挪到这里）。
 *
 * 播放过头（超过 sceneMs）的场景：返回 sceneMs，让游标停在末尾；真正的
 * "到点了停下来"由调用方监听 >= sceneMs 来 pause video。
 */
export function decideHoverFromVideo(input: SyncInputs): number | null {
  if (!input.isPlaying) return null
  if (!Number.isFinite(input.videoMs)) return null
  const clampedMs = clampMs(input.videoMs, input.sceneMs)
  if (Math.abs(clampedMs - input.hoverMs) < VIDEO_SYNC_EPSILON_MS) return null
  return clampedMs
}

/**
 * 播放中 — 检测"到终点了吗"。返回 true 时调用方应该停止播放 + seek 回 0（或
 * 保持在末尾，看产品；这里只判断）。
 *
 * 容忍 EPSILON_MS 是为了 30fps 视频里最后一帧可能是 scene - 33ms 的情况也
 * 算"到了"，避免用户体感"差那一点没停"。
 */
export function isAtSceneEnd(input: SyncInputs): boolean {
  return input.videoMs + VIDEO_SYNC_EPSILON_MS >= input.sceneMs
}

/** 保证 ms 在 [0, sceneMs] 且是有限数；失效值退 0。 */
function clampMs(ms: number, sceneMs: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0
  if (ms > sceneMs) return sceneMs
  return ms
}

// ─────────────────────────────────────────────────────────────────────
// 裁剪变体 —— v3.9 新增（时间轴视频 in/out 点）
//
// 心智模型：
//   - timelineMs ∈ [0, sceneMs]              作者时间轴坐标
//   - videoMs    ∈ [offset, offset+clipDur]  视频文件实际秒数坐标
//   - 映射：videoMs = timelineMs + offset     （把 0 时刻 shift 到 offset）
//   - 反向：timelineMs = videoMs - offset
//
// 旧函数假设 offset=0 / clipDur=sceneMs；新函数显式接受 trim 参数。
// 所有内部数学用 ms，只有最末端转秒贴 <video>.currentTime。
// ─────────────────────────────────────────────────────────────────────

export interface VideoTrim {
  /** 视频入点（ms）；默认 0 */
  offsetMs?: number
  /**
   * 视频裁剪段时长（ms）；默认 = sceneMs（不裁剪）。
   *
   * 为什么参数是 sceneMs 而不是 videoDurationMs：StagePane 播放始终以
   * scene.durationMs 为主（作者拉的时间轴）；clipDuration 只是"这段视频
   * 在裁剪后能播多久"的上限，`min(clipDuration, sceneMs)` 才是实际有效
   * 终点。
   */
  clipDurationMs?: number
}

/**
 * 计算有效的裁剪段 [startMs, endMs]（视频文件坐标，ms）。
 * 缺省：offset=0，end=sceneMs（即不裁剪，从 0 播到 sceneMs）。
 *
 * 注意返回的是**视频文件坐标**，不是时间轴坐标。
 */
export function resolveTrimRange(
  trim: VideoTrim | undefined,
  sceneMs: number,
): { startMs: number; endMs: number } {
  const offsetMs = Math.max(0, trim?.offsetMs ?? 0)
  const clipDurationMs =
    trim?.clipDurationMs != null && trim.clipDurationMs > 0
      ? trim.clipDurationMs
      : sceneMs
  return {
    startMs: offsetMs,
    endMs: offsetMs + clipDurationMs,
  }
}

/**
 * 作者在时间轴 hoverMs 处，视频应 seek 到视频文件的哪一秒？
 *
 * videoTargetMs = hoverMs + offset，并夹到裁剪段 [offset, offset+clip]。
 * 差距在 EPSILON 内返回 null（不抖）。
 *
 * v3.9.2：播放中也支持 seek（作者边播边点时间轴跳转），由 EPSILON 保护
 *        "onTimeUpdate 回写 hoverMs → 再触发 seek"的无效循环。
 *
 * 返回秒数（喂给 video.currentTime）。
 */
export function decideSeekFromHoverWithTrim(
  input: SyncInputs,
  trim: VideoTrim | undefined,
): number | null {
  const hoverClamped = clampMs(input.hoverMs, input.sceneMs)
  const { startMs, endMs } = resolveTrimRange(trim, input.sceneMs)
  // 时间轴 ms → 视频文件 ms
  const targetVideoMs = Math.min(endMs, Math.max(startMs, startMs + hoverClamped))
  if (Math.abs(targetVideoMs - input.videoMs) < VIDEO_SYNC_EPSILON_MS) {
    return null
  }
  return targetVideoMs / 1000
}

/**
 * 播放时：video 的 onTimeUpdate 报 videoMs（视频文件坐标），游标（时间轴
 * 坐标）应该设到哪里？
 *
 * timelineMs = videoMs - offset，并夹到 [0, sceneMs]。EPSILON 内不 emit。
 */
export function decideHoverFromVideoWithTrim(
  input: SyncInputs,
  trim: VideoTrim | undefined,
): number | null {
  if (!input.isPlaying) return null
  if (!Number.isFinite(input.videoMs)) return null
  const { startMs } = resolveTrimRange(trim, input.sceneMs)
  const rawTimelineMs = input.videoMs - startMs
  const clampedMs = clampMs(rawTimelineMs, input.sceneMs)
  if (Math.abs(clampedMs - input.hoverMs) < VIDEO_SYNC_EPSILON_MS) return null
  return clampedMs
}

/**
 * 播放中视频是否跑到了裁剪出点（或 scene 终点）。
 *
 * 判据：videoMs + EPSILON ≥ min(trim.endMs, offset + sceneMs)
 *
 * 为什么取 min：如果作者故意把 scene.durationMs < clipDurationMs（视频比
 * scene 长），到 scene 终点就该停；反之视频比 scene 短，到裁剪出点就该停。
 */
export function isAtTrimEnd(
  input: SyncInputs,
  trim: VideoTrim | undefined,
): boolean {
  const { startMs, endMs } = resolveTrimRange(trim, input.sceneMs)
  const sceneEndVideoMs = startMs + input.sceneMs
  const effectiveEnd = Math.min(endMs, sceneEndVideoMs)
  return input.videoMs + VIDEO_SYNC_EPSILON_MS >= effectiveEnd
}
