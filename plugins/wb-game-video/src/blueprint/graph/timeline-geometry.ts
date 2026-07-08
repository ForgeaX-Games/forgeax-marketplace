/**
 * 时间线几何 —— 把 TimelineElement 的 trigger/window 折算成时间轴上的 [startMs, endMs]，
 * 以及反向写回（拖拽/缩放/换轨）。TimelineStrip 与 StagePane 共用，保证同一套语义。
 *
 * 起点语义：window.startMs 优先；否则 trigger='at' 用 ms、'enter' 用 0、其余（performanceEnd/
 * exit/afterHit/stateChange）无固定时刻 → 记为 -1（时间轴不定位，靠列表编辑）。
 */
import type { TimelineElement } from './graph-schema'

/** 点元素在时间轴上的默认可见跨度（无 window.endMs 时）。 */
export const POINT_SPAN_MS = 1500

export function elementStartMs(el: TimelineElement): number {
  if (el.window?.startMs != null) return el.window.startMs
  if (el.trigger.when === 'at') return el.trigger.ms
  if (el.trigger.when === 'enter') return 0
  return -1
}

/** 时间轴块的结束时刻（用于渲染宽度 / 活跃判定）。 */
export function elementEndMs(el: TimelineElement, start = elementStartMs(el)): number {
  if (el.window?.endMs != null) return el.window.endMs
  if (start < 0) return start
  return start + POINT_SPAN_MS
}

/** cursorMs 时该元素是否"活跃"（用于 StagePane 决定显不显示）。 */
export function isElementActiveAt(el: TimelineElement, cursorMs: number): boolean {
  const start = elementStartMs(el)
  if (start < 0) return false
  const end = el.window?.endMs ?? start + POINT_SPAN_MS
  return cursorMs >= start && cursorMs <= end
}

/** 写回起点：有 window 则整体平移（保长度）；否则落到 trigger='at'。 */
export function withElementStart(el: TimelineElement, nextStart: number): TimelineElement {
  const s = Math.max(0, Math.round(nextStart))
  if (el.window?.startMs != null) {
    const len = (el.window.endMs ?? el.window.startMs) - el.window.startMs
    return { ...el, window: { startMs: s, endMs: el.window.endMs != null ? s + len : undefined }, trigger: { when: 'at', ms: s } }
  }
  return { ...el, trigger: { when: 'at', ms: s } }
}

/** 写回结束：确保 window.endMs ≥ startMs+最小跨度。 */
export function withElementEnd(el: TimelineElement, nextEnd: number): TimelineElement {
  const start = el.window?.startMs ?? (el.trigger.when === 'at' ? el.trigger.ms : 0)
  const end = Math.max(start + 100, Math.round(nextEnd))
  return { ...el, window: { startMs: start, endMs: end } }
}

/** 写回层级（换轨）。 */
export function withElementLayer(el: TimelineElement, layer: number): TimelineElement {
  return { ...el, layer: Math.max(0, Math.round(layer)) }
}

/** 元素所在轨道（缺省 layer=0）。 */
export function elementLayer(el: TimelineElement): number {
  return el.layer ?? 0
}
