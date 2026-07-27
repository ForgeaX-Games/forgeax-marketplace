/**
 * overlayChildPreview —— 把一个 OverlayChild 通用地渲染成预览节点（节点无关）。
 *
 * 统一走 overlay 表 + skinCtx；交互/表现不再分流。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { OverlayChild } from '../../runtime/schema/graph-schema'
import { defaultsForComponent, positionModeOf } from './editors'
import type { SkinCtx, SkinRegistry } from '../../runtime/component-host/rendererRegistry'
import { childWrapStyle } from '../../runtime/schema/layout'
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
  // 定位模式决定外包盒（与画布拖拽写的字段一致）：
  //  · inputs 型（字幕/选项等自锚定皮肤）→ 满屏透明层，皮肤靠 inputs.x/y 自定位。
  //  · layout 型（横幅/面板等流式组件）→ 按 child.layout.left/top 定位，故拖 layout 能移动它。
  const wrapStyle: CSSProperties = positionModeOf(child.component).kind === 'inputs'
    ? STAGE_FILL_WRAP
    : { ...childWrapStyle(child.layout ?? { left: 0, top: 0 }, false), pointerEvents: 'none' }
  return <div style={wrapStyle}>{body}</div>
}
