/**
 * GraphRuntime —— 纯 TS 状态机，**直接执行 GameGraph**（无 Scene/branches/编译层）。
 *
 * 走法（spec §3）：进入节点 → 跑 enter reactions + emit playClip → tick 时按 trigger 触发 overlay 子件
 * → 按 role 派发（presentation 出画面 / interaction 挂起等输入）→ 演出结束/交互判定
 * → 选出口 handle → 沿 edge → 进入下一节点。产**泛型 directive**，Player 消费。
 *
 * 关键机制：
 *  - 触发时机 Trigger：enter / at(ms)。
 *  - 出口=handle：语义在 sourceHandle（out、cond:N、else、pass、opt:N …），edge 只管连接 + 条件/权重。
 *  - 条件网关：cond:N 按序求值，else/out 兜底；加权随机：多条候选带 weight → rng 加权。
 *  - 交互：openInteraction 挂起 → submitInteraction(resolve) → outcome→handle→edge。
 *  - 副作用：reactions / option.effects（边不带 effects）。
 *  - jumpToNode：seek 到任意节点（默认保留全局态）。
 */
import type {
  GameEdge,
  GameGraph,
  GameNode,
  GameScenario,
  GraphCondition,
  GraphEffect,
  SubFlowPack,
  SubFlowPackDef,
} from '../schema/graph-schema'
import { getSubFlowPack, getSubFlow, isSubflowContainerData } from '../schema/graph-schema'
import { nodeOverlayChildren, nodeOverlayMounts } from '../schema/expand-overlay'
import { resolveEventReactions, completeReactions } from '../schema/overlay-events'
import type { NodeAction, OverlayInstanceChild, Reaction } from '../schema/node-config-schema'
import { overlayMountId } from '../schema/node-config-schema'
import { applyEffects, type MutableState } from './apply-effects'
import { initState } from './engine-init'
import { defaultKindRegistry, isContinueResult, type KindRegistry, type RuntimeCtx } from '../registry/kind-registry'
import type { RuntimeDirective } from './directives'
import { evaluateCondition, describeCondition, type ConditionTarget } from './condition'

export type GraphPhase = 'idle' | 'playing' | 'awaitInteraction' | 'ended'

/** call/return 栈帧：弹回时恢复 caller 所在图（同图 subflow 时 returnGraph === 当前图）。 */
export interface CallFrame {
  callerNodeId: string
  returnGraph: GameGraph
}

export interface RuntimeState extends MutableState {
  currentNodeId: string | null
  phase: GraphPhase
  elapsedMs: number
  visited: Set<string>
  traversedEdgeIds: Set<string>
  callStack: CallFrame[]
  log: string[]
}

const CHAIN_GUARD = 200

function isSubflowContainer(node: GameNode): boolean {
  return isSubflowContainerData(node.data)
}

function packLookupKey(id: string, version?: string): string {
  return version ? `${id}@${version}` : id
}

export class GraphRuntime {
  private readonly nodes = new Map<string, GameNode>()
  private readonly outgoing = new Map<string, GameEdge[]>()
  /** 主图（构造时传入）；jump/start 始终回到这里。 */
  private readonly rootGraph: GameGraph
  /** 当前正在执行的图（主图或某个 pack.graph）。 */
  private activeGraph: GameGraph
  private readonly packsByKey = new Map<string, SubFlowPackDef>()
  readonly state: RuntimeState
  private queue: RuntimeDirective[] = []

  // 每节点重置的运行游标
  private fired = new Set<string>() // 已触发的 enter/at 元素 id
  private firedAtReactions = new Set<number>() // 已触发的 at reaction 下标（按 node.data.reactions 顺序）
  private windowShown = new Set<string>() // 已按 window.startMs 显示的元素 id
  private windowRemoved = new Set<string>() // 已按 window.endMs 移除的元素 id
  private pending: string | null = null // 挂起中的 interaction 元素 id
  private chain = 0 // 同步穿链计数（anti-runaway）

  // 局级 state reactions（即时判负/判胜）：命中即设 redirect，在安全边界消费为一次跳转。
  private readonly reactions: Reaction[]
  private readonly firedStateReactions = new Set<number>()
  private redirect: { goto: string; resetGlobals?: boolean } | null = null
  private inExit = false // 跑 exit 元素期间抑制规则消费，避免退出时自跳环
  private returningTo = new Set<string>() // 正在弹回的容器节点：下一次 enter 跳过 subFlow 下钻、直接续 out

