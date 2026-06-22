import { describe, expect, it } from 'vitest'
import {
  clampMs,
  pxToMs,
  msToPx,
  snapMs,
  resolveSnapGridMs,
} from '../timelineMath'

describe('pxToMs', () => {
  it('0 像素 = 0 毫秒', () => {
    expect(pxToMs(0, 5000, 800)).toBe(0)
  })

  it('一半轨道 = 一半时长（保留小数）', () => {
    expect(pxToMs(400, 5000, 800)).toBe(2500)
  })

  it('整条轨道 = 总时长', () => {
    expect(pxToMs(800, 5000, 800)).toBe(5000)
  })

  it('比例换算 —— 任意 px → ms', () => {
    expect(pxToMs(160, 1000, 320)).toBe(500)
  })

  it('支持负数（往左拖）', () => {
    expect(pxToMs(-200, 4000, 800)).toBe(-1000)
  })

  it('totalMs 为 0 时返回 0（避免除 0）', () => {
    expect(pxToMs(100, 0, 800)).toBe(0)
  })

  it('trackWidthPx 为 0 时返回 0（避免除 0）', () => {
    expect(pxToMs(100, 5000, 0)).toBe(0)
  })

  it('trackWidthPx 为负数时回退为 0', () => {
    expect(pxToMs(100, 5000, -800)).toBe(0)
  })
})

describe('msToPx —— pxToMs 的逆运算', () => {
  it('0 毫秒 = 0 像素', () => {
    expect(msToPx(0, 5000, 800)).toBe(0)
  })

  it('一半时长 = 一半轨道', () => {
    expect(msToPx(2500, 5000, 800)).toBe(400)
  })

  it('与 pxToMs 自反 —— 任意值 round trip 精度无损', () => {
    expect(msToPx(pxToMs(123, 9000, 540), 9000, 540)).toBeCloseTo(123, 6)
  })

  it('totalMs 为 0 时返回 0', () => {
    expect(msToPx(500, 0, 800)).toBe(0)
  })
})

describe('clampMs', () => {
  it('值在范围内 → 原样返回', () => {
    expect(clampMs(120, 0, 1000)).toBe(120)
  })

  it('值小于 min → 返回 min', () => {
    expect(clampMs(-50, 0, 1000)).toBe(0)
  })

  it('值大于 max → 返回 max', () => {
    expect(clampMs(2000, 0, 1000)).toBe(1000)
  })

  it('刚好等于 min/max → 保留', () => {
    expect(clampMs(0, 0, 1000)).toBe(0)
    expect(clampMs(1000, 0, 1000)).toBe(1000)
  })

  it('min > max 时退回 min（避免 NaN）', () => {
    expect(clampMs(500, 1000, 200)).toBe(1000)
  })

  it('NaN 值被规整为 min', () => {
    expect(clampMs(Number.NaN, 0, 1000)).toBe(0)
  })
})

describe('snapMs', () => {
  it('grid <= 0 或 undefined → 不吸附', () => {
    expect(snapMs(143, 0)).toBe(143)
    expect(snapMs(143, -1)).toBe(143)
    expect(snapMs(143, undefined)).toBe(143)
  })

  it('100ms 网格 —— 143 → 100', () => {
    expect(snapMs(143, 100)).toBe(100)
  })

  it('100ms 网格 —— 180 → 200（四舍五入）', () => {
    expect(snapMs(180, 100)).toBe(200)
  })

  it('100ms 网格 —— 150 → 200（向上 banker 半进位）', () => {
    expect(snapMs(150, 100)).toBe(200)
  })

  it('250ms 网格 —— 660 → 750', () => {
    expect(snapMs(660, 250)).toBe(750)
  })

  it('支持负数', () => {
    expect(snapMs(-180, 100)).toBe(-200)
    expect(snapMs(-143, 100)).toBe(-100)
  })

  it('完全对齐网格 → 不动', () => {
    expect(snapMs(500, 100)).toBe(500)
  })
})

describe('resolveSnapGridMs —— 修饰键决定吸附粒度', () => {
  it('默认（无修饰键）= 100ms', () => {
    expect(resolveSnapGridMs({ shift: false, alt: false })).toBe(100)
  })

  it('Shift 按下 → 10ms（更精细）', () => {
    expect(resolveSnapGridMs({ shift: true, alt: false })).toBe(10)
  })

  it('Alt 按下 → 500ms（更粗粒度）', () => {
    expect(resolveSnapGridMs({ shift: false, alt: true })).toBe(500)
  })

  it('Shift 优先于 Alt', () => {
    expect(resolveSnapGridMs({ shift: true, alt: true })).toBe(10)
  })
})
