/**
 * runtime-schema —— 运行时「唯一消费协议」`GraphLibraryDocument` 的独立参考快照。
 *
 * ⚠️ 这是一份**完全独立**的手抄快照，故意不 import 任何模块——方便单独复制/分享/离线阅读，
 * 一份文件看全貌，不用跳文件。代价也在这：它不是 SSOT，仓库改了真实类型不会自动跟着变。
 *
 * 真正的 SSOT 永远是：
 *   - `../../runtime/schema/graph-schema.ts`
 *   - `../../runtime/schema/node-config-schema.ts`
 * （AGENTS.md 里「禁止随意加字段，改动需先取得专门同意」的那两份。）
 * 这两份文件改了字段时，本文件需要手动同步，否则会跟真实协议脱钩——若发现对不上，
 * 以那两份文件为准，本文件是错的。
 *
 * 阅读顺序：**自外向内**——从下方 §1 顶层文档看起，逐节下钻到里面引用的类型，
 * 最底部 §10 是最基础的数值/表达式原语。TypeScript 类型声明顺序不影响编译，
 * 排列纯粹为了「先看全貌、再看细节」的阅读体验。
 *
 * 完整落盘实例见同目录 `nodia.graph.json`（`n_door` 节点可完整跑一遍
 * NodeData → overlayNodes → ui.overlays → graph.edges 四层引用）。
 *
 * 范围声明：本文件只覆盖**引擎消费的输入协议**（落盘/编辑态）。`OverlayInstance` /
 * `RuntimeDirective` / `SessionSnapshot` 等是引擎内部展开与对外输出的派生态，从不作为
 * 输入喂给引擎，不在本文件范围内（它们的 SSOT 是 `runtime/schema/expand-overlay.ts`、
 * `runtime/engine/directives.ts`、`runtime/engine/session.ts`）。
 */

// ═══════════════════════════════════════════════════════════════════════════
// §1. 顶层文档：运行时唯一消费协议
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══ 运行时唯一消费协议 ═══
 * 完整落盘/编辑文档 = `GameScenario`（graph/variables/entities/…）+ `manifest`。
 * `new GraphSession(doc)` / `new GraphRuntime(doc.graph, doc, ...)` 只吃这一整份。
 */
export type GraphLibraryDocument = GameScenario & {
  /** 编辑器专属公式库；与 entities/variables 同级保存，runtime 从不读。 */
  formulas?: Record<string, unknown>
  manifest: BlueprintManifest
}

/** 顶层容器（scenarios.graph.json 的 scenario 内容形态）。 */
export interface GameScenario {
  version: string
  /** Record key === Variable.id。见 §7。 */
  variables?: Record<string, Variable>
  /** Record key === Entity.id。见 §7。 */
  entities?: Record<string, Entity>
  /** overlay 目录（`ui.overlays`）。见 §4。 */
  ui?: GameScenarioUi
  /** 用户自定义文字预设（内置项另存 text-style.ts，不在这里）。见 §9。 */
  textStylePresets?: { subtitle?: GraphTextStylePreset[]; overlay?: GraphTextStylePreset[] }
  /** 蓝图本体。见 §2。 */
  graph: GameGraph
}

/**
 * 嵌在 scenario 根上的蓝图库。`packs` 含主蓝图 + 全部子蓝图完整文档；
 * 根上的 `graph` 与 `packs[mainPackId].graph` 同步（双源，便于编辑库与运行入口共用）。
 */
export interface BlueprintManifest {
  version: 'wb-game-video.blueprint-manifest.v1'
  mainPackId: string
  packs: Record<string, BlueprintDoc>
}

/** 蓝图文档：一张独立可存取的图（主蓝图或子蓝图）。 */
export interface BlueprintDoc {
  id: string
  title: string
  /** 子蓝图内容版本（对齐 `subFlowPack` 钉死）；主蓝图可缺省。 */
  version?: string
  entry: string
  graph: GameGraph
  /** 主图须具备的变量/实体（缺则启动/校验失败）。 */
  requires?: { vars?: string[]; entities?: string[] }
}

// ═══════════════════════════════════════════════════════════════════════════
// §2. 图层：节点 / 边（reactflow 渲染骨架的落地形态）
// ═══════════════════════════════════════════════════════════════════════════

export interface GameGraph {
  nodes: GameNode[]
  edges: GameEdge[]
}

