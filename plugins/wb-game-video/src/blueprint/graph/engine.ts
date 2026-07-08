/**
 * GraphRuntime —— 纯 TS 状态机，**直接执行 GameGraph**（无 Scene/branches/编译层）。
 *
 * 走法（spec §3）：进入节点 → 跑 enter 计算 + emit playClip → tick 时按 trigger 触发时间线元素
 * → 按 role 派发（logic 改状态 / presentation 出画面 / interaction 挂起等输入）→ 演出结束/交互判定
 * → 选出口 handle → 沿 edge → 进入下一节点。产**泛型 directive**，Player 消费。
 *
 * 关键机制：
 *  - 触发时机 TriggerSpec：enter / at(ms) / performanceEnd / exit / stateChange(反应式)。
 *  - 出口=handle：语义在 sourceHandle（out、cond:N、else、pass、opt:N …），edge 只管连接 + 条件/副作用/权重。
 *  - 条件网关：cond:N 按序求值，else/out 兜底；加权随机：多条候选带 weight → rng 加权。
 *  - 交互：openInteraction 挂起 → submitInteraction(resolve) → outcome→handle→edge。
 *  - jumpToNode：seek 到任意节点（默认保留全局态）。
 */
import type { GameEdge, GameGraph, GameNode, GameScenario, GraphEffect, ReactiveRule, TimelineElement } from './graph-schema'
import { applyEffects, type MutableState } from './apply-effects'
import { initState } from './engine-init'
import { getKind, type RuntimeCtx } from './kind-registry'
import type { RuntimeDirective } from './directives'
import { evaluateCondition, describeCondition, type ConditionTarget } from './condition'

export type GraphPhase = 'idle' | 'playing' | 'awaitInteraction' | 'ended'

export interface RuntimeState extends MutableState {
  currentNodeId: string | null
  phase: GraphPhase
  elapsedMs: number
  visited: Set<string>
  traversedEdgeIds: Set<string>
  callStack: string[]
  log: string[]
}

const CHAIN_GUARD = 200

export class GraphRuntime {
  private readonly nodes = new Map<string, GameNode>()
  private readonly outgoing = new Map<string, GameEdge[]>()
  readonly state: RuntimeState
  private queue: RuntimeDirective[] = []

  // 每节点重置的运行游标
  private fired = new Set<string>() // 已触发的 at/enter/perfEnd/exit/afterHit 元素 id
  private firedReactive = new Set<string>() // 已触发的 stateChange 元素 id
  private windowShown = new Set<string>() // 已按 window.startMs 显示的元素 id
  private windowRemoved = new Set<string>() // 已按 window.endMs 移除的元素 id
  private pending: string | null = null // 挂起中的 interaction 元素 id
  private chain = 0 // 同步穿链计数（anti-runaway）

  // 图级反应规则（即时判负/判胜）：命中即设 redirect，在安全边界消费为一次跳转。
  private readonly rules: ReactiveRule[]
  private readonly firedRules = new Set<string>()
  private redirect: { goto: string; resetGlobals?: boolean } | null = null
  private inExit = false // 跑 exit 元素期间抑制规则消费，避免退出时自跳环
  private returningTo = new Set<string>() // 正在弹回的容器节点：下一次 enter 跳过 subFlowRef 下钻、直接续 out

