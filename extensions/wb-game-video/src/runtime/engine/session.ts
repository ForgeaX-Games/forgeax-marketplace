/**
 * GraphSession —— 引擎(GraphRuntime) 与 UI 之间的**视图模型控制器**（纯 TS，可 headless 单测）。
 *
 * 职责：驱动引擎、消费其产出的泛型 directive，维护一份「随时可渲染的快照」SessionSnapshot：
 * 当前演出片段 / 活动叠层 / HUD 数值 / 执行态(供蓝图可视化)。
 * React Player 只需订阅 snapshot 渲染 + 把玩家事件回灌 emitEvent()——UI 与引擎彻底解耦。
 */
import type { GameNode, GameScenario, SubFlowPackDef } from '../schema/graph-schema'
import type { Layout } from '../schema/node-config-schema'
import { GraphRuntime } from './engine'
import type { ComponentRegistry } from '../registry/component-registry'
import { createCoreSkinRegistry, createDefaultComponentRegistry } from '../component-host/components'
import type { SkinRegistry } from '../component-host/rendererRegistry'
import type { RuntimeDirective } from './directives'

/** GraphSession 构造选项：可注入隔离注册表；缺省每局新建核心组件/Skin 表。 */
export interface GraphSessionOptions {
  components?: ComponentRegistry
  skins?: SkinRegistry
  /** 测试注入依赖表。缺省用 `scenario.manifest.packs`。 */
  packs?: readonly SubFlowPackDef[]
}

const MAX_LOGS = 60

/** 把引擎指令转成运行日志一行（对齐旧试玩「运行日志」）。 */
function logLine(d: RuntimeDirective): string | undefined {
  switch (d.type) {
    case 'playClip':
      return `▶ 进入「${d.name}」${d.loop ? ' (Loop)' : ''}`
    case 'renderOverlay':
      return `✦ ${d.component}`
    case 'routeInfo':
      return `↳ 走「${d.via}」→ ${d.target}：${d.reason}`
    case 'log':
      return d.message
    default:
      return undefined
  }
}

export interface ClipSnap {
  nodeId: string
  name: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}
export interface OverlaySnap {
  elementId: string
  component: string
  inputs: Record<string, unknown>
}

export interface OverlayChildSnap {
  elementId: string
  component: string
  inputs: Record<string, unknown>
  /** 子组件级排版（相对挂载盒）→ CSS。 */
  childLayout?: Layout
}

/** 一份 overlay 挂载的运行态视图（挂载盒 + 其内可见子组件）。 */
export interface OverlayMountSnap {
  mountId: string
  /** 挂载级排版（相对视频舞台；节点 overlayNodes[].layout）。 */
  mountLayout?: Layout
  children: OverlayChildSnap[]
}
export interface HudEntitySnap {
  /** 约定便捷字段（= attrs.hp / attrMeta.hp.max）。 */
  hp: number
  maxHp: number
  /** 全量 attrs，供 HUD 绑定非 hp 属性。 */
  attrs: Record<string, number>
  /** attr → max（来自 attrMeta.max；无则回退当前值）。 */
  attrMax: Record<string, number>
}
export interface HudSnap {
  entities: Record<string, HudEntitySnap>
  vars: Record<string, number>
  flags: Record<string, number>
  score: number
}
export interface SessionSnapshot {
  phase: string
  currentNodeId: string | null
  clip?: ClipSnap
  overlayMounts: OverlayMountSnap[]
  hud: HudSnap
  /** 进入当前节点所走的边 + 命中条件（含实时值）；起始节点为 undefined。 */
  entryReason?: string
  visited: string[]
  traversedEdgeIds: string[]
  log: string[]
}

export class GraphSession {
  readonly runtime: GraphRuntime
  /** 本局皮肤表（Player 渲染用；与其它 Session 隔离）。 */
  readonly skins: SkinRegistry
  snapshot: SessionSnapshot
  private readonly nodesById: Map<string, GameNode>
  private pendingEntryReason: string | undefined

