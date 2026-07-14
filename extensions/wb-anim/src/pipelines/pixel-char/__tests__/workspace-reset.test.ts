// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createEmptyImageCache } from '../index'

describe('createEmptyImageCache()', () => {
  it('produces a cache with the turnaround reference cleared', () => {
    const cache = createEmptyImageCache()
    expect(cache.turnaroundImage).toBeNull()
  })

  it('produces empty record buckets for every per-action slot', () => {
    // 回归守门：曾经漏清 referenceAnchors / actionPrompts 导致换角色时
    // 新图用的还是旧的 anchor / prompt。这里逐桶断言空，防止再漏。
    const cache = createEmptyImageCache()
    expect(cache.actionSheets).toEqual({})
    expect(cache.cleanSheets).toEqual({})
    expect(cache.splitFrames).toEqual({})
    expect(cache.referenceAnchors).toEqual({})
    expect(cache.actionPrompts).toEqual({})
  })

  it('exposes exactly 6 top-level keys — 新增桶要同步 clearWorkspace()', () => {
    // 有人往 ImageCache 加新字段时，如果忘了更新 createEmptyImageCache，
    // 这个断言会把数量变化拍出来。把键名也一起断一下防止字段重命名
    // 但忘了同步这里。
    const cache = createEmptyImageCache()
    const keys = Object.keys(cache).sort()
    expect(keys).toEqual([
      'actionPrompts',
      'actionSheets',
      'cleanSheets',
      'referenceAnchors',
      'splitFrames',
      'turnaroundImage',
    ])
  })

  it('returns a fresh object on each call — 不能共享引用，否则 reset 后新旧互相污染', () => {
    const a = createEmptyImageCache()
    const b = createEmptyImageCache()
    expect(a).not.toBe(b)
    expect(a.actionSheets).not.toBe(b.actionSheets)
    expect(a.splitFrames).not.toBe(b.splitFrames)
  })
})
