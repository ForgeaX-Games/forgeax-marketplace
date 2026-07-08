/**
 * QTE 评分核心 —— 纯函数，离 React/DOM 完全独立。
 *
 * 设计：
 *   - 每个 cue 暴露独立的 `judgeHit(cue, window, score, deltaMs)` 评分
 *   - 完整一场 QTE 累加总分由 `tallyQTE` 计算
 *   - hold 类型的 cue 单独评分：用户实际按住时长 `holdMs`
 *
 * 与音游一致的语义：
 *   - 提前点 (deltaMs < 0) 与延迟点 (deltaMs > 0) 用同一窗口判定（绝对值）
 *   - 没点中 = MISS（appearAt 之前点击 / 触发了但根本没点）
 *
 * 不可变约束：判定全部依据传入参数，**不读时钟**——这样能在 vitest 里完全 mock。
 */

import type { QTECue, QTEHitWindow, QTESpec } from '../scenario/types'

/** 安全取 QTE cues —— LLM/导入偶尔产出缺 cues 的 QTESpec 壳。 */
export function qteCues(spec: QTESpec | undefined): QTECue[] {
  const raw = spec?.cues
  return Array.isArray(raw) ? raw : []
}

export type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS'
export type Timing = 'EARLY' | 'LATE' | 'ON' | 'NONE'

export interface HitVerdict {
  cueId: string
  judgement: Judgement
  /** 玩家点击 - 目标点（ms）；MISS 也保留信号供 UI 反馈 */
  deltaMs: number
  /** 该 cue 应得分（已含正负） */
  score: number
  timing: Timing
}

/**
 * 单点判定（tap / sweep）。
 *
 * @param cue       该节奏点配置
 * @param window    全局命中窗口（ms 容差）
 * @param score     全局分值表
 * @param deltaMs   `clickAtMs - cue.targetAt`；如果未点击需要按 MISS 处理时直接传 Number.POSITIVE_INFINITY
 */
export function judgeTap(
  cue: QTECue,
  window: QTEHitWindow,
  score: QTESpec['score'],
  deltaMs: number,
): HitVerdict {
  const abs = Math.abs(deltaMs)
  const finite = Number.isFinite(deltaMs)
  let judgement: Judgement
  if (finite && abs <= window.perfect) judgement = 'PERFECT'
  else if (finite && abs <= window.great) judgement = 'GREAT'
  else if (finite && abs <= window.good) judgement = 'GOOD'
  else judgement = 'MISS'

  const value =
    judgement === 'PERFECT'
      ? score.perfect
      : judgement === 'GREAT'
      ? score.great
      : judgement === 'GOOD'
      ? score.good
      : score.miss

  let timing: Timing = 'NONE'
  if (judgement !== 'MISS') {
    if (deltaMs < -2) timing = 'EARLY'
    else if (deltaMs > 2) timing = 'LATE'
    else timing = 'ON'
  }

  return { cueId: cue.id, judgement, deltaMs: finite ? deltaMs : Number.POSITIVE_INFINITY, score: value, timing }
}

/**
 * Hold 评分（v3.7 简化）：按住到目标时长就通过，不再因"时机"惩罚玩家。
 *
 * v3.6 背景：判"按得太晚"和"时长偏差太大"都会打 MISS。作者反馈这违反 hold
 * 的直觉——hold 应该是"能按住就行"的节奏点，不像 tap 需要卡帧对时机。
 * 外圈收缩动画也一并在 overlay 移除，视觉上不再暗示"有时机窗口要卡"。
 *
 * v3.7 契约：
 *   · 起手时刻（deltaMs）**完全不参与判定**，不论早/晚都不 MISS；
 *     timing 仍据 deltaMs 报 EARLY/LATE/ON，给 UI 反馈用，但不影响 score。
 *   · 时长偏差（|holdMs - durationMs|）决定档位：
 *       ≤ window.perfect → PERFECT（100）
 *       ≤ window.great   → GREAT  （60）
 *       其它（含 good 及以外）→ GOOD（30，兜底保送通过）
 *     没有 MISS 档：作者的原话"保持到时间就行了"。
 *   · auto-release 场景下 holdMs === durationMs，偏差 0 → PERFECT。
 *   · 玩家完全不按：由 QTEOverlay 放行 hold 的 expiry 检测，不会 emit verdict；
 *     该 cue 不出现在结算里，也不扣分。
 *
 * 缺少 cue.durationMs 时退化为 tap（没按住目标不成立，走 tap 语义）。
 */
