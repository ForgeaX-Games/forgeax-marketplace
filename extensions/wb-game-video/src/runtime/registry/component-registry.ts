/**
 * 组件注册契约 —— Overlay child 的运行时扩展点。
 *
 * 落盘字段只有 `OverlayChild.component`；注册键与之直接对应。
 * 多局并行：每个 GraphRuntime / GraphSession 可持有自己的 `ComponentRegistry` 实例；
 * 模块级 `registerComponent` / `getComponent` 指向默认表（单测 / 未注入时的回退）。
 *
 * 编辑器专用辅助（展示名、新建默认值、拍点/选项结构判定等）不在本文件——见 `editor/shell/editors.tsx`。
 */
import type { ComponentEvent, ComponentInput, ComponentManifest, Overlay } from '../schema/node-config-schema'
import type { GameNode, NodeHandle } from '../schema/graph-schema'
import type { OverlayInstanceChild } from '../schema/node-config-schema'
import { expandNodeOverlays } from '../schema/expand-overlay'
import { eventsFromParams } from '../schema/overlay-events'

export interface ComponentDef<P = Record<string, unknown>> {
  /**
   * 组件会抛出的事件（= 出口 handle 来源）。
   * 静态出口写这里；随实例变化的写在 `inputs.events`；
   * 运行时出口 = `inputs.events`（若有）否则本字段（见 `handlesOf`）。
   */
  events?: ComponentEvent[]
  /** 展示名（缺省 = component id）；编辑器可读，运行时不依赖。 */
  label?: string
  /**
   * 输入契约：语义类型 + `default`（新建初值）。
   * 运行时用默认值折 events；编辑器据此渲染控件。
   */
  inputs?: ComponentInput[]
  /** 跨字段校验（如 floatText 需 text||expr）；校验管线调用。 */
  validate?(inputs: P): string[]
}

/** 从 inputs[].default 组装默认值（manifest 折 events / 编辑器新建实例共用）。 */
export function buildDefaults(inputs: ComponentInput[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const i of inputs ?? []) if (i.default !== undefined) out[i.key] = i.default
  return out
}

/** 可注入的组件注册表（每局 Runtime 一份即可隔离）。 */
export class ComponentRegistry {
  private readonly components = new Map<string, ComponentDef>()

  registerComponent<P>(id: string, def: ComponentDef<P>): void {
    this.components.set(id, def as unknown as ComponentDef)
  }
  unregisterComponent(id: string): void {
    this.components.delete(id)
  }
  getComponent(componentId: string): ComponentDef | undefined {
    return this.components.get(componentId)
  }

  /** 组件契约视图：inputs + events（无静态 events 时从 inputs 默认值折）。 */
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

  /**
   * 组件实例出口 handle：实例 `inputs.events`（若有）否则组件静态 `events`。
   */
  handlesOf(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
    const p = this.getComponent(componentId)
    if (!p) return []
    const fromInputs = eventsFromParams(inputsBag ?? {})
    const events = fromInputs.length ? fromInputs : (p.events ?? [])
    return events.map((e) => ({ id: e.id, label: e.label }))
  }

  /** 节点出口：`default` + 各挂载组件可发事件（边 sourceHandle 对齐）。 */
  deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
    const instances = expandNodeOverlays(overlays, node)
    const children: OverlayInstanceChild[] = instances.flatMap((i) => i.children)
    const out: NodeHandle[] = [{ id: 'default' }]
    for (const el of children) out.push(...this.handlesOf(el.component, el.inputs as Record<string, unknown>))
    const seen = new Set<string>()
    return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  }
}

/** 默认表（单测 / Runtime 未注入时回退）。多局隔离请用 `createDefaultComponentRegistry()`。 */
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
export function getComponentManifest(componentId: string): ComponentManifest | undefined {
  return defaultComponentRegistry.getManifest(componentId)
}
export function deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
  return defaultComponentRegistry.deriveOutputs(node, overlays)
}
/** 默认表上的 handlesOf（引擎实例请用 `runtime.components.handlesOf`）。 */
export function componentHandles(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
  return defaultComponentRegistry.handlesOf(componentId, inputsBag)
}