export interface GameNode {
  id: string
  type: GameNodeType
  position: Position
  /** 画布派生视图用的空壳（单一入口 'in'）；不存逻辑。 */
  inputs: GameHandle[]
  /** 画布派生视图用的空壳（由组件 events 派生）；不存逻辑。 */
  outputs: GameHandle[]
  /** 节点逻辑真相全在这里。见 §3。 */
  data: GameNodeData
}

export interface GameEdge {
  id: string
  source: string
  target: string
  /** 出口 = 组件 emit 的 event id；`default` = 保留字/默认推进。 */
  sourceHandle: string
  /** 画布约定单一入口，恒为 `'in'`。 */
  targetHandle: string
  label?: string
  data?: EdgeRouting
}
/** 边路由数据（edge.data）——仅条件/权重/标签；副作用走 reactions，不在这里。 */
export interface EdgeRouting {
  condition?: GraphCondition
  weight?: number
  label?: string
  transition?: 'immediate' | 'onSettlement'
}

/** 图节点 type 字面量；合法集合的 SSOT 是引擎侧 NodeKindRegistry，故用开放联合。 */
export type GameNodeType = 'perf' | (string & {})

export interface Position {
  x: number
  y: number
}
export type HandleType = 'source' | 'target'
export type HandlePosition = 'left' | 'right' | 'top' | 'bottom'
/** 节点引脚（画布派生视图用；蓝图逻辑真相全在 `GameNode.data`，不在这里）。 */
export interface GameHandle {
  id: string
  type: HandleType
  position: HandlePosition
  label?: string
  data?: { flowId?: string }
}

// ═══════════════════════════════════════════════════════════════════════════
// §3. 节点 data：普通演出节点 / 子流程容器 / 子蓝图容器
// ═══════════════════════════════════════════════════════════════════════════

/** 图上节点 data 联合（基类 ∪ 子流程特化）。 */
export type GameNodeData = NodeData | SubProcessNodeData | SubFlowPackNodeData

/**
 * 图节点 `data` **基类**（普通演出节点）。子流程/子蓝图容器用特化类型
 * `SubProcessNodeData` / `SubFlowPackNodeData`。覆盖物一律经 `overlayNodes` 引用并展开；
 * 视频上只能挂 Overlay，不能直挂裸组件。
 */
export interface NodeData {
  name: string
  media?: NodeMedia
  mediaPlayMode?: 'once' | 'loop'
  routingSettlement?: { type: 'complete' } | { type: 'at'; ms: number }
  /**
   * 可选播放时长上限（ms）。无视频节点：作停留节拍。有视频节点：`>0` 且
   * `≤ 视频本身长度` 时到点提前收演出；否则视为无效，以视频本身长度为准。
   */
  durationMs?: number
  /** 本节点上的 overlay 挂载列表；纯过场可省略。见 §4。 */
  overlayNodes?: OverlayNode[]
  /** 默认样式方案：目录里一张 overlay 的 id。不挂载、不进时间轴，纯查表源。 */
  styleScheme?: string
  /** 节点级生命周期/响应规则。见 §5。 */
  reactions?: Reaction[]
}
/** 节点私有的内嵌子流程；entry 只允许指向直属 graph.nodes。 */
export interface SubProcess {
  entry: string
  graph: GameGraph
}
export interface SubProcessNodeData extends NodeData {
  subProcess: SubProcess
}
/** 跨图子蓝图容器：进入后加载 pack，从 entry 跑；包内叶子无出边时弹回主图。 */
export interface SubFlowPackNodeData extends NodeData {
  subFlowPack: SubFlowPack
}
/** 跨图子蓝图指针（图上只存指针，不存子图节点）。 */
export interface SubFlowPack {
  id: string
  /** 可选版本钉死；解析时优先 `id@version`，否则回退 `id`。 */
  version?: string
  /** 覆盖包内默认入口；缺省用蓝图文档 entry。 */
  entry?: string
}