  constructor(
    private readonly graph: GameGraph,
    private readonly scenario: GameScenario,
  ) {
    for (const node of graph.nodes) this.nodes.set(node.id, node)
    for (const edge of graph.edges) {
      const list = this.outgoing.get(edge.source)
      if (list) list.push(edge)
      else this.outgoing.set(edge.source, [edge])
    }
    this.rules = scenario.rules ?? []
    this.state = { ...initState(scenario), ...control() }
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
    const entry = this.graph.nodes[0]
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
    // 子流程下钻：首次进入容器 → 压栈 + 跳到子流程入口（不播容器自身演出）。
    if (node.data.subFlowRef && !this.returningTo.has(id)) {
      this.state.currentNodeId = id
      this.state.visited.add(id)
      this.state.callStack.push(id)
      this.enterNode(node.data.subFlowRef)
      return
    }
    const returning = this.returningTo.delete(id)
    this.state.currentNodeId = id
    this.state.elapsedMs = 0
    this.state.visited.add(id)
    // 子流程容器弹回：不重播演出、不跑 enter 元素，直接沿 out 续走。
    if (returning && node.data.subFlowRef) {
      this.fired = new Set()
      this.firedReactive = new Set()
      this.pending = null
      this.setPhase('playing')
      this.advanceAuto()
      return
    }
    this.fired = new Set()
    this.firedReactive = new Set()
    this.windowShown = new Set()
    this.windowRemoved = new Set()
    this.pending = null

    // 先发 playClip（换片会清空上一节点的叠层/交互）；随后 enter 元素产生的 overlay/interaction
    // 才不会被 playClip 反向清掉。
    this.emit({
      type: 'playClip',
      nodeId: id,
      name: node.data.name,
      clipId: node.data.clipId,
      mediaId: node.data.media?.ref,
      loop: node.data.mediaPlayMode === 'loop',
      durationMs: node.data.durationMs,
    })
    this.setPhase('playing')

    // enter 计算（可能开交互 → 挂起；或触发图级规则 → 即时改道）。带 window 的元素改由时钟窗口驱动，跳过。
    for (const el of node.data.timeline) {
      if (el.trigger.when === 'enter' && !el.window) this.runElement(el)
      if (this.state.phase === 'awaitInteraction' || this.redirect) break
    }
    if (this.state.phase === 'awaitInteraction') return
    if (this.consumeRedirect()) return

    // 瞬时节点（无演出时长 且 无交互元素）→ 立即推进，形成逻辑穿链。
    const hasInteraction = node.data.timeline.some((el) => getKind(el.kind)?.role === 'interaction')
    if (!node.data.durationMs && !hasInteraction) {
      this.runPerformanceEnd(node)
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
    for (const el of node.data.timeline) {
      if (el.trigger.when === 'at' && !el.window && el.trigger.ms <= elapsedMs && !this.fired.has(el.id)) {
        this.runElement(el)
        if ((this.state.phase as GraphPhase) === 'awaitInteraction' || this.redirect) break
      }
    }
    this.tickWindows(node, elapsedMs)
    this.consumeRedirect()
    return this.drain()
  }

  /** window 时段：到 startMs 显示、到 endMs 移除（表现层叠层的可见时段，如漂字/计时器只显示某段）。 */
  private tickWindows(node: GameNode, elapsedMs: number): void {
    for (const el of node.data.timeline) {
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

  /** 演出（视频/时长）结束：跑 performanceEnd 元素，若未挂起则自动沿出口推进。 */
  onPerformanceEnd(): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return this.drain()
    this.chain = 0
    this.runPerformanceEnd(node)
    if (this.consumeRedirect()) return this.drain()
    if (this.state.phase === 'playing') this.advanceAuto()
    return this.drain()
  }

  private runPerformanceEnd(node: GameNode): void {
    for (const el of node.data.timeline) {
      if (el.trigger.when === 'performanceEnd' && !el.window && !this.fired.has(el.id)) this.runElement(el)
      if (this.state.phase === 'awaitInteraction' || this.redirect) return
    }
  }

  // ── 交互 ────────────────────────────────────────────────────────────────────
  /** 玩家对挂起的 interaction 提交输入 → resolve → outcome→handle→edge。 */
  submitInteraction(elementId: string, input: unknown): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    const el = node?.data.timeline.find((e) => e.id === elementId)
    if (!node || !el) return this.drain()
    const plugin = getKind(el.kind)
    if (!plugin?.resolve) return this.drain()
    const { outcome, effects } = plugin.resolve(this.ctx(), el.params, input)
    if (effects) this.applyAndReact(effects as GraphEffect[])
    this.pending = null
    this.setPhase('playing')
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()
    const edge = this.selectHandleEdge(node.id, outcome)
    if (edge) this.traverse(edge)
    else this.advanceAuto()
    return this.drain()
  }

  // ── 元素派发 ────────────────────────────────────────────────────────────────
  private runElement(el: TimelineElement): void {
    const plugin = getKind(el.kind)
    if (!plugin) return
    this.fired.add(el.id)
    const ctx = { ...this.ctx(), elementId: el.id }
    if (plugin.role === 'logic' && plugin.run) {
      const { effects } = plugin.run(ctx, el.params)
      this.applyAndReact(effects as GraphEffect[])
    } else if (plugin.role === 'presentation') {
      // 有 render() 的 kind（如 floatText 需按当前状态算动态值）用其产出；否则发泛型 renderOverlay。
      if (plugin.render) {
        for (const d of plugin.render(ctx, el.params)) this.emit(d)
      } else {
        this.emit({
          type: 'renderOverlay',
          nodeId: this.state.currentNodeId ?? '',
          elementId: el.id,
          kind: el.kind,
          params: el.params,
          layer: el.layer,
        })
      }
    } else if (plugin.role === 'interaction') {
      if (plugin.present) for (const d of plugin.present(ctx, el.params)) this.emit(d)
      const timeoutMs = typeof el.params.timeoutMs === 'number' ? (el.params.timeoutMs as number) : undefined
      this.emit({
        type: 'openInteraction',
        nodeId: this.state.currentNodeId ?? '',
        elementId: el.id,
        kind: el.kind,
        params: el.params,
        handles: plugin.outputs(el.params).map((h) => h.id),
        ...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
      })
      this.setPhase('awaitInteraction')
      this.pending = el.id
      return // 挂起等输入：不连锁 afterHit
    }
    // 命中后连锁：触发绑定到本元素的 afterHit 元素（如结算→漂字），除非本步已改道。
    if (!this.redirect) this.fireAfterHit(el.id)
  }

  /** 触发所有 `trigger: { when:'afterHit', ref }` 指向 refId 的元素（fired 去重防环）。 */
  private fireAfterHit(refId: string): void {
    const node = this.node(this.state.currentNodeId)
    if (!node) return
    for (const el of node.data.timeline) {
      if (
        el.trigger.when === 'afterHit' &&
        el.trigger.ref === refId &&
        !this.fired.has(el.id) &&
        (this.state.phase as GraphPhase) !== 'awaitInteraction'
      ) {
        this.runElement(el)
      }
    }
  }

  /** 离开节点前跑其 exit 元素（logic/presentation；exit 不开交互）。spec §3.2。 */
  private runExit(node: GameNode): void {
    this.inExit = true
    for (const el of node.data.timeline) {
      if (el.trigger.when !== 'exit' || this.fired.has(el.id)) continue
      if (getKind(el.kind)?.role === 'interaction') continue // exit 不挂交互
      this.runElement(el)
    }
    this.inExit = false
  }

  /** 图级反应规则：状态变化后求值，首个命中的规则设 redirect（在安全边界消费为跳转）。 */
  private checkRules(): void {
    if (this.inExit || this.redirect || this.state.phase === 'ended') return
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i]!
      const key = rule.id ?? `${rule.goto}#${i}`
      if (rule.once && this.firedRules.has(key)) continue
      if (evaluateCondition(rule.when, this.condTarget())) {
        if (rule.once) this.firedRules.add(key)
        this.redirect = { goto: rule.goto, resetGlobals: rule.resetGlobals }
        return
      }
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
    this.enterNode(goto)
    return true
  }

