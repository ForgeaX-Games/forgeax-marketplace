/**
 * 组件注册契约 —— Overlay child 的**唯一扩展点**。
 *
 * 落盘字段只有 `OverlayChild.component`；注册键（`registerComponent(id, def)` 的 `id`）与之直接对应，
 * 一一对齐，无别名/分类折叠——皮肤（如 `inkKou`/`battleParry`）本身就是独立注册的顶层组件 id，
 * 不再经由「基础类型 + inputs.component 覆盖」这层间接。`role` / `surface` 仅注册表内部，不进 OverlayChild。
 * 没有「组件种类」这层概念——只有一个个独立组件，各自的能力由自己 `inputs` 里声明了什么结构化打（如
 * `component: 'qteCues'`）决定；要不要按某种专属交互对待，永远问 inputs 长什么样，不查任何分类标签。
 *
 * 多局并行：每个 GraphRuntime / GraphSession 持有自己的实例；
 * 模块级 `registerComponent` / `getComponent` 仍指向默认表。
 */
import type { ComponentEvent, ComponentInput, ComponentManifest, Overlay } from '../schema/node-config-schema'
import type { ElementRole, GameNode, NodeHandle } from '../schema/graph-schema'
import type { OverlayInstanceChild } from '../schema/node-config-schema'
import { expandNodeOverlays } from '../schema/expand-overlay'
import { eventsFromParams } from '../schema/overlay-events'
import type { MutableState } from '../engine/apply-effects'
import type { RuntimeDirective } from '../engine/directives'

/** 引擎给运行时契约的上下文（纯数据，模块不摸 DOM、不反读引擎内部）。 */
export interface RuntimeCtx {
  state: MutableState
  nodeId: string
  elapsedMs: number
  /** 当前正在执行的时间线元素 id（render/present 构造 directive 用）。 */
  elementId?: string
}

export interface ComponentDef<P = Record<string, unknown>> {
  /** 引擎调度用（不进落盘 OverlayChild）。 */
  role: ElementRole
  /** HUD 呈现面（GraphPlaySurface 等据此分流）。 */
  surface?: 'hud'
  /**
   * 组件内部用 %/inset 相对父框定位；挂载未配 layout 时，父框需铺满视频舞台。
   * （如 floatText / dialogue / transition）
   */
  stageRelative?: boolean
  /**
   * 组件会抛出的**事件**（= 出口 handle 来源）。
   * 静态出口写这里（如 qte 的 pass/good/fail）；随实例变化的（choice/hotspot 的选项）写在 `inputs.events`，
   * 运行时出口 = `inputs.events`（若有）否则本字段（见 `handlesOf`）。
   */
  events?: ComponentEvent[]
  /** 中文标签（编辑器「+ 元素」菜单展示）；缺省用 component id。 */
  label?: string
  /**
   * **输入契约（In · 唯一 SSOT）**：组件接收哪些 inputs 及其语义类型 + `default`（新建初值）。
   * 进 `ComponentManifest.inputs`；编辑器据此自动渲染配置控件（valueType→控件、options→select、component→复合编辑器）。
   * 新建实例默认值由各 input 的 `default` 组装（`buildDefaults`），不再有 `defaults()` 方法。
   */
  inputs?: ComponentInput[]

  // ── 可选行为逃生舱（默认数据驱动；仅少数组件需要）──────────────────────────────
  /** 作者期跨字段校验（如 floatText 需 text||expr）；必填/类型由 inputs.required/valueType 兜底。 */
  validate?(inputs: P): string[]
  /**
   * 到触发时机按当前态**算出要发的 overlay 指令**（唯一命令式钩子，供 floatText 之类按 expr 求值）。
   * 多数 presentation 无 render：走引擎泛型 renderOverlay，Player 按 inputs 直接画。
   * interaction 无判定钩子：皮肤自判定后经 emit 抛已声明 event id，引擎按事件路由。
   */
  render?(ctx: RuntimeCtx, inputs: P): RuntimeDirective[]
}

