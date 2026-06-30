import { describe, it, expect } from 'vitest'
import {
  clipFloorSec,
  settleClipDurationSec,
  planClipSegments,
} from '../settleClipDuration'
import { getCapability, type ModelCapability } from '../modelCapabilities'

const seedance2 = getCapability('seedance-2-0')
const seedance2fast = getCapability('seedance-2-0-fast')

describe('clipFloorSec', () => {
  it('优先取官方时长区间下限 durationRangeSec[0]', () => {
    expect(clipFloorSec(seedance2)).toBe(4)
    expect(clipFloorSec(seedance2fast)).toBe(4)
  })
  it('无 durationRangeSec 时回退 minUsefulClipSec', () => {
    const cap = { minUsefulClipSec: 3, maxSingleClipSec: 10 } as ModelCapability
    expect(clipFloorSec(cap)).toBe(3)
  })
  it('两者都缺时回退 4', () => {
    const cap = { maxSingleClipSec: 10 } as ModelCapability
    expect(clipFloorSec(cap)).toBe(4)
  })
})

describe('settleClipDurationSec · 单段结算（宁多勿少）', () => {
  it('3.2 → 4（向上取整 + min floor）', () => {
    expect(settleClipDurationSec(3.2, seedance2)).toBe(4)
  })
  it('5 → 5（区间内整数原样）', () => {
    expect(settleClipDurationSec(5, seedance2)).toBe(5)
  })
  it('15.9 → 15（夹到上限）', () => {
    expect(settleClipDurationSec(15.9, seedance2)).toBe(15)
  })
  it('小数一律向上取整（5.1 → 6）', () => {
    expect(settleClipDurationSec(5.1, seedance2)).toBe(6)
  })
  it('低于 floor 的需求被抬到 floor（1 → 4）', () => {
    expect(settleClipDurationSec(1, seedance2)).toBe(4)
  })
  it('非法输入回退 floor（NaN / 0 / 负 → 4）', () => {
    expect(settleClipDurationSec(Number.NaN, seedance2)).toBe(4)
    expect(settleClipDurationSec(0, seedance2)).toBe(4)
    expect(settleClipDurationSec(-3, seedance2)).toBe(4)
  })
  it('fast 档上限 12（13 → 12）', () => {
    expect(settleClipDurationSec(13, seedance2fast)).toBe(12)
  })
})

describe('planClipSegments · 分段结算', () => {
  it('30 → [15,15]（均分到上限）', () => {
    expect(planClipSegments(30, seedance2)).toEqual([15, 15])
  })
  it('22 → [11,11]（均分，无 <4 尾巴）', () => {
    expect(planClipSegments(22, seedance2)).toEqual([11, 11])
  })
  it('6 → [6]（单段可容）', () => {
    expect(planClipSegments(6, seedance2)).toEqual([6])
  })
  it('2 → [4]（单段但抬到 floor）', () => {
    expect(planClipSegments(2, seedance2)).toEqual([4])
  })
  it('末段不留 <floor 的尾巴（31 → 不是 [15,15,1]）', () => {
    const segs = planClipSegments(31, seedance2)
    expect(segs.every((s) => s >= 4)).toBe(true)
    expect(segs.reduce((a, b) => a + b, 0)).toBe(31)
    expect(segs).toEqual([11, 10, 10])
  })
  it('每段都 ≤ max 且 ≥ floor', () => {
    for (const total of [16, 25, 40, 47, 60]) {
      const segs = planClipSegments(total, seedance2)
      expect(segs.every((s) => s >= 4 && s <= 15)).toBe(true)
    }
  })
  it('非法输入 → []', () => {
    expect(planClipSegments(0, seedance2)).toEqual([])
    expect(planClipSegments(-5, seedance2)).toEqual([])
    expect(planClipSegments(Number.NaN, seedance2)).toEqual([])
  })
  it('fast 档按 max=12 分段（30 → [10,10,10]）', () => {
    expect(planClipSegments(30, seedance2fast)).toEqual([10, 10, 10])
  })
})
