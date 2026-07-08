/**
 * wb-game-video 蓝图 schema —— 严格对齐 `cinegame/src/blueprint-schema.ts` 的
 * 渲染无关 BPMN 形态，并按 cinegame 的扩展约定（见其 AGENTS.md）通过
 * `BaseBlueprintNode` / `BaseBlueprintEdge` 的**泛型参数**扩展出本插件需要的玩法
 * 字段，而不是复制一套平行结构。
 *
 * 约束（与 cinegame 一致）：
 *  - 蓝图本体只保存图语义；不写 reactflow / 坐标 / DOM / CSS 等渲染字段。
 *  - flow 本体在 graph.edges；节点的 incoming / outgoing 只存 flow id。
 *  - reactflow 仅属于转换层 `blueprint-reactflow.ts`（从本 schema 派生）。
 *  - 不引入 Zod；用 TypeScript 类型契约 + 单测覆盖转换/运行时行为。
 *
 * 与 cinegame 的差异：cinegame 是 demo（固定一套战斗），本插件是「玩法优先视频
 * 游戏」的通用编辑器，功能是 cinegame 的超集，因此 `GameVideoExtensionElements`
 * 在 cinegame 的 { clipId, hud, stateKey, calcType, dmgPoints, options } 之上，按
 * 同样的风格补齐：mediaPlayMode(Loop)、transition(转场)、sceneKind(两级状态机内层)、
 * qte / boss / decision / hotspots（保留既有玩法）。
 */

import type { BranchCondition, BranchKind, Effect, QteOutcome } from '../scenario/types'

// ── cinegame Base 形态（逐字移植，勿改；扩展走泛型）────────────────────────

export const BLUEPRINT_ELEMENT_TYPES = [
  'start',
  'end',
  'task',
  'userTask',
  'serviceTask',
  'gateway',
  'event',
  'subflow',
] as const

export type BlueprintElementType = typeof BLUEPRINT_ELEMENT_TYPES[number]

export interface BaseBlueprintNode<
  TElementType extends string = string,
  TExtensionElements extends object = object,
> {
  id: string
  elementType: TElementType
  name: string
  documentation: string
  incoming: string[]
  outgoing: string[]
  extensionElements: TExtensionElements
}

export interface BaseBlueprintEdge<TExtension extends object = object> {
  id: string
  sourceRef: string
  targetRef: string
  name?: string
  conditionExpression?: string
  extension?: TExtension
}

export interface BaseBlueprintGraph<
  TNode extends BaseBlueprintNode = BaseBlueprintNode,
  TEdge extends BaseBlueprintEdge = BaseBlueprintEdge,
> {
  id: string
  title: string
  schemaVersion: string
  nodes: TNode[]
  edges: TEdge[]
}

// ── wb-game-video 玩法扩展（沿用 cinegame 的扩展元素风格）────────────────────

/** HUD 方案 —— cinegame(hidden/battle/qte/ending) ∪ 本插件 HudPreset(hidden/main/battle/explore/narrative)。 */
export const BLUEPRINT_HUD_MODES = [
  'hidden',
  'main',
  'battle',
  'explore',
  'qte',
  'ending',
  'narrative',
] as const

export type BlueprintHudMode = typeof BLUEPRINT_HUD_MODES[number]

/** 两级状态机「内层」行为分派（对齐 gameplayTypes.SceneKind）。 */
export const BLUEPRINT_SCENE_KINDS = ['story', 'battle', 'qte', 'choice'] as const
export type BlueprintSceneKind = typeof BLUEPRINT_SCENE_KINDS[number]

/** 视频播放方式 —— Loop 要素。 */
export type BlueprintMediaPlayMode = 'once' | 'loop'

/** 演出判定点（对齐本插件 PerformanceCue）。 */
export interface BlueprintDamagePoint {
  /** 触发时刻（秒，相对节点视频起点 —— 与 cinegame 一致用秒）。 */
  t: number
  /** 飘字归一化坐标（0~100，沿用 cinegame 百分比）。 */
  x: number
  y: number
  note: string
  effects: Effect[]
}

