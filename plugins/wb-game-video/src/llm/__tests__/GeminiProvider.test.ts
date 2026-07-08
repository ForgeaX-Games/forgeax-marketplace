/**
 * GeminiProvider —— Generative Language API v1beta 集成测试
 *
 * 策略：mock 全局 fetch，抓 POST body，断言请求形状 + 响应解析 + 错误路径。
 *
 * 覆盖：
 *   1. buildGeminiBody 纯函数：systemPrompt / userPrompt / generationConfig / jsonMode
 *   2. generate() 成功路径
 *   3. generate() MAX_TOKENS → 抛 [TRUNCATED]
 *   4. generate() 空内容 → 抛 [EMPTY]
 *   5. generate() HTTP 非 2xx → 抛 [HTTP N]
 *   6. generate() safety block → 抛 [SAFETY]
 *   7. generateStream 成功：按段 emit text 事件 + 最终 done
 *   8. generateStream 透传 finishReason
 *   9. ping() 成功
 *   10. extractGeminiText 容错：parts 为空 / 多条 parts 拼接
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  GeminiProvider,
  buildGeminiBody,
  extractGeminiText,
  splitSseEvents,
} from '../GeminiProvider'

interface MockCall {
  url: string
  body?: string
  method?: string
}

function mockFetchJson(
  responder: (call: MockCall) => { status: number; json: unknown },
): { calls: MockCall[] } {
  const calls: MockCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, body: bodyStr, method: init?.method })
      const { status, json } = responder({ url, body: bodyStr })
      return new Response(JSON.stringify(json), { status }) as unknown as Response
    }),
  )
  return { calls }
}

function mockFetchStream(chunks: string[]): { calls: MockCall[] } {
  const calls: MockCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, body: bodyStr, method: init?.method })
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const c of chunks) {
            controller.enqueue(encoder.encode(c))
          }
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }) as unknown as Response
    }),
  )
  return { calls }
}

describe('GeminiProvider · buildGeminiBody（纯函数）', () => {
  it('带 systemPrompt → 生成 system_instruction', () => {
    const body = buildGeminiBody({
      systemPrompt: 'you are helpful',
      userPrompt: 'hello',
    })
    expect(body).toMatchObject({
      system_instruction: { parts: [{ text: 'you are helpful' }] },
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    })
    expect(body.generationConfig).toMatchObject({
      temperature: 0.85,
      maxOutputTokens: 1024,
    })
  })

  it('systemPrompt 为空 → 不出现 system_instruction 字段', () => {
    const body = buildGeminiBody({ systemPrompt: '   ', userPrompt: 'hi' })
    expect(body.system_instruction).toBeUndefined()
  })

  it('jsonMode=true → responseMimeType=application/json', () => {
    const body = buildGeminiBody({
      systemPrompt: 's',
      userPrompt: 'u',
      jsonMode: true,
    })
    expect((body.generationConfig as Record<string, unknown>).responseMimeType).toBe(
      'application/json',
    )
  })

  it('jsonMode 默认不设 responseMimeType', () => {
    const body = buildGeminiBody({ systemPrompt: 's', userPrompt: 'u' })
    expect(
      (body.generationConfig as Record<string, unknown>).responseMimeType,
    ).toBeUndefined()
  })

  it('maxTokens / temperature 透传', () => {
    const body = buildGeminiBody({
      systemPrompt: 's',
      userPrompt: 'u',
      temperature: 0.3,
      maxTokens: 4096,
    })
    expect(body.generationConfig).toMatchObject({
      temperature: 0.3,
      maxOutputTokens: 4096,
    })
  })

  describe('thinking 模型 maxTokens 抬底（v3.9.8）', () => {
    // 作者 2026-05-07 截图：gemini-3.1-pro-preview + maxTokens=1024 → forge 72 秒
    // 后 thinking 耗光预算 → parts 没 text → 报 [EMPTY]。buildGeminiBody 的
    // "model 是 gemini-3.x 时把 maxTokens 最小抬到 8192" 这条规则必须被单测
    // 钉死，避免以后重构时误删。
    it('gemini-3.1-pro-preview · 默认 1024 → 抬到 8192', () => {
      const body = buildGeminiBody({ userPrompt: 'u' }, 'gemini-3.1-pro-preview')
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(8192)
    })

    it('gemini-3.1-flash-lite-preview · 也是 3.x 系 → 抬', () => {
      const body = buildGeminiBody(
        { userPrompt: 'u', maxTokens: 1024 },
        'gemini-3.1-flash-lite-preview',
      )
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(8192)
    })

    it('caller 传的 maxTokens 已 >8192 → 保留，不下调', () => {
      const body = buildGeminiBody(
        { userPrompt: 'u', maxTokens: 32_768 },
        'gemini-3.1-pro-preview',
      )
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(32_768)
    })

    it('gemini-2.5-pro · 非 3.x → 不动 maxTokens', () => {
      const body = buildGeminiBody(
        { userPrompt: 'u', maxTokens: 1024 },
        'gemini-2.5-pro',
      )
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(1024)
    })

    it('gemini-2.0-flash · 非 3.x → 不动', () => {
      const body = buildGeminiBody({ userPrompt: 'u' }, 'gemini-2.0-flash')
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(1024)
    })

    it('未传 model（向后兼容老 caller） → 不动', () => {
      const body = buildGeminiBody({ userPrompt: 'u' })
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(1024)
    })

    // 防"gemini-35-whatever" 这种假阳 —— 必须是 "3" 后跟 "." 或 "-"
    it('"gemini-35-xxx" 不命中（保守匹配 gemini-3 系）', () => {
      const body = buildGeminiBody({ userPrompt: 'u' }, 'gemini-35-xxx')
      expect(
        (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ).toBe(1024)
    })
  })
})

describe('GeminiProvider · extractGeminiText', () => {
  it('多条 parts → 按顺序拼接', () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            content: {
              parts: [{ text: 'hello' }, { text: ' ' }, { text: 'world' }],
            },
          },
        ],
      }),
    ).toEqual({ text: 'hello world', hasThought: false })
  })

  it('candidates 为空 → 返回 { text:"", hasThought:false }', () => {
    expect(extractGeminiText({})).toEqual({ text: '', hasThought: false })
    expect(extractGeminiText({ candidates: [] })).toEqual({
      text: '',
      hasThought: false,
    })
    expect(extractGeminiText({ candidates: [{}] })).toEqual({
      text: '',
      hasThought: false,
    })
  })

  // v3.9.10：Gemini 3.x 的 forced-thinking 常发 thought-only part
  //   （有 thoughtSignature 但 text===""）。必须被识别出来，否则上层
  //   会把"只思考没说话"当成"代理挂了"处理。
  it('thought-only part → hasThought=true 且 text=""', () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            content: {
              parts: [{ thoughtSignature: 'abc==' }],
            },
          },
        ],
      }),
    ).toEqual({ text: '', hasThought: true })
  })

  it('混合 part：有 thought 也有 text → 只算 text 部分', () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            content: {
              parts: [
                { thoughtSignature: 'sig==' },
                { text: 'answer' },
              ],
            },
          },
        ],
      }),
    ).toEqual({ text: 'answer', hasThought: true })
  })
})

describe('GeminiProvider · generate()', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', {
      now: (() => {
        let t = 1000
        return () => (t += 10)
      })(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('成功路径：URL 携带 key query + POST body + 解析 candidates', async () => {
    const { calls } = mockFetchJson(() => ({
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'hello from gemini' }] }, finishReason: 'STOP' },
        ],
      },
    }))
    const g = new GeminiProvider({
      apiKey: 'K123',
      apiBase: 'https://generativelanguage.googleapis.com',
      model: 'gemini-3.1-pro-preview',
    })
    const text = await g.generate({ systemPrompt: 's', userPrompt: 'u' })
    expect(text).toBe('hello from gemini')
    expect(calls).toHaveLength(1)
    const call0 = calls[0]!
    expect(call0.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=K123',
    )
    expect(call0.method).toBe('POST')
    const body = JSON.parse(call0.body!) as Record<string, unknown>
    expect(body.contents).toBeDefined()
    expect(body.system_instruction).toBeDefined()
  })

  it('MAX_TOKENS → 抛 [TRUNCATED]', async () => {
    mockFetchJson(() => ({
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'half cut' }] }, finishReason: 'MAX_TOKENS' },
        ],
      },
    }))
    const g = new GeminiProvider({
      apiKey: 'K',
      apiBase: 'https://x.y',
    })
    await expect(g.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /\[TRUNCATED\]/,
    )
  })

  it('空文本 → 抛 [EMPTY]', async () => {
    mockFetchJson(() => ({
      status: 200,
      json: { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }] },
    }))
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    await expect(g.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /\[EMPTY\]/,
    )
  })

  it('HTTP 403 → 抛 [HTTP 403]', async () => {
    mockFetchJson(() => ({
      status: 403,
      json: { error: { code: 403, message: 'permission denied', status: 'PERMISSION_DENIED' } },
    }))
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    await expect(g.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /\[HTTP 403\]/,
    )
  })

  it('promptFeedback.blockReason → 抛 [SAFETY]', async () => {
    mockFetchJson(() => ({
      status: 200,
      json: { promptFeedback: { blockReason: 'SAFETY' } },
    }))
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    await expect(g.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /\[SAFETY\]/,
    )
  })
})

describe('GeminiProvider · generateStream()', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', {
      now: (() => {
        let t = 1000
        return () => (t += 10)
      })(),
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('按段 emit text 事件 + 最终 done', async () => {
    const chunk1 =
      'data: ' +
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'hello ' }] } }],
      }) +
      '\n\n'
    const chunk2 =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: 'world' }] }, finishReason: 'STOP' },
        ],
      }) +
      '\n\n'
    mockFetchStream([chunk1, chunk2])
    const g = new GeminiProvider({
      apiKey: 'K',
      apiBase: 'https://generativelanguage.googleapis.com',
    })
    const events: Array<{ type: string; delta?: string; full?: string }> = []
    const full = await g.generateStream(
      { systemPrompt: 's', userPrompt: 'u' },
      (ev) => {
        const rec: { type: string; delta?: string; full?: string } = { type: ev.type }
        if (ev.type === 'text') rec.delta = ev.delta
        if (ev.type === 'done') rec.full = ev.full
        events.push(rec)
      },
    )
    expect(full).toBe('hello world')
    expect(events.map((e) => e.type)).toEqual(['open', 'text', 'text', 'done'])
    expect(events[1]!.delta).toBe('hello ')
    expect(events[2]!.delta).toBe('world')
    expect(events[3]!.full).toBe('hello world')
  })

  it('流式 URL 形如 :streamGenerateContent?alt=sse', async () => {
    const chunk =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      }) +
      '\n\n'
    const { calls } = mockFetchStream([chunk])
    const g = new GeminiProvider({
      apiKey: 'K',
      apiBase: 'https://generativelanguage.googleapis.com',
      model: 'gemini-3.1-pro-preview',
    })
    await g.generateStream({ systemPrompt: 's', userPrompt: 'u' }, () => {})
    expect(calls[0]!.url).toContain(':streamGenerateContent?alt=sse')
    expect(calls[0]!.url).toContain('key=K')
  })

  it('流式 [DONE] 标记不当 JSON 解析', async () => {
    const chunks = [
      'data: ' +
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' },
          ],
        }) +
        '\n\n',
      'data: [DONE]\n\n',
    ]
    mockFetchStream(chunks)
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    const full = await g.generateStream(
      { systemPrompt: 's', userPrompt: 'u' },
      () => {},
    )
    expect(full).toBe('x')
  })
})

describe('GeminiProvider · splitSseEvents（纯函数）', () => {
  // v3.9.10 bug 复现：作者 gemini-3.1-pro-preview + curl 抓到的 payload 确认
  //   上游 **能** 返 text/event-stream。但浏览器里 `events=0` —— 根因是
  //   原实现只认 \n\n 分隔符 + 循环结束不 flush 残余 buffer。
  //   下面的测例把每种"原先会丢数据"的情况都钉死。

  it('LF 分隔：基本场景', () => {
    const { events, rest } = splitSseEvents('data: a\n\ndata: b\n\n')
    expect(events).toEqual(['data: a', 'data: b'])
    expect(rest).toBe('')
  })

  it('CRLF 分隔（Gemini 公网端点偶发）', () => {
    const { events, rest } = splitSseEvents('data: a\r\n\r\ndata: b\r\n\r\n')
    expect(events).toEqual(['data: a', 'data: b'])
    expect(rest).toBe('')
  })

  it('LF + CRLF 混用（代理改行符不一致）', () => {
    const { events, rest } = splitSseEvents(
      'data: one\n\ndata: two\r\n\r\ndata: three\n\n',
    )
    expect(events).toEqual(['data: one', 'data: two', 'data: three'])
    expect(rest).toBe('')
  })

  it('半条事件留在 rest 里，下次 feed 能拼上', () => {
    const r1 = splitSseEvents('data: start-of-msg\n\ndata: half')
    expect(r1.events).toEqual(['data: start-of-msg'])
    expect(r1.rest).toBe('data: half')
    const r2 = splitSseEvents(r1.rest + '-finished\n\n')
    expect(r2.events).toEqual(['data: half-finished'])
    expect(r2.rest).toBe('')
  })

  it('空 buffer → 无事件无残余', () => {
    expect(splitSseEvents('')).toEqual({ events: [], rest: '' })
  })

  it('多行事件内部包含单 \\n 但不是事件边界', () => {
    const raw =
      'event: content_block_delta\ndata: {"x":1}\n\n' +
      'event: content_block_delta\ndata: {"x":2}\n\n'
    const { events } = splitSseEvents(raw)
    expect(events).toEqual([
      'event: content_block_delta\ndata: {"x":1}',
      'event: content_block_delta\ndata: {"x":2}',
    ])
  })

  it('实拍 Gemini payload（curl 抓到的真实形态）', () => {
    // 抓自 `generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse`
    // 简化版：一个 thought-only chunk + 一个 final chunk
    const real =
      'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":"abc=="}]}}],"modelVersion":"gemini-3.1-pro-preview"}\r\n\r\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"嗨，你好"}]},"finishReason":"STOP"}]}\r\n\r\n'
    const { events, rest } = splitSseEvents(real)
    expect(events).toHaveLength(2)
    expect(rest).toBe('')
    expect(events[0]).toContain('thoughtSignature')
    expect(events[1]).toContain('STOP')
  })
})

describe('GeminiProvider · generateStream 末尾 flush（v3.9.10 回归）', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', {
      now: (() => {
        let t = 1000
        return () => (t += 10)
      })(),
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('最后一个 data 没有 \\n\\n 收尾也不能丢 —— 原 bug', async () => {
    // 模拟服务端关流时最后一段 payload 只跟了单个换行（没 \n\n），
    // 老实现 buffer 永久挂着这段数据、events=0；新实现 done 之后 flush。
    const payload =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: 'tail-without-separator' }] }, finishReason: 'STOP' },
        ],
      }) +
      '\n' // ← 注意：单个 \n，不是 \n\n
    mockFetchStream([payload])
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    const text = await g.generateStream({ userPrompt: 'u' }, () => {})
    expect(text).toBe('tail-without-separator')
  })

  it('\\r\\n\\r\\n 分隔符也能解析', async () => {
    const payload =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: 'crlf-ok' }] }, finishReason: 'STOP' },
        ],
      }) +
      '\r\n\r\n'
    mockFetchStream([payload])
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    const text = await g.generateStream({ userPrompt: 'u' }, () => {})
    expect(text).toBe('crlf-ok')
  })

  it('thought-only chunk 之后再来 final text → 最终 text 正常', async () => {
    const thought =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ thoughtSignature: 'sig==' }] } },
        ],
      }) +
      '\n\n'
    const final =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' },
        ],
      }) +
      '\n\n'
    mockFetchStream([thought, final])
    const g = new GeminiProvider({
      apiKey: 'K',
      apiBase: 'https://x.y',
      model: 'gemini-3.1-pro-preview',
    })
    const text = await g.generateStream({ userPrompt: 'u' }, () => {})
    expect(text).toBe('answer')
  })

  it('全是 thought-only 没 final → 抛 [EMPTY]，且 hint 提到 thought-only', async () => {
    const thought =
      'data: ' +
      JSON.stringify({
        candidates: [
          { content: { parts: [{ thoughtSignature: 'sig==' }] } },
        ],
      }) +
      '\n\n'
    mockFetchStream([thought])
    const g = new GeminiProvider({
      apiKey: 'K',
      apiBase: 'https://x.y',
      model: 'gemini-3.1-pro-preview',
    })
    await expect(g.generateStream({ userPrompt: 'u' }, () => {})).rejects.toThrow(
      /thought-only/,
    )
  })
})

describe('GeminiProvider · ping()', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', {
      now: (() => {
        let t = 1000
        return () => (t += 5)
      })(),
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ping 成功 → { ok:true, sample:"pong" }', async () => {
    mockFetchJson(() => ({
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'pong' }] }, finishReason: 'STOP' },
        ],
      },
    }))
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    const res = await g.ping()
    expect(res.ok).toBe(true)
    expect(res.sample).toBe('pong')
  })

  it('ping 失败 → { ok:false, error }', async () => {
    mockFetchJson(() => ({ status: 500, json: { error: { message: 'boom' } } }))
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    const res = await g.ping()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/HTTP 500/)
  })
})

describe('GeminiProvider · 构造器校验', () => {
  it('缺 apiKey → 抛错', () => {
    expect(() => new GeminiProvider({ apiKey: '', apiBase: 'x' })).toThrow(
      /missing apiKey/,
    )
  })
  it('缺 apiBase → 抛错', () => {
    expect(() => new GeminiProvider({ apiKey: 'k', apiBase: '' })).toThrow(
      /missing apiBase/,
    )
  })
  it('默认 model = gemini-3.1-pro-preview', () => {
    const g = new GeminiProvider({ apiKey: 'K', apiBase: 'https://x.y' })
    expect(g.getModel()).toBe('gemini-3.1-pro-preview')
    expect(g.getProviderName()).toBe('Gemini')
  })
})
