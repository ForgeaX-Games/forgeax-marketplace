/**
 * GraphRuntime —— 纯 TS 状态机，**直接执行 GameGraph**（无 Scene/branches/编译层）。
 *
 * 走法（spec §3）：进入节点 → 跑 enter reactions + emit playClip → tick 时按 trigger 触发 overlay 子件
 * → 到 trigger 时机 renderOverlay → 组件 emit(event) → reactions / 出边 → 下一节点。
 * 产**泛型 directive**，Player 消费。无 openInteraction / awaitInteraction；等待为声明式
 * （无 default 出边且仅有 event 出边时，演出结束不自动推进）。
 *
 * 关键机制：
 *  - 触发时机 Trigger：enter / at(ms)。
 *  - 出口=handle：sourceHandle === 出口 event id（default = 保留字/默认推进），edge 只管连接 + 条件/权重。
 *  - 条件网关：同 handle 多边，有条件者按序求值、无条件兜底；加权随机：候选皆带 weight → rng 加权。
 *  - 组件事件：emitComponentEvent → reactions.do（effect/spawn/advance）→ 无显式 advance 则按 handle 找边。
 *  - 副作用：一律走 reactions。
 *  - 换节点：只经边；reactions.do 的 advance(edgeId) 或引擎默认推进 / handle 出边。
 *  - jumpToNode：seek 到任意节点（默认保留全局态）。
 */
import type {
  BlueprintDoc,
  GameEdge,
  GameGraph,
  GameNode,
  GameScenario,
  GraphCondition,
  GraphEffect,
  GraphLibraryDocument,
  SubFlowPack,
  SubFlowPackDef,
} from '../schema/graph-schema'
import { getSubFlowPack, resolveGraphEntry } from '../schema/graph-schema'
import { nodeOverlayChildren, nodeOverlayMounts } from '../schema/expand-overlay'
import { resolveEventReactions, completeReactions } from '../schema/overlay-events'
import type { Layout, NodeAction, OverlayInstanceChild, Reaction } from '../schema/node-config-schema'
import { overlayMountId } from '../schema/node-config-schema'
import { applyEffects, type MutableState } from './apply-effects'
import { initState } from './engine-init'
import { defaultComponentRegistry, type ComponentRegistry } from '../registry/component-registry'
import type { RuntimeDirective, RenderOverlayDirective } from './directives'
import { evaluateCondition, describeCondition, type ConditionTarget } from './condition'
import { evalExpr, type EvalCtx } from './expr'
import { layoutIsEffectivelyEmpty } from '../schema/layout'
import {
  createCoreNodeKindRegistry,
  type NextIntent,
  type NodeKindRegistry,
  type NodeRuntimeCtx,
} from '../nodes'

export type GraphPhase = 'idle' | 'playing' | 'ended'

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

function packLookupKey(id: string, version?: string): string {
  return version ? `${id}@${version}` : id
}

export class GraphRuntime {
  private readonly nodes = new Map<string, GameNode>()
  private readonly outgoing = new Map<string, GameEdge[]>()
  /** 主图（构造时传入）；jump/start 始终回到这里。 */
  private readonly rootGraph: GameGraph
  /** 当前正在执行的图（根 graph，或执行中解析到的子蓝图 graph）。 */
  private activeGraph: GameGraph
  /** 依赖查找表：id / id@version → 子蓝图（来自 manifest.packs，或测试注入的 packs）。 */
  private readonly packsByKey = new Map<string, { id: string; version?: string; entry: string; graph: GameGraph }>()
  readonly state: RuntimeState
  private queue: RuntimeDirective[] = []

  // 每节点重置的运行游标
  private fired = new Set<string>() // 已触发的 enter/at 元素 id
  private firedAtReactions = new Set<number>() // 已触发的 at reaction 下标（按 node.data.reactions 顺序）
  private windowShown = new Set<string>() // 已按 window.startMs 显示的元素 id
  private windowRemoved = new Set<string>() // 已按 window.endMs 移除的元素 id
  private chain = 0 // 同步穿链计数（anti-runaway）

  // watch / lifecycle 的 advance 硬打断：命中即设 redirect，在安全边界消费为一次跳转。
  private redirect: { goto: string; resetGlobals?: boolean } | null = null
  private inExit = false // 跑 exit 元素期间抑制规则消费，避免退出时自跳环
  private returningTo = new Set<string>() // 正在弹回的容器节点：下一次 enter 跳过 subFlow 下钻、直接续 out

