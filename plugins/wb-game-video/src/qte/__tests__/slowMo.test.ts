import { describe, expect, it } from 'vitest'
import {
  computeCueWindow,
  cueSlowMoFailed,
  firstFailedSlowMoCue,
  resolveActiveSlowMo,
} from '../slowMo'
import type { QTECue, QTEHitWindow } from '../../scenario/types'
import type { HitVerdict } from '../QTEEngine'

const W: QTEHitWindow = { perfect: 80, great: 160, good: 280 }

function tap(id: string, appearAt: number, targetAt: number, slowMoCfg?: QTECue['slowMo']): QTECue {
  return {
    id,
    shape: 'tap',
    x: 0.5,
    y: 0.5,
    appearAt,
    targetAt,
    slowMo: slowMoCfg,
  }
}

function verdict(cueId: string, judgement: HitVerdict['judgement'], deltaMs = 0): HitVerdict {
  return { cueId, judgement, deltaMs, score: 0, timing: 'ON' }
}

describe('computeCueWindow', () => {
  it('cue 没有 slowMo 时返回 null', () => {
    const c = tap('a', 1000, 1500)
    expect(computeCueWindow(c, W, undefined)).toBeNull()
  })

  it('rate >= 1 视为关闭', () => {
    const c = tap('a', 1000, 1500, { rate: 1 })
    expect(computeCueWindow(c, W, undefined)).toBeNull()
  })

  it('未命中：窗口 = [appearAt - leadIn, targetAt + good]', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3, leadInMs: 200 })
    const w = computeCueWindow(c, W, undefined)!
    expect(w).toEqual({ cueId: 'a', rate: 0.3, enter: 800, exit: 1500 + W.good })
  })

  it('命中：尾巴 = hitAt + holdAfterHitMs', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3, leadInMs: 100, holdAfterHitMs: 600 })
    const v = verdict('a', 'PERFECT', -20) // 提前 20ms 命中
    const w = computeCueWindow(c, W, v)!
    expect(w.enter).toBe(900)
    expect(w.exit).toBe(1500 - 20 + 600) // hitAt = 1480
  })

  it('命中且 holdAfterHitMs 未设：命中即结束', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    const v = verdict('a', 'GREAT', 50)
    const w = computeCueWindow(c, W, v)!
    expect(w.exit).toBe(1550)
  })

  it('rate 被钳到 [0.05, 1)', () => {
    const c = tap('a', 1000, 1500, { rate: 0.001 })
    expect(computeCueWindow(c, W, undefined)?.rate).toBe(0.05)
  })
})

describe('resolveActiveSlowMo', () => {
  it('没有 slowMo cue → 不慢放', () => {
    const r = resolveActiveSlowMo([tap('a', 1000, 1500)], W, [], 1100)
    expect(r.active).toBe(false)
    expect(r.rate).toBe(1)
  })

  it('elapsed 在 cue 慢放窗口里 → active', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3, leadInMs: 200 })
    const r = resolveActiveSlowMo([c], W, [], 1200)
    expect(r.active).toBe(true)
    expect(r.rate).toBe(0.3)
    expect(r.activeCueId).toBe('a')
    expect(r.windowProgress).toBeGreaterThan(0)
    expect(r.windowProgress).toBeLessThan(1)
  })

  it('elapsed 在窗口外（之前/之后）→ inactive', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    expect(resolveActiveSlowMo([c], W, [], 500).active).toBe(false)
    expect(resolveActiveSlowMo([c], W, [], 1500 + W.good + 50).active).toBe(false)
  })

  it('两 cue 重叠 → 取最慢（rate 最小）', () => {
    const a = tap('a', 1000, 1500, { rate: 0.5 })
    const b = tap('b', 1100, 1600, { rate: 0.25 })
    const r = resolveActiveSlowMo([a, b], W, [], 1300)
    expect(r.activeCueId).toBe('b')
    expect(r.rate).toBe(0.25)
  })

  it('已命中且 holdAfterHitMs=0 → 命中后立刻退出慢放', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    const v = verdict('a', 'PERFECT', 0)
    // 命中那一刻仍在窗口内（exit=1500），刚好相等：算 active；之后 inactive
    expect(resolveActiveSlowMo([c], W, [v], 1500).active).toBe(true)
    expect(resolveActiveSlowMo([c], W, [v], 1501).active).toBe(false)
  })
})

describe('cueSlowMoFailed', () => {
  it('cue 没 slowMo → 永远不 fail', () => {
    expect(cueSlowMoFailed(tap('a', 1000, 1500), W, undefined, 99999)).toBe(false)
  })

  it('requireHit=false → 即使 MISS 也不 fail', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3, requireHit: false })
    const v = verdict('a', 'MISS', Number.POSITIVE_INFINITY)
    expect(cueSlowMoFailed(c, W, v, 5000)).toBe(false)
  })

  it('未到末尾 → 不 fail', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    expect(cueSlowMoFailed(c, W, undefined, 1500)).toBe(false)
  })

  it('过末尾且无 verdict → fail', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    expect(cueSlowMoFailed(c, W, undefined, 1500 + W.good + 1)).toBe(true)
  })

  it('过末尾且 MISS → fail', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    const v = verdict('a', 'MISS', Number.POSITIVE_INFINITY)
    expect(cueSlowMoFailed(c, W, v, 5000)).toBe(true)
  })

  it('过末尾但已命中（GOOD）→ 不 fail', () => {
    const c = tap('a', 1000, 1500, { rate: 0.3 })
    const v = verdict('a', 'GOOD', 100)
    expect(cueSlowMoFailed(c, W, v, 5000)).toBe(false)
  })
})

describe('firstFailedSlowMoCue', () => {
  it('多个 fail → 取 targetAt 最早那一个', () => {
    const a = tap('a', 1000, 1500, { rate: 0.3 })
    const b = tap('b', 2000, 2500, { rate: 0.3 })
    expect(firstFailedSlowMoCue([a, b], W, [], 9999)?.id).toBe('a')
  })

  it('全员命中 → null', () => {
    const a = tap('a', 1000, 1500, { rate: 0.3 })
    const va = verdict('a', 'PERFECT', 0)
    expect(firstFailedSlowMoCue([a], W, [va], 9999)).toBeNull()
  })
})
