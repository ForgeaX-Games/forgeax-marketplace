/**
 * 域 graph schema —— 新引擎/蓝图的**持久化 SSOT 形态**（存 scenarios.json）。
 *
 * 在 `./react-flow-schema.ts` 的泛型骨架（Node/Handle/Edge/Graph）之上落定本引擎的数据契约。
 * **图原生类型**（GraphEffect / GraphCondition / EntitySpec…）与 legacy `scenario/types` 解耦，
 * 保持通用、无品类假设：
 *   - 实体 = 一袋开放数值 `attrs` + 可选约束 `attrMeta`（min/max/initial）；**没有 hp 特权字段**——
 *     hp 只是"名为 hp、attrMeta 带 max/initial 的一个 attr"的**约定**。换品类（竞速无血条）只需换 attrs。
 *   - 条件/副作用全走 attr/var，`attrRatio` = `attrs[attr] / attrMeta[attr].max`（通用比例）。
 *   - 一切逻辑声明式、可序列化、无函数入库。
 */
import type { Graph, Node, Edge, Handle } from './react-flow-schema'

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
export interface EntitySpec {
  id?: string
  name?: string
  kind?: string
  /** 开放数值袋：attack/defense/speed/hp/… 任意扩展；公式按 entity.<id>.attr.<name> 引用。 */
  attrs?: Record<string, number>
  /** 每个 attr 的约束（clamp 上下界 / 初值 / 显示名）；可选。 */
  attrMeta?: Record<string, AttrMeta>
}
export interface VarSpec {
  id?: string
  name?: string
  kind?: 'number' | 'flag'
  initial?: number
  min?: number
  max?: number
}

// ── 文字样式（图原生，镜像 legacy TextStyle；floatText / dialogue 共用底座）──────────
/**
 * 文字「长什么样」描述。位置/尺寸不进这里（那是元素自己的 params.x/y/sizePct）；
 * 样式只管字体/色/描边/字号/对齐/底色/投影。全部可选，缺省由呈现层兜底。
 */
