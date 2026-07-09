/**
 * kind 注册契约 —— 新玩法的**唯一扩展点**。
 *
 * 每个时间线元素 kind（qte/settle/floatText/choice/skill/hotspot…）注册一个插件，声明：
 *   - role：view/logic/interaction（决定引擎调哪个契约、渲染归属）
 *   - validate：参数校验（validator 用）
 *   - outputs：该元素贡献哪些**输出 handle**（派生 node.outputs，见 spec §2.3/§2.5）
 * 运行时行为契约（run/render/present/resolve）在 P1/P2 接入；P0 先立注册 + handle 派生骨架。
 *
 * 加一个玩法 = 注册一个 kind，引擎/画布/校验都不改。
 */
import type { ElementRole, GameNode, GraphEffect, HandleSpec } from '../schema/graph-schema'
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
  kind: string
  role: ElementRole
  /** 中文标签（编辑器「+ 元素」菜单展示）；缺省用 kind。 */
  label?: string
  /** 新建该 kind 元素时的默认 params。 */
  defaults?(): P
  /** 声明式检视器表单字段（NodeInspector 据此渲染）；缺省回退 JSON 框。 */
  form?: FormField[]
  /** 返回问题描述数组，空数组 = 合法。 */
  validate(params: P): string[]
  /** 该 kind 需要的输出 handle（仅 interaction 通常有多出口；view/logic 一般返回 []）。 */
  outputs(params: P): HandleSpec[]

  // ── 运行时契约（按 role 实现其一；引擎调用，纯 TS）──────────────────────────
  /** presentation：产画面指令，不改状态、不产 outcome。 */
  render?(ctx: RuntimeCtx, params: P): RuntimeDirective[]
  /** logic：只产 effects（引擎负责 apply），不渲染、不阻塞。 */
  run?(ctx: RuntimeCtx, params: P): { effects: GraphEffect[] }
  /** interaction：呈现（等玩家输入）。 */
  present?(ctx: RuntimeCtx, params: P): RuntimeDirective[]
  /**
   * interaction：收到玩家输入 → `ResolveResult`。
   * - `{ outcome, effects? }`：结束会话，走 outcome 边（effects 先经安全点）
   * - `{ continue:true, effects? }`：保持挂起，可再 submit（effects 同样走安全点；rules 可 redirect）
   */
  resolve?(ctx: RuntimeCtx, params: P, input: unknown): ResolveResult
}

/**
 * Kind.resolve 返回值（协议 §4.1 / §5）。
 * `continue:true` 时不得带 outcome；结束路径可显式 `continue:false` 或省略。
 */
export type ResolveResult =
  | { outcome: string; effects?: GraphEffect[]; continue?: false }
  | { continue: true; effects?: GraphEffect[]; outcome?: undefined }

export function isContinueResult(r: ResolveResult): r is { continue: true; effects?: GraphEffect[] } {
  return r.continue === true
}

const REGISTRY = new Map<string, KindPlugin>()

/** 插件包元数据（scenario.requiredPlugins 对齐用；与单个 kind 注册正交）。 */
const PLUGINS = new Map<string, { version?: string }>()

export function registerKind<P>(plugin: KindPlugin<P>): void {
  REGISTRY.set(plugin.kind, plugin as unknown as KindPlugin)
}
export function unregisterKind(kind: string): void {
  REGISTRY.delete(kind)
}
export function getKind(kind: string): KindPlugin | undefined {
  return REGISTRY.get(kind)
}
export function listKinds(): KindPlugin[] {
  return [...REGISTRY.values()]
}

/** 声明运行环境已提供的插件包（id + 可选 semver 字符串，精确匹配）。 */
export function registerPlugin(id: string, meta?: { version?: string }): void {
  PLUGINS.set(id, { version: meta?.version })
}
export function unregisterPlugin(id: string): void {
  PLUGINS.delete(id)
}
export function hasPlugin(id: string, version?: string): boolean {
  const meta = PLUGINS.get(id)
  if (!meta) return false
  if (version != null && version !== '' && meta.version !== version) return false
  return true
}
export function listPlugins(): Array<{ id: string; version?: string }> {
  return [...PLUGINS.entries()].map(([id, m]) => ({ id, version: m.version }))
}

/**
 * 派生一个节点的输出 handle：默认单一 'out'（演出结束自动继续）+ 各 interaction 元素
 * kind 的 outputs() 汇总，按 id 去重（先到先留）。
 */
export function deriveOutputs(node: GameNode): HandleSpec[] {
  const out: HandleSpec[] = [{ id: 'out' }]
  for (const el of node.data.timeline) {
    const plugin = REGISTRY.get(el.kind)
    if (plugin && plugin.role === 'interaction') {
      out.push(...plugin.outputs(el.params))
    }
  }
  const seen = new Set<string>()
  return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
}

/** 输入永远单一 'in'。 */
export function deriveInputs(): HandleSpec[] {
  return [{ id: 'in' }]
}