  // 响应式：watch 上次采样值（key = 反应作用域#下标）；每个写屏障重采样比对。
  private watchPrev = new Map<string, number>()
  // 组件生命周期：本次节点访问内已 shown / 已 hidden 的运行态 child id。
  private shownChildren = new Set<string>()
  private hiddenFired = new Set<string>()
  // spawn 出的瞬态叠层：到 removeAtMs（本节点 elapsedMs）即发 removeOverlay。
  private pendingSpawns: Array<{ elementId: string; nodeId: string; removeAtMs: number }> = []
  private spawnSeq = 0

  /** 本局组件 / Plugin 表（多局隔离；缺省用模块默认表以兼容旧单测）。 */
  readonly components: ComponentRegistry

  /** 节点类型注册表：按 GameNode.type 派发 execute/next（perf/subflow/subflowPack 内置）。 */
  private readonly nodeKinds: NodeKindRegistry = createCoreNodeKindRegistry()

  /**
   * @param graph 开跑入口图（通常 = scenario 根 graph / 主图）。
   * @param packs 可选测试注入；生产路径依赖从 `scenario.manifest.packs` 按需解析。
   *              非空时优先于 manifest。
   */
  constructor(
    graph: GameGraph,
    private readonly scenario: GameScenario,
    components: ComponentRegistry = defaultComponentRegistry,
    packs: readonly SubFlowPackDef[] = [],
  ) {
    this.rootGraph = graph
    this.activeGraph = graph
    this.components = components
    this.loadDependencyTable(scenario, packs)
    this.indexGraph(graph)
    this.state = { ...initState(scenario), ...control() }
  }

  /** 执行中发现 subFlowPack 时的查表源：构造注入 packs（单测）> scenario.manifest.packs。 */
  private loadDependencyTable(scenario: GameScenario, packs: readonly SubFlowPackDef[]): void {
    const register = (id: string, entry: string, g: GameGraph, version?: string) => {
      const row = { id, version, entry, graph: g }
      if (version) this.packsByKey.set(packLookupKey(id, version), row)
      if (!this.packsByKey.has(id)) this.packsByKey.set(id, row)
    }
    if (packs.length > 0) {
      for (const p of packs) register(p.id, p.entry, p.graph, p.version)
      return
    }
    const blueprints = (scenario as GraphLibraryDocument).manifest?.packs
    if (!blueprints) return
    for (const d of Object.values(blueprints) as BlueprintDoc[]) {
      register(d.id, d.entry, d.graph, d.version)
    }
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

  private resolvePack(ref: SubFlowPack): { id: string; version?: string; entry: string; graph: GameGraph } {
    const keyed = ref.version ? this.packsByKey.get(packLookupKey(ref.id, ref.version)) : undefined
    const pack = keyed ?? this.packsByKey.get(ref.id)
    if (!pack) {
      const ver = ref.version ? `@${ref.version}` : ''
      throw new Error(`subFlowPack '${ref.id}${ver}' is not loaded`)
    }
    // 入口节点校验挪到 resolvePackEntry（可回退到图内根节点）；这里只保证依赖已在表中。
    return pack
  }

  private pushCall(callerNodeId: string): void {
    this.state.callStack.push({ callerNodeId, returnGraph: this.activeGraph })
  }

  private getComponent(componentId: string) {
    return this.components.getComponent(componentId)
  }

  /**
   * 本节点可调度的 overlay children：**调用栈容器（我方/敌方回合等）挂载的 overlay 覆盖整段子流程** +
   * 本节点自身挂载。容器 children 排在前（先渲染，避免被本节点交互中断枚举）。
   */
  private childrenOf(node: GameNode | null | undefined): OverlayInstanceChild[] {
    if (!node) return []
    const inherited = this.state.callStack.flatMap((f) => {
      const c = f.returnGraph.nodes.find((n) => n.id === f.callerNodeId)
      return c ? nodeOverlayChildren(this.scenario, c) : []
    })
    return [...inherited, ...nodeOverlayChildren(this.scenario, node)]
  }

  /** 找 el 所属挂载的 reactions（本节点或调用栈容器上）。 */
  private mountReactionsFor(el: OverlayInstanceChild): Reaction[] | undefined {
    const find = (n: GameNode | undefined) =>
      n ? nodeOverlayMounts(n).find((m) => overlayMountId(m) === el.source.mountId)?.reactions : undefined
    const own = find(this.node(this.state.currentNodeId))
    if (own) return own
    for (const f of this.state.callStack) {
      const c = f.returnGraph.nodes.find((n) => n.id === f.callerNodeId)
      const r = find(c)
      if (r) return r
    }
    return undefined
  }

  /**
   * 组件事件（点击 / 判定 / 超时 defaultEvent）：跑挂载 event 反应；
   * 无显式 advance 时按 handle 找边默认推进（与旧 submitInteraction 对齐）。
   */
  emitComponentEvent(elementId: string, key: string): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    const el = this.childrenOf(node).find((e) => e.id === elementId)
    if (!node || !el) return this.drain()
    const outcome =
      typeof key === 'string' && key
        ? key
        : ((el.inputs as { defaultEvent?: unknown }).defaultEvent as string) ?? 'fail'
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()

    const mountReactions = this.mountReactionsFor(el)
    const evReactions = resolveEventReactions(mountReactions, outcome, el.source.childId, el.source.mountId)
    let advanced = false
    for (const r of evReactions) {
      if (this.runEventActions(r.do, el)) {
        advanced = true
        break
      }
      if (this.redirect) break
    }
    if (this.consumeRedirect()) return this.drain()
    if (advanced) return this.drain()

    for (const srcId of this.eventRoutingNodeIds(el)) {
      const edge = this.selectHandleEdge(srcId, outcome)
      if (edge) {
        if (srcId !== node.id) {
          this.state.callStack = []
          this.returningTo.clear()
        }
        this.traverse(edge)
        break
      }
    }
    return this.drain()
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
    const kind = this.nodeKinds.resolve(node)
    if (!kind) {
      this.setPhase('ended')
      return
    }
    // 调度层公共入场：认领当前节点、清弹回标记、置时钟原点。节点态重置 / 换片 / 相位、跑元素 / 交互
    // 全由 kind.execute 经 ctx.beginPerform / beginResume 表达（descend 下钻不重置、不重播）。
    const returning = this.returningTo.delete(id)
    this.state.currentNodeId = id
    this.state.elapsedMs = 0
    this.state.visited.add(id)
    const intent = kind.execute(this.nodeCtx(node, returning))
    if (this.consumeRedirect()) return
    this.runIntent(intent, node)
  }

