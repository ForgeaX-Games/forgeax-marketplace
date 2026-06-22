import { describe, expect, it } from 'vitest'
import { resolveShotAtMs } from '../shotResolver'
import type { Shot } from '../../../scenario/types'

function makeShot(id: string, order: number, extra?: Partial<Shot>): Shot {
  return {
    id,
    order,
    framing: 'medium',
    prompt: '',
    ...extra,
  } as Shot
}

describe('resolveShotAtMs', () => {
  it('shots 为空返回 null', () => {
    expect(resolveShotAtMs([], 0, 5000)).toBeNull()
    expect(resolveShotAtMs(undefined, 0, 5000)).toBeNull()
  })

  it('所有 shot 无显式 span 时按 order 均分兜底（3 镜/6s）', () => {
    const shots = [makeShot('c', 2), makeShot('a', 0), makeShot('b', 1)]
    expect(resolveShotAtMs(shots, 0, 6000)).toBe('a')
    expect(resolveShotAtMs(shots, 1999, 6000)).toBe('a')
    expect(resolveShotAtMs(shots, 2000, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 3999, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 4000, 6000)).toBe('c')
    expect(resolveShotAtMs(shots, 5999, 6000)).toBe('c')
  })

  it('显式 startMs/endMs 优先区间命中（左闭右开）', () => {
    const shots = [
      makeShot('a', 0, { startMs: 0, endMs: 1500 }),
      makeShot('b', 1, { startMs: 1500, endMs: 4000 }),
      makeShot('c', 2, { startMs: 4000, endMs: 6000 }),
    ]
    expect(resolveShotAtMs(shots, 0, 6000)).toBe('a')
    expect(resolveShotAtMs(shots, 1499, 6000)).toBe('a')
    expect(resolveShotAtMs(shots, 1500, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 3999, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 4000, 6000)).toBe('c')
  })

  it('ms 超出末尾返回最后一个 shot', () => {
    const shots = [
      makeShot('a', 0, { startMs: 0, endMs: 2000 }),
      makeShot('b', 1, { startMs: 2000, endMs: 5000 }),
    ]
    expect(resolveShotAtMs(shots, 10_000, 5000)).toBe('b')
  })

  it('ms < 0 或 < 第一个 startMs 返回第一个 shot', () => {
    const shots = [
      makeShot('a', 0, { startMs: 500, endMs: 2000 }),
      makeShot('b', 1, { startMs: 2000, endMs: 5000 }),
    ]
    expect(resolveShotAtMs(shots, -100, 5000)).toBe('a')
    expect(resolveShotAtMs(shots, 200, 5000)).toBe('a')
  })

  it('混合态：部分有显式 span、部分没 —— 均按 shotSpan 兜底规则统一处理', () => {
    const shots = [
      makeShot('a', 0, { startMs: 0, endMs: 3000 }),
      makeShot('b', 1),
      makeShot('c', 2, { startMs: 4000, endMs: 6000 }),
    ]
    // b 的 span 按 order=1、总数=3、totalMs=6000 兜底到 [2000, 4000)
    expect(resolveShotAtMs(shots, 1000, 6000)).toBe('a')
    expect(resolveShotAtMs(shots, 3000, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 3999, 6000)).toBe('b')
    expect(resolveShotAtMs(shots, 4500, 6000)).toBe('c')
  })

  it('单镜：任何 ms 都返回它自己', () => {
    const shots = [makeShot('only', 0)]
    expect(resolveShotAtMs(shots, 0, 5000)).toBe('only')
    expect(resolveShotAtMs(shots, 2500, 5000)).toBe('only')
    expect(resolveShotAtMs(shots, 9999, 5000)).toBe('only')
  })

  it('order 未按数组顺序仍能正确排序', () => {
    const shots = [makeShot('last', 5), makeShot('first', 0), makeShot('mid', 2)]
    expect(resolveShotAtMs(shots, 0, 9000)).toBe('first')
    expect(resolveShotAtMs(shots, 5000, 9000)).toBe('mid')
    expect(resolveShotAtMs(shots, 7000, 9000)).toBe('last')
  })
})
