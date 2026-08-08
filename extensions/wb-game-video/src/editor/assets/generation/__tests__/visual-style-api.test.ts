import { describe, expect, it, vi } from 'vitest'
import {
  LIST_VIDEO_VISUAL_STYLES_TOOL_ID,
  listVideoVisualStyles,
} from '../visual-style-api'

describe('listVideoVisualStyles', () => {
  it('uses the bounded Workbench tool and accepts the documented Kino projection', async () => {
    const call = vi.fn(async () => ({
      ok: true,
      result: {
        items: [{
          key: 'anime',
          label: '二次元日系动画',
          cdnUrl: 'https://example.com/anime.jpg',
          tags: ['2D'],
          order: 3,
        }],
      },
    }))

    await expect(listVideoVisualStyles({ call })).resolves.toEqual([{
      key: 'anime',
      label: '二次元日系动画',
      cdnUrl: 'https://example.com/anime.jpg',
      tags: ['2D'],
      order: 3,
    }])
    expect(call).toHaveBeenCalledWith(LIST_VIDEO_VISUAL_STYLES_TOOL_ID, {})
  })

  it('rejects malformed style data instead of inventing fallback presets', async () => {
    const call = vi.fn(async () => ({ ok: true, result: { items: [{ key: 'anime' }] } }))
    await expect(listVideoVisualStyles({ call })).rejects.toThrow('invalid response')
  })
})
