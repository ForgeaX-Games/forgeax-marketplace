/**
 * 时间轴剪辑算子 —— 纯函数，不依赖 store。
 *
 * 给 Shot / AudioClip / DialogueLine 这样的"时间段"对象提供统一的：
 *   · splitAt(atMs)       —— 一段切成两段（剪切）
 *   · compactLeft(items)  —— 自动左对齐（消除轨道空隙）
 *   · clampToScene(...)   —— 夹进 [0, sceneDurationMs]
 *
 * 为什么不直接 set() 进 store？
 *   - 单测方便：不需要 Zustand runtime
 *   - 逻辑可被复用到 dialogue / shot / audio 三类 clip，不重复写
 */

/**
 * 任何有 "时间起止" 语义的 clip —— Shot / Dialogue 的 startMs/endMs，
 * AudioClip 的 startMs/durationMs 形态都能映射进来。
 */
export interface TimeSpan {
  startMs: number
  endMs: number
}

/** endMs 可能缺省（DialogueLine），调用方用这个 helper 夹进 total */
export function resolveEndMs(t: {
  startMs: number
  endMs?: number
}, fallbackMs: number): number {
  if (typeof t.endMs === 'number') return t.endMs
  return fallbackMs
}

/**
 * 把一段 [startMs, endMs] 按 atMs 切成两段 —— 不改动 id 字段，调用方自行签新 id。
 *
 * 输入：span { startMs, endMs }, atMs 必须落在 (startMs, endMs)（严格开区间）
 * 输出：[left, right]，满足 left.endMs === right.startMs === atMs
 *
 * 约束：
 *   - atMs ≤ startMs → 返回 [null, span]
 *   - atMs ≥ endMs   → 返回 [span, null]
 *   - 合法切点       → 两段；duration 至少 1ms，保证都不是空 clip
 */
export function splitAt<T extends TimeSpan>(
  span: T,
  atMs: number,
): [T | null, T | null] {
  if (atMs <= span.startMs) return [null, span]
  if (atMs >= span.endMs) return [span, null]
  return [
    { ...span, endMs: atMs },
    { ...span, startMs: atMs },
  ]
}

/**
 * 左对齐 —— 按 startMs 升序排，从 0 开始依次紧挨，保留各 clip 原 duration。
 *
 * 使用场景：作者连续拖了几段后，轨道里出现空隙；点击"自动左对齐"一键压实。
 *
 * 稳定性：同 startMs 时按原数组顺序稳定排序（避免抖动）。
 */
export function compactLeft<T extends TimeSpan>(items: T[]): T[] {
  if (items.length === 0) return items
  const withIndex = items.map((item, i) => ({ item, i }))
  withIndex.sort((a, b) => {
    if (a.item.startMs !== b.item.startMs) return a.item.startMs - b.item.startMs
    return a.i - b.i
  })
  let cursor = 0
  const out: T[] = []
  for (const { item } of withIndex) {
    const dur = Math.max(1, item.endMs - item.startMs)
    out.push({ ...item, startMs: cursor, endMs: cursor + dur })
    cursor += dur
  }
  return out
}

/**
 * 把一段 clip 夹进 [0, totalMs]：
 *   - 保持原 duration 不变（等价于沿时间轴平移，不压缩）
 *   - 如果 duration > totalMs，则裁到 [0, totalMs]
 *
 * 典型用途：拖入新 clip 时不要让它超出 scene 边界。
 */
export function clampToScene<T extends TimeSpan>(
  span: T,
  totalMs: number,
): T {
  const dur = Math.max(1, Math.min(totalMs, span.endMs - span.startMs))
  let start = Math.max(0, Math.min(totalMs - dur, span.startMs))
  const end = start + dur
  if (start < 0) start = 0
  return { ...span, startMs: start, endMs: end }
}

/**
 * 把一条 clip "移到 targetStartMs"，保持原 duration；夹到 scene 边界内。
 */
export function moveTo<T extends TimeSpan>(
  span: T,
  targetStartMs: number,
  totalMs: number,
): T {
  const dur = Math.max(1, span.endMs - span.startMs)
  const next = { ...span, startMs: targetStartMs, endMs: targetStartMs + dur }
  return clampToScene(next, totalMs)
}
