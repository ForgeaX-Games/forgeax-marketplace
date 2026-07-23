/**
 * overlayChildPreview —— 把一个 OverlayChild 通用地渲染成预览节点（节点无关）。
 *
 * 统一走 overlay 表 + skinCtx；交互/表现不再分流。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { OverlayChild } from '../../runtime/schema/graph-schema'
import { defaultsForComponent } from './editors'
import type { SkinCtx, SkinRegistry } from '../../runtime/component-host/rendererRegistry'
import { childWrapStyle, layoutHasExplicitSize } from '../../runtime/schema/layout'
import { applyStyleLockedEventParams } from '../video/graphMaterialOps'
import { localMsForChild } from './previewClock'

const STAGE_FILL_WRAP: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

/**
 * 渲染单个 overlay child 到预览。timeMs = 当前播放头（相对整段素材）；未知 component 返回 null（不炸）。
 */
export function renderOverlayChildPreview(
  child: OverlayChild,
  reg: SkinRegistry,
  ctx: SkinCtx,
  timeMs: number,
): ReactNode {
  const inputs = applyStyleLockedEventParams(
    { ...defaultsForComponent(child.component), ...(child.inputs ?? {}) },
    child.component,
  )
  const preview = { timeMs: localMsForChild(child, timeMs) }

  const body = reg.renderOverlay(
    {
      elementId: child.id,
      component: child.component,
      inputs,
    },
    undefined,
    preview,
    ctx,
  )
  if (!body) return null
  const wrapStyle: CSSProperties = layoutHasExplicitSize(child.layout)
    ? { ...childWrapStyle(child.layout, true), pointerEvents: 'none' }
    : STAGE_FILL_WRAP
  return <div style={wrapStyle}>{body}</div>
}
