/**
 * GraphSession —— 引擎(GraphRuntime) 与 UI 之间的**视图模型控制器**（纯 TS，可 headless 单测）。
 *
 * 职责：驱动引擎、消费其产出的泛型 directive，维护一份「随时可渲染的快照」SessionSnapshot：
 * 当前演出片段 / 活动叠层(表现层) / 当前交互 / HUD 数值 / 结局横幅 / 执行态(供蓝图可视化)。
 * React Player 只需订阅 snapshot 渲染 + 把玩家输入回灌 submit()——UI 与引擎彻底解耦。
 */
import type { GameNode, GameScenario } from './graph-schema'
import { GraphRuntime } from './engine'
import { registerCoreKinds } from './core-kinds'
import type { RuntimeDirective } from './directives'
import { hiddenHudKeys } from './hud-visibility'

const MAX_LOGS = 60

/** 把引擎指令转成运行日志一行（对齐旧试玩「运行日志」）。 */
function logLine(d: RuntimeDirective): string | undefined {
  switch (d.type) {
    case 'playClip':
      return `▶ 进入「${d.name}」${d.loop ? ' (Loop)' : ''}`
    case 'openInteraction':
      return `❓ 交互 ${d.kind}${d.handles.length ? ` · 出口 [${d.handles.join(', ')}]` : ''}`
    case 'renderOverlay':
      return `✦ ${d.kind}`
    case 'routeInfo':
      return `↳ 走「${d.via}」→ ${d.target}：${d.reason}`
    case 'banner':
      return `🏁 ${d.kind === 'victory' ? '胜利' : d.kind === 'defeat' ? '失败' : '结束'}${d.title ? ` · ${d.title}` : ''}`
    case 'log':
      return d.message
    default:
      return undefined
  }
}

export interface ClipSnap {
  nodeId: string
  name: string
  clipId?: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}
export interface OverlaySnap {
  elementId: string
  kind: string
  params: Record<string, unknown>
  layer?: number
}
export interface InteractionSnap {
  elementId: string
  kind: string
  params: Record<string, unknown>
  handles: string[]
  /** 限时 ms（>0 时 Player 到时自动 submit(undefined)）。 */
  timeoutMs?: number
}
export interface HudSnap {
  entities: Record<string, { hp: number; maxHp: number }>
  vars: Record<string, number>
  flags: Record<string, number>
  score: number
}
export interface SessionSnapshot {
  phase: string
  currentNodeId: string | null
  clip?: ClipSnap
  overlays: OverlaySnap[]
  interaction?: InteractionSnap
  banner?: { kind: 'victory' | 'defeat' | 'ending'; title: string }
  hud: HudSnap
  /** 当前上下文下应隐藏的 HUD 元素键（实体 id / 变量 id / 'score'）；渲染层据此过滤。 */
  hudHidden: string[]
  /** 进入当前节点所走的边 + 命中条件（含实时值）；起始节点为 undefined。 */
  entryReason?: string
  visited: string[]
  traversedEdgeIds: string[]
  log: string[]
}

export class GraphSession {
  readonly runtime: GraphRuntime
  snapshot: SessionSnapshot
  private readonly uiHud: unknown
  private readonly nodesById: Map<string, GameNode>
  private pendingEntryReason: string | undefined

  constructor(scenario: GameScenario) {
    registerCoreKinds()
    this.runtime = new GraphRuntime(scenario.graph, scenario)
    this.uiHud = scenario.ui?.hud
    this.nodesById = new Map(scenario.graph.nodes.map((n) => [n.id, n]))
    this.snapshot = this.freshSnapshot()
  }

  /** 当前 phase / 交互下应隐藏的 HUD 元素键。 */
  private computeHudHidden(): string[] {
    const nodeHud = this.nodesById.get(this.runtime.state.currentNodeId ?? '')?.data.hud
    const interactionKind = this.snapshot?.interaction?.kind
    const isBattle = nodeHud?.preset === 'battle'
    return [...hiddenHudKeys(this.uiHud, nodeHud, { phase: this.runtime.state.phase, interactionKind, isBattle })]
  }

  private freshSnapshot(): SessionSnapshot {
    return {
      phase: this.runtime.state.phase,
      currentNodeId: this.runtime.state.currentNodeId,
      overlays: [],
      hud: this.readHud(),
      hudHidden: this.computeHudHidden(),
      visited: [],
      traversedEdgeIds: [],
      log: [],
    }
  }