  /** 执行 NodeKind 返回的走向意图（节点只表达意图，动栈 / 切图 / 走边 / 结束由此代劳）。 */
  private runIntent(intent: NextIntent, node: GameNode): void {
    switch (intent.kind) {
      case 'descend':
        this.pushCall(node.id)
        if (intent.graph) this.switchGraph(intent.graph)
        this.enterNode(intent.entry)
        return
      case 'advance':
        // 无自动出边时 advanceAuto 自理：有调用栈则弹回 caller，栈空则 finishEnd 结束本局。
        if (this.state.phase === 'playing') this.advanceAuto()
        return
      case 'await':
      default:
        return
    }
  }

  /** 构造给 NodeKind 的受控上下文：读调度态 + 发指令 / 跑元素 + 节点态生命周期钩子。 */
  private nodeCtx(node: GameNode, returning: boolean): NodeRuntimeCtx {
    const self = this
    return {
      node,
      state: self.state,
      elapsedMs: self.state.elapsedMs,
      returning,
      get redirected() {
        return self.redirect !== null
      },
      emit: (d) => self.emit(d),
      childrenOf: (n) => self.childrenOf(n),
      runElement: (el) => self.runElement(el),
      beginPerform: () => self.beginPerform(node),
      beginResume: () => self.beginResume(),
      applyEnterReactions: (n) => self.applyPhaseReactionEffects(n, 'enter'),
      isInstant: (n) => self.isInstantNode(n),
      resolvePackEntry: (n) => self.resolvePackEntry(n),
    }
  }

