import { describe, expect, it } from 'vitest'
import {
  CUE_RING_TARGET_SCALE,
  cueIsExpired,
  cueIsLive,
  cuePhase,
  cueProgress,
  cueRingScale,
  judgeHold,
  judgeTap,
  shouldRenderCue,
  shouldRunExpiryCheck,
  tallyQTE,
} from '../QTEEngine'
import type { QTECue, QTESpec } from '../../scenario/types'

const window = { perfect: 50, great: 120, good: 240 }
const score = { perfect: 100, great: 60, good: 30, miss: -20 }

const tap = (over: Partial<QTECue> = {}): QTECue => ({
  id: 'c1',
  shape: 'tap',
  x: 0.5,
  y: 0.5,
  appearAt: 0,
  targetAt: 1000,
  ...over,
})

describe('judgeTap', () => {
  it('PERFECT 当 |delta| <= window.perfect', () => {
    const v = judgeTap(tap(), window, score, 30)
    expect(v.judgement).toBe('PERFECT')
    expect(v.score).toBe(100)
    expect(v.timing).toBe('LATE')
  })

  it('提前点用绝对值判定，但 timing=EARLY', () => {
    const v = judgeTap(tap(), window, score, -45)
    expect(v.judgement).toBe('PERFECT')
    expect(v.timing).toBe('EARLY')
  })

  it('GREAT 当 perfect < |delta| <= great', () => {
    const v = judgeTap(tap(), window, score, 100)
    expect(v.judgement).toBe('GREAT')
    expect(v.score).toBe(60)
  })

  it('GOOD 当 great < |delta| <= good', () => {
    const v = judgeTap(tap(), window, score, -200)
    expect(v.judgement).toBe('GOOD')
    expect(v.timing).toBe('EARLY')
  })

  it('MISS 当 |delta| > good', () => {
    const v = judgeTap(tap(), window, score, 400)
    expect(v.judgement).toBe('MISS')
    expect(v.score).toBe(-20)
    expect(v.timing).toBe('NONE')
  })

  it('从未点击（infinity）也是 MISS', () => {
    const v = judgeTap(tap(), window, score, Number.POSITIVE_INFINITY)
    expect(v.judgement).toBe('MISS')
    expect(v.score).toBe(-20)
  })

  it('完全准确 (delta=0) 是 ON', () => {
    const v = judgeTap(tap(), window, score, 0)
    expect(v.timing).toBe('ON')
    expect(v.judgement).toBe('PERFECT')
  })
})

describe('judgeHold', () => {
  const holdCue = tap({ shape: 'hold', durationMs: 800 })

  // v3.7 放宽"hold 的唯一使命是按够时长"：
  //   · 起手早/晚完全不参与判定（UI 的 timing 字段仍反馈 EARLY/LATE 做视觉提示）
  //   · 时长偏差超出 great 窗统一兜底到 GOOD，不再出 MISS
  //   · auto-release（按满时长）视为 PERFECT
  //   · 不按的 hold 由 QTEOverlay 跳过 expiry，完全不出现在 verdict 里

  it('按住满目标时长 → PERFECT（auto-release 场景）', () => {
    const v = judgeHold(holdCue, window, score, 0, 800)
    expect(v.judgement).toBe('PERFECT')
    expect(v.score).toBe(100)
  })

  it('提前按下 + 按住满目标时长 → 依然 PERFECT（起手时刻不再惩罚）', () => {
    const v = judgeHold(holdCue, window, score, -900, 800)
    expect(v.judgement).toBe('PERFECT')
  })

  it('时长偏离在 great 内 → GREAT', () => {
    // holdMs 偏离 800 达 100ms（在 great=120 内）
    const v = judgeHold(holdCue, window, score, 0, 700)
    expect(v.judgement).toBe('GREAT')
    expect(v.score).toBe(60)
  })

  it('时长偏离在 good 内 → GOOD', () => {
    // holdMs 偏离 800 达 200ms（在 good=240 内）
    const v = judgeHold(holdCue, window, score, 0, 1000)
    expect(v.judgement).toBe('GOOD')
    expect(v.score).toBe(30)
  })

  it('时长偏离超出 good → 仍然 GOOD（兜底，不再 MISS）', () => {
    // holdMs 偏离 800 达 500ms；v3.7 以后不再因为差距给 MISS
    const v = judgeHold(holdCue, window, score, 0, 1300)
    expect(v.judgement).toBe('GOOD')
    expect(v.score).toBe(30)
  })

  it('按得很晚也不再 MISS（起手时刻不参与判定）', () => {
    // startDelta=600（> good=240），旧版本会直接 MISS；新版本看时长
    const v = judgeHold(holdCue, window, score, 600, 800)
    expect(v.judgement).toBe('PERFECT')
    expect(v.timing).toBe('LATE')
  })

  it('cue 没设 durationMs 时退化成 tap', () => {
    const v = judgeHold(tap({ shape: 'hold' }), window, score, 30, 1000)
    expect(v.judgement).toBe('PERFECT')
  })
})

