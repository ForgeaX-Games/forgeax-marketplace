/**
 * GraphRuntime —— 纯 TS 状态机，**直接执行 GameGraph**（无 Scene/branches/编译层）。
 *
 * 走法（spec §3）：进入节点 → 跑 enter reactions + emit playClip → tick 时按 trigger 触发 overlay 子件
 * → 按 role 派发（presentation 出画面 / interaction 挂起等输入）→ 演出结束/交互判定
 * → 选出口 handle → 沿 edge → 进入下一节点。产**泛型 directive**，Player 消费。
 *
 * 关键机制：
 *  - 触发时机 Trigger：enter / at(ms)。
 *  - 出口=handle：sourceHandle === 出口 event id（default = 保留字/默认推进），edge 只管连接 + 条件/权重。
 *  - 条件网关：同 handle 多边，有条件者按序求值、无条件兜底；加权随机：候选皆带 weight → rng 加权。
 *  - 交互：openInteraction 挂起 → 皮肤自判定后 submit（=emit 已声明 event id）→ outcome=event id →
 *    reactions.do（effect/spawn/advance）→ 有边则默认 advance（无匹配边则只做副作用、不换节点）。
 *  - 副作用：一律走 reactions（边与皮肤 submit 都不带 effects）。
 *  - 换节点：只经边；reactions.do 的 advance(edgeId) 或引擎默认推进。
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
import type { Layout, NodeAction, OverlayInstanceChild, Reaction } from '../schema/node-config-schema'
import { overlayMountId } from '../schema/node-config-schema'
import { applyEffects, type MutableState } from './apply-effects'
import { initState } from './engine-init'
import { defaultComponentRegistry, type ComponentRegistry, type RuntimeCtx } from '../registry/component-registry'
import type { RuntimeDirective, RenderOverlayDirective } from './directives'
import { evaluateCondition, describeCondition, type ConditionTarget } from './condition'
import { evalExpr, type EvalCtx } from './expr'
import { layoutIsEffectivelyEmpty } from '../schema/layout'

const STAGE_FILL: Layout = { left: 0, top: 0, width: 1, height: 1 }


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

  constructor(
    graph: GameGraph,
    private readonly scenario: GameScenario,
    components: ComponentRegistry = defaultComponentRegistry,
    packs: readonly SubFlowPackDef[] = [],
  ) {
    this.rootGraph = graph
    this.activeGraph = graph
    this.components = components
    for (const p of packs) {
      this.packsByKey.set(packLookupKey(p.id, p.version), p)
      if (!this.packsByKey.has(p.id)) this.packsByKey.set(p.id, p) // 无版本时也可按 id 命中
    }
    for (const req of scenario.requiredPlugins ?? []) {
      if (!this.components.hasPlugin(req.id, req.version)) {
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
   * 组件**非阻塞**事件：点击某展示组件的按钮 → 跑其所属挂载的 event 反应（effect/spawn/advance）。
   * 不进 awaitInteraction、不占 pending——与主交互（技能/QTE）并存；advance = 硬打断到边 target。
   */
  emitComponentEvent(elementId: string, key: string): RuntimeDirective[] {
    const el = this.childrenOf(this.node(this.state.currentNodeId)).find((e) => e.id === elementId)
    if (!el) return this.drain()
    const evs = resolveEventReactions(this.mountReactionsFor(el), key, el.source.childId, el.source.mountId)
    for (const r of evs) {
      this.runReactiveActions(r.do)
      if (this.redirect) break
    }
    this.consumeRedirect()
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
    // 组件生命周期 / spawn 游标随节点重置；watch 基线按当前态重建（本节点内的变化才 fire）。
    this.shownChildren = new Set()
    this.hiddenFired = new Set()
    this.pendingSpawns = []
    this.seedWatch()

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

    // enter 计算：先铺完所有表现层（HUD / 字幕方案等），再开交互。
    // 旧逻辑「碰交互就 break」会吞掉挂载顺序靠后的静态方案血条；带 window 的仍改由时钟驱动。
    for (const el of this.childrenOf(node)) {
      if (el.trigger.when !== 'enter' || el.window) continue
      if ((this.getComponent(el.component)?.role ?? 'presentation') === 'interaction') continue
      this.runElement(el)
      if (this.redirect) break
    }
    if (!this.redirect) {
      for (const el of this.childrenOf(node)) {
        if (el.trigger.when !== 'enter' || el.window) continue
        if ((this.getComponent(el.component)?.role ?? 'presentation') !== 'interaction') continue
        this.runElement(el)
        if (this.state.phase === 'awaitInteraction' || this.redirect) break
      }
    }
    // enter 相位 reactions 的副作用（生命周期效果）。
    if (this.state.phase !== 'awaitInteraction' && !this.redirect) this.applyPhaseReactionEffects(node, 'enter')
    if (this.state.phase === 'awaitInteraction') return
    if (this.consumeRedirect()) return

    // 瞬时节点（无视频、无演出时长、无交互）→ 立即推进，形成逻辑穿链。
    // 有视频时按素材播完（Player onEnded）推进，不看 durationMs。
    const hasMedia = !!node.data.media?.ref
    const hasInteraction = this.childrenOf(node).some(
      (el) => this.getComponent(el.component)?.role === 'interaction',
    )
    if (!hasMedia && !node.data.durationMs && !hasInteraction) {
      if (this.consumeRedirect()) return
      if (this.state.phase === 'playing') this.advanceAuto()
    }
  }

  // ── tick / 演出结束 ─────────────────────────────────────────────────────────
  /**
   * 推进节点时钟：触发到点的 at 元素 + window 时段叠层。
   * 交互挂起（awaitInteraction）时仍推进 window（时间轴飘字/字幕），否则试玩里选项一出叠层全灭。
   */
  tick(elapsedMs: number): RuntimeDirective[] {
    this.state.elapsedMs = elapsedMs
    const node = this.node(this.state.currentNodeId)
    if (!node) return this.drain()
    const phase = this.state.phase as GraphPhase
    if (phase !== 'playing' && phase !== 'awaitInteraction') return this.drain()

    if (phase === 'playing') {
      for (const el of this.childrenOf(node)) {
        if (el.trigger.when === 'at' && !el.window && el.trigger.ms <= elapsedMs && !this.fired.has(el.id)) {
          this.runElement(el)
          if ((this.state.phase as GraphPhase) === 'awaitInteraction' || this.redirect) break
        }
      }
      // at 相位 reactions 的副作用（到点施加）。
      if (this.state.phase === 'playing' && !this.redirect) this.applyAtReactionEffects(node, elapsedMs)
    }

    this.tickWindows(node, elapsedMs)
    this.reapSpawns(elapsedMs)
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
          // 组件消失（unmount）→ 触发 hidden 生命周期反应（每节点访问首次）。
          if (this.shownChildren.has(el.id) && !this.hiddenFired.has(el.id)) {
            this.hiddenFired.add(el.id)
            this.fireLifecycle('hidden', el)
          }
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
   * 玩家对挂起的 interaction 提交输入：皮肤已自行判定，`input` 即最终 outcome（event id）——
   * 命中的 event reaction 的 do（effect/spawn/advance）；无显式 advance 则有匹配出边默认推进。
   */
  submitInteraction(elementId: string, input: unknown): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    const el = this.childrenOf(node).find((e) => e.id === elementId)
    if (!node || !el) return this.drain()
    if (this.state.phase !== 'awaitInteraction' || this.pending !== elementId) return this.drain()
    // 皮肤自判定后 emit 的**最终 event id** 即 outcome；缺省（超时 submit(undefined)）落 inputs.defaultEvent（兜底 'fail'）。
    const outcome =
      typeof input === 'string' && input
        ? input
        : ((el.inputs as { defaultEvent?: unknown }).defaultEvent as string) ?? 'fail'
    this.pending = null
    this.setPhase('playing')
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()

    // 命中 outcome 的 event reaction：do 同级跑 effect/spawn/advance（副作用一律在此）。
    const mountReactions =
      nodeOverlayMounts(node).find((m) => overlayMountId(m) === el.source.mountId)?.reactions
      ?? nodeOverlayMounts(node)[0]?.reactions
    const evReactions = resolveEventReactions(mountReactions, outcome, el.source.childId, el.source.mountId)
    let advanced = false
    for (const r of evReactions) {
      if (this.runEventActions(r.do)) {
        advanced = true
        break
      }
      if (this.redirect) break
    }
    if (this.consumeRedirect()) return this.drain()
    if (advanced) return this.drain()

    // 无显式 advance：有匹配出边则默认推进；无匹配边 → 只做副作用、不换节点（演出续播/收尾时再默认推进）。
    const edge = this.selectHandleEdge(node.id, outcome)
    if (edge) this.traverse(edge)
    return this.drain()
  }

  /** 施加 reaction.do 中的 effect（生命周期相位：enter/at/exit/complete，只改状态、不换节点）。 */
  private runEffectActions(actions: NodeAction[]): void {
    for (const a of actions) {
      if (a.kind === 'effect' && a.effects.length) this.applyAndReact(a.effects)
    }
  }

  /** 交互事件 do：effect/spawn/advance；advance = 沿当前图的边软推进。返回是否已换节点。 */
  private runEventActions(actions: NodeAction[]): boolean {
    for (const a of actions) {
      if (a.kind === 'effect') {
        if (a.effects.length) this.applyAndReact(a.effects)
      } else if (a.kind === 'spawn') {
        this.doSpawn(a)
      } else if (a.kind === 'advance') {
        const edge = this.edgeById(a.edgeId)
        if (edge && edge.source === this.state.currentNodeId) {
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

  private mountLayoutFor(el: OverlayInstanceChild): Layout | undefined {
    const node = this.nodes.get(el.source.nodeId)
    const mount = nodeOverlayMounts(node).find((m) => overlayMountId(m) === el.source.mountId)
    if (mount?.layout && !layoutIsEffectivelyEmpty(mount.layout)) return mount.layout
    const plugin = this.getComponent(el.component)
    if (plugin?.stageRelative) return STAGE_FILL
    return undefined
  }

  private emitRenderOverlay(d: RenderOverlayDirective, el: OverlayInstanceChild): void {
    const plugin = this.getComponent(el.component)
    this.emit({
      ...d,
      mountId: d.mountId ?? el.source.mountId,
      mountLayout: d.mountLayout ?? this.mountLayoutFor(el),
      childLayout: d.childLayout ?? el.layout,
      selfPositioned: d.selfPositioned ?? plugin?.stageRelative,
    } as RenderOverlayDirective & { mountId: string })
  }

  // ── 元素派发 ────────────────────────────────────────────────────────────────
  private runElement(el: OverlayInstanceChild): void {
    const plugin = this.getComponent(el.component)
    const role = plugin?.role ?? 'presentation'
    this.fired.add(el.id)
    // 组件出现（mount）→ 触发 shown 生命周期反应（每节点访问首次）。
    // 注意：已在 awaitInteraction 时仍要继续渲表现层（window 飘字/字幕）；
    // 仅当「本次 shown 反应新打开交互 / 改道」才中断后续派发。
    const phaseBeforeShown = this.state.phase as GraphPhase
    if (!this.shownChildren.has(el.id)) {
      this.shownChildren.add(el.id)
      this.fireLifecycle('shown', el)
      if (this.redirect) return
      if (
        role !== 'presentation'
        && phaseBeforeShown !== 'awaitInteraction'
        && this.state.phase === 'awaitInteraction'
      ) {
        return
      }
    }
    const ctx = { ...this.ctx(), elementId: el.id }
    const inputs = el.inputs
    if (role === 'presentation') {
      if (plugin?.render) {
        for (const d of plugin.render(ctx, inputs)) {
          if (d.type === 'renderOverlay') this.emitRenderOverlay(d, el)
          else this.emit(d)
        }
      } else {
        this.emitRenderOverlay({
          type: 'renderOverlay',
          nodeId: this.state.currentNodeId ?? '',
          elementId: el.id,
          component: el.component,
          inputs,
        }, el)
      }
    } else if (role === 'interaction') {
      if (!plugin) return
      // 已有主交互挂起时不再叠开第二个（window 触发的交互元素不受 enter/tick 外层循环 break 约束，需要本地兜底）。
      if (this.state.phase === 'awaitInteraction') return
      // 限时：timeoutMs（choice）/ windowMs（QTE 窗口）/ durationMs（皮肤时限）同源。
      const timeoutRaw =
        (typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined)
        ?? (typeof inputs.windowMs === 'number' ? inputs.windowMs : undefined)
        ?? (typeof inputs.durationMs === 'number' ? inputs.durationMs : undefined)
      const timeoutMs = typeof timeoutRaw === 'number' && timeoutRaw > 0 ? timeoutRaw : undefined
      // 选项门控由皮肤用 inputs.events[].condition + SkinCtx 时时求值（不注入 _locked）。
      this.emit({
        type: 'openInteraction',
        nodeId: this.state.currentNodeId ?? '',
        elementId: el.id,
        component: el.component,
        inputs,
        handles: this.components.handlesOf(el.component, inputs).map((h) => h.id),
        ...(timeoutMs ? { timeoutMs } : {}),
      })
      this.setPhase('awaitInteraction')
      this.pending = el.id
      return
    }
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

  /** 局级 state reactions：状态变化后求值，首个命中且含显式 advance 的设 redirect（硬打断到边 target）。 */
  private checkRules(): void {
    if (this.inExit || this.redirect || this.state.phase === 'ended') return
    for (let i = 0; i < this.reactions.length; i++) {
      const r = this.reactions[i]!
      if (r.when.type !== 'state') continue
      if (this.firedStateReactions.has(i)) continue
      if (!evaluateCondition(r.when.condition, this.condTarget())) continue
      const adv = r.do.find((a): a is Extract<NodeAction, { kind: 'advance' }> => a.kind === 'advance')
      if (!adv) continue
      const edge = this.edgeById(adv.edgeId)
      if (!edge) continue
      this.firedStateReactions.add(i)
      this.redirect = { goto: edge.target }
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
    if (!this.redirect) this.checkWatch()
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
   * scenario 全局 + 当前节点 + 各挂载 + **调用栈上的子流程容器节点**（容器级 watch 覆盖整段子流程，
   * 如「我方回合」容器上的 watch 在其技能子节点执行期间仍生效）。
   */
  private activeWatchReactions(): Array<{ key: string; r: Reaction }> {
    const out: Array<{ key: string; r: Reaction }> = []
    this.reactions.forEach((r, i) => {
      if (r.when.type === 'watch') out.push({ key: `s#${i}`, r })
    })
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
    const plugin = this.getComponent(component)
    const mountLayout = layout ?? (plugin?.stageRelative ? STAGE_FILL : undefined)
    const elementId = `spawn:${++this.spawnSeq}`
    this.emit({
      type: 'renderOverlay',
      nodeId,
      mountId: elementId,
      mountLayout,
      elementId,
      component,
      inputs,
      selfPositioned: plugin?.stageRelative,
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