export interface GraphTextStyle {
  fontFamily?: string
  fontWeight?: number
  italic?: boolean
  underline?: boolean
  color?: string
  strokeColor?: string
  strokeWidth?: number
  /** 字号：画面高度百分比（用 cqh 渲染，与分辨率无关）。 */
  fontSizePct?: number
  align?: 'left' | 'center' | 'right'
  bgColor?: string
  opacity?: number
  shadow?: boolean
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

/** 触发时机（相对本节点演出时间线）。 */
export type TriggerSpec =
  | { when: 'enter' }
  | { when: 'at'; ms: number }
  | { when: 'performanceEnd' }
  | { when: 'exit' }
  | { when: 'afterHit'; ref: string }
  | { when: 'stateChange'; condition: GraphCondition }

/** 三职责：表现 / 逻辑 / 交互。 */
export type ElementRole = 'presentation' | 'logic' | 'interaction'

/** 时间线元素统一信封；params 由各 kind 解释与校验（kind-registry）。 */
export interface TimelineElement {
  id: string
  role: ElementRole
  kind: string
  trigger: TriggerSpec
  window?: { startMs?: number; endMs?: number }
  layer?: number
  params: Record<string, unknown>
}

/** 派生输出/输入端口的最小描述（kind.outputs() 返回）。 */
export interface HandleSpec {
  id: string
  label?: string
  kind?: string
}

/** HUD 节点级显示规则（两层模型的第 2 层）。 */
export interface HudElementRule {
  element: string
  visible?: boolean
  windows?: { startMs?: number; endMs?: number }[]
  showDuring?: 'always' | 'battle' | 'qte'
}
export interface NodeHud {
  preset?: string
  elements?: HudElementRule[]
}

export interface NodeMedia {
  kind: string
  ref?: string
  prompt?: string
  meta?: Record<string, unknown>
}

/** 演出节点数据（node.data）。 */
export interface PerfNodeData {
  name: string
  media?: NodeMedia
  clipId?: string
  mediaPlayMode?: 'once' | 'loop'
  durationMs?: number
  timeline: TimelineElement[]
  hud?: NodeHud
  /** 终点标记：到此节点且无出边时弹对应结局横幅。 */
  end?: 'victory' | 'defeat' | 'ending'
  /**
   * call/return：本节点结束且无可走自动出边时，从调用栈弹回 caller（而非结束）。
   * 典型：热点子场景看完 → 返回热点中枢节点。栈空则退化为正常结束。
   */
  returnsToCaller?: boolean
  /**
   * 同图子流程下钻：本节点是容器——首次进入即压栈并跳到 `subFlowRef` 指向的**本图**入口；
   * 子流程内某节点 `returnsToCaller` 结束时弹回本节点，本节点**不重播演出**、直接沿 `out` 继续。
   * 与 `subFlowPack` 互斥（同节点只应有一个）。
   */
  subFlowRef?: string
  /**
   * 跨图子蓝图引用（方案 B）：进入本容器后加载外部 pack 图，从 pack.entry（或本字段 entry）跑，
   * `returnsToCaller` 时弹回本节点并恢复主图。包本体不内联进主 graph。
   */
  subFlowPack?: SubFlowPackRef
}

/** 调用节点上的包引用（主图只存指针，不存 pack 内节点）。 */
export interface SubFlowPackRef {
  /** 包 id（与 SubFlowPack.id 对齐）。 */
  id: string
  /** 可选版本钉死；解析时优先 `id@version`，否则回退 `id`。 */
  version?: string
  /** 覆盖包内默认入口；缺省用 SubFlowPack.entry。 */
  entry?: string
}

/**
 * 可独立编辑/落盘的子蓝图包（跨图 call/return 的被调方）。
 * 运行时由 GraphRuntime 预加载注入；主 scenario 的 vars/entities/rules 仍为一局 SSOT。
 */
export interface SubFlowPack {
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

/** 边路由数据（edge.data）——条件只在此/entryGate/trigger 出现。 */
export interface EdgeRouting {
  condition?: GraphCondition
  effects?: GraphEffect[]
  weight?: number
  showAtMs?: number
  label?: string
  /**
   * call：走这条边时把 source 节点压入调用栈（"我会回来"）。目标子流程结束且带
   * `returnsToCaller` 时弹栈回到本 source。缺省=单向 goto（不压栈）。
   */
  call?: boolean
}

export type GameHandle = Handle<{ flowId?: string }>
export type GameNode = Node<PerfNodeData, 'perf', { flowId?: string }>
export type GameEdge = Edge<EdgeRouting>
export type GameGraph = Graph<GameNode, GameEdge>

/**
 * 图级反应规则（spec §2.6）——每次状态变化后求值，条件成立即"即时"跳转，
 * 不必等演出结束。典型用途：任一方 HP≤0 立刻判负/判胜（`when: attrRatio hp lte 0 → goto: lose`），
 * 免得每个节点重复配死亡出口。放全局一处即对整图生效。
 */
export interface ReactiveRule {
  id?: string
  when: GraphCondition
  /** 命中即进入的节点 id。 */
  goto: string
  /** 仅首次命中触发（默认每次命中都触发；但通常 goto 到结局节点后即结束）。 */
  once?: boolean
  /** 跳转时复位全局态（默认保留）。 */
  resetGlobals?: boolean
}

/** scenario 声明依赖的插件包（运行环境须 `registerPlugin` 同名；缺则 load 失败）。 */
export interface RequiredPlugin {
  id: string
  /** 可选版本；有则与 `registerPlugin(id,{version})` 精确匹配。 */
  version?: string
}

/** 顶层容器（scenarios.json 的 scenario 内容形态）。 */
export interface GameScenario {
  schemaVersion: string
  variables?: Record<string, VarSpec>
  entities?: Record<string, EntitySpec>
  statuses?: Record<string, unknown>
  ui?: { hud?: unknown[]; accentColor?: string }
  rng?: { seed: number }
  /** 图级反应规则（即时判负/判胜等）；每次状态变化后求值。 */
  rules?: ReactiveRule[]
  /** 扩展图依赖的插件包；缺插件或版本不满足 → validateScenario error。 */
  requiredPlugins?: RequiredPlugin[]
  /** 用户自定义文字预设（内置在 text-style.ts；这里只存用户新建的，按 subtitle/overlay 分组）。 */
  textStylePresets?: { subtitle?: GraphTextStylePreset[]; overlay?: GraphTextStylePreset[] }
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
    const data = node.data as { timeline?: unknown } | undefined
    return !!data && Array.isArray(data.timeline)
  })
}
