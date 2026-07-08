/**
 * 运行时「指令」—— 纯引擎(BlueprintRuntime) 对外只产出这组渲染无关的指令，由
 * React/DOM 驱动层(Player) 翻译成实际的视频播放 / HUD / QTE 卡片 / 选项 / 飘字。
 *
 * 与 cinegame 的取舍一致：状态机走法是纯逻辑（可单测），渲染是另一层。cinegame 把
 * 两者写在一个 runtime.ts 里（DOM 直接操作）；本插件因为有 React Player，拆成
 * 「引擎产指令 + 视图消费指令」，更易单测、也能接回既有 Player 渲染设施。
 */

import type {
  BlueprintBossRound,
  BlueprintDecision,
  BlueprintHotspot,
  BlueprintHudMode,
  BlueprintOption,
  BlueprintQte,
  BlueprintTransition,
  BlueprintDamagePoint,
} from '../blueprint-schema'
import type { Effect } from '../../scenario/types'

/** 播放某节点的演出片段（Loop / once + 转场 + HUD）。 */
export interface PlayClipDirective {
  type: 'playClip'
  nodeId: string
  /** 节点名（无演出编号时给画面兜底标题）。 */
  name: string
  clipId?: string
  mediaId?: string
  loop: boolean
  durationMs?: number
  hud: BlueprintHudMode
  transition?: BlueprintTransition
  /** 该片段时间轴上的结算点（到点扣血/飘字）。 */
  dmgPoints: BlueprintDamagePoint[]
}

/** 打开 QTE 判定（等待玩家命中）。 */
export interface OpenQteDirective {
  type: 'openQte'
  nodeId: string
  qte: BlueprintQte
}

/** 打开选项（暂停/限时选择）。 */
export interface OpenChoiceDirective {
  type: 'openChoice'
  nodeId: string
  options: BlueprintOption[]
  decision?: BlueprintDecision
}

/** 打开 Boss 战某一回合（等待玩家命中/失手）。 */
export interface OpenBossRoundDirective {
  type: 'openBossRound'
  nodeId: string
  round: BlueprintBossRound
  roundIndex: number
  totalRounds: number
}

/** 激活可点按热点（call/return 子流程 / detour 原地对话）。 */
export interface OpenHotspotsDirective {
  type: 'openHotspots'
  nodeId: string
  hotspots: BlueprintHotspot[]
}

/** detour 原地对话（不换节点，播完回原视频进度）。 */
export interface DialogueDirective {
  type: 'dialogue'
  speaker?: string
  lines: string[]
}

/** 结局横幅（胜利/失败/普通结局）。 */
export interface BannerDirective {
  type: 'banner'
  kind: 'victory' | 'defeat' | 'ending'
  nodeId: string
  title: string
}

/** 实体血量/分数变化（HUD 刷新）。 */
export interface StateChangedDirective {
  type: 'stateChanged'
}

/**
 * 进入节点时即时结算的实体数值效果，供视图层就近弹飘字（如冥想进场回血 +30）。
 * 与 dmgPoints（沿视频时间轴到点触发）不同：onEnter 效果在进入节点那一刻立即生效，
 * 没有 clip 时间坐标，位置由视图层按实体（我方/敌方）就近安置。
 */
export interface FloatEffectsDirective {
  type: 'floatEffects'
  nodeId: string
  effects: Effect[]
}

/** 日志（调试 / 战斗记录）。 */
export interface LogDirective {
  type: 'log'
  message: string
}

export type RuntimeDirective =
  | PlayClipDirective
  | OpenQteDirective
  | OpenChoiceDirective
  | OpenBossRoundDirective
  | OpenHotspotsDirective
  | DialogueDirective
  | BannerDirective
  | StateChangedDirective
  | FloatEffectsDirective
  | LogDirective