describe('tallyQTE', () => {
  const spec: QTESpec = {
    cues: [],
    window,
    score,
    passingScore: 150,
  }
  it('累加并且未到 passingScore 时 passed=false', () => {
    const verdicts = [
      judgeTap(tap({ id: 'a' }), window, score, 0),  // 100
      judgeTap(tap({ id: 'b' }), window, score, 200), // GOOD = 30
    ]
    const run = tallyQTE(spec, verdicts)
    expect(run.total).toBe(130)
    expect(run.passed).toBe(false)
    expect(run.perfect).toBe(1)
    expect(run.good).toBe(1)
  })

  it('passingScore 为空时永远 passed', () => {
    const run = tallyQTE({ ...spec, passingScore: undefined }, [
      judgeTap(tap(), window, score, 999),
    ])
    expect(run.passed).toBe(true)
  })
})

describe('cueProgress / cueIsLive / cueIsExpired', () => {
  const c = tap({ appearAt: 1000, targetAt: 2000 })

  it('progress 在 appearAt=0、targetAt=1', () => {
    expect(cueProgress(c, 1000)).toBeCloseTo(0)
    expect(cueProgress(c, 1500)).toBeCloseTo(0.5)
    expect(cueProgress(c, 2000)).toBeCloseTo(1)
    expect(cueProgress(c, 2200)).toBeGreaterThan(1)
  })

  it('cueIsLive 覆盖 [appearAt, targetAt + window.good]', () => {
    expect(cueIsLive(c, window, 999)).toBe(false)
    expect(cueIsLive(c, window, 1000)).toBe(true)
    expect(cueIsLive(c, window, 2240)).toBe(true)
    expect(cueIsLive(c, window, 2241)).toBe(false)
  })

  it('cueIsExpired 在过命中点 + good 后', () => {
    expect(cueIsExpired(c, window, 2240)).toBe(false)
    expect(cueIsExpired(c, window, 2241)).toBe(true)
  })
})

describe('cuePhase —— 编辑器/玩家 marker 可见性状态机', () => {
  const c = tap({ appearAt: 1000, targetAt: 2000 })

  it('appearAt 之前 → before（marker 必须完全隐形，否则就是用户截图里的 bug）', () => {
    expect(cuePhase(c, window, 0)).toBe('before')
    expect(cuePhase(c, window, 999)).toBe('before')
  })

  it('appearAt..targetAt → incoming（外环正在收缩）', () => {
    expect(cuePhase(c, window, 1000)).toBe('incoming')
    expect(cuePhase(c, window, 1500)).toBe('incoming')
    expect(cuePhase(c, window, 2000)).toBe('incoming')
  })

  it('targetAt..targetAt+good → window（贴脸命中尾窗）', () => {
    expect(cuePhase(c, window, 2001)).toBe('window')
    expect(cuePhase(c, window, 2240)).toBe('window')
  })

  it('过 good 窗口 → after（应该消失，不留鬼影）', () => {
    expect(cuePhase(c, window, 2241)).toBe('after')
    expect(cuePhase(c, window, 9999)).toBe('after')
  })
})

/**
 * 这两个函数是为了修一个非常具体的 bug：
 *
 *   - 玩家在 intro（无 QTE）上 elapsed 推进到 11000ms，然后选 "撬开锁" 进 pry（含 QTE）。
 *   - 此时 React 还没把 elapsed 重置到 0，QTEOverlay 第一次 mount 就拿到 elapsed=11000。
 *   - 旧代码直接对 pry 所有 cue 跑 `cueIsExpired`，11000 > 任何 cue 的 targetAt+good，
 *     于是 emit 一堆 MISS verdict。带 slowMo.requireHit 的 cue 立刻被判失败，弹结算屏。
 *
 * 修复思路：expired 检测只在 elapsed **单调向前** 推进时跑；时间倒退（场景切换 / replay）
 * 或第一次见到 spec（prev=null）时跳过这一拍。这样切场景的"瞬态错位"不会污染 verdicts。
 */