export function judgeHold(
  cue: QTECue,
  window: QTEHitWindow,
  score: QTESpec['score'],
  deltaMs: number,
  holdMs: number,
): HitVerdict {
  if (cue.durationMs == null) return judgeTap(cue, window, score, deltaMs)

  // 时长偏差是唯一档位来源；不再有 MISS 档
  const holdDelta = Math.abs(holdMs - cue.durationMs)
  let finalJudge: Judgement
  if (holdDelta <= window.perfect) finalJudge = 'PERFECT'
  else if (holdDelta <= window.great) finalJudge = 'GREAT'
  else finalJudge = 'GOOD'

  const value =
    finalJudge === 'PERFECT'
      ? score.perfect
      : finalJudge === 'GREAT'
        ? score.great
        : score.good

  // timing 仅做信息反馈（AnimatedScoreline 等 UI 用），不再影响档位
  let timing: Timing = 'NONE'
  if (Number.isFinite(deltaMs)) {
    if (deltaMs < -2) timing = 'EARLY'
    else if (deltaMs > 2) timing = 'LATE'
    else timing = 'ON'
  }

  return {
    cueId: cue.id,
    judgement: finalJudge,
    deltaMs: Number.isFinite(deltaMs) ? deltaMs : Number.POSITIVE_INFINITY,
    score: value,
    timing,
  }
}

/** 总分汇总（带通过判定）。 */
export interface QTERun {
  verdicts: HitVerdict[]
  total: number
  passed: boolean
  perfect: number
  great: number
  good: number
  miss: number
}

export function tallyQTE(spec: QTESpec, verdicts: HitVerdict[]): QTERun {
  let total = 0
  let perfect = 0
  let great = 0
  let good = 0
  let miss = 0
  for (const v of verdicts) {
    total += v.score
    if (v.judgement === 'PERFECT') perfect++
    else if (v.judgement === 'GREAT') great++
    else if (v.judgement === 'GOOD') good++
    else miss++
  }
  const passed = spec.passingScore == null ? true : total >= spec.passingScore
  return { verdicts, total, passed, perfect, great, good, miss }
}

/**
 * 序列 QTE（spec.sequence=true）是否通过 —— v9 玩法系统。
 *
 * 连段/连打语义：cues 必须**按 appearAt 升序**每个都拿到非 MISS 判定，且玩家
 * 的实际命中顺序（verdicts 的加入顺序，即点击顺序）与该升序一致。任一漏拍或
 * 错序即整段失败。spec.sequence 为假 → 恒 true（交回 tallyQTE.passed 处理旧行为）。
 *
 * 纯函数：只依赖入参，不读时钟，可在 vitest 完全确定性验证。
 */
export function sequencePassed(spec: QTESpec, verdicts: HitVerdict[]): boolean {
  if (!spec.sequence) return true
  const order = [...qteCues(spec)]
    .sort((a, b) => a.appearAt - b.appearAt)
    .map((c) => c.id)
  if (order.length === 0) return true
  const byId = new Map(verdicts.map((v) => [v.cueId, v]))
  // 每个 cue 都必须有非 MISS 判定
  for (const id of order) {
    const v = byId.get(id)
    if (!v || v.judgement === 'MISS') return false
  }
  // 命中顺序（点击顺序）必须严格等于 appearAt 升序
  const hitOrder = verdicts
    .filter((v) => v.judgement !== 'MISS')
    .map((v) => v.cueId)
  if (hitOrder.length < order.length) return false
  for (let i = 0; i < order.length; i++) {
    if (hitOrder[i] !== order[i]) return false
  }
  return true
}