  private readHud(): HudSnap {
    const s = this.runtime.state
    const entities: HudSnap['entities'] = {}
    // HUD 血条按约定读名为 hp 的 attr + attrMeta.hp.max（无 hp 的品类此处为 0/0，改由 HUD 元素绑定别的 attr）。
    for (const [id, e] of Object.entries(s.entities)) {
      entities[id] = { hp: e.attrs.hp ?? 0, maxHp: e.attrMeta?.hp?.max ?? 0 }
    }
    return { entities, vars: { ...s.vars }, flags: { ...s.flags }, score: s.score }
  }

  // ── 控制（驱动引擎 + 消费指令）────────────────────────────────────────────────
  start(): SessionSnapshot {
    return this.apply(this.runtime.start())
  }
  tick(elapsedMs: number): SessionSnapshot {
    return this.apply(this.runtime.tick(elapsedMs))
  }
  performanceEnd(): SessionSnapshot {
    return this.apply(this.runtime.onPerformanceEnd())
  }
  /** 玩家对当前交互提交输入（如技能 key / QTE 结果 / 热点 id）。 */
  submit(input: unknown): SessionSnapshot {
    const inter = this.snapshot.interaction
    if (!inter) return this.snapshot
    return this.apply(this.runtime.submitInteraction(inter.elementId, input))
  }
  /** 点击运行时蓝图节点 → 跳转执行。 */
  jump(nodeId: string, opts?: { resetGlobals?: boolean }): SessionSnapshot {
    return this.apply(this.runtime.jumpToNode(nodeId, opts))
  }

  private apply(dirs: RuntimeDirective[]): SessionSnapshot {
    for (const d of dirs) {
      const line = logLine(d)
      if (line && d.type !== 'log') this.snapshot.log.push(line)
      switch (d.type) {
        case 'routeInfo':
          // 进入下一节点的原因（边 + 条件 + 实时值），在紧随其后的 playClip 落到该节点。
          this.pendingEntryReason = `走「${d.via}」→ ${d.target}：${d.reason}`
          break
        case 'playClip':
          // 新节点开演：换片、清空上一节点的叠层与交互。
          this.snapshot.clip = {
            nodeId: d.nodeId,
            name: d.name,
            clipId: d.clipId,
            mediaId: d.mediaId,
            loop: d.loop,
            durationMs: d.durationMs,
          }
          this.snapshot.overlays = []
          this.snapshot.interaction = undefined
          this.snapshot.entryReason = this.pendingEntryReason
          this.pendingEntryReason = undefined
          break
        case 'renderOverlay':
          this.snapshot.overlays.push({ elementId: d.elementId, kind: d.kind, params: d.params, layer: d.layer })
          break
        case 'removeOverlay':
          this.snapshot.overlays = this.snapshot.overlays.filter((o) => o.elementId !== d.elementId)
          break
        case 'openInteraction':
          this.snapshot.interaction = { elementId: d.elementId, kind: d.kind, params: d.params, handles: d.handles, timeoutMs: d.timeoutMs }
          break
        case 'banner':
          this.snapshot.banner = { kind: d.kind, title: d.title }
          break
        case 'log':
          this.snapshot.log.push(d.message)
          break
        case 'stateChanged':
        case 'hudUpdate':
          this.snapshot.hud = this.readHud()
          break
      }
    }
    if (this.snapshot.log.length > MAX_LOGS) this.snapshot.log = this.snapshot.log.slice(-MAX_LOGS)
    // 同步执行态（供 HUD / 蓝图可视化）
    const s = this.runtime.state
    this.snapshot.phase = s.phase
    this.snapshot.currentNodeId = s.currentNodeId
    this.snapshot.hud = this.readHud()
    this.snapshot.hudHidden = this.computeHudHidden()
    this.snapshot.visited = [...s.visited]
    this.snapshot.traversedEdgeIds = [...s.traversedEdgeIds]
    // 返回**新的对象引用**——GraphSession 内部快照是原地累积的，若直接返回同一引用，
    // React 的 setState 会因 Object.is 相等而跳过重渲染（引擎推进了、界面却不更新）。
    return this.cloned()
  }

  /** 快照浅拷贝（关键：给 React 一个新引用触发重渲染）。 */
  private cloned(): SessionSnapshot {
    const s = this.snapshot
    return {
      ...s,
      overlays: [...s.overlays],
      hudHidden: [...s.hudHidden],
      visited: [...s.visited],
      traversedEdgeIds: [...s.traversedEdgeIds],
      log: [...s.log],
      hud: { ...s.hud, entities: { ...s.hud.entities }, vars: { ...s.hud.vars }, flags: { ...s.hud.flags } },
    }
  }
}
