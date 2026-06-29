/**
 * VideoPlan 类型定义 —— v3.8 新增
 *
 * 这是 Planner（LLM）与 Scheduler（纯函数）+ Runner（副作用层）之间的契约。
 * 把类型独立成文件，避免三层互相 import 成环；所有消费方只依赖这里。
 */

/**
 * 单个视频段 —— 一次视频模型调用生成的最小单元。
 *
 * 一个 shot 可能对应 1..N 个 segment：
 *   - shot.durationSec ≤ 模型 max → 1 段
 *   - shot.durationSec >  模型 max → 多段（由 splitDurationToSegments 决定段时长）
 */
export interface VideoSegment {
  /** 稳定 id，格式 `<sceneId>-<shotId>-seg<NN>`；方便日志/审计定位 */
  id: string
  /** 所属 scene id —— 跟 scenario.scenes 对应 */
  sceneId: string
  /** 所属 shot id —— 跟 Shot.id 对应，一对多 */
  shotId: string
  /**
   * 段内序号（0-based）—— 本 shot 拆成 N 段时从 0 递增。
   * 决定 `dependsOn` 链条：segmentIndex=1 的 dependsOn = segmentIndex=0 的 id。
   */
  segmentIndex: number
  /** 本段时长（秒），保证 ∈ [1, modelCapabilities.maxSingleClipSec] */
  durationSec: number
  /** 本段最终喂模型的中文 prompt（已含时间刻度 + 运镜 + 动作） */
  prompt: string
  /**
   * 连续组 id —— 同组 segment 必须串行，前段尾帧作下段起始。
   *
   * 同一 shot 内拆多段 → 天然同组（id = `grp-<shotId>`）
   * 跨 shot 但叙事连续 → LLM 打同一 groupId（如追逐戏 3 个 shot）
   * 独立 shot → 自己一组（id = `grp-<shotId>`）
   */
  continuityGroupId: string
  /**
   * 依赖的 segment id —— 有值时 Scheduler 必须等它完成、截尾帧、作为 startFrame 传入。
   * 同组内第一段 = undefined（用 shot 的 keyframeMediaRef 做起手图）。
   */
  dependsOnSegmentId?: string
  /**
   * 起手图策略 —— 决定本段 video 生成时的 referenceImageDataUrl 从哪来。
   *   'shot-keyframe'    : 用 shot.keyframeMediaRef（同组首段）
   *   'shot-start-frame' : 用 shot.startFrameMediaRef（ab 策略同组首段）
   *   'prev-segment-tail': 用 dependsOnSegmentId 段的视频最后一帧（同组非首段）
   *   'text-only'        : 无起手图，文生视频（模型不支持 i2v 或无图可用）
   */
  startFrameStrategy: 'shot-keyframe' | 'shot-start-frame' | 'prev-segment-tail' | 'text-only'
  /**
   * 续接策略（P3-C）—— 「一镜到底」靠**我方自截尾帧 + 多模态参考 + 提示词**实现，
   * **不**走模型的原生视频延长（不回传上一段视频）：
   *   'continuation': 本段是上一画面的连续延续 —— 参考图序列 = [上一段尾帧, 角色锚点, 场景图…]
   *                   （reference 模式 ≤9 张），并在提示词里**明确声明「这是同一连续镜头」**，
   *                   由视频模型据此自然续接。对应 startFrameStrategy='prev-segment-tail'。
   *   'standalone'  : 段用自己的关键帧/首帧起手，不承接前段。
   */
  extendStrategy?: 'continuation' | 'standalone'
  /**
   * 本段在成片里对应的源 shot 在 scene.shots[] 中的 order。
   * 冗余字段，Scheduler 用来排序时间轴，不必计算。
   */
  shotOrder: number
}

/**
 * 一个完整的视频编排方案 —— Planner 的输出 / Scheduler 的输入。
 */
export interface VideoPlan {
  /** 对应 scene id */
  sceneId: string
  /** 所有 segment，已按 (shotOrder, segmentIndex) 排序 */
  segments: VideoSegment[]
  /** 使用的视频模型能力位快照 —— 记录 Planner 决策时参照的值 */
  modelId: string
  /** Planner 决策日志（给作者后台查看用） */
  rationale: string
  /** 告警（非致命） */
  warnings: string[]
}

/**
 * LLM 返回的"连续组判定"原始输出 —— 只含语义决策，不含物理拆段。
 *
 * LLM 只回答一件事：哪些 shotId 属于同一个 continuityGroup？
 * 物理拆段（durationSec → segment 数量）由 videoSchedule 纯函数做。
 *
 * 这样的分工保证：
 *   - LLM 只做它擅长的"语义叙事判断"（这三个镜是追逐戏延续吗）
 *   - 代码做它擅长的"确定性物理计算"（30 秒按 10s 拆成 3 段）
 */
export interface LLMContinuityDecision {
  /** shotId → continuityGroupId；不在表里的 shot 视为独自一组 */
  assignments: Record<string, string>
  /** 决策理由（人话）—— 写入 VideoPlan.rationale 供后台查 */
  rationale: string
}
