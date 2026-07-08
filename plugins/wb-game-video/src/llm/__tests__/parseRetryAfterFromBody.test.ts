/**
 * parseRetryAfterFromBody · 单元测试
 * ====================================
 *
 * 真实 bug 现场（2026-05-11）：Azure OpenAI gpt-image-2 在 S0 tier 撞 429 时
 * 不给 Retry-After header，只在 response body 里写
 *   "Please retry after 16 seconds."
 * 客户端只看 header → 拿到 undefined → 落到默认指数退避（封顶 15s）→ 比 Azure
 * 要求的 16s 少一点点，第 5 次继续撞，UI 报错。
 *
 * 这组测试锁死三条守约：
 *   1) 各种 Azure 实际会用的文案都能识别（retry after/in、seconds/sec/s）
 *   2) 结构化字段（retry_after_ms / retry_after）优先识别
 *   3) 不相关内容返回 undefined，不会假阳性
 */
import { describe, it, expect } from 'vitest'
import { parseRetryAfterFromBody } from '../GptImageProvider'

describe('parseRetryAfterFromBody', () => {
  it('识别 Azure 的 "retry after 16 seconds."（官方文案）', () => {
    const body = JSON.stringify({
      error: {
        code: 'RateLimitReached',
        message:
          'Your requests to gpt-image-2 for gpt-image-2 in East US 2 have exceeded ' +
          'the call rate limit for your current AIServices S0 pricing tier. ' +
          'This request was for ImageGenerations_Create under Azure OpenAI API ' +
          'version 2024-02-01. Please retry after 16 seconds. ' +
          'To increase your default rate limit, visit https://aka.ms/oai/quotaincrease.',
      },
    })
    expect(parseRetryAfterFromBody(body)).toBe(16_000)
  })

  it('识别简写 "retry after 5s"', () => {
    expect(
      parseRetryAfterFromBody('server is busy, retry after 5s'),
    ).toBe(5_000)
  })

  it('识别变体 "Please retry in 10 seconds"', () => {
    expect(
      parseRetryAfterFromBody('{"error":{"message":"Please retry in 10 seconds"}}'),
    ).toBe(10_000)
  })

  it('识别 "try again in 7 sec"', () => {
    expect(parseRetryAfterFromBody('throttled, try again in 7 sec')).toBe(7_000)
  })

  it('结构化字段 retry_after_ms 优先于文本匹配', () => {
    // body 文本里写 3 秒，但结构化字段是 2500ms —— 取结构化
    const body = JSON.stringify({
      error: {
        message: 'retry after 3 seconds',
        retry_after_ms: 2500,
      },
    })
    expect(parseRetryAfterFromBody(body)).toBe(2500)
  })

  it('结构化字段 retry_after（秒）也能识别', () => {
    const body = JSON.stringify({
      error: {
        retry_after: 4,
        message: 'throttled',
      },
    })
    expect(parseRetryAfterFromBody(body)).toBe(4_000)
  })

  it('没有"retry" 字样时返回 undefined（不假阳性）', () => {
    expect(parseRetryAfterFromBody('some random error message')).toBeUndefined()
    expect(parseRetryAfterFromBody('{"error":{"code":"BadRequest"}}')).toBeUndefined()
    expect(parseRetryAfterFromBody('')).toBeUndefined()
  })

  it('数字必须是正数；0 / 负数 / NaN 都返回 undefined', () => {
    expect(
      parseRetryAfterFromBody('retry after 0 seconds'),
    ).toBeUndefined()
    expect(
      parseRetryAfterFromBody(
        JSON.stringify({ error: { retry_after_ms: -100 } }),
      ),
    ).toBeUndefined()
    expect(
      parseRetryAfterFromBody(
        JSON.stringify({ error: { retry_after_ms: Number.NaN } }),
      ),
    ).toBeUndefined()
  })

  it('大小写不敏感', () => {
    expect(parseRetryAfterFromBody('RETRY AFTER 8 SECONDS')).toBe(8_000)
    expect(parseRetryAfterFromBody('Please Retry In 2 Seconds')).toBe(2_000)
  })

  it('小数秒数也能识别（比如 "retry after 0.5s"）', () => {
    expect(parseRetryAfterFromBody('retry after 0.5 seconds')).toBe(500)
  })
})
