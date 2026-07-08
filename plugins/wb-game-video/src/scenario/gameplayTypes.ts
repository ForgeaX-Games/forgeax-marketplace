/**
 * 视频游戏「玩法优先」扩展类型 —— v9 新增。
 *
 * 设计原则(见 docs/features/video-game-reel-gameplay.md):
 *   1. **同一 Scenario SSOT**：这些类型都是 Scene / Scenario 上的**可选字段**，
 *      缺省即「纯影游」，旧数据零回归、运行时按现状播放。
 *   2. **复用优先**：新类型集中本文件，types.ts 只挂可选字段引用，避免散落耦合。
 *   3. **媒体不可知**：Boss / QTE / 选择都基于已有的 Scene.media + branches 体系，
 *      不引入第二套数据；蓝图视图与运行时都只是「多解释几条规则」。
 *
 * 与 types.ts 的循环 import 仅限 `type` 引用（编译期擦除，无运行时环）。
 */

import type { QTESpec, BranchCondition, Effect } from './types'

// ============================================================================
// 两级状态机 —— 场景类别
// ============================================================================

/**
 * 场景类别 —— 两级状态机的「内层」行为分派。
 *
 *   story  纯叙事 / 过场（缺省，等价旧影游节点）
 *   battle Boss 战（挂 BossSpec，回合制结算）
 *   qte    以 QTE 为主的节点（节奏点 / sequence / 子弹时间）
 *   choice 以选择为主的节点（暂停 / 限时选择）
 *
 * 缺省 undefined = 'story'，保证旧剧本行为不变。
 */
export type SceneKind = 'story' | 'battle' | 'qte' | 'choice'

/** 视频播放方式 —— 对齐原型「演出方式：循环 / 单次」。 */
export type MediaPlayMode = 'once' | 'loop'

/** HUD 方案 —— 对齐原型四档 + 叙事模式。 */
export type HudPreset = 'hidden' | 'main' | 'battle' | 'explore' | 'narrative'

/** 选项类型 —— 对齐原型 optType。 */
export type DecisionOptType = 'static' | 'timed' | 'timed_qte'

/** 选完分支后何时跳转 —— 对齐原型 fireAt。 */
export type DecisionFireAt = 'on_pick' | 'video_end'

/** 选项 UI 呈现 —— 对齐原型 optPresent。 */
export type ChoicePresentation = 'list' | 'hotspot'

/** QTE 交互形式 —— 对齐原型 qteKind。 */
export type QteKind = 'parry' | 'timing' | 'mash' | 'sequence' | 'sweep'

/** QTE UI 变体 —— ext.qteUi 取值。 */
export type QteUi = 'default' | 'battleParry' | 'inkKou'
/** 选项 UI 变体 —— ext.choiceUi 取值。 */
export type ChoiceUi = 'default' | 'battleSkillBar' | 'inkYingMo'

// ============================================================================
// 实体 —— HUD 血条 / Boss 战的状态载体
// ============================================================================

export type EntityKind = 'player' | 'boss' | 'enemy' | 'ally'

/**
 * 实体的运行时可比较属性（闭合 union）—— 供条件子句 attrCompare 与 entityStat 副作用共用。
 * 血量走 hp（既有 maxHp/initialHp + hpRatio 语义），这里收敛「非血量」的数值属性。
 * 目前仅 speed（出手速度，先手判定用）；后续要加 attack/defense 等按需扩展本 union。
 */
export type EntityAttr = 'speed'

/**
 * 一个可被 HUD 展示、可在 Boss 战里掉血的实体。
 * 挂在 Scenario.entities（全局注册表）。
 */
export interface EntitySpec {
  id: string
  /** 显示名（HUD / 蓝图角标用）。 */
  name: string
  kind: EntityKind
  /** 最大血量。 */
  maxHp: number
  /** 初始血量（缺省 = maxHp）。 */
  initialHp?: number
  /** 出手速度（先手判定：速度大者先手）。缺省 = 0。运行时可被 entityStat(speed) 改写。 */
  speed?: number
  /** HUD 头像 mediaStore id。 */
  portraitMediaId?: string
  /** 作者备注。 */
  desc?: string
}

// ============================================================================
// 状态效果 —— HUD StatusIcons / 条件判定的词汇表
// ============================================================================