  private applyAndReact(effects: GraphEffect[]): void {
    applyEffects(this.state, effects)
    this.emit({ type: 'stateChanged' })
    this.reactive()
    this.checkRules()
  }

  /** 反应式：状态变化后评估本节点 stateChange 元素，条件成立即触发（如阈值提示/死亡结算）。 */
  private reactive(): void {
    const node = this.node(this.state.currentNodeId)
    if (!node) return
    for (const el of node.data.timeline) {
      if (el.trigger.when !== 'stateChange' || this.firedReactive.has(el.id)) continue
      if (evaluateCondition(el.trigger.condition, this.condTarget())) {
        this.firedReactive.add(el.id)
        this.runElement(el)
      }
    }
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
    const edge = this.selectAutoEdge(nodeId)
    if (!edge) {
      // 无自动出边：若本节点声明 returnsToCaller 且调用栈非空 → 弹回 caller（call/return）。
      const node = this.nodes.get(nodeId)
      if (node?.data.returnsToCaller && this.state.callStack.length > 0) {
        const caller = this.state.callStack.pop() as string
        this.runExit(node)
        this.returningTo.add(caller) // 标记：弹回容器时跳过 subFlowRef 再下钻
        this.enterNode(caller)
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
    if (edge.data?.effects) {
      this.applyAndReact(edge.data.effects as GraphEffect[])
      if (this.consumeRedirect()) return // 边副作用触发图级规则 → 改道，放弃本边
    }
    this.state.traversedEdgeIds.add(edge.id)
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
    // call 边：压栈 source，子流程结束后可 returnsToCaller 弹回。
    if (edge.data?.call && this.state.currentNodeId) this.state.callStack.push(this.state.currentNodeId)
    this.enterNode(edge.target)
  }

  private finishEnd(nodeId: string): void {
    this.setPhase('ended')
    const node = this.nodes.get(nodeId)
    const kind = node?.data.end ?? 'ending'
    this.emit({ type: 'banner', kind, nodeId, title: node?.data.name ?? '' })
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
