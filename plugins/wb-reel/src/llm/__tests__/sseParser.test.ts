import { describe, expect, it } from 'vitest'
import { createSseParser, feedSse } from '../sseParser'

/**
 * SSE 解析单测 —— 覆盖 Anthropic Messages API 流式事件的几种真实形态。
 * 参考：https://docs.claude.com/en/api/streaming
 */
describe('sseParser', () => {
  it('解析单个 content_block_delta(text_delta)', () => {
    const s = createSseParser()
    const raw =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n'
    const ev = feedSse(s, raw)
    expect(ev).toEqual([{ text: '你好' }])
  })

  it('跨 chunk 粘包：半段保留到下一次 feed', () => {
    const s = createSseParser()
    const a =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你'
    const b =
      '好"}}\n\n'
    const ev1 = feedSse(s, a)
    const ev2 = feedSse(s, b)
    expect(ev1).toEqual([])
    expect(ev2).toEqual([{ text: '你好' }])
  })

  it('忽略 message_start / content_block_start / ping 等无关事件', () => {
    const s = createSseParser()
    const raw =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n' +
      'event: ping\n' +
      'data: {"type":"ping"}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
    const ev = feedSse(s, raw)
    expect(ev).toEqual([])
  })

  it('抓 message_delta.stop_reason', () => {
    const s = createSseParser()
    const raw =
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n'
    const ev = feedSse(s, raw)
    expect(ev).toEqual([{ stopReason: 'end_turn' }])
  })

  it('max_tokens 截断也通过 stopReason 报出来', () => {
    const s = createSseParser()
    const raw =
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ stopReason: 'max_tokens' }])
  })

  it('错误事件 → errorMessage', () => {
    const s = createSseParser()
    const raw =
      'event: error\n' +
      'data: {"type":"error","error":{"type":"overloaded_error","message":"server busy"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ errorMessage: 'server busy' }])
  })

  it('多个 delta 一次喂入，按顺序产出', () => {
    const s = createSseParser()
    const raw =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"B"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"C"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ text: 'A' }, { text: 'B' }, { text: 'C' }])
  })

  it('空 text_delta 被丢弃（Anthropic 偶尔会发 text:""）', () => {
    const s = createSseParser()
    const raw =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}\n\n'
    expect(feedSse(s, raw)).toEqual([])
  })

  it('不合法 JSON 的 data 被静默跳过，不抛异常', () => {
    const s = createSseParser()
    const raw =
      'event: content_block_delta\n' +
      'data: {not json\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ text: 'ok' }])
  })

  it('[DONE] 哨兵（OpenAI 风格）不会当作事件', () => {
    const s = createSseParser()
    const raw =
      'data: [DONE]\n\n' +
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ stopReason: 'end_turn' }])
  })

  it('即使 event: 缺失，也会根据 data.type 判断', () => {
    const s = createSseParser()
    const raw =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}\n\n'
    expect(feedSse(s, raw)).toEqual([{ text: 'x' }])
  })
})
