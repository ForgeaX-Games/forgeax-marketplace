/**
 * BlueprintRuntime —— 纯逻辑的「视频状态机」运行时引擎，对齐 cinegame runtime 的走法
 * （进入节点 → 播放演出 → 按节点类型解算交互 → 求边/条件 → 进入下一节点），但产出
 * 渲染无关的 RuntimeDirective[]，由 Player 驱动层消费。
 *
 * 必备要素（用户要求保留）：
 *  - Loop：节点 mediaPlayMode='loop' → playClip.loop=true（边播边选 / 探索）。
 *  - 转场：节点 transition → playClip.transition。
 *  - QTE：节点 qte → openQte；submitQte 按命中数判 qte_pass/qte_fail 边。
 *  - 状态机：节点 elementType + sceneKind 决定交互；出边 conditionExpression/结构化
 *    condition 决定走向（数值/flag/hpRatio/score/status/visited/hasItem）。
 *  - Boss：节点 boss → 回合制 openBossRound；命中扣 Boss 血、失手扣玩家血，胜负跳转。
 *
 * 流程是纯函数式状态推进：所有输入方法返回「本次新产生的指令」，便于单测与 React 消费。
 */

import {
  applyEntityEffects,
  applyEffects,
  applyItemEffects,
  evaluateCondition,
  initVarState,
  type EntityHpView,
  type EvalContext,
  type ItemState,
  type VarState,
} from '../../player/conditionEval'
import type { QteOutcome, Scenario } from '../../scenario/types'
import type {
  BlueprintBoss,
  BlueprintDamagePoint,
  GameVideoBlueprintEdge,
  GameVideoBlueprintGraph,
  GameVideoBlueprintNode,
  GameVideoExtensionElements,
} from '../blueprint-schema'
import type { RuntimeDirective } from './directives'

export type RuntimePhase =
  | 'idle'
  | 'playing'
  | 'awaitChoice'
  | 'awaitQte'
  | 'awaitBoss'
  | 'awaitHotspot'
  | 'victory'
  | 'defeat'
  | 'ended'

export interface EntityRuntime {
  hp: number
  maxHp: number
  kind: string
  statusIds: string[]
  /** 出手速度（先手判定 attrCompare 用）；可被 entityStat(speed) 运行时改写。 */
  speed: number
}

export interface RuntimeState {
  currentNodeId: string | null
  phase: RuntimePhase
  vars: VarState
  items: ItemState
  visited: Set<string>
  /** 已走过的边 id（用于蓝图状态机把跑过的路线标绿）。 */
  traversedEdgeIds: Set<string>
  score: number
  entities: Record<string, EntityRuntime>
  /** call/return 子流程返回栈（节点 id）。 */
  callStack: string[]
  /** 层级子蓝图返回栈：子图结束后继续父节点出边。 */
  subflowStack: Array<{ parentNodeId: string; subflowId: string }>
  bossRoundIndex: number
  log: string[]
}

export class BlueprintRuntime {
  private readonly nodes = new Map<string, GameVideoBlueprintNode>()
  private readonly outgoing = new Map<string, GameVideoBlueprintEdge[]>()
  private readonly subflows: NonNullable<GameVideoBlueprintGraph['subflows']>
  /** 子流程内层节点 id → 其所属子流程帧（供 jumpTo 重建返回栈）。 */
  private readonly subflowOfNode = new Map<string, { subflowId: string; parentNodeId: string }>()
  readonly state: RuntimeState
  private queue: RuntimeDirective[] = []
  /**
   * 单次驱动调用内、沿「无演出逻辑节点」同步穿链时已进入过的节点 id。仅用于防御
   * 脏蓝图里「全无演出且边恒真」的环导致的爆栈；每次 drain（= 每个公共入口结束）清空。
   */
  private chainSeen = new Set<string>()

