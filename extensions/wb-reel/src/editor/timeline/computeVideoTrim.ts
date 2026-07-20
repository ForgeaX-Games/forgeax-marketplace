/**
 * computeVideoTrim —— VIDEO 轨道 handle 拖拽的纯函数。
 *
 * 输入：当前 offset/clip、拖拽 delta（ms，正 = 向右拖、即"时间变大"）、handle 类型
 *        外加可选的 `naturalDurationMs`（原视频时长上限，v3.9.1）。
 * 输出：下一组 offset/clip，已做边界保护（offset ≥ 0、clip ≥ 100ms）
 *
 * 左 handle：
 *   "向右拖（delta>0）= 裁更多头、offset 增大、clip 减小"
 *   "向左拖（delta<0）= 恢复被裁的头、offset 减小、clip 增大"
 *   → 出点时刻保持不动：offset + clip = const
 *
 * 右 handle：
 *   "向右拖（delta>0）= 恢复被裁的尾、clip 增大" → offset 不变
 *   "向左拖（delta<0）= 裁更多尾、clip 减小"
 *   v3.9.1：右 handle 上限 = naturalDurationMs - offset（不得超过视频原长）
 *
 * 单独拆文件是为了：
 *   1) 让 Timeline.tsx 满足 React Fast Refresh 的"单文件只 export 组件或只 export 非组件"约束
 *   2) 单测纯函数，不牵扯 Timeline 巨石依赖
 */

const MIN_CLIP_MS = 100

export function computeVideoTrim(
  handle: 'left' | 'right',
  offset: number,
  clip: number,
  deltaMs: number,
  naturalDurationMs?: number,
): { offsetMs: number; clipDurationMs: number } {
  const safeOffset0 = Math.max(0, offset)
  const safeClip0 = Math.max(MIN_CLIP_MS, clip)
  // 原视频时长上限；未传或 <=0 视作无上限（向后兼容旧数据）
  const naturalMax =
    naturalDurationMs != null && naturalDurationMs > 0
      ? naturalDurationMs
      : Infinity
  if (handle === 'left') {
    // 左 handle 保持"出点时刻不动"：offset + clip = 常量
    const endMs = safeOffset0 + safeClip0
    const nextOffset = Math.max(
      0,
      Math.min(endMs - MIN_CLIP_MS, safeOffset0 + deltaMs),
    )
    return {
      offsetMs: nextOffset,
      clipDurationMs: endMs - nextOffset,
    }
  }
  // 右 handle：offset 不动，clip 自由变；但不得越过原视频时长
  const maxClip = Math.max(MIN_CLIP_MS, naturalMax - safeOffset0)
  const nextClip = Math.min(
    maxClip,
    Math.max(MIN_CLIP_MS, safeClip0 + deltaMs),
  )
  return { offsetMs: safeOffset0, clipDurationMs: nextClip }
}
