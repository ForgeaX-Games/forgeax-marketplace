/**
 * 组件注册契约 —— Overlay child 的**唯一扩展点**（历史名 KindPlugin / KindRegistry）。
 *
 * 落盘字段只有 `OverlayChild.component`；插件上的 `kind` 字符串 = 组件 id。
 * `role` / `surface` 仅注册表内部，不进 OverlayChild。
 *
 * 多局并行：每个 GraphRuntime / GraphSession 持有自己的实例；
 * 模块级 `registerKind` / `getKind` / `getComponent` 仍指向默认表。
 */
import type { ComponentEvent, ComponentManifest, Overlay } from '../schema/node-config-schema'
import type { ElementRole, GameNode, GraphEffect, NodeHandle } from '../schema/graph-schema'
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

/**
 * 声明式表单字段 schema —— 让 NodeInspector 的 per-kind 检视器由注册表驱动，
 * 取代硬编码 switch。标量字段（text/number/select/checkbox/color）直接渲染；
 * 复杂字段（textStyle/effects/options/qteCues/hotspots）派发到专用受控组件，
 * 由组件自身处理内部条件分支。
 */
export type FormField =
  | { t: 'text'; key: string; label: string; placeholder?: string; mono?: boolean }
  | { t: 'number'; key: string; label: string; step?: number; min?: number; max?: number }
  | { t: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  | { t: 'checkbox'; key: string; label: string }
  | { t: 'color'; key: string; label: string; placeholder?: string }
  | { t: 'textStyle'; key: string; label: string; group: 'subtitle' | 'overlay' }
  | { t: 'effects'; key: string; label: string }
  | { t: 'options'; key: string; label: string }
  | { t: 'qteCues'; key: string; label: string }
  | { t: 'hotspots'; key: string; label: string }

export interface KindPlugin<P = Record<string, unknown>> {
  /** 组件 id（= OverlayChild.component / 注册键）。 */
  kind: string
  /** 引擎调度用（不进落盘 OverlayChild）。 */
  role: ElementRole
  /** HUD 呈现面（GraphPlaySurface 等据此分流）。 */
  surface?: 'hud'
  /** 同行为的其它 component id（如 battleParry → qte）。 */
  aliases?: string[]
  /** 导出事件（无则回退 params.exits）。 */
  events?: ComponentEvent[]
  /** 中文标签（编辑器「+ 元素」菜单展示）；缺省用 kind。 */
  label?: string
  /** 新建该组件时的默认 params。 */
  defaults?(): P
  /** 声明式检视器表单字段（NodeInspector 据此渲染）；缺省回退 JSON 框。 */
  form?: FormField[]
  /** 返回问题描述数组，空数组 = 合法。 */
  validate(params: P): string[]
  /** 该组件需要的输出 handle（仅 interaction 通常有多出口）。 */
  outputs(params: P): NodeHandle[]

  // ── 运行时契约（按 role 实现其一；引擎调用，纯 TS）──────────────────────────
  // 副作用（改状态）一律走 node.data.reactions 的生命周期相位，组件不再承载 run()。
  render?(ctx: RuntimeCtx, params: P): RuntimeDirective[]
  present?(ctx: RuntimeCtx, params: P): RuntimeDirective[]
  resolve?(ctx: RuntimeCtx, params: P, input: unknown): ResolveResult
}

export type ResolveResult =
  | { outcome: string; effects?: GraphEffect[]; continue?: false }
  | { continue: true; effects?: GraphEffect[]; outcome?: undefined }

export function isContinueResult(r: ResolveResult): r is { continue: true; effects?: GraphEffect[] } {
  return r.continue === true
}

/** 可注入的组件注册表（每局 Runtime 一份即可隔离）。 */
export class KindRegistry {
  private readonly kinds = new Map<string, KindPlugin>()
  private readonly plugins = new Map<string, { version?: string }>()

  registerKind<P>(plugin: KindPlugin<P>): void {
    const p = plugin as unknown as KindPlugin
    this.kinds.set(p.kind, p)
    for (const a of p.aliases ?? []) this.kinds.set(a, p)
  }
  unregisterKind(kind: string): void {
    const p = this.kinds.get(kind)
    this.kinds.delete(kind)
    if (p) {
      for (const [k, v] of this.kinds) {
        if (v === p) this.kinds.delete(k)
      }
    }
  }
  getKind(kind: string): KindPlugin | undefined {
    return this.kinds.get(kind)
  }
  /** 与 getKind 同义：按 OverlayChild.component 查找。 */
  getComponent(componentId: string): KindPlugin | undefined {
    return this.kinds.get(componentId)
  }
  listKinds(): KindPlugin[] {
    const seen = new Set<KindPlugin>()
    const out: KindPlugin[] = []
    for (const p of this.kinds.values()) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  }

  /** 组件导出清单（manifest）；无 events 时从 params 默认值折 exits。 */
  getManifest(componentId: string): ComponentManifest | undefined {
    const p = this.getComponent(componentId)
    if (!p) return undefined
    const defaults = (p.defaults?.() ?? {}) as Record<string, unknown>
    const events = p.events?.length ? p.events : eventsFromParams(defaults)
    return {
      id: componentId,
      label: p.label,
      events,
    }
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
   * 派生节点输出 handle：默认 'out' + reactions 中带 goto 的 event/complete，或 interaction outputs()。
   */
  deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
    const instances = expandNodeOverlays(overlays, node)
    const children: OverlayInstanceChild[] = instances.flatMap((i) => i.children)
    const out: NodeHandle[] = [{ id: 'out' }]
    let anyEventReaction = false
    const consider = (reactions: import('../schema/node-config-schema').Reaction[] | undefined) => {
      if (!reactions) return
      for (const r of reactions) {
        if (!r.do.some((a) => a.kind === 'goto')) continue
        if (r.when.type === 'event') {
          anyEventReaction = true
          out.push({ id: r.when.id, label: r.when.id })
        }
      }
    }
    consider(node.data.reactions)
    for (const inst of instances) consider(inst.reactions)
    if (!anyEventReaction) {
      for (const el of children) {
        const plugin = this.getComponent(el.component)
        if (plugin && plugin.role === 'interaction') {
          out.push(...plugin.outputs(el.params))
        }
      }
    }
    const seen = new Set<string>()
    return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  }
}

/** 编辑器 / 单测默认表（模块单例）。多局试玩请用 `createCoreKindRegistry()` 新建实例。 */
export const defaultKindRegistry = new KindRegistry()

export function registerKind<P>(plugin: KindPlugin<P>): void {
  defaultKindRegistry.registerKind(plugin)
}
export function unregisterKind(kind: string): void {
  defaultKindRegistry.unregisterKind(kind)
}
export function getKind(kind: string): KindPlugin | undefined {
  return defaultKindRegistry.getKind(kind)
}
export function getComponent(componentId: string): KindPlugin | undefined {
  return defaultKindRegistry.getComponent(componentId)
}
export function getComponentManifest(componentId: string): ComponentManifest | undefined {
  return defaultKindRegistry.getManifest(componentId)
}
export function listKinds(): KindPlugin[] {
  return defaultKindRegistry.listKinds()
}
export function registerPlugin(id: string, meta?: { version?: string }): void {
  defaultKindRegistry.registerPlugin(id, meta)
}
export function unregisterPlugin(id: string): void {
  defaultKindRegistry.unregisterPlugin(id)
}
export function hasPlugin(id: string, version?: string): boolean {
  return defaultKindRegistry.hasPlugin(id, version)
}
export function listPlugins(): Array<{ id: string; version?: string }> {
  return defaultKindRegistry.listPlugins()
}
export function deriveOutputs(node: GameNode, overlays?: Record<string, import('../schema/node-config-schema').Overlay>): NodeHandle[] {
  return defaultKindRegistry.deriveOutputs(node, overlays)
}

/** 输入永远单一 'in'。 */
export function deriveInputs(): NodeHandle[] {
  return [{ id: 'in' }]
}
