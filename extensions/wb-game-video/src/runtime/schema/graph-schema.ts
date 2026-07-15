/**
 * 域 graph schema —— 新引擎/蓝图的**持久化 SSOT 形态**（存 scenarios.graph.json）。
 *
 * 在 `./react-flow-schema.ts` 的泛型骨架（Node/Handle/Edge/Graph）之上落定本引擎的数据契约。
 * 视频覆盖物见 `./node-config-schema.ts`：
 *   - **Overlay** → `GameScenario.ui.overlays`（含 `children`）
 *   - **OverlayNode** → `NodeData.overlayNodes[]`
 *
 * **图原生类型**（GraphEffect / GraphCondition / Entity…）保持通用、无品类假设：
 *   - 实体 = 一袋开放数值 `attrs` + 可选约束 `attrMeta`（min/max/initial）；**没有 hp 特权字段**——
 *     hp 只是"名为 hp、attrMeta 带 max/initial 的一个 attr"的**约定**。
 *   - 条件/副作用全走 attr/var，`attrRatio` = `attrs[attr] / attrMeta[attr].max`。
 *   - 一切逻辑声明式、可序列化、无函数入库。
 */
import type { Graph, Node, Edge, Handle } from './react-flow-schema'
import type { GameScenarioUi, OverlayNode, Reaction } from './node-config-schema'

export type {
  BindValue,
  Layout,
  LayoutValue,
  OverlayChild,
  Overlay,
  GameScenarioUi,
  OverlayNode,
  OverlayInstanceChild,
  OverlayInstance,
  ComponentInput,
  ComponentEvent,
  ComponentManifest,
  NodeAction,
  Reaction,
  ReactionTrigger,
  OverlayEventRef,
} from './node-config-schema'

export { overlayMountId } from './node-config-schema'

export { layoutValueToCss, layoutToCss } from './layout'

export {
  expandOverlayMount,
  expandNodeOverlays,
  expandNodeChildren,
  nodeOverlayChildren,
  nodeOverlayMounts,
  overlayInstanceChildId,
} from './expand-overlay'

export {
  aggregateOverlayEvents,
  aggregateNodeOverlayEvents,
  deriveEdgesFromReactions,
  deriveEdgesFromNodeOverlays,
  eventsFromParams,
  resolveEventReactionDo,
  resolveEventReactions,
  completeReactions,
} from './overlay-events'

/** 常量或声明式表达式（见 expr.ts）。 */
export type NumOrExpr = number | { expr: string }
export type CmpOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq'

// ── 副作用（图原生，通用）────────────────────────────────────────────────────
export type GraphEffect =
  | { kind: 'attr'; entityId: string; attr: string; op: 'add' | 'set'; value: NumOrExpr; once?: boolean; id?: string }
  | { kind: 'var'; varId: string; op: 'add' | 'set'; value: NumOrExpr; once?: boolean; id?: string }
  | { kind: 'flag'; varId: string; value: boolean; id?: string }
  | { kind: 'item'; itemId: string; op: 'give' | 'take'; count: number; id?: string }