  /** 本局 Kind / Plugin 表（多局隔离；缺省用模块默认表以兼容旧单测）。 */
  readonly kinds: KindRegistry

  constructor(
    graph: GameGraph,
    private readonly scenario: GameScenario,
    kinds: KindRegistry = defaultKindRegistry,
    packs: readonly SubFlowPackDef[] = [],
  ) {
    this.rootGraph = graph
    this.activeGraph = graph
    this.kinds = kinds
    for (const p of packs) {
      this.packsByKey.set(packLookupKey(p.id, p.version), p)
      if (!this.packsByKey.has(p.id)) this.packsByKey.set(p.id, p) // 无版本时也可按 id 命中
    }
    for (const req of scenario.requiredPlugins ?? []) {
      if (!this.kinds.hasPlugin(req.id, req.version)) {
        const ver = req.version ? `@${req.version}` : ''
        throw new Error(`required plugin '${req.id}${ver}' is not registered`)
      }
    }
    this.indexGraph(graph)
    this.reactions = scenario.reactions ?? []
    this.state = { ...initState(scenario), ...control() }
  }

  private indexGraph(graph: GameGraph): void {
    this.nodes.clear()
    this.outgoing.clear()
    for (const node of graph.nodes) this.nodes.set(node.id, node)
    for (const edge of graph.edges) {
      const list = this.outgoing.get(edge.source)
      if (list) list.push(edge)
      else this.outgoing.set(edge.source, [edge])
    }
  }

  private switchGraph(graph: GameGraph): void {
    this.activeGraph = graph
    this.indexGraph(graph)
  }

  private resolvePack(ref: SubFlowPack): SubFlowPackDef {
    const keyed = ref.version ? this.packsByKey.get(packLookupKey(ref.id, ref.version)) : undefined
    const pack = keyed ?? this.packsByKey.get(ref.id)
    if (!pack) {
      const ver = ref.version ? `@${ref.version}` : ''
      throw new Error(`subFlowPack '${ref.id}${ver}' is not loaded`)
    }
    const entry = ref.entry ?? pack.entry
    if (!pack.graph.nodes.some((n) => n.id === entry)) {
      throw new Error(`subFlowPack '${pack.id}' missing entry node '${entry}'`)
    }
    return pack
  }

  private pushCall(callerNodeId: string): void {
    this.state.callStack.push({ callerNodeId, returnGraph: this.activeGraph })
  }

  private getComponent(componentId: string) {
    return this.kinds.getComponent(componentId)
  }

  /** 本节点展开后的 overlay children（无挂载则 []）。 */
  private childrenOf(node: GameNode | null | undefined): OverlayInstanceChild[] {
    if (!node) return []
    return nodeOverlayChildren(this.scenario, node)
  }

  // ── 指令队列 ────────────────────────────────────────────────────────────────
  private emit(d: RuntimeDirective): void {
    this.queue.push(d)
  }
  private drain(): RuntimeDirective[] {
    const q = this.queue
    this.queue = []
    return q
  }
  // 经方法赋值，避免 TS 把 this.state.phase 的类型窄化成某个字面量（跨方法可被 runElement 改写）。
  private setPhase(p: GraphPhase): void {
    this.state.phase = p
  }
  private ctx(): RuntimeCtx {
    return { state: this.state, nodeId: this.state.currentNodeId ?? '', elapsedMs: this.state.elapsedMs }
  }
  private condTarget(): ConditionTarget {
    return { state: this.state, visited: this.state.visited }
  }
  private node(id: string | null): GameNode | undefined {
    return id ? this.nodes.get(id) : undefined
  }

  // ── 控制入口 ────────────────────────────────────────────────────────────────
  start(): RuntimeDirective[] {
    this.switchGraph(this.rootGraph)
    const entry = this.rootGraph.nodes[0]
    if (!entry) {
      this.setPhase('ended')
      return this.drain()
    }
    this.chain = 0
    this.returningTo = new Set()
    this.enterNode(entry.id)
    return this.drain()
  }

  /** seek 到任意节点从头跑（调试/可视化点击）。默认保留全局态，resetGlobals 干净复现。 */
  jumpToNode(id: string, opts: { resetGlobals?: boolean } = {}): RuntimeDirective[] {
    if (opts.resetGlobals) this.resetGlobalsState()
    this.switchGraph(this.rootGraph)
    this.state.callStack = []
    this.chain = 0
    this.returningTo = new Set()
    this.enterNode(id)
    return this.drain()
  }