/** 从 inputs[].default 组装新建实例默认值（取代旧 `defaults()` 方法）。 */
export function buildDefaults(inputs: ComponentInput[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const i of inputs ?? []) if (i.default !== undefined) out[i.key] = i.default
  return out
}

/** 可注入的组件注册表（每局 Runtime 一份即可隔离）。 */
export class ComponentRegistry {
  private readonly components = new Map<string, ComponentDef>()
  private readonly plugins = new Map<string, { version?: string }>()

  registerComponent<P>(id: string, def: ComponentDef<P>): void {
    this.components.set(id, def as unknown as ComponentDef)
  }
  unregisterComponent(id: string): void {
    this.components.delete(id)
  }
  /** 按 OverlayChild.component 查找。 */
  getComponent(componentId: string): ComponentDef | undefined {
    return this.components.get(componentId)
  }
  listComponents(): ComponentDef[] {
    const seen = new Set<ComponentDef>()
    const out: ComponentDef[] = []
    for (const p of this.components.values()) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  }

  /** 组件导出清单（manifest）：inputs（契约）+ events（无则从 inputs 默认值折）。 */
  getManifest(componentId: string): ComponentManifest | undefined {
    const p = this.getComponent(componentId)
    if (!p) return undefined
    const inputs = p.inputs ?? []
    const events = p.events?.length ? p.events : eventsFromParams(buildDefaults(inputs))
    const label = p.label ?? componentId
    return {
      id: componentId,
      label,
      ...(inputs.length ? { inputs } : {}),
      events,
    }
  }

  /** 新建该组件实例的默认 inputs 值（由 inputs[].default 组装）。 */
  defaultsFor(componentId: string): Record<string, unknown> {
    return buildDefaults(this.getComponent(componentId)?.inputs)
  }

  /**
   * 组件实例的出口 handle：实例 `inputs.events`（choice/hotspot 的选项，若有）否则组件静态 `events`（qte 的 pass/good/fail）。
   * 取代旧的 `outputs(inputs)` 方法。
   */
  handlesOf(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
    const p = this.getComponent(componentId)
    if (!p) return []
    const fromInputs = eventsFromParams(inputsBag ?? {})
    const events = fromInputs.length ? fromInputs : (p.events ?? [])
    return events.map((e) => ({ id: e.id, label: e.label }))
  }

  registerPlugin(id: string, meta?: { version?: string }): void {
    this.plugins.set(id, { version: meta?.version })
  }
  unregisterPlugin(id: string): void {
    this.plugins.delete(id)
  }
  hasPlugin(id: string, version?: string): boolean {
    const meta = this.plugins.get(id)
    if (!meta) return false
    if (version != null && version !== '' && meta.version !== version) return false
    return true
  }
  listPlugins(): Array<{ id: string; version?: string }> {
    return [...this.plugins.entries()].map(([id, m]) => ({ id, version: m.version }))
  }

  /**
   * 派生节点出口目录（outlets）：保留字 `default` + 各挂载组件可发事件。
   * interaction → `outputs(inputs)`（= inputs.events）；presentation 等有 events 的（如面板按钮）一并纳入。
   * 走向由边承接（sourceHandle === 出口 id）。
   */
  deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
    const instances = expandNodeOverlays(overlays, node)
    const children: OverlayInstanceChild[] = instances.flatMap((i) => i.children)
    const out: NodeHandle[] = [{ id: 'default' }]
    for (const el of children) out.push(...this.handlesOf(el.component, el.inputs as Record<string, unknown>))
    const seen = new Set<string>()
    return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  }
}

/** 编辑器 / 单测默认表（模块单例）。多局试玩请用 `createCoreComponentRegistry()` 新建实例。 */
export const defaultComponentRegistry = new ComponentRegistry()

export function registerComponent<P>(id: string, def: ComponentDef<P>): void {
  defaultComponentRegistry.registerComponent(id, def)
}
export function unregisterComponent(id: string): void {
  defaultComponentRegistry.unregisterComponent(id)
}
export function getComponent(componentId: string): ComponentDef | undefined {
  return defaultComponentRegistry.getComponent(componentId)
}