/**
 * 状态效果定义（中毒 / 增益 / 眩晕…）。挂 Scenario.statuses（全局注册表）。
 * 运行时实体身上「当前有哪些 status」是 Player 会话态，不进 Scenario。
 */
export interface StatusSpec {
  id: string
  name: string
  kind: 'buff' | 'debuff'
  /** HUD 图标 mediaStore id。 */
  iconMediaId?: string
  /** 作者备注。 */
  desc?: string
}

// ============================================================================
// 限时 / 暂停选择
// ============================================================================

/**
 * 选择呈现方式 —— 控制 scene.branches(kind='choice') 怎么弹给玩家。
 * 挂 Scene.decision；缺省 = 经典「场景结束后出选项」。
 *
 * 配置套路对齐 `视频交互原型.html` 蓝图右栏「选项」组。
 */
export interface DecisionSpec {
  /**
   * 选项类型（原型 optType）：
   *   static     = 不限时选项
   *   timed      = 限时选项（配合 timeoutMs）
   *   timed_qte  = 限时 QTE（无选项列表，走 qte_pass/fail）
   */
  optType?: DecisionOptType
  /**
   * 兼容旧字段：pause = 暂停等选；timed = 限时。
   * optType 缺省时由 mode 推断。
   */
  mode?: 'pause' | 'timed' | 'wait'
  /** 选项开始出现时刻（ms，相对 scene）。loop 节点边播边选。 */
  atMs?: number
  /** 选项显示窗口起点（ms）。缺省 = atMs ?? 0。 */
  windowStartMs?: number
  /** 选项显示窗口终点（ms）。缺省 = durationMs。 */
  windowEndMs?: number
  /** timed 模式倒计时（ms）。 */
  timeoutMs?: number
  /** 超时缺省分支 id（不填 → 第一个满足条件的分支）。 */
  defaultBranchId?: string
  /** 玩家提示文案（如「快做决定！」）。 */
  prompt?: string
  /** 选完何时跳转：即时 / 等视频结束（原型 fireAt）。 */
  fireAt?: DecisionFireAt
  /** 清单式卡片 vs 画面热区（原型 optPresent；限时锁定 list）。 */
  presentation?: ChoicePresentation
  /** 时间轴/画面层级；数值越大越靠上。 */
  layer?: number
  /** 限时 QTE 的交互形式（原型 qteKind）。 */
  qteKind?: QteKind
}

// ============================================================================
// Boss 战
// ============================================================================

/**
 * Boss 战一回合 —— 一次互动（QTE / 选择）+ 命中/失手的伤害结算。
 */
export interface BossRound {
  id: string
  /** 回合提示 / 招式名。 */
  label?: string
  /** 命中（QTE 通过 / 正确选择）时触发的状态变化。 */
  hitEffects?: Effect[]
  /** 失手（QTE 失败 / 错误选择）时触发的状态变化。 */
  missEffects?: Effect[]
  /** 本回合的 QTE 配置（回合级节奏点；与 scene.qte 互补）。 */
  qte?: QTESpec
}

/**
 * Boss 战配置 —— 挂在 Scene.kind='battle' 的场景上。
 */
export interface BossSpec {
  /** Boss 实体 id（Scenario.entities）。 */
  entityId: string
  /** 玩家实体 id（缺省取第一个 kind='player' 的实体）。 */
  playerEntityId?: string
  /** 回合列表（按序）。 */
  rounds: BossRound[]
  /** Boss HP 清零跳转（胜利）。 */
  winSceneId?: string
  /** 玩家 HP 清零跳转（失败）。 */
  loseSceneId?: string
  /** 完美通关（全回合命中、玩家零伤）触发的隐藏标记 flag varId（写 1）。 */
  perfectFlagVarId?: string
}

// ============================================================================
// 可点按热点 —— call / return 子流程
// ============================================================================

/**
 * 热区「中断—返回」原地对话 —— 对齐 seedance hotspot.detour。
 * 不走 targetSceneId，播完对话后回到原视频进度。
 */
export interface HotspotDetour {
  speaker?: string
  /** 多行台词，逐行点击推进。 */
  dialogue: string[]
  /** 对话结束后写入的 flag（varId → 1）。 */
  setFlagVarIds?: string[]
}

