// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureStylePoster,
  __resetStylePosterCacheForTest,
} from '../stylePosterCache'
import type { ImageClient, ImageRequest, ImageResult } from '../../llm/types'

/**
 * stylePosterCache 行为契约：
 *   - 同一 cacheKey 命中内存 → 不重复 generate
 *   - 并发同 cacheKey → in-flight 去重，只 generate 一次
 *   - generate 抛错 → 返回 null，不缓存 null，下次允许重试
 *
 * 注意：happy-dom 可能没有 indexedDB；实现需在缺失时优雅跳过 IDB，
 * 这些测试只断言内存层 + 去重 + 错误处理，不依赖真实 IDB。
 */

function makeClient(impl?: (req: ImageRequest) => Promise<ImageResult>): ImageClient & {
  readonly generate: ReturnType<typeof vi.fn>
} {
  const generate = vi.fn(
    impl ??
      (async (req: ImageRequest): Promise<ImageResult> => ({
        dataUrl: 'data:img/x',
        mimeType: 'image/png',
        base64: 'x',
        prompt: req.prompt,
        latencyMs: 1,
      })),
  )
  const client = {
    generate,
    ping: async () => ({ ok: true, latencyMs: 0 }),
    getModel: () => 'mock',
    getProviderName: () => 'mock',
  } as unknown as ImageClient & { readonly generate: ReturnType<typeof vi.fn> }
  return client
}

describe('stylePosterCache', () => {
  beforeEach(() => {
    __resetStylePosterCacheForTest()
  })

  it('同一 cacheKey 两次调用 → generate 只 1 次，两次都返回该 dataUrl', async () => {
    const client = makeClient()
    const a = await ensureStylePoster('k1', 'poster prompt', client)
    const b = await ensureStylePoster('k1', 'poster prompt', client)
    expect(a).toBe('data:img/x')
    expect(b).toBe('data:img/x')
    expect(client.generate).toHaveBeenCalledTimes(1)
  })

  it('并发同 cacheKey → in-flight 去重，generate 只 1 次', async () => {
    let resolveGen: (r: ImageResult) => void = () => {}
    const client = makeClient(
      () =>
        new Promise<ImageResult>((resolve) => {
          resolveGen = resolve
        }),
    )
    const p = Promise.all([
      ensureStylePoster('k2', 'p', client),
      ensureStylePoster('k2', 'p', client),
    ])
    // generate 在 idbGet 之后才被调用；等到它真正被调用（resolveGen 被赋值）再 resolve
    await vi.waitFor(() => {
      expect(client.generate).toHaveBeenCalledTimes(1)
    })
    resolveGen({
      dataUrl: 'data:img/x',
      mimeType: 'image/png',
      base64: 'x',
      prompt: 'p',
      latencyMs: 1,
    })
    const [a, b] = await p
    expect(a).toBe('data:img/x')
    expect(b).toBe('data:img/x')
    expect(client.generate).toHaveBeenCalledTimes(1)
  })

  it('generate reject → 返回 null，不缓存 null，下次重试', async () => {
    let shouldFail = true
    const client = makeClient(async (req) => {
      if (shouldFail) throw new Error('boom')
      return {
        dataUrl: 'data:img/ok',
        mimeType: 'image/png',
        base64: 'ok',
        prompt: req.prompt,
        latencyMs: 1,
      }
    })

    const first = await ensureStylePoster('k3', 'p', client)
    expect(first).toBeNull()
    expect(client.generate).toHaveBeenCalledTimes(1)

    shouldFail = false
    const second = await ensureStylePoster('k3', 'p', client)
    expect(second).toBe('data:img/ok')
    expect(client.generate).toHaveBeenCalledTimes(2)
  })
})