/**
 * 该组件是否支持「自由拖拽定位」——**唯一官方入口**，纯结构化推导，不设独立开关字段：
 * 组件 `inputs` 里同时声明了 `x` 和 `y` 才算支持（渲染端才有地方读、写回才有地方落）；
 * 缺其一 → 不支持（HUD 类血条/气力条按角色/规则锚定固定屏幕位置，inputs 里本就没有 x/y）。
 * 未注册组件默认 `true`（保持编辑器旧行为，宁可给手柄不误判）。
 * 新增组件只需在自己 `inputs` 里老实声明 x/y——不必回来改这个函数，也不必再加一个平行的
 * `positionable` 标记跟 inputs 保持同步（那样两处数据源迟早会漂移）。
 * 编辑器预览手柄生成处（`activePreviewOverlaysFromNode`）/ 素材属性面板置灰逻辑均调用此函数。
 */
export function isPositionable(componentId: string): boolean {
  const inputs = getComponent(componentId)?.inputs
  if (!inputs) return true
  return inputs.some((i) => i.key === 'x') && inputs.some((i) => i.key === 'y')
}
export function getComponentManifest(componentId: string): ComponentManifest | undefined {
  return defaultComponentRegistry.getManifest(componentId)
}

/** 编辑器展示名：读 `ComponentManifest.label`；未注册则退回 component id。 */
export function componentTypeLabel(componentId: string): string {
  return getComponentManifest(componentId)?.label || componentId
}

/**
 * 该组件的 `inputs` 里是否声明了「多拍点」结构（`component: 'qteCues'` 那一项）——
 * 纯结构判定，不查任何分类标签。有 ⇒ 时间轴走多拍点专属交互（左缘=appearAt/右缘=endAt/菱形=targetAt），
 * 没有就走通用单条 window 拖拽。新组件要参与这套交互，只需在自己 inputs 里老实声明该项。
 */
export function hasCuePointsInput(componentId: string): boolean {
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'qteCues')
}

/**
 * 该组件的 `inputs` 里是否声明了「出口清单」结构（`component: 'events'` 那一项，供选项清单编辑器用）——
 * 纯结构判定；hotspot 的画面热点用另一个标记 `hotspotEvents` 区分，不撞这里；已经有拍点结构的
 * 组件走拍点专属交互，不再落进出口清单分支（即便它自己也声明了 `events`）。
 */
export function hasOptionEventsInput(componentId: string): boolean {
  if (hasCuePointsInput(componentId)) return false
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'events')
}
export function listComponents(): ComponentDef[] {
  return defaultComponentRegistry.listComponents()
}
export function registerPlugin(id: string, meta?: { version?: string }): void {
  defaultComponentRegistry.registerPlugin(id, meta)
}
export function unregisterPlugin(id: string): void {
  defaultComponentRegistry.unregisterPlugin(id)
}
export function hasPlugin(id: string, version?: string): boolean {
  return defaultComponentRegistry.hasPlugin(id, version)
}
export function listPlugins(): Array<{ id: string; version?: string }> {
  return defaultComponentRegistry.listPlugins()
}
export function deriveOutputs(node: GameNode, overlays?: Record<string, import('../schema/node-config-schema').Overlay>): NodeHandle[] {
  return defaultComponentRegistry.deriveOutputs(node, overlays)
}
/** 组件实例出口 handle（inputs.events 优先，否则组件静态 events）。 */
export function componentHandles(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
  return defaultComponentRegistry.handlesOf(componentId, inputsBag)
}
/** 组件新建实例默认 inputs 值（由 inputs[].default 组装）。 */
export function defaultsForComponent(componentId: string): Record<string, unknown> {
  return defaultComponentRegistry.defaultsFor(componentId)
}

/** 输入永远单一 'in'。 */
export function deriveInputs(): NodeHandle[] {
  return [{ id: 'in' }]
}
