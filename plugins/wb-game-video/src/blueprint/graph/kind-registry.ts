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
import type { ElementRole, GameNode, GraphEffect, HandleSpec } from './graph-schema'
import type { MutableState } from './apply-effects'
import type { RuntimeDirective } from './directives'

/** 引擎给运行时契约的上下文（纯数据，模块不摸 DOM、不反读引擎内部）。 */
export interface RuntimeCtx {
  state: MutableState
  nodeId: string
  elapsedMs: number
  /** 当前正在执行的时间线元素 id（render/present 构造 directive 用）。 */
  elementId?: string
}

export interface KindPlugin<P = Record<string, unknown>> {
  kind: string
  role: ElementRole
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
  /** interaction：收到玩家输入 → 判定出 outcome(= 出口 handle id) + 可选 effects。 */
  resolve?(ctx: RuntimeCtx, params: P, input: unknown): { outcome: string; effects?: GraphEffect[] }
}

const REGISTRY = new Map<string, KindPlugin>()

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
