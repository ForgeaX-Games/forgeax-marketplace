/**
 * overlayChildPreview —— 把一个 OverlayChild 通用地渲染成预览节点（节点无关）。
 *
 * 不写死任何具体皮肤 id：按 component 查注册表的 role/surface 分流 —— HUD / 交互 / 表现，
 * 各自造对应的运行态 snap 交给 SkinRegistry 渲染。皮肤是什么就画什么，编辑器不认识具体皮肤。
 *
 * timeMs 统一转成 `localMsForChild` 本地时刻再传给皮肤的 preview/previewTimeMs——
 * 供支持预览态的皮肤（如 inkKou / inkYingMo）驱动动画/显隐。
 */
import type { ReactNode } from 'react'
import type { OverlayChild } from '../../runtime/schema/graph-schema'
import { defaultsForComponent, getComponent } from '../../runtime/registry/component-registry'
import type { HudElementView, SkinCtx, SkinRegistry } from '../../runtime/skins/rendererRegistry'
import { applyStyleLockedEventParams } from '../video/graphMaterialOps'
import { localMsForChild } from './previewClock'

/**
 * 渲染单个 overlay child 到预览。timeMs = 当前播放头（相对整段素材）；未知 component 返回 null（不炸）。
 *
 * 缺省字段兜底：老数据 / 手改 JSON 常见只写 `{ id, component }` 不带 `inputs`——皮肤按自己的
 * `inputs.events` 之类必填字段 map 渲染，缺了就画不出任何东西（不报错，纯静默空白，
 * 容易被误当成「组件坏了」）。这里用 `defaultsForComponent` 兜底缺省值，child 自己写的字段仍优先。
 *
 * 叩击/防反/應默/技能条这几个样式锁定组件还要再过一遍 `applyStyleLockedEventParams`——
 * 通用 defaultsForComponent 只给得出无皮肤特征的泛用兜底（"选项一"），这几个组件自己的出口
 * 文案（應/默、斩/突/守…）只有这个函数知道，预览才能跟真正克隆出来的实例长一样。
 */
export function renderOverlayChildPreview(
  child: OverlayChild,
  reg: SkinRegistry,
  ctx: SkinCtx,
  timeMs: number,
): ReactNode {
  const plugin = getComponent(child.component)
  const inputs = applyStyleLockedEventParams(
    { ...defaultsForComponent(child.component), ...(child.inputs ?? {}) },
    child.component,
  )
  const preview = { timeMs: localMsForChild(child, timeMs) }

  if (plugin?.surface === 'hud') {
    const bind = typeof inputs.bind === 'string' ? inputs.bind : child.id
    const label = typeof inputs.label === 'string' ? inputs.label : undefined
    const accent = typeof inputs.accent === 'string' ? inputs.accent : undefined
    const el: HudElementView = { element: bind, component: child.component, bind, label, accent, layout: child.layout }
    return reg.renderHudElement(el, ctx, preview)
  }

  if (plugin?.role === 'interaction') {
    return reg.renderInteraction(
      {
        elementId: child.id,
        component: child.component,
        inputs,
        handles: [],
        timeoutMs: typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined,
      },
      () => {},
      ctx,
      preview,
    )
  }

  // 表现层（dialogue / floatText / transition …）
  return reg.renderOverlay(
    {
      elementId: child.id,
      component: child.component,
      inputs,
    },
    undefined,
    preview,
  )
}