  /** perf 进入：重置本节点态 + seedWatch + 发 playClip（换片清上一节点叠层）+ 相位置 playing。 */
  private beginPerform(node: GameNode): void {
    this.fired = new Set()
    this.firedAtReactions = new Set()
    this.windowShown = new Set()
    this.windowRemoved = new Set()
    // 组件生命周期 / spawn 游标随节点重置；watch 基线按当前态重建（本节点内的变化才 fire）。
    this.shownChildren = new Set()
    this.hiddenFired = new Set()
    this.pendingSpawns = []
    this.seedWatch()
    // 先发 playClip（换片会清空上一节点的叠层/交互）；随后 enter 元素产生的 overlay/interaction 才不会被反清。
    this.emit({
      type: 'playClip',
      nodeId: node.id,
      name: node.data.name,
      mediaId: node.data.media?.ref,
      loop: node.data.mediaPlayMode === 'loop',
      durationMs: node.data.durationMs,
    })
    this.setPhase('playing')
  }

  /** 容器弹回：不重播演出、不跑 enter 元素，只重置 fired/pending + 相位置 playing，随后沿 out 续走。 */
  private beginResume(): void {
    this.fired = new Set()
    this.setPhase('playing')
  }

  /** 瞬时节点：无 media、无 durationMs、无可 emit 事件的组件 → 进入即可推进（逻辑穿链）。 */
  private isInstantNode(node: GameNode): boolean {
    if (node.data.media?.ref) return false
    if (node.data.durationMs) return false
    return !this.childrenOf(node).some(
      (el) => this.components.handlesOf(el.component, el.inputs).length > 0,
    )
  }

  /** 解析子蓝图包入口 + 其图（subflowPack 用）；非 pack 返回 undefined。 */
  private resolvePackEntry(node: GameNode): { entry: string; graph: GameGraph } | undefined {
    const ref = getSubFlowPack(node.data)
    if (!ref) return undefined
    const pack = this.resolvePack(ref)
    const entry = resolveGraphEntry(pack.graph, ref.entry ?? pack.entry)
    if (!entry) {
      throw new Error(`subFlowPack '${pack.id}' has no nodes`)
    }
    return { entry, graph: pack.graph }
  }

  // ── tick / 演出结束 ─────────────────────────────────────────────────────────
  /** 推进节点时钟：触发到点的 at 元素 + window 时段叠层。 */
  tick(elapsedMs: number): RuntimeDirective[] {
    this.flushTimeline(elapsedMs)
    return this.drain()
  }

  /**
   * 把节点时钟推到 elapsedMs，并补跑到点的 at / window / spawn 收割。
   * 不 drain——供 tick 与 onPerformanceEnd 共用（片尾也必须先冲刷 at，再决定是否 advance）。
   */
  private flushTimeline(elapsedMs: number): void {
    this.state.elapsedMs = elapsedMs
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return

    for (const el of this.childrenOf(node)) {
      if (el.trigger.when === 'at' && !el.window && el.trigger.ms <= elapsedMs && !this.fired.has(el.id)) {
        this.runElement(el)
        if (this.redirect) break
      }
    }
    if (!this.redirect) this.applyAtReactionEffects(node, elapsedMs)

    this.tickWindows(node, elapsedMs)
    this.reapSpawns(elapsedMs)
    this.consumeRedirect()
  }

  /** window 时段：到 startMs 显示、到 endMs 移除（表现层叠层的可见时段，如漂字/计时器只显示某段）。 */
  private tickWindows(node: GameNode, elapsedMs: number): void {
    for (const el of this.childrenOf(node)) {
      if (!el.window) continue
      const start = el.window.startMs ?? 0
      const end = el.window.endMs
      if (!this.windowShown.has(el.id) && elapsedMs >= start && (end == null || elapsedMs < end)) {
        this.windowShown.add(el.id)
        this.runElement(el)
      }
      if (!this.windowRemoved.has(el.id) && end != null && elapsedMs >= end) {
        this.windowRemoved.add(el.id)
        if (this.windowShown.has(el.id)) {
          this.emit({ type: 'removeOverlay', nodeId: node.id, elementId: el.id })
          // 组件消失（unmount）→ 触发 hidden 生命周期反应（每节点访问首次）。
          if (this.shownChildren.has(el.id) && !this.hiddenFired.has(el.id)) {
            this.hiddenFired.add(el.id)
            this.fireLifecycle('hidden', el)
          }
        }
      }
    }
  }