  constructor(
    private readonly graph: GameVideoBlueprintGraph,
    private readonly scenario: Scenario,
  ) {
    this.subflows = graph.subflows ?? {}
    for (const node of graph.nodes) this.nodes.set(node.id, node)
    for (const subflow of Object.values(this.subflows)) {
      for (const node of subflow.nodes) {
        this.nodes.set(node.id, node)
        if (subflow.parentNodeId) {
          this.subflowOfNode.set(node.id, {
            subflowId: subflow.id,
            parentNodeId: subflow.parentNodeId,
          })
        }
      }
    }
    const allEdges = [
      ...graph.edges,
      ...Object.values(this.subflows).flatMap((subflow) => subflow.edges),
    ]
    for (const edge of allEdges) {
      const list = this.outgoing.get(edge.sourceRef)
      if (list) list.push(edge)
      else this.outgoing.set(edge.sourceRef, [edge])
    }
    this.state = {
      currentNodeId: null,
      phase: 'idle',
      vars: initVarState(scenario),
      items: {},
      visited: new Set<string>(),
      traversedEdgeIds: new Set<string>(),
      score: 0,
      entities: initEntities(scenario),
      callStack: [],
      subflowStack: [],
      bossRoundIndex: 0,
      log: [],
    }
  }

  // ── 公共驱动入口 ──────────────────────────────────────────────────────────

  start(): RuntimeDirective[] {
    const startNode =
      this.graph.nodes.find((n) => n.elementType === 'start') ?? this.graph.nodes[0]
    if (!startNode) {
      this.state.phase = 'ended'
      return this.drain()
    }
    this.enterNode(startNode.id)
    return this.drain()
  }

  /**
   * 调试跳转：把运行时直接跳到某节点并就地执行（图形状态机点击节点触发）。
   * 清掉与「从此处重跑」无关的返回栈/回合游标；若目标是子流程内层节点，则重建其
   * 子流程帧，保证内层跑完能正确弹回父节点后续边。
   */
  jumpTo(id: string): RuntimeDirective[] {
    if (!this.nodes.has(id)) return this.drain()
    this.state.callStack = []
    this.state.subflowStack = []
    this.state.bossRoundIndex = 0
    const frame = this.subflowOfNode.get(id)
    if (frame) this.state.subflowStack.push({ parentNodeId: frame.parentNodeId, subflowId: frame.subflowId })
    this.enterNode(id)
    return this.drain()
  }

  /** 当前节点演出片段播放结束（非 loop）。 */
  onClipEnded(): RuntimeDirective[] {
    if (this.state.phase === 'playing' || this.state.phase === 'awaitHotspot') {
      this.advanceAuto()
    }
    return this.drain()
  }

  /** 玩家在选项里选了一项（key = BlueprintOption.key / Branch.id）。 */
  chooseOption(optionKey: string): RuntimeDirective[] {
    const node = this.currentNode()
    if (!node) return this.drain()
    const options = node.extensionElements.options ?? []
    if (this.state.phase !== 'awaitChoice' && options.length === 0) return this.drain()

    const matchingEdges = (this.outgoing.get(node.id) ?? []).filter(
      (e) => e.extension?.branchId === optionKey,
    )
    const edge = matchingEdges.find((e) => this.edgeConditionPasses(e))
    if (edge) {
      this.applyEdge(edge)
      this.enterNode(edge.targetRef)
    } else if (!this.navigateChoiceTarget(node.id, optionKey, options)) {
      this.log(`选项 ${optionKey} 未匹配到出边`)
    }
    return this.drain()
  }

  /** 选项 fallback：编译边缺失 / 条件未过时，回读 Scenario 分支或 BlueprintOption.target。 */
  private navigateChoiceTarget(
    nodeId: string,
    optionKey: string,
    options: NonNullable<GameVideoBlueprintNode['extensionElements']['options']>,
  ): boolean {
    const opt = options.find((o) => o.key === optionKey)
    if (opt && this.nodes.has(opt.target)) {
      this.enterNode(opt.target)
      return true
    }
    const branch = (this.scenario.scenes[nodeId]?.branches ?? []).find(
      (b) => b.id === optionKey && b.kind === 'choice' && b.targetSceneId,
    )
    if (!branch?.targetSceneId || !this.nodes.has(branch.targetSceneId)) return false
    if (branch.effects?.length) this.applyRuntimeEffects(branch.effects)
    this.enterNode(branch.targetSceneId)
    return true
  }

