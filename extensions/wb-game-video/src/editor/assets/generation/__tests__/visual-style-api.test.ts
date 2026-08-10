import { describe, expect, it, vi } from 'vitest'
import {
  listVideoVisualStyles,
} from '../visual-style-api'

describe('listVideoVisualStyles', () => {
  it('uses the native Kino visual-style API contract', async () => {
    const list = vi.fn(async () => ({
      items: [{
        key: 'anime',
        label: '二次元日系动画',
        cdn_url: 'https://example.com/anime.jpg',
        tag: ['2D'],
        order: 3,
      }],
    }))

    await expect(listVideoVisualStyles({ list })).resolves.toEqual([{
      key: 'anime',
      label: '二次元日系动画',
      cdnUrl: 'https://example.com/anime.jpg',
      tags: ['2D'],
      order: 3,
    }])
    expect(list).toHaveBeenCalledOnce()
  })

  it('rejects malformed style data instead of inventing fallback presets', async () => {
    const list = vi.fn(async () => ({ items: [{ key: 'anime' }] }))
    await expect(listVideoVisualStyles({ list })).rejects.toThrow('invalid response')
  })
})
