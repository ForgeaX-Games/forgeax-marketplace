import { describe, it, expect } from 'vitest'
import { computeVideoTrim } from '../timeline/computeVideoTrim'

/*
 * 覆盖矩阵：
 *   · 左 handle：向右拖（正 delta）= 丢更多视频头，offset ↑、clip ↓
 *                 向左拖（负 delta）= 恢复头，offset ↓、clip ↑
 *                 出点时刻（offset + clip）保持不变
 *   · 右 handle：向右拖 = 放长裁剪段，clip ↑，offset 不变
 *                 向左拖 = 裁更多尾，clip ↓，offset 不变
 *   · 边界：offset ≥ 0、clip ≥ MIN_CLIP_MS=100
 */

describe('computeVideoTrim · 左 handle（入点）', () => {
  it('向右拖 +500ms → offset 加 500、clip 减 500（出点不动）', () => {
    const r = computeVideoTrim('left', 1000, 5000, 500)
    expect(r).toEqual({ offsetMs: 1500, clipDurationMs: 4500 })
    expect(r.offsetMs + r.clipDurationMs).toBe(6000) // 出点守恒
  })

  it('向左拖 -300ms → offset 减 300、clip 加 300', () => {
    const r = computeVideoTrim('left', 1000, 5000, -300)
    expect(r).toEqual({ offsetMs: 700, clipDurationMs: 5300 })
  })

  it('向左超出 offset=0 边界 → offset 夹 0、clip = 原出点', () => {
    const r = computeVideoTrim('left', 200, 5000, -9999)
    expect(r.offsetMs).toBe(0)
    expect(r.clipDurationMs).toBe(5200) // 出点 = 200+5000 = 5200
  })

  it('向右超出 clip=100 下限 → offset 夹住保留 100ms clip', () => {
    const r = computeVideoTrim('left', 1000, 5000, 9999)
    // 出点 6000，下限 100 → offset 最多 5900
    expect(r.offsetMs).toBe(5900)
    expect(r.clipDurationMs).toBe(100)
  })
})

describe('computeVideoTrim · 右 handle（出点）', () => {
  it('向右拖 +1000 → clip 加 1000、offset 不变', () => {
    expect(computeVideoTrim('right', 1000, 5000, 1000)).toEqual({
      offsetMs: 1000,
      clipDurationMs: 6000,
    })
  })

  it('向左拖 -2000 → clip 减 2000、offset 不变', () => {
    expect(computeVideoTrim('right', 1000, 5000, -2000)).toEqual({
      offsetMs: 1000,
      clipDurationMs: 3000,
    })
  })

  it('向左越过 clip=100 下限 → clip 夹 100', () => {
    expect(computeVideoTrim('right', 1000, 5000, -9999)).toEqual({
      offsetMs: 1000,
      clipDurationMs: 100,
    })
  })
})

describe('computeVideoTrim · 原视频时长上限（v3.9.1）', () => {
  it('右 handle 向右拖超过 naturalDuration → clip 夹到 natural-offset', () => {
    // 原视频 30s，当前 offset=1s、clip=5s；拖 +100s → 理应夹到 clip=29s（30-1）
    const r = computeVideoTrim('right', 1000, 5000, 100_000, 30_000)
    expect(r.offsetMs).toBe(1000)
    expect(r.clipDurationMs).toBe(29_000)
  })

  it('右 handle 在 natural 范围内不受影响', () => {
    const r = computeVideoTrim('right', 1000, 5000, 2000, 30_000)
    expect(r.clipDurationMs).toBe(7000)
  })

  it('natural 未传（旧数据）→ 无上限（向后兼容）', () => {
    const r = computeVideoTrim('right', 1000, 5000, 100_000)
    expect(r.clipDurationMs).toBe(105_000)
  })

  it('左 handle 不受 natural 上限影响（只管入点不动出点不过 natural）', () => {
    // 左 handle 改 offset，不直接接触 natural 边界（出点本来就在原范围内）
    const r = computeVideoTrim('left', 1000, 5000, 500, 30_000)
    expect(r).toEqual({ offsetMs: 1500, clipDurationMs: 4500 })
  })
})

describe('computeVideoTrim · 非法输入兜底', () => {
  it('初始 offset 负 → 夹 0', () => {
    const r = computeVideoTrim('right', -100, 5000, 0)
    expect(r.offsetMs).toBe(0)
  })

  it('初始 clip 过小 → 夹 100', () => {
    const r = computeVideoTrim('right', 1000, 50, 0)
    expect(r.clipDurationMs).toBeGreaterThanOrEqual(100)
  })
})
