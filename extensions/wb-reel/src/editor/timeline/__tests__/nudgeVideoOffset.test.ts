import { describe, it, expect } from 'vitest'
import { nudgeVideoOffset } from '../nudgeVideoOffset'

describe('nudgeVideoOffset', () => {
  describe('基本平移', () => {
    it('向右平移 100ms · 未封顶时直接加', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 0,
          clipDurationMs: 5000,
          deltaMs: 100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(100)
    })

    it('向左平移 100ms · 从 500 回到 400', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 500,
          clipDurationMs: 5000,
          deltaMs: -100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(400)
    })

    it('Shift=10ms 精细步长', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 1000,
          clipDurationMs: 5000,
          deltaMs: 10,
          naturalDurationMs: 30_000,
        }),
      ).toBe(1010)
    })

    it('Alt=500ms 大步', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 0,
          clipDurationMs: 5000,
          deltaMs: 500,
          naturalDurationMs: 30_000,
        }),
      ).toBe(500)
    })
  })

  describe('边界保护', () => {
    it('左边界：offset 不能为负', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 50,
          clipDurationMs: 5000,
          deltaMs: -100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(0)
    })

    it('右边界：offset + clip 不能超过 naturalDuration', () => {
      // natural 30s, clip 5s → maxOffset = 25s；试图挪到 26s
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 25_000,
          clipDurationMs: 5000,
          deltaMs: 1000,
          naturalDurationMs: 30_000,
        }),
      ).toBe(25_000)
    })

    it('右边界：已经到最大值时继续向右 = 保持不动', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 25_000,
          clipDurationMs: 5000,
          deltaMs: 500,
          naturalDurationMs: 30_000,
        }),
      ).toBe(25_000)
    })

    it('clip 刚好等于 natural → 无法平移（maxOffset=0）', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 0,
          clipDurationMs: 30_000,
          deltaMs: 100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(0)
    })

    it('natural 未知 → 不封顶（向后兼容旧数据）', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 25_000,
          clipDurationMs: 5000,
          deltaMs: 10_000,
        }),
      ).toBe(35_000)
    })

    it('naturalDuration=0 视为未知（防脏数据）', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 100,
          clipDurationMs: 5000,
          deltaMs: 100,
          naturalDurationMs: 0,
        }),
      ).toBe(200)
    })
  })

  describe('异常输入防御', () => {
    it('负数 offset 输入 → 被钳到 0 再平移', () => {
      // safeOffset = max(0, -50) = 0；delta=100 → 100
      expect(
        nudgeVideoOffset({
          currentOffsetMs: -50,
          clipDurationMs: 5000,
          deltaMs: 100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(100)
    })

    it('负 clip 钳到 0 → 仍能用 natural 做上限计算', () => {
      expect(
        nudgeVideoOffset({
          currentOffsetMs: 0,
          clipDurationMs: -1000,
          deltaMs: 100,
          naturalDurationMs: 30_000,
        }),
      ).toBe(100)
    })
  })
})