/**
 * 画面可点按热点：点某处进入支线（call），或 detour 原地对话，或单向跳转。
 * 挂 Scene.hotspots；与 v7 的 SearchHotspot(拾物)区分。
 */
export interface Hotspot {
  id: string
  /** 归一化坐标（0~1）。 */
  x: number
  y: number
  /** 命中半径（归一化，默认 0.08）。 */
  r?: number
  /** 出现 / 消失时刻（ms，相对 scene；缺省 = 全场景可见）。 */
  appearAt?: number
  endMs?: number
  /** 点击后进入的子流程入口 sceneId（与 detour 二选一）。 */
  targetSceneId?: string
  /** 原地多行对话（seedance detour）；优先于 targetSceneId。 */
  detour?: HotspotDetour
  /** true = 本局只触发一次。 */
  once?: boolean
  /**
   * 'return'（默认）= 子流程走到返回点时回到本 scene（call/return）；
   * 'goto'        = 单向跳转，不返回。
   */
  mode?: 'return' | 'goto'
  /** 提示文案 / 图标 label。 */
  label?: string
  /** 解锁条件（同 Branch.condition）。 */
  condition?: BranchCondition
}

// ============================================================================
// 演出结算轴（Performance cues）—— seedance attackBeat / 原型结算时间轴
// ============================================================================

/** 时间轴上的判定点 —— 到时刻触发一组状态变化，可选绑定飘字表现。 */
export interface PerformanceCue {
  id: string
  /** 触发时刻（ms，相对 scene 起点）。 */
  atMs: number
  /** 触发时应用的状态变化。空数组表示纯判定/标记点。 */
  effects: Effect[]
  /** 编辑器/日志标签（可选）。 */
  label?: string
  /** 时间轴/画面层级；数值越大越靠上。 */
  layer?: number
}

/** 挂 Scene.performance —— FMV 演出内的「attackBeat」扣血轴。 */
export interface PerformanceSpec {
  cues: PerformanceCue[]
}

// ============================================================================
// HUD / 玩法 UI 配置
// ============================================================================

export type HudElement = 'playerHp' | 'bossHp' | 'score' | 'status' | 'inventory' | 'timer'

export interface HudRule {
  element: HudElement
  /**
   * 何时显示：
   *   'always' 全程；'battle' 仅 SceneKind='battle'；
   *   'qte'    仅 QTE / 限时选择时；'never' 隐藏。
   */
  show: 'always' | 'battle' | 'qte' | 'never'
}

/**
 * 全局 HUD / 玩法 UI 配置 —— 挂 Scenario.ui。
 * 缺省 → 按 SceneKind 智能显示（HudLayer 自带兜底规则）。
 */
export interface UIConfig {
  hud?: HudRule[]
  /** HUD 主题色（hex），缺省走播放器默认。 */
  accentColor?: string
}

const HUD_ELEMENTS = new Set<HudElement>([
  'playerHp',
  'bossHp',
  'score',
  'status',
  'inventory',
  'timer',
])

const HUD_SHOW_VALUES = new Set<HudRule['show']>(['always', 'battle', 'qte', 'never'])

function isHudElement(v: unknown): v is HudElement {
  return typeof v === 'string' && HUD_ELEMENTS.has(v as HudElement)
}

function isHudShow(v: unknown): v is HudRule['show'] {
  return typeof v === 'string' && HUD_SHOW_VALUES.has(v as HudRule['show'])
}

function parseHudRuleEntry(raw: unknown): HudRule | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (!isHudElement(rec.element) || !isHudShow(rec.show)) return null
  return { element: rec.element, show: rec.show }
}

/**
 * 把任意形态的 ui.hud 归位为 HudRule[]。
 *
 * LLM / 外部导入偶尔产出 Record 形态（{ playerHp: 'always' }）或非数组；
 * 播放器与规则模块只认数组 SSOT。
 */
export function coerceHudRules(raw: unknown): HudRule[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.map(parseHudRuleEntry).filter((r): r is HudRule => r != null)
  }
  if (typeof raw === 'object') {
    const out: HudRule[] = []
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isHudElement(key)) continue
      if (isHudShow(value)) {
        out.push({ element: key, show: value })
        continue
      }
      const nested = parseHudRuleEntry(value)
      if (nested && nested.element === key) out.push(nested)
    }
    return out
  }
  return []
}