  /**
   * 演出（视频/时长）结束：先把时钟冲到节点时长并补挂 `trigger.at`（如 video_end 才出现的應/默），
   * 再交给 NodeKind.next（缺省 advance；仅有 event 边时 advanceAuto 会停住等待 emit）。
   */
  onPerformanceEnd(): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return this.drain()
    this.chain = 0
    const dur = typeof node.data.durationMs === 'number' ? node.data.durationMs : undefined
    const endMs = Math.max(this.state.elapsedMs, dur ?? this.state.elapsedMs)
    this.flushTimeline(endMs)
    if (this.state.phase !== 'playing') return this.drain()
    if (this.consumeRedirect()) return this.drain()
    // 时间驱动唤醒（媒体播完/时长到点）→ 交由 NodeKind.next 决定走向（缺省 advance）。
    const kind = this.nodeKinds.resolve(node)
    const intent: NextIntent = kind?.next ? kind.next(this.nodeCtx(node, false)) : { kind: 'advance' }
    this.runIntent(intent, node)
    return this.drain()
  }

  /** 施加 reaction.do 中的 effect（生命周期相位：enter/at/exit/complete，只改状态、不换节点）。 */
  private runEffectActions(actions: NodeAction[]): void {
    for (const a of actions) {
      if (a.kind === 'effect' && a.effects.length) this.applyAndReact(a.effects)
    }
  }

  /** 事件路由可匹配的节点 id：当前节点 + 调用栈容器 + 元素所属节点。 */
  private eventRoutingNodeIds(el?: OverlayInstanceChild): string[] {
    const ids: string[] = []
    const cur = this.state.currentNodeId
    if (cur) ids.push(cur)
    for (const f of this.state.callStack) {
      if (!ids.includes(f.callerNodeId)) ids.push(f.callerNodeId)
    }
    if (el?.source.nodeId && !ids.includes(el.source.nodeId)) ids.push(el.source.nodeId)
    return ids
  }

  /** 交互事件 do：effect/spawn/advance；advance = 沿当前图的边软推进。返回是否已换节点。 */
  private runEventActions(actions: NodeAction[], el?: OverlayInstanceChild): boolean {
    for (const a of actions) {
      if (a.kind === 'effect') {
        if (a.effects.length) this.applyAndReact(a.effects)
      } else if (a.kind === 'spawn') {
        this.doSpawn(a)
      } else if (a.kind === 'advance') {
        const edge = this.edgeById(a.edgeId)
        if (edge && this.eventRoutingNodeIds(el).includes(edge.source)) {
          if (edge.source !== this.state.currentNodeId) {
            this.state.callStack = []
            this.returningTo.clear()
          }
          this.traverse(edge)
          return true
        }
      }
      if (this.redirect) return false
    }
    return false
  }

  /** 施加节点某生命周期相位（enter/exit）reactions 的副作用。 */
  private applyPhaseReactionEffects(node: GameNode, phase: 'enter' | 'exit'): void {
    for (const r of node.data.reactions ?? []) {
      if (r.when.type === phase) this.runEffectActions(r.do)
      if (this.redirect) return
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
      if (this.redirect) return
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

  private mountLayoutFor(el: OverlayInstanceChild): Layout | undefined {
    const node = this.nodes.get(el.source.nodeId)
    const mount = nodeOverlayMounts(node).find((m) => overlayMountId(m) === el.source.mountId)
    if (mount?.layout && !layoutIsEffectivelyEmpty(mount.layout)) return mount.layout
    return undefined
  }

  private emitRenderOverlay(d: RenderOverlayDirective, el: OverlayInstanceChild): void {
    this.emit({
      ...d,
      mountId: d.mountId ?? el.source.mountId,
      mountLayout: d.mountLayout ?? this.mountLayoutFor(el),
      childLayout: d.childLayout ?? el.layout,
    } as RenderOverlayDirective & { mountId: string })
  }

  // ── 元素派发 ────────────────────────────────────────────────────────────────
  private runElement(el: OverlayInstanceChild): void {
    this.fired.add(el.id)
    // 组件出现（mount）→ 触发 shown 生命周期反应（每节点访问首次）。
    if (!this.shownChildren.has(el.id)) {
      this.shownChildren.add(el.id)
      this.fireLifecycle('shown', el)
      if (this.redirect) return
    }
    // 全部组件统一 renderOverlay；expr 等绘制时 resolve（见 floatText / battleHpBar）。
    this.emitRenderOverlay({
      type: 'renderOverlay',
      nodeId: this.state.currentNodeId ?? '',
      elementId: el.id,
      component: el.component,
      inputs: el.inputs,
    }, el)
  }

  /** 离开节点前跑 exit 相位 reactions（副作用）+ 仍可见组件的 hidden 生命周期。 */
  private runExit(node: GameNode): void {
    this.inExit = true
    this.applyPhaseReactionEffects(node, 'exit')
    // 离场：本节点仍显示、未触发 hidden 的组件，统一 unmount → 触发 hidden。
    for (const el of this.childrenOf(node)) {
      if (this.shownChildren.has(el.id) && !this.hiddenFired.has(el.id)) {
        this.hiddenFired.add(el.id)
        this.fireLifecycle('hidden', el)
      }
    }
    this.inExit = false
  }

  /** 若有待消费的 redirect（watch/lifecycle advance），跑当前节点 exit 后即时跳转。返回是否跳转。 */
  private consumeRedirect(): boolean {
    if (!this.redirect) return false
    const { goto, resetGlobals } = this.redirect
    this.redirect = null
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
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
    this.checkWatch()
  }

  // ── 响应式 watch（pull-diff 于写屏障）────────────────────────────────────────
  private evalCtx(locals?: Record<string, number>): EvalCtx {
    return {
      vars: this.state.vars,
      entities: this.state.entities,
      flags: this.state.flags,
      score: this.state.score,
      rng: this.state.rng,
      ...(locals ? { locals } : {}),
    }
  }

  private safeEval(expr: string, locals?: Record<string, number>): number {
    try {
      return evalExpr(expr, this.evalCtx(locals))
    } catch {
      return 0
    }
  }

  /**
   * 当前作用域内的 watch 反应，带稳定 key：
   * 当前节点 + 各挂载 + **调用栈上的子流程容器节点**（容器级 watch 覆盖整段子流程，
   * 如「我方回合」容器上的 watch 在其技能子节点执行期间仍生效）。
   */
  private activeWatchReactions(): Array<{ key: string; r: Reaction }> {
    const out: Array<{ key: string; r: Reaction }> = []
    const node = this.node(this.state.currentNodeId)
    if (node) {
      ;(node.data.reactions ?? []).forEach((r, i) => {
        if (r.when.type === 'watch') out.push({ key: `n:${node.id}#${i}`, r })
      })
      nodeOverlayMounts(node).forEach((m) => {
        const mid = overlayMountId(m)
        ;(m.reactions ?? []).forEach((r, i) => {
          if (r.when.type === 'watch') out.push({ key: `m:${node.id}:${mid}#${i}`, r })
        })
      })
    }
    // 调用栈上的容器（我方回合/敌方回合/子蓝图）：其 watch 在整段子流程内生效。
    this.state.callStack.forEach((frame, d) => {
      const container = frame.returnGraph.nodes.find((n) => n.id === frame.callerNodeId)
      ;(container?.data.reactions ?? []).forEach((r, i) => {
        if (r.when.type === 'watch') out.push({ key: `c${d}:${frame.callerNodeId}#${i}`, r })
      })
    })
    return out
  }

  /** 进入节点时对活跃 watch 建立基线（不触发），使本节点内的后续变化才 fire。 */
  private seedWatch(): void {
    for (const { key, r } of this.activeWatchReactions()) {
      if (r.when.type !== 'watch') continue
      this.watchPrev.set(key, this.safeEval(r.when.of))
    }
  }

  /** 写屏障后重采样：对每个 watch 反应比对 prev/next，按 on 命中即跑 do（注入 prev/next/delta）。 */
  private checkWatch(): void {
    if (this.inExit || this.state.phase === 'ended') return
    for (const { key, r } of this.activeWatchReactions()) {
      if (r.when.type !== 'watch') continue
      const next = this.safeEval(r.when.of)
      if (!this.watchPrev.has(key)) {
        this.watchPrev.set(key, next)
        continue
      }
      const prev = this.watchPrev.get(key)!
      if (next === prev) continue
      const on = r.when.on ?? 'change'
      const fire = on === 'inc' ? next > prev : on === 'dec' ? next < prev : true
      // 先更新基线再跑 do，避免 do 内改状态导致自触发。
      this.watchPrev.set(key, next)
      if (!fire) continue
      this.runReactiveActions(r.do, { prev, next, delta: next - prev })
      if (this.redirect) return
    }
  }

  /** watch / shown / hidden / 非阻塞 emit 的 do：effect / spawn / advance；advance → 硬打断（redirect 到边 target）。 */
  private runReactiveActions(actions: NodeAction[], locals?: Record<string, number>): void {
    for (const a of actions) {
      if (a.kind === 'effect') {
        if (a.effects.length) this.applyAndReact(a.effects)
      } else if (a.kind === 'spawn') {
        this.doSpawn(a, locals)
      } else if (a.kind === 'advance') {
        // exit 期不接受 advance（避免与正在进行的 consumeRedirect 自跳环）。
        if (!this.redirect && !this.inExit) {
          const edge = this.edgeById(a.edgeId)
          if (edge) this.redirect = { goto: edge.target }
        }
      }
      if (this.redirect) return
    }
  }

  private resolveBind(value: unknown, locals?: Record<string, number>): unknown {
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>
      // 数值绑定：`{ expr }`（走 expr 求值，返回数字）。
      if (typeof o.expr === 'string') return this.safeEval(o.expr, locals)
      // 标识/字符串绑定：`{ ref }`（如 entity.<id>.name，随实体改名动态取；不写死）。
      if (typeof o.ref === 'string') return this.resolveRef(o.ref)
    }
    return value
  }

  /**
   * 解析非数值引用（字符串场景，如实体名）。名字取自 scenario.entities（作者可改），非落盘写死。
   * 支持：entity.<id>.name / entity.<id>.attr.<a>(数字) / var.<id> / score。
   */
  private resolveRef(ref: string): unknown {
    const p = ref.split('.')
    if (p[0] === 'entity') {
      const id = p[1] ?? ''
      if (p[2] === 'name') return this.scenario.entities?.[id]?.name ?? id
      if (p[2] === 'attr' && p[3]) return this.state.entities[id]?.attrs[p[3]] ?? 0
      return id
    }
    if (p[0] === 'var') return this.state.vars[p.slice(1).join('.')] ?? 0
    if (p[0] === 'score') return this.state.score
    return ref
  }

  /** 主动刷出一个 overlay 组件模板实例（瞬态；ttl 到点自动移除）。 */
  private doSpawn(action: Extract<NodeAction, { kind: 'spawn' }>, locals?: Record<string, number>): void {
    const nodeId = this.state.currentNodeId
    if (!nodeId) return
    const slash = action.from.indexOf('/')
    const overlayId = slash >= 0 ? action.from.slice(0, slash) : action.from
    const childId = slash >= 0 ? action.from.slice(slash + 1) : ''
    const tpl = this.scenario.ui?.overlays?.[overlayId]?.children.find((c) => c.id === childId)
    // 模板默认 + spawn 覆盖，合并后统一 resolveBind：{expr}(数值) / {ref}(实体名等) 均在此就地求值成具体值。
    const merged: Record<string, unknown> = { ...(tpl?.inputs ?? {}), ...(action.inputs ?? {}) }
    const inputs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) inputs[k] = this.resolveBind(v, locals)
    const component = tpl?.component ?? overlayId
    const layout: Layout | undefined = action.layout ?? (tpl?.layout && !layoutIsEffectivelyEmpty(tpl.layout) ? tpl.layout : undefined)
    const elementId = `spawn:${++this.spawnSeq}`
    this.emit({
      type: 'renderOverlay',
      nodeId,
      mountId: elementId,
      mountLayout: layout,
      childLayout: layout,
      elementId,
      component,
      inputs,
    })
    if (action.ttlMs && action.ttlMs > 0) {
      this.pendingSpawns.push({ elementId, nodeId, removeAtMs: this.state.elapsedMs + action.ttlMs })
    }
  }

  /** 到点回收 ttl 到期的 spawn 叠层。 */
  private reapSpawns(elapsedMs: number): void {
    if (!this.pendingSpawns.length) return
    const nodeId = this.state.currentNodeId
    const keep: typeof this.pendingSpawns = []
    for (const s of this.pendingSpawns) {
      if (s.nodeId === nodeId && elapsedMs >= s.removeAtMs) {
        this.emit({ type: 'removeOverlay', nodeId: s.nodeId, elementId: s.elementId })
      } else {
        keep.push(s)
      }
    }
    this.pendingSpawns = keep
  }

  // ── 组件生命周期（shown / hidden）─────────────────────────────────────────────
  /** `of` 是否指向该运行态 child（支持 childId / mountId-overlayId/childId / 运行态全 id）。 */
  private matchOf(of: string, el: OverlayInstanceChild): boolean {
    const s = el.source
    return (
      of === s.childId ||
      of === el.id ||
      of === `${s.mountId}/${s.childId}` ||
      of === `${s.overlayId}/${s.childId}`
    )
  }

  private lifecycleReactions(node: GameNode, kind: 'shown' | 'hidden', el: OverlayInstanceChild): Reaction[] {
    const out: Reaction[] = []
    for (const r of node.data.reactions ?? []) {
      if (r.when.type === kind && this.matchOf(r.when.of, el)) out.push(r)
    }
    for (const m of nodeOverlayMounts(node)) {
      for (const r of m.reactions ?? []) {
        if (r.when.type === kind && this.matchOf(r.when.of, el)) out.push(r)
      }
    }
    return out
  }

  private fireLifecycle(kind: 'shown' | 'hidden', el: OverlayInstanceChild): void {
    const node = this.node(this.state.currentNodeId)
    if (!node) return
    for (const r of this.lifecycleReactions(node, kind, el)) {
      this.runReactiveActions(r.do)
      if (this.redirect) return
    }
  }

  // ── 出口选择 / 边遍历 ───────────────────────────────────────────────────────
  /** 按 id 找当前图（或主图）里的边——供 reactions.do 的 advance(edgeId) 使用。 */
  private edgeById(id: string): GameEdge | undefined {
    return this.activeGraph.edges.find((e) => e.id === id) ?? this.rootGraph.edges.find((e) => e.id === id)
  }

  /** 从候选边里选一条：有条件者按序求值，命中优先；否则无条件兜底；多条候选皆带 weight 则加权随机。 */
  private pickEdge(edges: GameEdge[]): GameEdge | undefined {
    if (edges.length === 0) return undefined
    const conditioned = edges.filter((e) => e.data?.condition)
    const uncond = edges.filter((e) => !e.data?.condition)
    const passing = conditioned.filter((e) => evaluateCondition(e.data?.condition, this.condTarget()))
    const pool = passing.length > 0 ? passing : uncond
    if (pool.length === 0) return undefined
    if (pool.length > 1 && pool.every((e) => e.data?.weight !== undefined)) return this.pickWeighted(pool)
    return pool[0]
  }

  /** 是否存在非 default 的 event 出边（声明式等待：演出结束不自动推进）。 */
  private hasEventHandleOutEdges(nodeId: string): boolean {
    return (this.outgoing.get(nodeId) ?? []).some(
      (e) => e.sourceHandle != null && e.sourceHandle !== 'default',
    )
  }

  /** 自动推进：默认出口（sourceHandle === 'default' 或缺省）。 */
  private selectAutoEdge(nodeId: string): GameEdge | undefined {
    return this.pickEdge(
      (this.outgoing.get(nodeId) ?? []).filter((e) => e.sourceHandle === undefined || e.sourceHandle === 'default'),
    )
  }

  /** 交互出口：sourceHandle === 事件 id。 */
  private selectHandleEdge(nodeId: string, handle: string): GameEdge | undefined {
    return this.pickEdge((this.outgoing.get(nodeId) ?? []).filter((e) => (e.sourceHandle ?? 'default') === handle))
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
    // 收尾副作用（complete reactions）先施加，再由边决定走向；副作用可能触发 watch advance 改道。
    const curNode = this.nodes.get(nodeId)
    if (curNode) {
      this.applyCompleteReactionEffects(curNode)
      if (this.consumeRedirect()) return
    }
    const edge = this.selectAutoEdge(nodeId)
    if (!edge) {
      // 声明式等待：仅有 event 出边、无 default → 停在本节点等组件 emit（不结束本局）。
      if (this.hasEventHandleOutEdges(nodeId)) return
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
      via: edge.sourceHandle ?? 'default',
      target: edge.target,
      reason: describeCondition(edge.data?.condition, this.condTarget()),
    })
    this.state.traversedEdgeIds.add(edge.id)
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
    this.enterNode(edge.target)
  }

  private finishEnd(_nodeId: string): void {
    // 无出边且调用栈空 → 本局结束。引擎只负责把相位切到 ended，不强制任何结局文案；
    // 胜负/结局表现完全交给节点 overlay 与图规则（reactions），配了什么才演什么。
    this.setPhase('ended')
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
