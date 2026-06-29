import { describe, it, expect } from 'vitest'
import { hydrateMediaFromIdb } from '../hydrateMediaFromIdb'
import type { StoredMedia } from '../mediaIdb'

function rec(overrides: Partial<StoredMedia> = {}): StoredMedia {
  return {
    id: 'm-1',
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    size: 1024,
    createdAt: 1_000,
    blob: new Blob(['hi'], { type: 'video/mp4' }),
    ...overrides,
  }
}

const urlMaker = (_b: Blob): string => 'blob:mock-url'

describe('hydrateMediaFromIdb', () => {
  it('空列表 → 空对象', () => {
    expect(hydrateMediaFromIdb([], urlMaker)).toEqual({})
  })

  it('为每条 StoredMedia 合成 MediaEntry（url 走 urlMaker 注入）', () => {
    const out = hydrateMediaFromIdb(
      [
        rec({ id: 'm-a', name: 'a.mp4', createdAt: 100 }),
        rec({ id: 'm-b', name: 'b.webm', mimeType: 'video/webm', createdAt: 200 }),
      ],
      urlMaker,
    )
    expect(Object.keys(out).sort()).toEqual(['m-a', 'm-b'])
    expect(out['m-a']!.name).toBe('a.mp4')
    expect(out['m-a']!.url).toBe('blob:mock-url')
    expect(out['m-b']!.mimeType).toBe('video/webm')
  })

  it('IDB 恢复的条目一律标记为 saved —— 避免 UI 当作 pending 卡住', () => {
    const out = hydrateMediaFromIdb([rec({ id: 'm-1' })], urlMaker)
    expect(out['m-1']!.persistState).toBe('saved')
  })

  it('跳过 id 为空字符串的脏数据（防御）', () => {
    const out = hydrateMediaFromIdb(
      [rec({ id: '' }), rec({ id: 'ok' })],
      urlMaker,
    )
    expect(Object.keys(out)).toEqual(['ok'])
  })
})
