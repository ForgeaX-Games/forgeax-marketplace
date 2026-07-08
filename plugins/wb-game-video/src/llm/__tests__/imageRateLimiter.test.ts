import { describe, it, expect, vi, afterEach } from 'vitest'
import { imageRateLimiter } from '../imageRateLimiter'

/**
 * 这里不能 new 新实例（imageRateLimiter.ts 导出的是单例），
 * 所以只断言"行为特征"：
 *   - acquire 按序回到前台
 *   - release 后下一个立刻可进
 *   - noteRateLimitHit(ms) 之后一段时间内都拿不到位置
 */
afterEach(() => vi.useRealTimers())

describe('imageRateLimiter', () => {
  it('acquire 返回 release 函数', async () => {
    const release = await imageRateLimiter.acquire()
    expect(typeof release).toBe('function')
    release()
    // 多调一次不抛
    release()
  })

  it('maxConcurrent=3 时第 4 个要等前面 release', async () => {
    const r1 = await imageRateLimiter.acquire()
    const r2 = await imageRateLimiter.acquire()
    const r3 = await imageRateLimiter.acquire()

    let fourthResolved = false
    const p4 = imageRateLimiter.acquire().then((r) => {
      fourthResolved = true
      return r
    })

    // 立刻给个机会 resolve
    await Promise.resolve()
    expect(fourthResolved).toBe(false)

    r1()
    // release 会异步触发 pump；再给点循环
    await new Promise((r) => setTimeout(r, 50))
    const r4 = await p4
    expect(fourthResolved).toBe(true)

    r2()
    r3()
    r4()
  })

  it('noteRateLimitHit 之后短时间内 acquire 会被推迟', async () => {
    // 先把桶清空：拿到再放
    const r = await imageRateLimiter.acquire()
    r()

    imageRateLimiter.noteRateLimitHit(300)
    const t0 = Date.now()
    const rAfter = await imageRateLimiter.acquire()
    const elapsed = Date.now() - t0
    // 冷却至少 300ms
    expect(elapsed).toBeGreaterThanOrEqual(200)
    rAfter()
  })
})
