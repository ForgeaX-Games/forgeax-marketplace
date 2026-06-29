import type { Shot } from '../../scenario/types'

/**
 * `resolveShotAtMs` —— 把一个 "scene 时间轴光标 ms" 映射到 "当前应选中的 shot id"。
 *
 * 这是 Timeline 拖动 playhead 后 **自动同步 PromptTabs / StagePane** 的核心纯函数。
 *
 * 规则（按优先级）：
 *   1) 若 shot 有显式 `startMs / endMs`，用区间严格匹配：
 *      `startMs <= ms < endMs`
 *      一旦命中直接返回该 shot.id，不再看其他 shot。
 *      （显式时段 = 作者拖过一次时间轴的镜头，权威）
 *
 *   2) 若所有 shot 都没显式时段（典型"刚从脚本拆完分镜"情况），
 *      按 `order` 均分 `totalMs` 兜底：
 *        idx = clamp(floor(ms / totalMs * shotsLen), 0, shotsLen-1)
 *      返回 shots.sort(order)[idx].id。
 *
 *   3) 混合态（部分 shot 有显式 span，部分没）：
 *      先扫有 span 的看命中；没命中再对"空白区间"按均分兜底 —— 实际上
 *      Timeline 的 `shotSpan()` 规则保证每个 shot 最终都有一个 span（显式或
 *      均分 fallback），所以这里同样对"按 order 均分兜底"的 shots 统一处理：
 *      先构造 `effectiveSpans[i] = { startMs, endMs }`，再做区间命中。
 *
 *   4) 边界：
 *      · ms < 第一个 shot.startMs         → 返回第一个 shot.id
 *      · ms >= 最后一个 shot.endMs        → 返回最后一个 shot.id
 *      · shots.length === 0                → 返回 null
 *      · totalMs <= 0                       → 返回第一个 shot.id（无法均分）
 *
 * 纯函数、无副作用，便于单测；调用方（Timeline.track RAF）拿到 id 后自己
 * 决定是否调 setSelectedShotId（避免重复写入）。
 */
export function resolveShotAtMs(
  shots: Shot[] | undefined,
  ms: number,
  totalMs: number,
): string | null {
  if (!shots || shots.length === 0) return null
  const sorted = shots.slice().sort((a, b) => a.order - b.order)

  // Step 1：计算每个 shot 的"有效 span"。与 Timeline.shotSpan() 保持一致：
  //   显式 startMs/endMs 优先；否则按 order 均分 totalMs。
  const total = Math.max(1, totalMs)
  const spans = sorted.map((shot, idx) => {
    const start =
      shot.startMs != null
        ? shot.startMs
        : Math.round((idx * total) / sorted.length)
    const end =
      shot.endMs != null
        ? shot.endMs
        : Math.round(((idx + 1) * total) / sorted.length)
    return { id: shot.id, startMs: start, endMs: end }
  })

  // Step 2：边界
  const clamped = Math.max(0, ms)
  // spans is non-empty here (sorted derives from shots, guarded above), but
  // noUncheckedIndexedAccess can't prove it — capture with a guard.
  const first = spans[0]
  const last = spans[spans.length - 1]
  if (!first || !last) return null
  if (clamped < first.startMs) return first.id
  if (clamped >= last.endMs) return last.id

  // Step 3：区间命中。注意区间左闭右开（与 Timeline keyframe 语义一致）。
  for (const s of spans) {
    if (clamped >= s.startMs && clamped < s.endMs) return s.id
  }

  // 理论不会到这（前面的 edge case 已覆盖），保险起见回退到离得最近的那个
  let best = first
  let bestDist = Math.abs(clamped - (best.startMs + best.endMs) / 2)
  for (const s of spans.slice(1)) {
    const mid = (s.startMs + s.endMs) / 2
    const d = Math.abs(clamped - mid)
    if (d < bestDist) {
      best = s
      bestDist = d
    }
  }
  return best.id
}
