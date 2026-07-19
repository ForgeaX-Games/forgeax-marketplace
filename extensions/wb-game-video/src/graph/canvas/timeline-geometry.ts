/**
 * 时间几何 —— 把 Overlay child 的 trigger/window 折算成时间轴上的 [startMs, endMs]。
 */
import type { OverlayInstanceChild } from '../../runtime/schema/node-config-schema'

export function elementStartMs(el: OverlayInstanceChild): number {
  if (el.window?.startMs != null) return el.window.startMs
  if (el.trigger.when === 'at') return el.trigger.ms
  return 0
}

export function elementEndMs(el: OverlayInstanceChild, start = elementStartMs(el)): number {
  if (el.window?.endMs != null) return el.window.endMs
  return start + 1000
}

export function isElementActiveAt(el: OverlayInstanceChild, cursorMs: number): boolean {
  const a = elementStartMs(el)
  const b = elementEndMs(el, a)
  return cursorMs >= a && cursorMs < b
}

export function withElementStart(el: OverlayInstanceChild, nextStart: number): OverlayInstanceChild {
  const end = elementEndMs(el)
  const start = Math.max(0, nextStart)
  if (el.trigger.when === 'at') {
    return { ...el, trigger: { when: 'at', ms: start }, window: el.window ? { ...el.window, startMs: start } : { startMs: start, endMs: end } }
  }
  return { ...el, window: { startMs: start, endMs: Math.max(start + 1, end) } }
}

export function withElementEnd(el: OverlayInstanceChild, nextEnd: number): OverlayInstanceChild {
  const start = elementStartMs(el)
  return { ...el, window: { startMs: start, endMs: Math.max(start + 1, nextEnd) } }
}

export function withElementZIndex(el: OverlayInstanceChild, zIndex: number): OverlayInstanceChild {
  return { ...el, layout: { ...el.layout, zIndex } }
}

export function elementZIndex(el: OverlayInstanceChild): number {
  return el.layout?.zIndex ?? 0
}