  /** 提交 QTE 命中数。 */
  submitQte(hits: number): RuntimeDirective[] {
    if (this.state.phase !== 'awaitQte') return this.drain()
    const node = this.currentNode()
    const qte = node?.extensionElements.qte
    if (!node || !qte) return this.drain()
    const need = qte.passingHits ?? qte.cueMs.length
    const passed = hits >= Math.max(1, need)
    this.state.score += hits * 100
    this.log(passed ? `QTE 通过（命中 ${hits}）` : `QTE 失败（命中 ${hits}）`)
    return this.resolveQteOutcome(node, passed ? 'pass' : 'fail')
  }

  /** 提交显式 QTE 结果档位（用于原型三档防反：pass / good / fail）。 */
  submitQteOutcome(outcome: QteOutcome): RuntimeDirective[] {
    if (this.state.phase !== 'awaitQte') return this.drain()
    const node = this.currentNode()
    if (!node?.extensionElements.qte) return this.drain()
    this.log(`QTE ${outcome}`)
    return this.resolveQteOutcome(node, outcome)
  }

  /** 提交 Boss 战一回合结果。 */
  submitBossRound(hit: boolean): RuntimeDirective[] {
    if (this.state.phase !== 'awaitBoss') return this.drain()
    const node = this.currentNode()
    const boss = node?.extensionElements.boss
    if (!node || !boss) return this.drain()
    const round = boss.rounds[this.state.bossRoundIndex]
    if (!round) {
      return this.finishBoss(node, boss, true)
    }
    if (hit) {
      this.applyRuntimeEffects(round.hitEffects)
      this.log(`${round.label ?? '回合'} 命中`)
    } else {
      this.applyRuntimeEffects(round.missEffects)
      this.log(`${round.label ?? '回合'} 失手`)
    }

    if (this.entityHp(boss.entityId) <= 0) return this.finishBoss(node, boss, true)
    if (this.entityHp(boss.playerEntityId ?? this.firstOfKind('player')) <= 0) {
      return this.finishBoss(node, boss, false)
    }
    this.state.bossRoundIndex += 1
    if (this.state.bossRoundIndex < boss.rounds.length) {
      this.openBossRound(node, boss)
      return this.drain()
    }
    // 回合用尽且双方存活 —— 视为玩家挺过本场（胜）。
    return this.finishBoss(node, boss, true)
  }

  /** 点击画面热点（call/return 子流程 / detour 原地对话）。 */
  clickHotspot(hotspotId: string): RuntimeDirective[] {
    if (this.state.phase !== 'awaitHotspot') return this.drain()
    const node = this.currentNode()
    const hs = node?.extensionElements.hotspots?.find((h) => h.id === hotspotId)
    if (!node || !hs) return this.drain()
    if (hs.detour) {
      this.emit({ type: 'dialogue', speaker: hs.detour.speaker, lines: hs.detour.dialogue })
      return this.drain()
    }
    if (hs.target && this.nodes.has(hs.target)) {
      if (hs.mode !== 'goto') this.state.callStack.push(node.id)
      this.enterViaEdge(hs.target)
    }
    return this.drain()
  }

  /** 视频时间轴上的判定点到点（由驱动层按 clip 时间调度回调）。 */
  applyDamagePoint(point: BlueprintDamagePoint): RuntimeDirective[] {
    this.applyRuntimeEffects(point.effects)
    return this.drain()
  }

  // ── 内部：节点进入 / 自动推进 ──────────────────────────────────────────────

