import { describe, expect, it } from 'vitest'
import { computeBackoffMs, shouldRetryHttp, shouldRetryError } from '../retryPolicy'

/**
 * 重试策略 = 系统稳定性的契约。
 *
 * 真实 bug 现场：429 EngineOverloaded · 单次请求耗时 62s 才报错（意味着裸 fetch
 * 被服务端 hold 了一整个超时周期），下游 image gen 完全停摆。
 *
 * 所以这个测试要钉死：
 *   - 哪些状态码必须重试（429 / 5xx），哪些绝对不重试（4xx 客户端错）
 *   - Retry-After 头必须被尊重（429 通常带）
 *   - 指数退避必须有 jitter（避免重连惊群）
 *   - 退避有上限（避免单次请求被卡几分钟）
 */
describe('retryPolicy', () => {
  describe('shouldRetryHttp', () => {
    it('429 必须重试（rate limit / engine overloaded）', () => {
      expect(shouldRetryHttp(429)).toBe(true)
    })

    it('5xx 必须重试（服务端临时故障）', () => {
      expect(shouldRetryHttp(500)).toBe(true)
      expect(shouldRetryHttp(502)).toBe(true)
      expect(shouldRetryHttp(503)).toBe(true)
      expect(shouldRetryHttp(504)).toBe(true)
    })

    it('4xx（除 429）绝不重试 —— key 错 / prompt 违规 / deployment 不存在', () => {
      expect(shouldRetryHttp(400)).toBe(false)
      expect(shouldRetryHttp(401)).toBe(false)
      expect(shouldRetryHttp(403)).toBe(false)
      expect(shouldRetryHttp(404)).toBe(false)
      expect(shouldRetryHttp(422)).toBe(false)
    })

    it('2xx / 3xx 不重试（语义上不应到这）', () => {
      expect(shouldRetryHttp(200)).toBe(false)
      expect(shouldRetryHttp(304)).toBe(false)
    })
  })

  describe('shouldRetryError', () => {
    it('网络错误（TypeError）应该重试', () => {
      expect(shouldRetryError(new TypeError('Failed to fetch'))).toBe(true)
    })

    it('AbortError 不重试 —— 那是用户主动中断', () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      expect(shouldRetryError(e)).toBe(false)
    })

    it('普通业务错误（[API ...]）不重试', () => {
      expect(shouldRetryError(new Error('[API InvalidPrompt] xxx'))).toBe(false)
    })
  })

  describe('computeBackoffMs', () => {
    it('Retry-After 数字秒优先（429 通常带）', () => {
      const ms = computeBackoffMs(0, '5')
      expect(ms).toBeGreaterThanOrEqual(5000)
      expect(ms).toBeLessThan(7000) // 允许 jitter
    })

    it('Retry-After 解析失败时回退到指数退避', () => {
      const ms = computeBackoffMs(0, 'gibberish')
      expect(ms).toBeGreaterThanOrEqual(800)
      expect(ms).toBeLessThan(2500)
    })

    it('指数增长：第 0 次 ≈ 1s，第 3 次 ≈ 8s', () => {
      // 跑多次抹平 jitter
      const samples = (n: number) =>
        Array.from({ length: 50 }, () => computeBackoffMs(n))
      const m0 = samples(0).reduce((a, b) => a + b) / 50
      const m3 = samples(3).reduce((a, b) => a + b) / 50
      expect(m0).toBeGreaterThan(800)
      expect(m0).toBeLessThan(2000)
      expect(m3).toBeGreaterThan(7000)
      expect(m3).toBeLessThan(13000)
    })

    it('退避上限 30s（避免单次卡几分钟）', () => {
      // 第 10 次理论 ≈ 1024s，但应被钳到 30s
      const ms = computeBackoffMs(10)
      expect(ms).toBeLessThanOrEqual(30000)
    })

    it('结果带 jitter（同一 attempt 多次取值应不全相等）', () => {
      const samples = new Set(
        Array.from({ length: 20 }, () => computeBackoffMs(2)),
      )
      // 至少要有 5 种不同值（jitter 范围足够大）
      expect(samples.size).toBeGreaterThan(5)
    })
  })
})
