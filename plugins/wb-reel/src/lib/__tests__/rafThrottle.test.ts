import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rafThrottle } from '../rafThrottle'

describe('rafThrottle', () => {
  let pending: FrameRequestCallback[] = []
  let originalRaf: typeof requestAnimationFrame
  let originalCaf: typeof cancelAnimationFrame
  let nextId = 1

  beforeEach(() => {
    pending = []
    nextId = 1
    originalRaf = globalThis.requestAnimationFrame
    originalCaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      const id = nextId++
      pending.push(cb)
      return id
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number): void => {
      void id
      pending = []
    }) as typeof cancelAnimationFrame
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCaf
  })

  function flushFrame(): void {
    const cbs = pending
    pending = []
    cbs.forEach((cb) => cb(performance.now()))
  }

  it('一帧内多次调用只触发一次 fn，且使用最新参数', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(1)
    t(2)
    t(3)
    expect(fn).not.toHaveBeenCalled()
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(3)
  })

  it('跨帧重置调度，能再次触发', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t('a')
    flushFrame()
    t('b')
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 'a')
    expect(fn).toHaveBeenNthCalledWith(2, 'b')
  })

  it('cancel 后挂起的帧不再执行', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(42)
    t.cancel()
    flushFrame()
    expect(fn).not.toHaveBeenCalled()
  })

  it('handler 抛错不会让下一次调度失败', () => {
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
      .mockImplementationOnce(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = rafThrottle(fn)
    t(1)
    flushFrame()
    t(2)
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