  private resetGlobalsState(): void {
    const base = initState(this.scenario)
    this.state.vars = base.vars
    this.state.varMeta = base.varMeta
    this.state.entities = base.entities
    this.state.flags = base.flags
    this.state.score = base.score
    this.state.items = base.items
    this.state.rng = base.rng
    this.state.appliedOnce = base.appliedOnce
    this.state.visited = new Set()
    this.state.traversedEdgeIds = new Set()
  }

  // ── 进入节点 ────────────────────────────────────────────────────────────────
  private enterNode(id: string): void {
    if (++this.chain > CHAIN_GUARD) {
      this.emit({ type: 'log', message: `anti-runaway: chain>${CHAIN_GUARD} at ${id}` })
      this.setPhase('ended')
      return
    }
    const node = this.nodes.get(id)
    if (!node) {
      this.setPhase('ended')
      return
    }
    // 跨图子蓝图：压栈（含 returnGraph）→ 切到 pack 图 → 进入口。
    const packRef = getSubFlowPack(node.data)
    if (packRef && !this.returningTo.has(id)) {
      const pack = this.resolvePack(packRef)
      const entry = packRef.entry ?? pack.entry
      this.state.currentNodeId = id
      this.state.visited.add(id)
      this.pushCall(id)
      this.switchGraph(pack.graph)
      this.enterNode(entry)
      return
    }
    // 同图子流程：压栈 + 跳到本图入口（不播容器自身演出）。
    const subRef = getSubFlow(node.data)
    if (subRef && !this.returningTo.has(id)) {
      this.state.currentNodeId = id
      this.state.visited.add(id)
      this.pushCall(id)
      this.enterNode(subRef)
      return
    }
    const returning = this.returningTo.delete(id)
    this.state.currentNodeId = id
    this.state.elapsedMs = 0
    this.state.visited.add(id)
    // 子流程/子蓝图容器弹回：不重播演出、不跑 enter 元素，直接沿 out 续走。
    if (returning && isSubflowContainer(node)) {
      this.fired = new Set()
      this.pending = null
      this.setPhase('playing')
      this.advanceAuto()
      return
    }
    this.fired = new Set()
    this.firedAtReactions = new Set()
    this.windowShown = new Set()
    this.windowRemoved = new Set()
    this.pending = null

    // 先发 playClip（换片会清空上一节点的叠层/交互）；随后 enter 元素产生的 overlay/interaction
    // 才不会被 playClip 反向清掉。
    this.emit({
      type: 'playClip',
      nodeId: id,
      name: node.data.name,
      mediaId: node.data.media?.ref,
      loop: node.data.mediaPlayMode === 'loop',
      durationMs: node.data.durationMs,
    })
    this.setPhase('playing')

    // enter 计算（可能开交互 → 挂起；或触发图级规则 → 即时改道）。带 window 的元素改由时钟窗口驱动，跳过。
    for (const el of this.childrenOf(node)) {
      if (el.trigger.when === 'enter' && !el.window) this.runElement(el)
      if (this.state.phase === 'awaitInteraction' || this.redirect) break
    }
    // enter 相位 reactions 的副作用（生命周期效果）。
    if (this.state.phase !== 'awaitInteraction' && !this.redirect) this.applyPhaseReactionEffects(node, 'enter')
    if (this.state.phase === 'awaitInteraction') return
    if (this.consumeRedirect()) return

    // 瞬时节点（无演出时长 且 无交互元素）→ 立即推进，形成逻辑穿链。
    const hasInteraction = this.childrenOf(node).some(
      (el) => this.getComponent(el.component)?.role === 'interaction',
    )
    if (!node.data.durationMs && !hasInteraction) {
      if (this.consumeRedirect()) return
      if (this.state.phase === 'playing') this.advanceAuto()
    }
  }

  // ── tick / 演出结束 ─────────────────────────────────────────────────────────
  /** 推进节点时钟，触发到点的 at 元素。 */
  tick(elapsedMs: number): RuntimeDirective[] {
    this.state.elapsedMs = elapsedMs
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return this.drain()
    for (const el of this.childrenOf(node)) {
      if (el.trigger.when === 'at' && !el.window && el.trigger.ms <= elapsedMs && !this.fired.has(el.id)) {
        this.runElement(el)
        if ((this.state.phase as GraphPhase) === 'awaitInteraction' || this.redirect) break
      }
    }
    // at 相位 reactions 的副作用（到点施加）。
    if (this.state.phase === 'playing' && !this.redirect) this.applyAtReactionEffects(node, elapsedMs)
    this.tickWindows(node, elapsedMs)
    this.consumeRedirect()
    return this.drain()
  }