/**
 * 一场 QTE 的最终「是否通过」—— 统一 spec.passingScore 与 spec.sequence 两条门槛。
 * 序列模式额外要求 sequencePassed；二者都满足才算过（AND）。
 */
export function qtePassed(spec: QTESpec, verdicts: HitVerdict[]): boolean {
  return tallyQTE(spec, verdicts).passed && sequencePassed(spec, verdicts)
}

/**
 * 整段超时截止时刻（ms，相对 scene 起点）。
 * - 单 cue（战斗防反墨章）：首个 appearAt + timeoutMs（原 prototype 语义）。
 * - 多 cue：最后一个 cue 的判定窗结束 + timeoutMs，避免第二个按键点尚未出现就整段超时。
 */
export function qteTimeoutDeadlineMs(spec: QTESpec | undefined): number | null {
  const cues = qteCues(spec)
  const timeoutMs = spec?.window?.timeoutMs
  if (!spec || timeoutMs == null || cues.length === 0) return null
  const good = spec.tolerance?.good ?? 480
  if (cues.length === 1) {
    return Math.min(...cues.map((c) => c.appearAt)) + timeoutMs
  }
  const lastLiveEnd = Math.max(...cues.map((c) => c.targetAt + good))
  return lastLiveEnd + timeoutMs
}

/**
 * 整段 QTE 是否已「全部 cue 出过判定」（用于超时检测时判断是否还在进行中）。
 * 全部 cue 都有 verdict → 已结束，不再触发超时失败。
 */
export function qteAllResolved(spec: QTESpec | undefined, verdicts: HitVerdict[]): boolean {
  const cues = qteCues(spec)
  if (!spec || cues.length === 0) return true
  const resolved = new Set(verdicts.map((v) => v.cueId))
  return cues.every((c) => resolved.has(c.id))
}

/**
 * 给定时刻 (ms) 与 cue.appearAt / cue.targetAt，
 * 计算 UI 渲染需要的归一化进度 (0..1) —— 0 = 刚出现，1 = 命中点，>1 = 已过命中点。
 */
export function cueProgress(cue: QTECue, nowMs: number): number {
  const span = cue.targetAt - cue.appearAt
  if (span <= 0) return nowMs >= cue.targetAt ? 1 : 0
  return (nowMs - cue.appearAt) / span
}

/** 一个 cue 当前是否处于 "可被命中" 时间窗 [appearAt, targetAt + window.good] */
export function cueIsLive(cue: QTECue, window: QTEHitWindow, nowMs: number): boolean {
  return nowMs >= cue.appearAt && nowMs <= cue.targetAt + window.good
}

/**
 * 一个 cue 是否已经因为超时过期（玩家完全错过）。
 * 用于运行时驱动 MISS：超过 targetAt + window.good 还没 verdict 就算 MISS。
 */
export function cueIsExpired(cue: QTECue, window: QTEHitWindow, nowMs: number): boolean {
  return nowMs > cue.targetAt + window.good
}

/**
 * 编辑器 / 玩家"打点可见性"的三态：
 *   - `'before'`     还未到 appearAt → UI 应**完全隐形**
 *   - `'incoming'`   appearAt 之后、targetAt 之前 → 外环正在收缩、玩家可点
 *   - `'window'`     targetAt 之后到 targetAt + window.good → 命中窗口尾部，仍可点（"贴脸命中"）
 *   - `'after'`      过了命中窗口 → UI 应**完全消失**（编辑器 hover 也不再保留鬼影）
 *
 * 把音游里"音符出现 / 滑入 / 命中线 / 飞走"的状态机抽干净的纯函数。
 * Player & StagePane 共用，避免可见性规则散落在两个组件里漂移。
 */
export type CuePhase = 'before' | 'incoming' | 'window' | 'after'
export function cuePhase(cue: QTECue, window: QTEHitWindow, nowMs: number): CuePhase {
  if (nowMs < cue.appearAt) return 'before'
  if (nowMs <= cue.targetAt) return 'incoming'
  if (nowMs <= cue.targetAt + window.good) return 'window'
  return 'after'
}