/** 选项 / 出边映射（对齐 cinegame BlueprintOption）。 */
export interface BlueprintOption {
  key: string
  label: string
  /** 目标节点 id（cinegame: target）。 */
  target: string
  /** 条件表达式（与 edge.conditionExpression 同语言）。 */
  conditionExpression?: string
}

/** QTE 配置（运行时 QTE 要素；从 scenario QTESpec 编译而来的精简形态）。 */
export interface BlueprintQte {
  kind: 'parry' | 'timing' | 'mash' | 'sequence' | 'sweep'
  /** 命中窗口（ms 容差）。 */
  windowMs: number
  /** 节奏点时刻（ms，相对节点起点）。 */
  cueMs: number[]
  /** 每个节奏点的输入配置；与 cueMs 同序。 */
  cues?: Array<{
    id: string
    triggerKey?: string
    shape?: 'tap' | 'hold' | 'sweep'
    durationMs?: number
    sweepDir?: 'up' | 'down' | 'left' | 'right'
    label?: string
  }>
  /** 序列：必须按序命中。 */
  sequence?: boolean
  /** 整段超时（ms）。 */
  timeoutMs?: number
  /** 通过所需最低命中数（缺省 = 全部命中）。 */
  passingHits?: number
  /** 可展示 / 可手动提交的 QTE 结果档位标签。 */
  outcomeLabels?: Partial<Record<QteOutcome, string>>
}

/** 限时 / 暂停选择（对齐 gameplayTypes.DecisionSpec 的运行时子集）。 */
export interface BlueprintDecision {
  optType: 'static' | 'timed' | 'timed_qte'
  /** 选项出现时刻（ms）。 */
  atMs?: number
  /** 限时倒计时（ms）。 */
  timeoutMs?: number
  /** 超时缺省目标节点 id。 */
  defaultTarget?: string
  prompt?: string
  /** 选完何时跳转。 */
  fireAt?: 'on_pick' | 'video_end'
  presentation?: 'list' | 'hotspot'
  layer?: number
}

/** Boss 战一回合。 */
export interface BlueprintBossRound {
  id: string
  label?: string
  hitEffects?: Effect[]
  missEffects?: Effect[]
  qte?: BlueprintQte
}

/** Boss 战配置（对齐 gameplayTypes.BossSpec）。 */
export interface BlueprintBoss {
  entityId: string
  playerEntityId?: string
  rounds: BlueprintBossRound[]
  /** Boss HP=0 跳转节点。 */
  winTarget?: string
  /** 玩家 HP=0 跳转节点。 */
  loseTarget?: string
  /** 完美通关写入的 flag varId。 */
  perfectFlagVarId?: string
}

/** 画面可点按热点（call/return 子流程 —— 对齐 gameplayTypes.Hotspot）。 */
export interface BlueprintHotspot {
  id: string
  x: number
  y: number
  r?: number
  appearAtMs?: number
  endMs?: number
  /** 点击进入的子流程入口节点 id。 */
  target?: string
  /** 原地多行对话（detour）。 */
  detour?: { speaker?: string; dialogue: string[] }
  once?: boolean
  /** return = 子流程结束回到本节点；goto = 单向。 */
  mode?: 'return' | 'goto'
  label?: string
  conditionExpression?: string
}

/** 转场（对齐 scenario TransitionSpec 的运行时子集）。 */
export interface BlueprintTransition {
  kind: 'cut' | 'fade' | 'crossfade' | 'dip'
  durationMs?: number
}

/** 进入节点时的副作用（数值/物品/flag）。 */
export interface BlueprintOnEnter {
  effects?: Effect[]
  /** 进入时写 1 的 flag varId 列表。 */
  setFlagVarIds?: string[]
}

