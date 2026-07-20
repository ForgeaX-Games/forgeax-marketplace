/**
 * 运行时「泛型指令」—— 引擎(GraphRuntime, 纯 TS) 对外只产出这组渲染无关指令，由 Player
 * 侧的**渲染器 registry**按 `kind` 派发成实际 UI（视频/HUD/QTE/选项/漂字…）。
 *
 * 关键设计（spec §3.3）：presentation / interaction 用**泛型** `renderOverlay` / `openInteraction`
 * 携带 `{ kind, inputs }`，而不是每种玩法一个 directive 类型——这样新增 kind 时 Player 只需在
 * registry 注册一个渲染器，**不必改 Player 的 switch**（消除旧 BlueprintPlayer 的 else-if 爆炸）。
 */

/** 播放某节点的演出（视频/占位 + loop）。 */
export interface PlayClipDirective {
  type: 'playClip'
  nodeId: string
  name: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}

import type { Layout } from '../schema/node-config-schema'

/** 表现层元素（漂字/贴纸/字幕/转场…）→ 由 renderer registry 按 component 渲染。 */
export interface RenderOverlayDirective {
  type: 'renderOverlay'
  nodeId: string
  /** 挂载键（节点 overlayNodes 或 spawn 瞬态 id）；kind.render 可省略，由引擎补齐。 */
  mountId?: string
  /** 挂载级排版：相对视频舞台；无显式尺寸 → 自适应内容。 */
  mountLayout?: Layout
  elementId: string
  component: string
  inputs: Record<string, unknown>
  /** 子组件级排版：相对挂载盒；挂载有尺寸时缺省 = 左上角。 */
  childLayout?: Layout
  /**
   * 组件自定位：内部用 %/inset 相对父框摆放（如 floatText 用 x/y）。
   * 为真时子盒需铺满挂载盒且点击穿透，否则组件的百分比会相对零尺寸盒塌成左上角。
   */
  selfPositioned?: boolean
}

/** 交互层元素（qte/choice/skill/hotspot…）→ 呈现并等待玩家输入；handles = 可产出的出口。 */
export interface OpenInteractionDirective {
  type: 'openInteraction'
  nodeId: string
  elementId: string
  component: string
  inputs: Record<string, unknown>
  handles: string[]
  /** 限时 ms（choice/skill 的 timeoutMs；QTE 亦接受 windowMs/durationMs 归一）。>0 时 Player 到时自动 submit(undefined) 走缺省出口。 */
  timeoutMs?: number
}

/** 移除某个已渲染的表现层叠层（window.endMs 到点：如漂字/计时器只显示某时段）。 */
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
  | OpenInteractionDirective
  | HudUpdateDirective
  | StateChangedDirective
  | RouteInfoDirective
  | LogDirective

export function isOpenInteraction(d: RuntimeDirective): d is OpenInteractionDirective {
  return d.type === 'openInteraction'
}
export function isRenderOverlay(d: RuntimeDirective): d is RenderOverlayDirective {
  return d.type === 'renderOverlay'
}
export function isPlayClip(d: RuntimeDirective): d is PlayClipDirective {
  return d.type === 'playClip'
}
