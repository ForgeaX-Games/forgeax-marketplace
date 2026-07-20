/**
 * nudgeVideoOffset —— VIDEO clip 的"左移 / 右移"平移逻辑（v3.9.8）。
 *
 * 与 `computeVideoTrim` 区别：
 *   · computeVideoTrim 是 handle 拖拽，两侧 handle 分别改 offset / clip
 *   · nudgeVideoOffset 是 toolbar 的 ◀ / ▶ + 键盘 ← / → 按键：
 *     平移视频入点，**clip 长度不变**；"从视频文件的哪一段取素材"整段挪。
 *
 * 约束：
 *   · offset ≥ 0
 *   · offset + clip ≤ natural（如果 natural 已知）—— 挪到视频尾部不能再往右
 *   · 若 natural 未知（旧数据没 probe 到），不封顶，让作者能操作；超了时
 *     播放层会自动截短（HTMLVideoElement 读不到的帧跳黑）。
 *
 * 拆文件原因：
 *   · Timeline.tsx 是巨石组件，在里面写会 Fast Refresh 被拒（React 规则：
 *     一个文件只能 export 组件或非组件 helper 的其中之一）
 *   · 纯函数好单测，跟 `computeVideoTrim` 放同目录便于对比
 */
export function nudgeVideoOffset(args: {
  currentOffsetMs: number
  clipDurationMs: number
  deltaMs: number
  naturalDurationMs?: number
}): number {
  const { currentOffsetMs, clipDurationMs, deltaMs, naturalDurationMs } = args
  const safeOffset = Math.max(0, currentOffsetMs)
  const safeClip = Math.max(0, clipDurationMs)
  const maxOffset =
    naturalDurationMs != null && naturalDurationMs > 0
      ? Math.max(0, naturalDurationMs - safeClip)
      : Number.POSITIVE_INFINITY
  const next = safeOffset + deltaMs
  return Math.max(0, Math.min(maxOffset, next))
}
