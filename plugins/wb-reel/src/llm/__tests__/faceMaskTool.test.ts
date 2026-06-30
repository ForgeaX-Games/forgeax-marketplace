import { afterEach, describe, expect, it, vi } from 'vitest'
import { maskSeedanceContentInput } from '../faceMaskTool'
import type { BuildSeedanceContentInput } from '../seedanceContent'

const DATA_URL = 'data:image/png;base64,AAAA'
const MASKED = 'data:image/png;base64,MASKED'

function input(over: Partial<BuildSeedanceContentInput> = {}): BuildSeedanceContentInput {
  return {
    composedText: '一个镜头',
    mode: 'frames',
    firstFrameUrl: DATA_URL,
    ...over,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('maskSeedanceContentInput · 写实风格 gate', () => {
  it('非写实风格（anime/cartoon/...）：整组透传，且根本不请求打码服务', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    for (const vs of ['anime', 'cartoon', 'pixelart', 'watercolor', 'ink'] as const) {
      const out = await maskSeedanceContentInput(input(), { visualStyle: vs })
      expect(out.firstFrameUrl).toBe(DATA_URL) // 原样透传
    }
    expect(fetchSpy).not.toHaveBeenCalled() // gate 关闭：零网络往返
  })

  it('photoreal：开 gate，真正调用打码端点并替换为打码图', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, image: MASKED }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const out = await maskSeedanceContentInput(input(), { visualStyle: 'photoreal' })
    expect(fetchSpy).toHaveBeenCalled()
    expect(out.firstFrameUrl).toBe(MASKED)
  })

  it('visualStyle 缺省视为写实（保守、零回归）：仍走打码', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, image: MASKED }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const out = await maskSeedanceContentInput(input()) // 不传 opts
    expect(fetchSpy).toHaveBeenCalled()
    expect(out.firstFrameUrl).toBe(MASKED)
  })

  it('参考图模式：非写实同样整组透传', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const refs = [DATA_URL, 'data:image/png;base64,BBBB']
    const out = await maskSeedanceContentInput(
      input({ mode: 'reference', firstFrameUrl: undefined, referenceImageUrls: refs }),
      { visualStyle: 'anime' },
    )
    expect(out.referenceImageUrls).toEqual(refs)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
