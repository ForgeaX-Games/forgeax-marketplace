/**
 * 运行时「泛型指令」—— 引擎(GraphRuntime, 纯 TS) 对外只产出这组渲染无关指令，由 Player
 * 侧的**渲染器 registry**按 `component` 派发成实际 UI。
 *
 * 全部组件统一 `renderOverlay`（含原 interaction）；玩家结果经 session.emitEvent，无 openInteraction。
 */

import type { Layout } from '../schema/node-config-schema'

/** 播放某节点的演出（视频/占位 + loop）。 */
export interface PlayClipDirective {
  type: 'playClip'
  nodeId: string
  name: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}

/** 叠层元素 → 由 renderer registry 按 component 渲染。 */
export interface RenderOverlayDirective {
  type: 'renderOverlay'
  nodeId: string
  /** 挂载键（节点 overlayNodes 或 spawn 瞬态 id）；可省略，由引擎补齐。 */
  mountId?: string
  /** 挂载级排版：相对视频舞台；无显式尺寸 → 自适应内容。 */
  mountLayout?: Layout
  elementId: string
  component: string
  inputs: Record<string, unknown>
  /** 子组件级排版：相对挂载盒；有则映射为 CSS，无且挂载有尺寸 → 铺满挂载盒。 */
  childLayout?: Layout
}

/** 移除某个已渲染的叠层（window.endMs 到点）。 */
export interface RemoveOverlayDirective {
  type: 'removeOverlay'
  nodeId: string
  elementId: string
}

/** HUD 需要刷新（读全局态重绘）。 */
export interface HudUpdateDirective {
  type: 'hudUpdate'
  nodeId: string
}

/** 全局态发生变化（血量/数值/flag），视图据此刷新。 */
export interface StateChangedDirective {
  type: 'stateChanged'
}

/** 走了哪条边进入下一节点 + 命中的条件（含实时值）——用于日志「进入原因」。 */
export interface RouteInfoDirective {
  type: 'routeInfo'
  via: string
  target: string
  reason: string
}

/** 日志（调试 / 可视化事件流）。 */
export interface LogDirective {
  type: 'log'
  message: string
}

export type RuntimeDirective =
  | PlayClipDirective
  | RenderOverlayDirective
  | RemoveOverlayDirective
  | HudUpdateDirective
  | StateChangedDirective
  | RouteInfoDirective
  | LogDirective

export function isRenderOverlay(d: RuntimeDirective): d is RenderOverlayDirective {
  return d.type === 'renderOverlay'
}
export function isPlayClip(d: RuntimeDirective): d is PlayClipDirective {
  return d.type === 'playClip'
}