  /** window 时段：到 startMs 显示、到 endMs 移除（表现层叠层的可见时段，如漂字/计时器只显示某段）。 */
  private tickWindows(node: GameNode, elapsedMs: number): void {
    for (const el of this.childrenOf(node)) {
      if (!el.window) continue
      const start = el.window.startMs ?? 0
      const end = el.window.endMs
      if (!this.windowShown.has(el.id) && elapsedMs >= start && (end == null || elapsedMs < end)) {
        this.windowShown.add(el.id)
        this.runElement(el) // 按 role 派发（presentation→emit overlay / logic→apply）
      }
      if (!this.windowRemoved.has(el.id) && end != null && elapsedMs >= end) {
        this.windowRemoved.add(el.id)
        if (this.windowShown.has(el.id)) {
          this.emit({ type: 'removeOverlay', nodeId: node.id, elementId: el.id })
        }
      }
    }
  }

  /** 演出（视频/时长）结束：若未挂起则自动沿出口推进（收尾副作用见 complete reactions）。 */
  onPerformanceEnd(): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return this.drain()
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()
    if (this.state.phase === 'playing') this.advanceAuto()
    return this.drain()
  }

  // ── 交互 ────────────────────────────────────────────────────────────────────
  /**
   * 玩家对挂起的 interaction 提交输入 → resolve →
   *   continue:true →（可选 effects@安全点）保持 awaitInteraction，可再 submit；
   *   outcome →（可选 effects@安全点）选边；rules redirect 压过本次 outcome。
   */
  submitInteraction(elementId: string, input: unknown): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    const el = this.childrenOf(node).find((e) => e.id === elementId)
    if (!node || !el) return this.drain()
    if (this.state.phase !== 'awaitInteraction' || this.pending !== elementId) return this.drain()
    const plugin = this.getComponent(el.component)
    if (!plugin?.resolve) return this.drain()
    const result = plugin.resolve(this.ctx(), el.params, input)
    if (isContinueResult(result)) {
      if (result.effects?.length) this.applyAndReact(result.effects as GraphEffect[])
      if (this.consumeRedirect()) return this.drain()
      return this.drain()
    }
    if (result.effects?.length) this.applyAndReact(result.effects as GraphEffect[])
    this.pending = null
    this.setPhase('playing')
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()

    // reactions = 效果（不含走向）：命中 outcome 的 event reaction 先施加副作用，再由**边**决定去向。
    const mountReactions =
      nodeOverlayMounts(node).find((m) => overlayMountId(m) === el.source.mountId)?.reactions
      ?? nodeOverlayMounts(node)[0]?.reactions
    const evReactions = resolveEventReactions(mountReactions, result.outcome, el.source.childId, el.source.mountId)
    for (const r of evReactions) this.runEffectActions(r.do)
    if (this.consumeRedirect()) return this.drain()

    const edge = this.selectHandleEdge(node.id, result.outcome)
    if (edge) this.traverse(edge)
    else this.advanceAuto()
    return this.drain()
  }

  /** 施加 reaction.do 中的 effect（忽略 goto——走向属于边）。 */
  private runEffectActions(actions: NodeAction[]): void {
    for (const a of actions) {
      if (a.kind === 'effect' && a.effects.length) this.applyAndReact(a.effects)
    }
  }

  /** 施加节点某生命周期相位（enter/exit）reactions 的副作用。 */
  private applyPhaseReactionEffects(node: GameNode, phase: 'enter' | 'exit'): void {
    for (const r of node.data.reactions ?? []) {
      if (r.when.type === phase) this.runEffectActions(r.do)
      if (this.state.phase === 'awaitInteraction' || this.redirect) return
    }
  }

  /** 施加节点 at 相位 reactions 的副作用（到点、去重）。 */
  private applyAtReactionEffects(node: GameNode, elapsedMs: number): void {
    const reactions = node.data.reactions ?? []
    for (let i = 0; i < reactions.length; i++) {
      const r = reactions[i]!
      if (r.when.type !== 'at' || this.firedAtReactions.has(i) || r.when.ms > elapsedMs) continue
      this.firedAtReactions.add(i)
      this.runEffectActions(r.do)
      if ((this.state.phase as GraphPhase) === 'awaitInteraction' || this.redirect) return
    }
  }

  /**
   * 节点收尾（complete）reactions 的副作用：按作者顺序取首个 `if` 成立的分支（否则无 `if` 兜底），施加其 effect。
   * 仅副作用，不决定走向（走向由 selectAutoEdge 的边负责）。
   */
  private applyCompleteReactionEffects(node: GameNode): void {
    const completes = completeReactions(node.data.reactions)
    if (!completes.length) return
    const target = this.condTarget()
    const chosen =
      completes.find((r) => r.when.type === 'complete' && r.when.if && evaluateCondition(r.when.if, target)) ??
      completes.find((r) => r.when.type === 'complete' && !r.when.if)
    if (chosen) this.runEffectActions(chosen.do)
  }

  // ── 元素派发 ────────────────────────────────────────────────────────────────
  private runElement(el: OverlayInstanceChild): void {
    const plugin = this.getComponent(el.component)
    const role = plugin?.role ?? 'presentation'
    this.fired.add(el.id)
    const ctx = { ...this.ctx(), elementId: el.id }
    const params = el.params.component == null ? { ...el.params, component: el.component } : el.params
    if (role === 'presentation') {
      if (plugin?.render) {
        for (const d of plugin.render(ctx, params)) this.emit(d)
      } else {
        this.emit({
          type: 'renderOverlay',
          nodeId: this.state.currentNodeId ?? '',
          elementId: el.id,
          component: el.component,
          params,
          zIndex: el.layout?.zIndex,
        })
      }
    } else if (role === 'interaction') {
      if (!plugin) return
      if (plugin.present) for (const d of plugin.present(ctx, params)) this.emit(d)
      // 限时：timeoutMs（choice）/ windowMs（QTE 窗口）/ durationMs（皮肤时限）同源。
      const timeoutRaw =
        (typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined)
        ?? (typeof params.windowMs === 'number' ? params.windowMs : undefined)
        ?? (typeof params.durationMs === 'number' ? params.durationMs : undefined)
      const timeoutMs = typeof timeoutRaw === 'number' && timeoutRaw > 0 ? timeoutRaw : undefined
      const lockedParams = this.withOptionLocks(params)
      this.emit({
        type: 'openInteraction',
        nodeId: this.state.currentNodeId ?? '',
        elementId: el.id,
        component: el.component,
        params: lockedParams,
        handles: plugin.outputs(params).map((h) => h.id),
        ...(timeoutMs ? { timeoutMs } : {}),
      })
      this.setPhase('awaitInteraction')
      this.pending = el.id
      return
    }
  }

  /** 给 choice/skill 的选项按 condition 算出 `_locked`（当前态不满足即锁定）；无 condition 原样返回。 */
  private withOptionLocks(params: Record<string, unknown>): Record<string, unknown> {
    const opts = params.options
    if (!Array.isArray(opts)) return params
    let changed = false
    const mapped = (opts as Array<Record<string, unknown>>).map((o) => {
      const cond = o.condition as GraphCondition | undefined
      const locked = cond ? !evaluateCondition(cond, this.condTarget()) : false
      if (locked) changed = true
      return locked ? { ...o, _locked: true } : o
    })
    return changed ? { ...params, options: mapped } : params
  }

  /** 离开节点前跑 exit 相位 reactions（副作用）；UI 槽不再用 Trigger.exit。 */
  private runExit(node: GameNode): void {
    this.inExit = true
    this.applyPhaseReactionEffects(node, 'exit')
    this.inExit = false
  }

  /** 局级 state reactions：状态变化后求值，首个命中且含 goto 的设 redirect。 */
  private checkRules(): void {
    if (this.inExit || this.redirect || this.state.phase === 'ended') return
    for (let i = 0; i < this.reactions.length; i++) {
      const r = this.reactions[i]!
      if (r.when.type !== 'state') continue
      if (this.firedStateReactions.has(i)) continue
      if (!evaluateCondition(r.when.condition, this.condTarget())) continue
      const goto = r.do.find((a): a is Extract<NodeAction, { kind: 'goto' }> => a.kind === 'goto')
      if (!goto) continue
      this.firedStateReactions.add(i)
      this.redirect = { goto: goto.targetNodeId }
      return
    }
  }

  /** 若有待消费的 redirect（图级规则命中），跑当前节点 exit 后即时跳转。返回是否跳转。 */
  private consumeRedirect(): boolean {
    if (!this.redirect) return false
    const { goto, resetGlobals } = this.redirect
    this.redirect = null
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
    this.pending = null
    this.setPhase('playing')
    if (resetGlobals) this.resetGlobalsState()
    // 图级规则是硬打断（判胜/判负等）：清调用栈并回到主图，再进目标节点。
    this.state.callStack = []
    this.returningTo.clear()
    this.switchGraph(this.rootGraph)
    this.enterNode(goto)
    return true
  }

  private applyAndReact(effects: GraphEffect[]): void {
    applyEffects(this.state, effects)
    this.emit({ type: 'stateChanged' })
    this.checkRules()
  }

  // ── 出口选择 / 边遍历 ───────────────────────────────────────────────────────
  private autoPriority(handle: string | undefined): number {
    if (handle?.startsWith('cond:')) return Number(handle.slice(5)) || 0
    if (handle === 'else') return 1e6
    return 1e7 // 'out' / undefined 最后
  }

  private selectAutoEdge(nodeId: string): GameEdge | undefined {
    const edges = (this.outgoing.get(nodeId) ?? []).filter(
      (e) =>
        e.sourceHandle === undefined ||
        e.sourceHandle === 'out' ||
        e.sourceHandle === 'else' ||
        e.sourceHandle.startsWith('cond:'),
    )
    edges.sort((a, b) => this.autoPriority(a.sourceHandle) - this.autoPriority(b.sourceHandle))
    const passing = edges.filter((e) => evaluateCondition(e.data?.condition, this.condTarget()))
    if (passing.length === 0) return undefined
    if (passing.length > 1 && passing.every((e) => e.data?.weight !== undefined)) {
      return this.pickWeighted(passing)
    }
    return passing[0]
  }

  private selectHandleEdge(nodeId: string, handle: string): GameEdge | undefined {
    const edges = (this.outgoing.get(nodeId) ?? []).filter((e) => e.sourceHandle === handle)
    const passing = edges.filter((e) => evaluateCondition(e.data?.condition, this.condTarget()))
    const pool = passing.length > 0 ? passing : edges
    if (pool.length === 0) return undefined
    if (pool.length > 1 && pool.every((e) => e.data?.weight !== undefined)) return this.pickWeighted(pool)
    return pool[0]
  }

  private pickWeighted(edges: GameEdge[]): GameEdge {
    const total = edges.reduce((s, e) => s + (e.data?.weight ?? 1), 0)
    let r = (this.state.rng?.next() ?? 0) * total
    for (const e of edges) {
      r -= e.data?.weight ?? 1
      if (r < 0) return e
    }
    return edges[edges.length - 1] as GameEdge
  }

  private advanceAuto(): void {
    const nodeId = this.state.currentNodeId
    if (!nodeId) return
    // 收尾副作用（complete reactions）先施加，再由边决定走向；副作用可能触发局级规则改道。
    const curNode = this.nodes.get(nodeId)
    if (curNode) {
      this.applyCompleteReactionEffects(curNode)
      if (this.consumeRedirect()) return
    }
    const edge = this.selectAutoEdge(nodeId)
    if (!edge) {
      // 无自动出边 + 调用栈非空 → 弹回 caller（subFlow / subFlowPack）；回环用显式边。
      const node = this.nodes.get(nodeId)
      if (this.state.callStack.length > 0) {
        const frame = this.state.callStack.pop() as CallFrame
        if (node) this.runExit(node)
        this.returningTo.add(frame.callerNodeId) // 弹回容器时跳过 subFlow 再下钻
        this.switchGraph(frame.returnGraph)
        this.enterNode(frame.callerNodeId)
        return
      }
      this.finishEnd(nodeId)
      return
    }
    this.traverse(edge)
  }

  private traverse(edge: GameEdge): void {
    // 记录"为什么进入下一节点"：命中的边 + 条件（含求值时实时值），在应用边副作用前取值。
    this.emit({
      type: 'routeInfo',
      via: edge.sourceHandle ?? 'out',
      target: edge.target,
      reason: describeCondition(edge.data?.condition, this.condTarget()),
    })
    this.state.traversedEdgeIds.add(edge.id)
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
    this.enterNode(edge.target)
  }

  private finishEnd(nodeId: string): void {
    this.setPhase('ended')
    const node = this.nodes.get(nodeId)
    // 结局横幅不靠节点 end 标记；无出边即结束。胜负表现走 overlay / 图规则。
    this.emit({ type: 'banner', kind: 'ending', nodeId, title: node?.data.name ?? '' })
  }
}

function control(): Omit<RuntimeState, keyof MutableState> {
  return {
    currentNodeId: null,
    phase: 'idle',
    elapsedMs: 0,
    visited: new Set<string>(),
    traversedEdgeIds: new Set<string>(),
    callStack: [],
    log: [],
  }
}