// ── 条件（图原生，通用；无 hp 特判）──────────────────────────────────────────
export type GraphClause =
  | { type: 'var'; varId: string; op: CmpOp; value: number }
  | { type: 'flag'; varId: string; equals: boolean }
  | { type: 'visited'; nodeId: string }
  /** 直接比某实体某 attr 的值。 */
  | { type: 'attr'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 比某 attr 的"比例"= attrs[attr] / attrMeta[attr].max（如 hp 血量比例；死亡 = attrRatio hp lte 0）。 */
  | { type: 'attrRatio'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 两实体同名 attr 运行时比较（如出手判断比 speed）。 */
  | { type: 'attrCompare'; left: string; right: string; attr: string; op: CmpOp }
  | { type: 'score'; op: CmpOp; value: number }
  | { type: 'hasItem'; itemId: string; count?: number }
export interface GraphCondition {
  all: GraphClause[]
}

// ── 实体 / 变量定义 ──────────────────────────────────────────────────────────
/** attr 的静态约束/元信息（值本身在运行态的 attrs 里）。 */
export interface AttrMeta {
  min?: number
  max?: number
  /** 复位/复活的初值（restart/resetGlobals 用）。 */
  initial?: number
  /** HUD/编辑器显示名。 */
  label?: string
}
export interface Entity {
  /** 与 `GameScenario.entities` 的 Record key 对齐；编辑器添加时自动生成，不可手填。 */
  id: string
  name?: string
  kind?: string
  /** 开放数值袋：attack/defense/speed/hp/… 任意扩展；公式按 entity.<id>.attr.<name> 引用。 */
  attrs?: Record<string, number>
  /** 每个 attr 的约束（clamp 上下界 / 初值 / 显示名）；可选。 */
  attrMeta?: Record<string, AttrMeta>
}
export interface Variable {
  /** 与 `GameScenario.variables` 的 Record key 对齐；编辑器添加时自动生成，不可手填。 */
  id: string
  name?: string
  initial?: number
  min?: number
  max?: number
}

// ── 文字样式（图原生，镜像 legacy TextStyle；floatText / dialogue 共用底座）──────────
/**
 * 文字「长什么样」。位置/尺寸见 `Layout`。
 * 字段名与 CSS / React.CSSProperties 一一对应；呈现层只做单位换算与缺省兜底。
 * · `fontSize`：数值 = 画面高度百分比，渲染为 `${n}cqh`
 * · `WebkitTextStroke*`：对应 `-webkit-text-stroke-color/width`
 */
export interface GraphTextStyle {
  fontFamily?: string
  fontWeight?: number
  color?: string
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  textDecoration?: string
  backgroundColor?: string
  opacity?: number
  textShadow?: string
  WebkitTextStrokeColor?: string
  WebkitTextStrokeWidth?: number
}

/** 文字预设样式（预设网格一格）；内置在 text-style.ts，用户自定义存 GameScenario.textStylePresets。 */
export interface GraphTextStylePreset {
  id: string
  name: string
  style: GraphTextStyle
  /** 仅字幕预设：勾选后展示说话人前缀（映射到 dialogue.speaker）。 */
  speakerPrefix?: boolean
  /** 内置只读；用户自定义可编辑/删除。 */
  builtin?: boolean
}

/**
 * 触发时机（相对**本演出节点**的生命周期 / 时间线）。
 * 引擎按 when 在对应时刻跑该元素（`fired` 去重）。
 * 收尾 / 离场副作用走 `Reaction`（`complete` / `exit`），不在 Trigger 上表达。
 */
export type Trigger =
  /** 进入本节点、演出开始时立刻触发（开场 HUD / 进门对话等）。 */
  | { when: 'enter' }
  /**
   * 相对本节点演出起点经过 `ms` 毫秒后触发（卡点 QTE、中段飘字等）。
   * `ms` 与视频时间轴对齐；同一元素只触发一次。
   */
  | { when: 'at'; ms: number }

/**
 * Kind 插件职责（presentation 渲染 / interaction 交互）。副作用不在组件层，走 node.data.reactions。
 * 覆盖物见 OverlayChild.component（无落盘 role）。
 */
export type ElementRole = 'presentation' | 'interaction'

/** 节点端口描述（`outputs()` / `deriveOutputs` 返回）；边经 `sourceHandle`/`targetHandle` 引用其 `id`。 */
export interface NodeHandle {
  id: string
  label?: string
}

export interface NodeMedia {
  kind: string
  ref?: string
  /** 写给视频生成模型的镜头/动作/氛围提示词（图编辑器「重新生成」面板）。 */
  prompt?: string
  meta?: Record<string, unknown>
}

/**
 * 图节点 `data` **基类**（普通演出节点）。
 *
 * 子流程 / 子蓝图容器用特化类型：
 *   - `SubFlowNodeData` — 同图下钻
 *   - `SubFlowPackNodeData` — 跨图 pack 引用
 * `GameNode.data` = `GameNodeData` 联合；读写嵌套字段用 `getSubFlow` / `getSubFlowPack`。
 *
 * 覆盖物一律经 `overlayNodes` 引用并展开；视频上只能挂 Overlay，不能直挂裸组件。
 */
export interface NodeData {
  name: string
  media?: NodeMedia
  mediaPlayMode?: 'once' | 'loop'
  durationMs?: number
  /** 本节点上的 overlay 挂载列表；纯过场可省略。 */
  overlayNodes?: OverlayNode[]
  reactions?: Reaction[]
}

/**
 * 跨图子蓝图包指针（主图只存指针，不存 pack 内节点）。
 * 完整包本体见 `SubFlowPackDef`（`scenario.packs`）。
 */
export interface SubFlowPack {
  /** 包 id（与 SubFlowPackDef.id 对齐）。 */
  id: string
  /** 可选版本钉死；解析时优先 `id@version`，否则回退 `id`。 */
  version?: string
  /** 覆盖包内默认入口；缺省用 SubFlowPackDef.entry。 */
  entry?: string
}

/**
 * 同图子流程容器：首次进入压栈并跳到 `subFlow`；
 * 子流程叶子无自动出边时弹回，容器不重播、沿 `out` 续走。回环用显式边。
 */
export interface SubFlowNodeData extends NodeData {
  subFlow: string
}

/**
 * 跨图子蓝图容器：进入后加载 pack，从 entry 跑；包内叶子无出边时弹回主图。
 */
export interface SubFlowPackNodeData extends NodeData {
  subFlowPack: SubFlowPack
}

/** 图上节点 data 联合（基类 ∪ 子流程特化）。 */
export type GameNodeData = NodeData | SubFlowNodeData | SubFlowPackNodeData

export function getSubFlow(d: GameNodeData): string | undefined {
  const rec = d as SubFlowNodeData & { subFlowRef?: string }
  // subFlow 为现行字段；subFlowRef 为更名兼容（旧草稿/落盘）。
  const v = rec.subFlow ?? rec.subFlowRef
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function getSubFlowPack(d: GameNodeData): SubFlowPack | undefined {
  const p = (d as SubFlowPackNodeData).subFlowPack
  return p && typeof p === 'object' && typeof p.id === 'string' ? p : undefined
}

export function isSubflowContainerData(d: GameNodeData): boolean {
  return getSubFlow(d) != null || getSubFlowPack(d) != null
}

/**
 * 可独立编辑/落盘的子蓝图包（跨图 call/return 的被调方）。
 * 运行时由 GraphRuntime 预加载注入；主 scenario 的 vars/entities/reactions 仍为一局 SSOT。
 */
export interface SubFlowPackDef {
  schemaVersion: 'wb-game-video.pack.v1'
  id: string
  version: string
  title?: string
  /** 包内入口节点 id。 */
  entry: string
  graph: GameGraph
  /** 可选：主图须具备的变量/实体（缺则启动/校验失败；P0 引擎仅在 resolve 时检查 entry 存在）。 */
  requires?: { vars?: string[]; entities?: string[] }
}

/** 边路由数据（edge.data）——仅条件 / 权重 / 标签；副作用走 reactions / option.effects。 */
export interface EdgeRouting {
  condition?: GraphCondition
  weight?: number
  label?: string
}

/** 当前图节点 type 字面量；新品类在此联合扩展。 */
export type GameNodeType = 'perf'

export type GameHandle = Handle<{ flowId?: string }>
export type GameNode = Node<GameNodeData, GameNodeType, { flowId?: string }>
export type GameEdge = Edge<EdgeRouting>
export type GameGraph = Graph<GameNode, GameEdge>

/**
 * 局级 reactions（多为 `when.type === 'state'`）：状态变化后求值，
 * do 含 goto 则硬打断跳转。典型：HP≤0 → 胜/负。与挂载/节点共用瘦 Reaction。
 */
// （类型 Reaction 由上方 export type 与 node-config 导出）

/** scenario 声明依赖的插件包（运行环境须 `registerPlugin` 同名；缺则 load 失败）。 */
export interface RequiredPlugin {
  id: string
  /** 可选版本；有则与 `registerPlugin(id,{version})` 精确匹配。 */
  version?: string
}

/** 顶层容器（scenarios.graph.json 的 scenario 内容形态）。 */
export interface GameScenario {
  schemaVersion: string
  /** Record key === Variable.id（添加时自动生成）。 */
  variables?: Record<string, Variable>
  /** Record key === Entity.id（添加时自动生成）。 */
  entities?: Record<string, Entity>
  statuses?: Record<string, unknown>
  /** overlay 目录（`ui.overlays`）+ 可选主题色。 */
  ui?: GameScenarioUi
  rng?: { seed: number }
  /** 局级 reactions（即时判负/判胜等）；每次状态变化后求值。 */
  reactions?: Reaction[]
  /** 扩展图依赖的插件包；缺插件或版本不满足 → validateScenario error。 */
  requiredPlugins?: RequiredPlugin[]
  /** 用户自定义文字预设（内置在 text-style.ts；这里只存用户新建的，按 subtitle/overlay 分组）。 */
  textStylePresets?: { subtitle?: GraphTextStylePreset[]; overlay?: GraphTextStylePreset[] }
  /**
   * 本局挂载的子蓝图包。容器节点用 `SubFlowPackNodeData.subFlowPack` 存指针；包本体在此。
   * 缺包而节点引用了 → 运行时 resolve 失败。
   */
  packs?: SubFlowPackDef[]
  graph: GameGraph
}

/** 运行时守卫：浅校验 graph 形状（深校验走 validate.ts）。 */
export function isGameGraph(v: unknown): v is GameGraph {
  if (!v || typeof v !== 'object') return false
  const g = v as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false
  return g.nodes.every((n) => {
    if (!n || typeof n !== 'object') return false
    const node = n as { type?: unknown; data?: unknown }
    if (node.type !== 'perf') return false
    return !!node.data && typeof node.data === 'object'
  })
}
