import { describe, expect, it } from 'vitest'
import {
  clampToScene,
  compactLeft,
  moveTo,
  resolveEndMs,
  splitAt,
} from '../editOps'

describe('editOps · splitAt', () => {
  it('合法切点 → 两段，首尾邻接', () => {
    const [l, r] = splitAt({ startMs: 0, endMs: 1000, foo: 1 }, 400)
    expect(l).toEqual({ startMs: 0, endMs: 400, foo: 1 })
    expect(r).toEqual({ startMs: 400, endMs: 1000, foo: 1 })
  })

  it('切点在起点或之前 → 保留原段，左空', () => {
    const [l, r] = splitAt({ startMs: 100, endMs: 500 }, 100)
    expect(l).toBeNull()
    expect(r).toEqual({ startMs: 100, endMs: 500 })
  })

  it('切点在终点或之后 → 保留原段，右空', () => {
    const [l, r] = splitAt({ startMs: 100, endMs: 500 }, 500)
    expect(l).toEqual({ startMs: 100, endMs: 500 })
    expect(r).toBeNull()
  })

  it('保留原对象的其它字段（浅拷贝）', () => {
    const [l, r] = splitAt({ startMs: 0, endMs: 10, ref: 'x', role: 'bgm' }, 4)
    expect(l).toMatchObject({ ref: 'x', role: 'bgm' })
    expect(r).toMatchObject({ ref: 'x', role: 'bgm' })
  })
})

describe('editOps · compactLeft', () => {
  it('空数组直接返回', () => {
    expect(compactLeft([])).toEqual([])
  })

  it('按 startMs 升序从 0 起紧挨，保留各 duration', () => {
    const out = compactLeft([
      { startMs: 2000, endMs: 2500 },
      { startMs: 300, endMs: 900 },
      { startMs: 3000, endMs: 3200 },
    ])
    expect(out.map((x) => [x.startMs, x.endMs])).toEqual([
      [0, 600],
      [600, 1100],
      [1100, 1300],
    ])
  })

  it('同 startMs → 原数组顺序稳定', () => {
    const out = compactLeft([
      { startMs: 100, endMs: 300, id: 'a' },
      { startMs: 100, endMs: 200, id: 'b' },
    ])
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('editOps · clampToScene', () => {
  it('正常 duration → 夹进 [0, total] 边界', () => {
    expect(
      clampToScene({ startMs: -200, endMs: 300 }, 1000),
    ).toMatchObject({ startMs: 0, endMs: 500 })
    expect(
      clampToScene({ startMs: 900, endMs: 1400 }, 1000),
    ).toMatchObject({ startMs: 500, endMs: 1000 })
  })

  it('duration 大于 total → 截到 [0, total]', () => {
    expect(
      clampToScene({ startMs: 100, endMs: 5000 }, 1000),
    ).toMatchObject({ startMs: 0, endMs: 1000 })
  })
})

describe('editOps · moveTo', () => {
  it('保持 duration，平移到目标起点（在边界内）', () => {
    expect(moveTo({ startMs: 0, endMs: 500 }, 2000, 3000)).toMatchObject({
      startMs: 2000,
      endMs: 2500,
    })
  })

  it('超出右边界 → 贴右边界', () => {
    expect(moveTo({ startMs: 0, endMs: 500 }, 2800, 3000)).toMatchObject({
      startMs: 2500,
      endMs: 3000,
    })
  })

  it('负起点 → 贴 0', () => {
    expect(moveTo({ startMs: 0, endMs: 500 }, -200, 3000)).toMatchObject({
      startMs: 0,
      endMs: 500,
    })
  })
})

describe('editOps · resolveEndMs', () => {
  it('有 endMs 直接取', () => {
    expect(resolveEndMs({ startMs: 0, endMs: 500 }, 1000)).toBe(500)
  })

  it('缺省 endMs 时用 fallback', () => {
    expect(resolveEndMs({ startMs: 0 }, 1000)).toBe(1000)
  })
})