/**
 * 判断"是否应该跑超时检测（emit MISS）"。
 *
 * 单纯 `cueIsExpired(now)` 在场景切换的瞬间会撞车：旧场景 elapsed=11000，
 * 切到新场景的同一帧 React 还没把 elapsed 重置，新挂载的 QTEOverlay 拿到
 * elapsed=11000，对新场景的 cue 全部判 expired，立刻 emit 一堆 MISS。
 *
 * 解决：要求 elapsed **单调向前**才跑检测。
 *   - prev=null（首次见到 spec / overlay 刚挂载）→ 跳过这一拍，等下一帧拿到正确 elapsed
 *   - now < prev（时间倒退：场景切换 / replay）   → 跳过
 *   - now >= prev → 正常检测
 *
 * 这是 *瞬态错位过滤器*，不影响正常的 expired 语义。
 */
export function shouldRunExpiryCheck(
  prevElapsedMs: number | null,
  nowMs: number,
): boolean {
  if (prevElapsedMs == null) return false
  return nowMs >= prevElapsedMs
}

/**
 * 目标环（"PERFECT 命中框"）相对于 cue 容器的归一化尺寸。
 *
 * 这是飞入环 scale=1 时的"对齐基准"——意味着外环飞入到这个 scale 时，
 * 与目标框完全重合，即 PERFECT 时机点。CSS 必须用同一常量（通过 CSS var
 * 注入或硬编码 0.6）来设置目标环的实际尺寸。
 */
export const CUE_RING_TARGET_SCALE = 0.6

/**
 * 飞入环（外环）在 progress 时刻应该使用的 transform scale。
 *
 * 设计：
 *   - progress=0  → scale = 2.4   外环在最外圈（cue 刚出现）
 *   - progress=1  → scale = CUE_RING_TARGET_SCALE   *精确* 等于目标环 → PERFECT 时机点
 *   - progress>1  → scale 继续线性向内缩（提示玩家已经"飞过"命中点）
 *   - progress→∞  → scale clamp 到一个非零最小值，防止 cue 塌成一个点
 *
 * 让飞入环精确撞进目标环里，玩家 *肉眼* 就知道"撞中那一刻 = PERFECT"。
 * 旧代码 ringScale 终点 ≈ 0.95、目标环 38%，两者根本不重叠——这是用户
 * 反馈"不知道收缩到什么位置才会触发最佳"的根因。
 */
export function cueRingScale(progress: number): number {
  const FROM = 2.4
  const TO = CUE_RING_TARGET_SCALE
  const MIN = 0.3
  if (progress <= 0) return FROM
  if (progress <= 1) return FROM - (FROM - TO) * progress
  // 过命中点后继续线性向内缩，斜率比飞入更陡 1.5×（提示玩家"已经晚了"）
  const overshoot = (progress - 1) * (FROM - TO) * 1.5
  return Math.max(MIN, TO - overshoot)
}

/**
 * cue 是否应该出现在 DOM 里。
 *
 * 设计：以"音游打点"的可见性为基准，不让 verdict 永驻造成幽灵叠加：
 *   - 未到 appearAt → 永远不渲染
 *   - 在 [appearAt, targetAt + window.good] 命中窗口内 → 渲染（玩家可点）
 *   - 已 resolved 且在 splash 尾巴内 → 渲染（让 PERFECT/MISS 飘字播完）
 *   - 否则                          → 不渲染（关键：旧版本只看 verdict 永驻，导致跨 cue 叠加）
 */
export function shouldRenderCue(
  cue: QTECue,
  window: QTEHitWindow,
  nowMs: number,
  hasVerdict: boolean,
  splashTailMs: number,
): boolean {
  if (nowMs < cue.appearAt) return false
  const liveEnd = cue.targetAt + window.good
  if (nowMs <= liveEnd) return true
  if (hasVerdict && nowMs <= liveEnd + splashTailMs) return true
  return false
}