/** 进入门槛（对齐 scenario EntryGate）—— 不满足条件时改道 / 阻挡。 */
export interface BlueprintEntryGate {
  /** 可读派生（与 edge.conditionExpression 同语言）。 */
  conditionExpression?: string
  /** 结构化进入条件（运行时求值）。 */
  condition?: BranchCondition
  onFail: 'redirect' | 'block'
  /** onFail='redirect' 时改道到的节点 id。 */
  redirectTarget?: string
  hint?: string
}

/**
 * 节点扩展元素 —— cinegame 的 { clipId, hud, stateKey, calcType, dmgPoints, options }
 * 超集。所有「多出来的玩法」都按 cinegame 风格挂在这里，蓝图本体仍是纯图。
 */
export interface GameVideoExtensionElements {
  /** 演出编号（gameAssetCatalog clip id）—— cinegame parity。 */
  clipId?: string
  /** 已解析的 mediaStore id（运行时直接拿到播放源时填）。 */
  mediaId?: string
  hud: BlueprintHudMode
  stateKey: string
  /** 两级状态机内层类别。 */
  sceneKind: BlueprintSceneKind
  /** Loop / once。 */
  mediaPlayMode: BlueprintMediaPlayMode
  calcType?: string
  dmgPoints: BlueprintDamagePoint[]
  options?: BlueprintOption[]
  /** 节点视频时长（ms）—— 运行时兜底等待用。 */
  durationMs?: number
  qte?: BlueprintQte
  boss?: BlueprintBoss
  decision?: BlueprintDecision
  hotspots?: BlueprintHotspot[]
  transition?: BlueprintTransition
  /** 进入节点副作用。 */
  onEnter?: BlueprintOnEnter
  /** 进入门槛（不满足改道 / 阻挡）。 */
  entryGate?: BlueprintEntryGate
  /** call/return 子流程出口：运行时到此节点弹回调用它的 hotspot 所在节点。 */
  returnsToCaller?: boolean
  /** 层级子蓝图引用：进入本节点时自动下钻到对应 graph 的 rootNodeId。 */
  subFlowRef?: string
}

export type GameVideoBlueprintNode = BaseBlueprintNode<BlueprintElementType, GameVideoExtensionElements>

/**
 * 边扩展 —— cinegame 的 edge 只有 conditionExpression(字符串，给人看/展示)。本插件
 * 运行时要按结构化条件求值并落数值/物品副作用，故把这些挂在 cinegame 预留的
 * `extension` 槽里（仍保持 conditionExpression 作可读派生），运行时只依赖 blueprint。
 */
export interface GameVideoEdgeExtension {
  kind: BranchKind
  /** 来源 Branch.id（回溯/调试）。 */
  branchId: string
  /** 三档 QTE 精确结果键；缺省按 kind 推断 pass/fail。 */
  qteOutcome?: QteOutcome
  condition?: BranchCondition
  effects?: Effect[]
  /** 选项出现时刻（ms）—— kind='choice'。 */
  showAtMs?: number
  gateMode?: 'hide' | 'lock'
}

export type GameVideoBlueprintEdge = BaseBlueprintEdge<GameVideoEdgeExtension>

export interface GameVideoBlueprintSubflowGraph {
  id: string
  title: string
  rootNodeId: string
  parentNodeId?: string
  nodes: GameVideoBlueprintNode[]
  edges: GameVideoBlueprintEdge[]
}

export const GAME_VIDEO_BLUEPRINT_SCHEMA_VERSION = 'wb-game-video.blueprint.v1' as const

export type GameVideoBlueprintGraph = BaseBlueprintGraph<
  GameVideoBlueprintNode,
  GameVideoBlueprintEdge
> & {
  schemaVersion: typeof GAME_VIDEO_BLUEPRINT_SCHEMA_VERSION
  subflows?: Record<string, GameVideoBlueprintSubflowGraph>
}
