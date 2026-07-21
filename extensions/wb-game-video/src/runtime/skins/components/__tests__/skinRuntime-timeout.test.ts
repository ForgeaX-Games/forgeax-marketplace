import { describe, expect, it } from 'bun:test'
import { resolveTimeoutMs } from '../skinRuntime'

describe('resolveTimeoutMs', () => {
  it('优先 timeoutMs，其次 windowMs / durationMs', () => {
    expect(resolveTimeoutMs({ timeoutMs: 8000, windowMs: 1, durationMs: 2 })).toBe(8000)
    expect(resolveTimeoutMs({ windowMs: 3000 })).toBe(3000)
    expect(resolveTimeoutMs({ durationMs: 1500 })).toBe(1500)
  })

  it('忽略非正数', () => {
    expect(resolveTimeoutMs({ timeoutMs: 0 })).toBeUndefined()
    expect(resolveTimeoutMs({ timeoutMs: -1 })).toBeUndefined()
    expect(resolveTimeoutMs({})).toBeUndefined()
  })
})