  constructor(scenario: GameScenario, opts: GraphSessionOptions = {}) {
    // 默认 = 核心契约 + 皮肤包契约（同文件 ComponentDef）；调用方自带 components 则假定已装全。
    const components = opts.components ?? createDefaultComponentRegistry()
    this.skins = opts.skins ?? createCoreSkinRegistry()
    // 开跑用根 graph；依赖解析在 GraphRuntime 内走 manifest.packs（或 opts.packs 注入）。
    this.runtime = new GraphRuntime(scenario.graph, scenario, components, opts.packs ?? [])
    this.nodesById = new Map(scenario.graph.nodes.map((n) => [n.id, n]))
    this.snapshot = this.freshSnapshot()
  }

  private freshSnapshot(): SessionSnapshot {
    return {
      phase: this.runtime.state.phase,
      currentNodeId: this.runtime.state.currentNodeId,
      overlayMounts: [],
      hud: this.readHud(),
      visited: [],
      traversedEdgeIds: [],
      log: [],
    }
  }

  private readHud(): HudSnap {
    const s = this.runtime.state
    const entities: HudSnap['entities'] = {}
    for (const [id, e] of Object.entries(s.entities)) {
      const attrs = { ...e.attrs }
      const attrMax: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) {
        attrMax[k] = e.attrMeta?.[k]?.max ?? v
      }
      for (const [k, m] of Object.entries(e.attrMeta ?? {})) {
        if (attrMax[k] === undefined && m.max !== undefined) attrMax[k] = m.max
      }
      entities[id] = {
        hp: attrs.hp ?? 0,
        maxHp: e.attrMeta?.hp?.max ?? attrs.hp ?? 0,
        attrs,
        attrMax,
      }
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
  /** 组件事件（点击 / 判定 / 超时 defaultEvent）→ 跑挂载 reactions，必要时按 handle 找边。 */
  emitEvent(elementId: string, key: string): SessionSnapshot {
    return this.apply(this.runtime.emitComponentEvent(elementId, key))
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
          // 新节点开演：换片、清空上一节点的叠层。
          this.snapshot.clip = {
            nodeId: d.nodeId,
            name: d.name,
            mediaId: d.mediaId,
            loop: d.loop,
            durationMs: d.durationMs,
          }
          this.snapshot.overlayMounts = []
          this.snapshot.entryReason = this.pendingEntryReason
          this.pendingEntryReason = undefined
          break
        case 'renderOverlay': {
          const mountId = d.mountId ?? d.elementId
          let mount = this.snapshot.overlayMounts.find((m) => m.mountId === mountId)
          if (!mount) {
            mount = { mountId, mountLayout: d.mountLayout, children: [] }
            this.snapshot.overlayMounts.push(mount)
          } else if (d.mountLayout) {
            mount.mountLayout = d.mountLayout
          }
          const child: OverlayChildSnap = {
            elementId: d.elementId,
            component: d.component,
            inputs: d.inputs,
            childLayout: d.childLayout,
          }
          const idx = mount.children.findIndex((c) => c.elementId === d.elementId)
          if (idx >= 0) mount.children[idx] = child
          else mount.children.push(child)
          break
        }
        case 'removeOverlay':
          for (const mount of this.snapshot.overlayMounts) {
            mount.children = mount.children.filter((c) => c.elementId !== d.elementId)
          }
          this.snapshot.overlayMounts = this.snapshot.overlayMounts.filter((m) => m.children.length > 0)
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
      overlayMounts: s.overlayMounts.map((m) => ({
        ...m,
        children: [...m.children],
      })),
      visited: [...s.visited],
      traversedEdgeIds: [...s.traversedEdgeIds],
      log: [...s.log],
      hud: { ...s.hud, entities: { ...s.hud.entities }, vars: { ...s.hud.vars }, flags: { ...s.hud.flags } },
    }
  }
}