describe('shouldRunExpiryCheck —— 防止场景切换瞬间误判 MISS', () => {
  it('第一次见到 spec（prev=null）→ false，让 elapsed 自然归零再开始检测', () => {
    expect(shouldRunExpiryCheck(null, 0)).toBe(false)
    expect(shouldRunExpiryCheck(null, 9999)).toBe(false)
  })

  it('时间倒退（场景切换 / replay）→ false', () => {
    expect(shouldRunExpiryCheck(11000, 0)).toBe(false)
    expect(shouldRunExpiryCheck(500, 100)).toBe(false)
  })

  it('时间正常向前 → true', () => {
    expect(shouldRunExpiryCheck(0, 16)).toBe(true)
    expect(shouldRunExpiryCheck(1000, 1033)).toBe(true)
  })

  it('时间不动（同一拍）→ true，允许在到达边界那一刻检测', () => {
    expect(shouldRunExpiryCheck(2240, 2240)).toBe(true)
  })
})

describe('shouldRenderCue —— cue 显示窗口（含 splash 尾巴），杜绝 resolved 永驻', () => {
  const c = tap({ appearAt: 1000, targetAt: 2000 })
  const splashTail = 800

  it('appearAt 之前 → 不渲染（不管有没有 verdict）', () => {
    expect(shouldRenderCue(c, window, 500, false, splashTail)).toBe(false)
    expect(shouldRenderCue(c, window, 500, true, splashTail)).toBe(false)
  })

  it('在 [appearAt, targetAt+good] 内 → 渲染', () => {
    expect(shouldRenderCue(c, window, 1000, false, splashTail)).toBe(true)
    expect(shouldRenderCue(c, window, 1500, false, splashTail)).toBe(true)
    expect(shouldRenderCue(c, window, 2240, false, splashTail)).toBe(true)
  })

  it('过 good 窗口、未 resolved → 不渲染（关键：杜绝 11000ms 误显示）', () => {
    expect(shouldRenderCue(c, window, 2241, false, splashTail)).toBe(false)
    expect(shouldRenderCue(c, window, 11000, false, splashTail)).toBe(false)
  })

  it('过 good 窗口、已 resolved 且在 splash 尾巴内 → 渲染（让 PERFECT/MISS 飘字播完）', () => {
    expect(shouldRenderCue(c, window, 2500, true, splashTail)).toBe(true)
    expect(shouldRenderCue(c, window, 2240 + splashTail, true, splashTail)).toBe(true)
  })

  it('已 resolved 但超过 splash 尾巴 → 不渲染（这是修掉 "resolved 永驻" 的关键）', () => {
    expect(shouldRenderCue(c, window, 2240 + splashTail + 1, true, splashTail)).toBe(false)
    expect(shouldRenderCue(c, window, 11000, true, splashTail)).toBe(false)
  })
})

/**
 * 修一个非常具体的 UX bug：原本飞入环 scale 终点是 0.95（91px），
 * 目标环固定在 38%（36px）—— 两者永远不会重叠。玩家肉眼无法判断
 * "外环缩到哪儿才算最佳命中"。
 *
 * 正确设计（音游标准）：
 *   - progress = 0       → 外环最外圈（scale = 2.4，飞入起点）
 *   - progress = 1       → 外环 *精确* 等于目标环（CUE_RING_TARGET_SCALE）→ PERFECT 时机
 *   - progress > 1       → 外环继续向内缩（提示已过命中点）
 *   - progress >> 1      → 外环最小（clamp 到 0.3 防止消失）
 */
describe('cueRingScale —— 外环飞入到目标环正中重合即 PERFECT 时机', () => {
  it('progress=0 时外环在最外（飞入起点）', () => {
    expect(cueRingScale(0)).toBeCloseTo(2.4)
  })

  it('progress=1 时外环 *精确* 等于目标环（PERFECT 时刻外环对齐目标框）', () => {
    expect(cueRingScale(1)).toBeCloseTo(CUE_RING_TARGET_SCALE)
  })

  it('progress 单调：0 < progress < 1 时严格大于目标环', () => {
    expect(cueRingScale(0.5)).toBeGreaterThan(CUE_RING_TARGET_SCALE)
    expect(cueRingScale(0.9)).toBeGreaterThan(CUE_RING_TARGET_SCALE)
  })

  it('progress > 1 时外环继续向内缩（提示已经飞过命中点）', () => {
    expect(cueRingScale(1.05)).toBeLessThan(CUE_RING_TARGET_SCALE)
    expect(cueRingScale(1.2)).toBeLessThan(cueRingScale(1.05))
  })

  it('progress 极大时仍 clamp 到一个非零最小值（cue 不会塌成一个点消失）', () => {
    expect(cueRingScale(5)).toBeGreaterThan(0)
    expect(cueRingScale(99)).toBeGreaterThan(0)
  })
})
