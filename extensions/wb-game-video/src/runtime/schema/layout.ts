/**
 * Layout → CSS（绝对定位）。overlay 内组件 / 挂载相对视频等共用。
 */
import type { CSSProperties } from 'react'
import type { Layout, LayoutValue } from './node-config-schema'

/** number → 百分比（含负值）；已是 `%`/`px` 串则原样。 */
export function layoutValueToCss(v: LayoutValue): string {
  if (typeof v === 'number') return `${v * 100}%`
  return v
}

/** 转成可直接挂到绝对定位节点上的 style。无 layout 时仅 `position:absolute`。 */
export function layoutToCss(layout: Layout | undefined): CSSProperties {
  const style: CSSProperties = { position: 'absolute' }
  if (!layout) return style
  if (layout.top != null) style.top = layoutValueToCss(layout.top)
  if (layout.right != null) style.right = layoutValueToCss(layout.right)
  if (layout.bottom != null) style.bottom = layoutValueToCss(layout.bottom)
  if (layout.left != null) style.left = layoutValueToCss(layout.left)
  if (layout.width != null) style.width = layoutValueToCss(layout.width)
  if (layout.height != null) style.height = layoutValueToCss(layout.height)
  if (layout.zIndex != null) style.zIndex = layout.zIndex
  const tx = layout.translateX != null ? layoutValueToCss(layout.translateX) : null
  const ty = layout.translateY != null ? layoutValueToCss(layout.translateY) : null
  if (tx != null || ty != null) {
    style.transform = `translate(${tx ?? '0'}, ${ty ?? '0'})`
  }
  return style
}
