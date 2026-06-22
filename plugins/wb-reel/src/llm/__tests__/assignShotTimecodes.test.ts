import { describe, it, expect } from 'vitest'
import { assignShotTimecodes } from '../assignShotTimecodes'
import type { Shot } from '../../scenario/types'

function shot(id: string, order: number, durationSec?: number): Shot {
  return { id, order, framing: 'medium', prompt: `p-${id}`, durationSec }
}

describe('assignShotTimecodes', () => {
  it('空数组返回空', () => {
    expect(assignShotTimecodes([], 50000)).toEqual([])
  })

  it('首镜 startMs=0、末镜 endMs 正好等于场景时长', () => {
    const out = assignShotTimecodes(
      [shot('a', 0, 2), shot('b', 1, 4), shot('c', 2, 4)],
      10000,
    )
    expect(out[0].startMs).toBe(0)
    expect(out[out.length - 1].endMs).toBe(10000)
  })

  it('按 durationSec 占比分配区间长度', () => {
    const out = assignShotTimecodes(
      [shot('a', 0, 2), shot('b', 1, 8)],
      10000,
    )
    // a 占 2/10 → ~2000；b 占 8/10 → 收尾到 10000
    expect(out[0].endMs).toBe(2000)
    expect(out[1].startMs).toBe(2000)
    expect(out[1].endMs).toBe(10000)
  })

  it('全部缺 durationSec 时等分', () => {
    const out = assignShotTimecodes(
      [shot('a', 0), shot('b', 1), shot('c', 2), shot('d', 3)],
      8000,
    )
    expect(out.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 2000],
      [2000, 4000],
      [4000, 6000],
      [6000, 8000],
    ])
  })

  it('混合缺省：缺 durationSec 的用已知均值兜底，区间单调铺满', () => {
    const out = assignShotTimecodes(
      [shot('a', 0, 4), shot('b', 1), shot('c', 2, 4)],
      12000,
    )
    // b 缺省 → 兜底均值 4 → 三镜各 4s → 等分到 12000
    expect(out[0].startMs).toBe(0)
    expect(out[2].endMs).toBe(12000)
    // 单调不减
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThanOrEqual(out[i - 1].endMs - 1)
      expect(out[i].endMs).toBeGreaterThanOrEqual(out[i].startMs)
    }
  })

  it('保留原 shot 其它字段', () => {
    const s: Shot = {
      id: 'x',
      order: 0,
      framing: 'wide',
      prompt: 'hello',
      durationSec: 5,
      continuityGroupId: 'g1',
    }
    const [out] = assignShotTimecodes([s], 5000)
    expect(out.id).toBe('x')
    expect(out.framing).toBe('wide')
    expect(out.prompt).toBe('hello')
    expect(out.continuityGroupId).toBe('g1')
    expect(out.startMs).toBe(0)
    expect(out.endMs).toBe(5000)
  })

  it('零/负时长场景按 1ms 兜底不崩', () => {
    const out = assignShotTimecodes([shot('a', 0, 3)], 0)
    expect(out[0].startMs).toBe(0)
    expect(out[0].endMs).toBe(1)
  })
})