  private enterNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      this.state.phase = 'ended'
      return
    }
    this.state.currentNodeId = id
    this.state.visited.add(id)
    this.applyOnEnter(node)

    const ext = node.extensionElements
    if (ext.subFlowRef) {
      const subflow = this.subflows[ext.subFlowRef]
      if (subflow && this.nodes.has(subflow.rootNodeId)) {
        this.state.subflowStack.push({ parentNodeId: id, subflowId: ext.subFlowRef })
        this.enterNode(subflow.rootNodeId)
        return
      }
    }

    // 只有「有演出」的节点才换片；纯逻辑/判定节点（无 clip / media）不发 playClip，
    // 保留上一段正在播放的视频（含 loop），逻辑就地叠加执行——对齐原型的隐藏计算节点。
    if (nodeHasPerformance(ext)) {
      this.emit({
        type: 'playClip',
        nodeId: id,
        name: node.name,
        clipId: ext.clipId,
        mediaId: ext.mediaId,
        loop: ext.mediaPlayMode === 'loop',
        durationMs: ext.durationMs,
        hud: ext.hud,
        transition: ext.transition,
        dmgPoints: ext.dmgPoints,
      })
    }

    if (ext.boss) {
      this.state.phase = 'awaitBoss'
      this.state.bossRoundIndex = 0
      this.openBossRound(node, ext.boss)
      return
    }
    if (ext.qte) {
      this.state.phase = 'awaitQte'
      this.emit({ type: 'openQte', nodeId: id, qte: ext.qte })
      return
    }
    const options = ext.options ?? []
    if (options.length > 0) {
      this.state.phase = 'awaitChoice'
      this.emit({ type: 'openChoice', nodeId: id, options, decision: ext.decision })
      return
    }
    if (ext.hotspots && ext.hotspots.length > 0) {
      this.state.phase = 'awaitHotspot'
      this.emit({ type: 'openHotspots', nodeId: id, hotspots: ext.hotspots })
      return
    }
    const hasPerf = nodeHasPerformance(ext)

    if (node.elementType === 'end' || (this.outgoing.get(id) ?? []).length === 0) {
      if (this.state.subflowStack.length > 0) {
        // 子图出口：有演出则等视频播完再弹回父节点；无演出（纯逻辑出口）就地弹回。
        if (hasPerf) this.state.phase = 'playing'
        else this.advanceThroughLogic(id)
        return
      }
      this.finishEnd(node)
      return
    }

    // 有演出：进入 'playing'，由驱动层按视频结束 / durationMs 推进。
    // 无演出的纯逻辑直通节点：不等待，就地沿 auto 边同步穿到下一节点。
    if (hasPerf) this.state.phase = 'playing'
    else this.advanceThroughLogic(id)
  }

  /** 无演出逻辑节点：带环防护地就地推进（避免脏蓝图的无演出恒真环爆栈）。 */
  private advanceThroughLogic(id: string): void {
    if (this.chainSeen.has(id)) {
      this.log(`无演出节点链检测到环（${id}），停在此节点等待驱动`)
      this.state.phase = 'playing'
      return
    }
    this.chainSeen.add(id)
    this.advanceAuto()
  }

  private advanceAuto(): void {
    const node = this.currentNode()
    if (!node) {
      this.state.phase = 'ended'
      return
    }
    if (node.extensionElements.returnsToCaller && this.state.callStack.length > 0) {
      const back = this.state.callStack.pop()!
      this.enterNode(back)
      return
    }
    const edges = (this.outgoing.get(node.id) ?? []).filter(
      (e) => e.extension?.kind !== 'choice' && e.extension?.kind !== 'qte_pass' && e.extension?.kind !== 'qte_fail',
    )
    const edge = edges.find((e) => this.edgeConditionPasses(e)) ?? edges[0]
    if (edge) {
      this.applyEdge(edge)
      this.enterNode(edge.targetRef)
      return
    }
    if (this.finishSubflow()) return
    if (this.state.callStack.length > 0) {
      const back = this.state.callStack.pop()!
      this.enterNode(back)
      return
    }
    this.finishEnd(node)
  }

  private finishSubflow(): boolean {
    const frame = this.state.subflowStack.pop()
    if (!frame) return false
    this.advanceFromParentNode(frame.parentNodeId)
    return true
  }

  private advanceFromParentNode(parentNodeId: string): void {
    const parent = this.nodes.get(parentNodeId)
    if (!parent) {
      this.state.phase = 'ended'
      return
    }
    const edges = (this.outgoing.get(parent.id) ?? []).filter(
      (e) => e.extension?.kind !== 'choice' && e.extension?.kind !== 'qte_pass' && e.extension?.kind !== 'qte_fail',
    )
    const edge = edges.find((e) => this.edgeConditionPasses(e)) ?? edges[0]
    if (edge) {
      this.applyEdge(edge)
      this.enterNode(edge.targetRef)
      return
    }
    this.finishEnd(parent)
  }

  // ── 内部：Boss ────────────────────────────────────────────────────────────

  private openBossRound(node: GameVideoBlueprintNode, boss: BlueprintBoss): void {
    const round = boss.rounds[this.state.bossRoundIndex]
    if (!round) {
      this.finishBoss(node, boss, true)
      return
    }
    this.emit({
      type: 'openBossRound',
      nodeId: node.id,
      round,
      roundIndex: this.state.bossRoundIndex,
      totalRounds: boss.rounds.length,
    })
  }

  private finishBoss(
    node: GameVideoBlueprintNode,
    boss: BlueprintBoss,
    win: boolean,
  ): RuntimeDirective[] {
    this.log(win ? 'Boss 战胜利' : 'Boss 战失败')
    if (win && boss.perfectFlagVarId) {
      // 完美判定留给驱动层细化；此处仅在胜利时不写（避免误标）。
    }
    const target = win ? boss.winTarget : boss.loseTarget
    if (target && this.nodes.has(target)) {
      this.enterViaEdge(target)
    } else {
      this.state.phase = win ? 'victory' : 'defeat'
      this.emit({
        type: 'banner',
        kind: win ? 'victory' : 'defeat',
        nodeId: node.id,
        title: win ? '战斗胜利' : '战斗失败',
      })
    }
    return this.drain()
  }

  // ── 内部：结局 / 副作用 / 条件 ─────────────────────────────────────────────

  private finishEnd(node: GameVideoBlueprintNode): void {
    this.state.phase = 'ended'
    const ending = node.extensionElements.hud === 'ending'
    this.emit({
      type: 'banner',
      kind: 'ending',
      nodeId: node.id,
      title: ending ? node.name || '结局' : node.name || '完',
    })
  }

  private applyOnEnter(node: GameVideoBlueprintNode): void {
    const onEnter = node.extensionElements.onEnter
    if (!onEnter) return
    let changed = this.applyRuntimeEffects(onEnter.effects, { emit: false })
    if (onEnter.setFlagVarIds && onEnter.setFlagVarIds.length > 0) {
      for (const id of onEnter.setFlagVarIds) this.state.vars[id] = 1
      changed = true
    }
    if (changed) this.emit({ type: 'stateChanged' })
    // 进场即时结算的实体 HP 变化（如冥想回血 +30）给视图一个飘字信号；位置由视图层就近安置。
    const floatable = (onEnter.effects ?? []).filter(
      (e) => e.kind === 'entityStat' && e.stat === 'hp' && e.value !== 0,
    )
    if (floatable.length > 0) {
      this.emit({ type: 'floatEffects', nodeId: this.state.currentNodeId ?? node.id, effects: floatable })
    }
  }

  private applyEdge(edge: GameVideoBlueprintEdge): void {
    this.state.traversedEdgeIds.add(edge.id)
    const ext = edge.extension
    if (!ext) return
    this.applyRuntimeEffects(ext.effects)
  }

  /**
   * 沿一条图上已存在的边进入目标节点（Boss 胜负跳转 / 热点子流程等不走 applyEdge 的
   * 转移用）——记录该边为「走过」，让状态机把这条路线也标绿。
   */
  private enterViaEdge(targetId: string): void {
    const cur = this.state.currentNodeId
    if (cur) {
      const edge = (this.outgoing.get(cur) ?? []).find((e) => e.targetRef === targetId)
      if (edge) this.state.traversedEdgeIds.add(edge.id)
    }
    this.enterNode(targetId)
  }

  private edgeConditionPasses(edge: GameVideoBlueprintEdge): boolean {
    return evaluateCondition(edge.extension?.condition, this.evalCtx())
  }

  private pickEdge(
    node: GameVideoBlueprintNode,
    predicate: (e: GameVideoBlueprintEdge) => boolean,
  ): GameVideoBlueprintEdge | undefined {
    return (this.outgoing.get(node.id) ?? []).find(
      (e) => predicate(e) && this.edgeConditionPasses(e),
    )
  }

  private resolveQteOutcome(
    node: GameVideoBlueprintNode,
    outcome: QteOutcome,
  ): RuntimeDirective[] {
    const fallbackKind = outcome === 'fail' ? 'qte_fail' : 'qte_pass'
    const edge =
      this.pickEdge(node, (e) => e.extension?.qteOutcome === outcome) ??
      this.pickEdge(node, (e) => e.extension?.kind === fallbackKind && !e.extension?.qteOutcome) ??
      this.pickEdge(node, (e) => e.extension?.kind === 'auto' || !e.extension)
    if (edge) {
      this.applyEdge(edge)
      this.enterNode(edge.targetRef)
    } else {
      this.advanceAuto()
    }
    return this.drain()
  }

  private evalCtx(): EvalContext {
    const entities: Record<string, EntityHpView> = {}
    for (const [id, e] of Object.entries(this.state.entities)) {
      entities[id] = { hp: e.hp, maxHp: e.maxHp, statusIds: e.statusIds, speed: e.speed }
    }
    return {
      vars: this.state.vars,
      visitedSceneIds: this.state.visited,
      ownedItems: this.state.items,
      entities,
      score: this.state.score,
    }
  }

  // ── 内部：实体血量 ────────────────────────────────────────────────────────

  private applyRuntimeEffects(
    effects: BlueprintDamagePoint['effects'] | undefined,
    opts: { emit?: boolean } = {},
  ): boolean {
    if (!effects || effects.length === 0) return false
    const beforeVars = this.state.vars
    const beforeItems = this.state.items
    const beforeEntities = this.state.entities
    this.state.vars = applyEffects(effects, this.state.vars, this.scenario)
    this.state.items = applyItemEffects(effects, this.state.items)
    this.state.entities = applyEntityEffects(effects, this.state.entities)
    const changed =
      beforeVars !== this.state.vars ||
      beforeItems !== this.state.items ||
      beforeEntities !== this.state.entities
    if (changed && opts.emit !== false) this.emit({ type: 'stateChanged' })
    return changed
  }

  private entityHp(entityId: string | undefined): number {
    if (!entityId) return 1
    return this.state.entities[entityId]?.hp ?? 1
  }

  private firstOfKind(kind: string): string | undefined {
    for (const [id, e] of Object.entries(this.state.entities)) {
      if (e.kind === kind) return id
    }
    return undefined
  }

  // ── 内部：工具 ────────────────────────────────────────────────────────────

  private currentNode(): GameVideoBlueprintNode | undefined {
    return this.state.currentNodeId ? this.nodes.get(this.state.currentNodeId) : undefined
  }

  private log(message: string): void {
    this.state.log = [...this.state.log.slice(-19), message]
    this.emit({ type: 'log', message })
  }

  private emit(directive: RuntimeDirective): void {
    this.queue.push(directive)
  }

  private drain(): RuntimeDirective[] {
    const out = this.queue
    this.queue = []
    this.chainSeen.clear()
    return out
  }
}

/**
 * 节点是否带「演出」——有可播放片段（clip 或已解析的 media）为真。为假即纯逻辑/判定
 * 节点：运行时就地穿过、不换片，逻辑叠加在上一段正在播放的视频之上。
 */
function nodeHasPerformance(ext: GameVideoExtensionElements): boolean {
  return !!(ext.clipId || ext.mediaId)
}

function initEntities(scenario: Scenario): Record<string, EntityRuntime> {
  const out: Record<string, EntityRuntime> = {}
  for (const e of Object.values(scenario.entities ?? {})) {
    out[e.id] = {
      hp: e.initialHp ?? e.maxHp,
      maxHp: e.maxHp,
      kind: e.kind,
      statusIds: [],
      speed: e.speed ?? 0,
    }
  }
  return out
}