export interface NodeMedia {
  kind: string
  ref?: string
  /** 写给视频生成模型的镜头/动作/氛围提示词。 */
  prompt?: string
  meta?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════
// §4. 覆盖物：Overlay 目录 + 节点挂载
// ═══════════════════════════════════════════════════════════════════════════

/** scenario.ui：overlay 目录。 */
export interface GameScenarioUi {
  overlays: Record<string, Overlay>
}

/**
 * 演出节点上的一份 overlay **挂载**（原型引用 + 稀疏差量，对齐 Figma 实例覆盖 /
 * Unity Prefab modifications 心智）——未出现在 overrides/added/removed 里的组件
 * 永远跟随原型；只有显式改过的字段才脱钩。
 */
export interface OverlayNode {
  /** 挂载键，缺省 = `overlay`；同节点多次挂同一张 overlay 时必须显式且唯一。 */
  id?: string
  /** `scenario.ui.overlays` 中的 overlay id（原型）。 */
  overlay: string
  /** 整块相对本节点视频；无显式尺寸 → 自适应子组件内容。见 §8 Layout。 */
  layout?: Layout
  /** 本挂载 when→do（多为 event；走向经 do 内 advance + 边）。见 §5。 */
  reactions?: Reaction[]
  /** 逐组件差量：childId → 对原型该组件的字段级覆盖。 */
  overrides?: Record<string, Partial<OverlayChild>>
  /** 本挂载本地新增的组件（不写回共享方案）。 */
  added?: OverlayChild[]
  /** 屏蔽原型里的这些 childId（tombstone；不物理删除共享方案）。 */
  removed?: string[]
}

/** 一张可复用 Overlay。键 = `scenario.ui.overlays[id]`。 */
export interface Overlay {
  id: string
  title?: string
  children: OverlayChild[]
}

/**
 * Overlay 内一个组件实例。
 * - `component`：唯一类型键（行为 + 皮肤均由此查注册表）
 * - `layout`：相对**挂载盒**的排版；挂载有显式尺寸时缺省 = 左上角
 * - `inputs`：玩法/表现入参（禁止塞 pos/layout/component，摆放走 layout 字段）
 */
export interface OverlayChild {
  id: string
  component: string
  layout?: Layout
  trigger?: Trigger
  window?: { startMs?: number; endMs?: number }
  inputs?: Record<string, unknown>
  note?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// §5. Reaction：作者 SSOT（when → do；走向只经 do 内 advance + 边）
// ═══════════════════════════════════════════════════════════════════════════

/** 瘦 Reaction：when + do。作用域由挂载位置决定（node.data.reactions 或 overlayNodes[].reactions）。 */
export interface Reaction {
  when: ReactionTrigger
  do: NodeAction[]
}

/**
 * 触发面（闭合）：
 * - enter/at(ms)/exit/complete：节点生命周期
 * - event：组件事件（挂 mount.reactions）
 * - state：局级规则相位（历史字段，已不再消费）
 * - watch：观察表达式变化（change/inc/dec）
 * - shown/hidden：某 overlay 组件实例出现/消失
 */
export type ReactionTrigger =
  | { type: 'enter' }
  | { type: 'at'; ms: number }
  | { type: 'exit' }
  | { type: 'complete'; if?: GraphCondition }
  | { type: 'event'; id: string }
  | { type: 'state'; condition: GraphCondition }
  | { type: 'watch'; of: string; on?: 'change' | 'inc' | 'dec' }
  | { type: 'shown'; of: string }
  | { type: 'hidden'; of: string }

/**
 * 闭合动作原语——同级并列，一个 do 可含多件事：
 * - effect：施加副作用（改 attr/var/flag/item）
 * - advance：沿指定出边 `edgeId` 推进到其 `target`（**唯一「换节点」通道**）
 * - spawn：主动实例化一个 overlay 组件模板（瞬态表现，如伤害飘字）
 */
export type NodeAction =
  | { kind: 'effect'; effects: GraphEffect[] }
  | { kind: 'advance'; edgeId: string }
  | { kind: 'spawn'; from: string; inputs?: Record<string, unknown>; layout?: Layout; ttlMs?: number }

// ═══════════════════════════════════════════════════════════════════════════
// §6. 条件 / 副作用（图原生，无品类假设）
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphCondition {
  all: GraphClause[]
}
export type GraphClause =
  | { type: 'var'; varId: string; op: CmpOp; value: number }
  | { type: 'flag'; varId: string; equals: boolean }
  | { type: 'visited'; nodeId: string }
  /** 直接比某实体某 attr 的值。 */
  | { type: 'attr'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 比某 attr 的「比例」= attrs[attr] / attrMeta[attr].max（如 hp 血量比例；死亡 = attrRatio hp lte 0）。 */
  | { type: 'attrRatio'; entityId: string; attr: string; op: CmpOp; value: number }
  /** 两实体同名 attr 运行时比较（如出手判断比 speed）。 */
  | { type: 'attrCompare'; left: string; right: string; attr: string; op: CmpOp }
  | { type: 'score'; op: CmpOp; value: number }
  | { type: 'hasItem'; itemId: string; count?: number }

export type GraphEffect =
  | { kind: 'attr'; entityId: string; attr: string; op: NumericEffectOp; value: NumOrExpr; once?: boolean; id?: string }
  | { kind: 'var'; varId: string; op: NumericEffectOp; value: NumOrExpr; once?: boolean; id?: string }
  | { kind: 'flag'; varId: string; value: boolean; id?: string }
  | { kind: 'item'; itemId: string; op: 'give' | 'take'; count: number; id?: string }
/** 数值类 effect 的运算：加 / 乘 / 设为（减 = 增加负数）。 */
export type NumericEffectOp = 'add' | 'mul' | 'set'
export type CmpOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq'

// ═══════════════════════════════════════════════════════════════════════════
// §7. 实体 / 变量
// ═══════════════════════════════════════════════════════════════════════════

export interface Entity {
  /** 与 `GameScenario.entities` 的 Record key 对齐。 */
  id: string
  name?: string
  kind?: string
  /** 开放数值袋：attack/defense/speed/hp/… 任意扩展；**没有 hp 特权字段**。 */
  attrs?: Record<string, number>
  attrMeta?: Record<string, AttrMeta>
}
export interface Variable {
  /** 与 `GameScenario.variables` 的 Record key 对齐。 */
  id: string
  name?: string
  initial?: number
  min?: number
  max?: number
}
/** attr 的静态约束/元信息（值本身在运行态里）。 */
export interface AttrMeta {
  min?: number
  max?: number
  /** 复位/复活的初值（restart/resetGlobals 用）。 */
  initial?: number
  /** HUD/编辑器显示名。 */
  label?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// §8. 排版 / 触发时机 / 组件契约
// ═══════════════════════════════════════════════════════════════════════════

/** 绝对定位排版（CSS inset 心智）。 */
export interface Layout {
  top?: LayoutValue
  right?: LayoutValue
  bottom?: LayoutValue
  left?: LayoutValue
  width?: LayoutValue
  height?: LayoutValue
  /** 自身偏移，对齐 CSS `transform: translate(...)`。 */
  translateX?: LayoutValue
  translateY?: LayoutValue
  zIndex?: number
}
/** `number` = 相对父框 0~1 比例（含负值）；也可用 `'50%'` / `'12px'` 字符串。 */
export type LayoutValue = number | `${number}%` | `${number}px`

/** 相对**本演出节点**生命周期的触发时机。收尾/离场副作用走 Reaction，不在这里表达。 */
export type Trigger =
  | { when: 'enter' }
  | { when: 'at'; ms: number }

export interface ComponentInput {
  key: string
  label?: string
  valueType: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: unknown
  options?: { value: string; label: string }[]
  /** 用哪个输入组件渲染：color / entity / events / effects / textStyle / qteCues … */
  component?: string
}
/** 组件对外抛出的事件；运行时 emit → 归一成这些 id，边用 `sourceHandle === event.id` 承接。 */
export interface ComponentEvent {
  id: string
  label?: string
}
export interface ComponentManifest {
  /** = OverlayChild.component */
  id: string
  label?: string
  inputs?: ComponentInput[]
  events: ComponentEvent[]
}
/** State → 展示：常量或 `{ expr }`（声明式，无函数入库）。 */
export type BindValue = string | number | boolean | { expr: string }

// ═══════════════════════════════════════════════════════════════════════════
// §9. 文字样式（floatText / dialogue 共用底座）
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphTextStylePreset {
  id: string
  name: string
  style: GraphTextStyle
  /** 仅字幕预设：勾选后展示说话人前缀。 */
  speakerPrefix?: boolean
  builtin?: boolean
}
export interface GraphTextStyle {
  fontFamily?: string
  fontWeight?: number
  color?: string
  /** 数值 = 画面高度百分比，渲染为 `${n}cqh`。 */
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  textDecoration?: string
  backgroundColor?: string
  opacity?: number
  textShadow?: string
  WebkitTextStrokeColor?: string
  WebkitTextStrokeWidth?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// §10. 数值 / 表达式原语（最底层）
// ═══════════════════════════════════════════════════════════════════════════

/** 数值 = 常量或表达式字符串。求值语法只此一套；引擎只读 `expr`，从不读 `pick`。 */
export type NumOrExpr = number | { expr: string; pick?: ValuePick }
/** `pick` 的选取式结构（运行时忽略）：常量，或一条左结合的 ±×÷ 条款链。 */
export type ValuePick =
  | { mode: 'const'; const: number }
  | { mode: 'pick'; terms: ValueTerm[] }
export interface ValueTerm {
  op?: ValueTermOp
  source: 'entity' | 'var' | 'const'
  refId: string
  attr?: string
  constValue?: number
}
export type ValueTermOp = '+' | '-' | '*' | '/'
