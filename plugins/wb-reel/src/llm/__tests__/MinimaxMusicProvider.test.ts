import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createMinimaxMusicClient,
  hexToBytes,
  MINIMAX_MUSIC_PRESETS,
} from '../MinimaxMusicProvider'

/*
 * MinimaxMusicProvider · 文本/歌词 → 音乐生成
 *
 * 设计契约 (与官方 https://platform.minimaxi.com/docs/api-reference/music-generation 对齐):
 *   - 没 key -> mock 路径, silent mp3 dataUrl, mock=true
 *   - 有 key -> POST `${apiBase}/v1/music_generation`, Bearer 鉴权
 *   - body 必须含 model, output_format='hex', stream=false; lyrics/prompt 按需透传
 *   - 响应 base_resp.status_code !== 0 -> 抛 Error 含 code 和 status_msg
 *   - 响应 data.audio (hex 字符串) -> 解码为 bytes, 落入 dataUrl base64
 *   - extra_info.music_duration / music_sample_rate 等元数据透传
 *   - is_instrumental / lyrics_optimizer / 翻唱字段按需挂到 body
 */

describe('hexToBytes', () => {
  it('正常 hex -> bytes', () => {
    expect(Array.from(hexToBytes('00ff10'))).toEqual([0, 255, 16])
  })
  it('大小写混合, 内嵌空白都能解', () => {
    expect(Array.from(hexToBytes('Aa BB cC'))).toEqual([0xaa, 0xbb, 0xcc])
  })
  it('奇数长度 -> 抛错', () => {
    expect(() => hexToBytes('abc')).toThrow(/invalid hex length/)
  })
})

describe('MinimaxMusicProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mock 路径: 缺 key -> silent mp3 占位, 不打网络', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const client = createMinimaxMusicClient({ apiKey: '' })
    const r = await client.generate({ prompt: 'rainy night' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.mock).toBe(true)
    expect(r.dataUrl.startsWith('data:audio/mpeg;base64,')).toBe(true)
    expect(r.bytes.length).toBeGreaterThan(0)
    expect(r.model).toBe('music-2.6-free')
  })

  it('真路径: 鉴权 Bearer + 完整 body 字段', async () => {
    const fakeHex = '4944330400000000000a' // 一段任意 hex
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { status: 2, audio: fakeHex },
          trace_id: 'tr-001',
          extra_info: {
            music_duration: 25364,
            music_sample_rate: 44100,
            music_channel: 2,
            bitrate: 256000,
            music_size: 813651,
          },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const client = createMinimaxMusicClient({
      apiKey: 'sk-api-test',
      defaultModel: 'music-2.6-free',
    })
    const r = await client.generate({
      prompt: 'Mandopop, festive',
      lyrics: '[Verse]\nhello',
      audioSetting: { sampleRate: 32000, format: 'mp3' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0] as [string, RequestInit]
    const url = call[0]
    const init = call[1]
    expect(String(url)).toBe('/__minimax_music__/v1/music_generation')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-api-test')
    expect(headers['Content-Type']).toBe('application/json')

    const sent = JSON.parse(init.body as string) as Record<string, any>
    expect(sent.model).toBe('music-2.6-free')
    expect(sent.output_format).toBe('hex')
    expect(sent.stream).toBe(false)
    expect(sent.prompt).toBe('Mandopop, festive')
    expect(sent.lyrics).toBe('[Verse]\nhello')
    expect(sent.audio_setting.sample_rate).toBe(32000)
    expect(sent.audio_setting.format).toBe('mp3')
    expect(sent.is_instrumental).toBeUndefined() // 默认不带
    expect(sent.lyrics_optimizer).toBeUndefined()

    expect(r.mock).toBeUndefined()
    expect(r.bytes.length).toBe(fakeHex.length / 2)
    expect(r.durationMs).toBe(25364)
    expect(r.sampleRate).toBe(44100)
    expect(r.channel).toBe(2)
    expect(r.traceId).toBe('tr-001')
    expect(r.dataUrl.startsWith('data:audio/mpeg;base64,')).toBe(true)
  })

  it('isInstrumental + lyricsOptimizer + 不传 lyrics -> 字段如实传', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { status: 2, audio: 'aabb' },
          base_resp: { status_code: 0, status_msg: 'ok' },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    await client.generate({
      prompt: 'epic battle',
      isInstrumental: true,
      lyricsOptimizer: true,
    })
    const call = fetchSpy.mock.calls[0] as [string, RequestInit]
    const init = call[1]
    const sent = JSON.parse(init.body as string) as Record<string, any>
    expect(sent.is_instrumental).toBe(true)
    expect(sent.lyrics_optimizer).toBe(true)
    expect(sent.lyrics).toBeUndefined()
  })

  it('响应 base_resp.status_code !== 0 -> 抛 Error 包含 code 与 msg', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: null,
            base_resp: { status_code: 2013, status_msg: 'invalid params' },
          }),
          { status: 200 },
        ),
      ),
    )
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(
      /code=2013.*invalid params/,
    )
  })

  it('HTTP 非 2xx -> 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 503 })),
    )
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/HTTP 503/)
  })

  it('preset 列表至少含 1 纯音乐 + 1 含歌词, id 不重复', () => {
    const ids = MINIMAX_MUSIC_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(MINIMAX_MUSIC_PRESETS.some((p) => p.isInstrumental === true)).toBe(true)
    expect(MINIMAX_MUSIC_PRESETS.some((p) => p.lyrics.length > 0)).toBe(true)
  })

  /*
   * v6.7 · onProgress + AbortController
   *
   * 这两个测试覆盖"150s 不能默默等"的核心契约:
   *   - generate(opts.onProgress) 至少 emit 'request_sent' 与 'response_received'
   *     即使 fetch 是即时返回的 (mock); 真线慢响应时还会有 'tick' 心跳.
   *   - opts.signal.abort() 之后, generate 必须 reject AbortError, 且 emit 'cancelled'.
   *     不能既继续解码又 silently resolve, 否则 UI 取消按钮形同虚设.
   */
  it('onProgress: 至少 emit request_sent / response_received / decoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: { status: 2, audio: 'aabb' },
            trace_id: 'tr-2',
            base_resp: { status_code: 0, status_msg: 'ok' },
          }),
          { status: 200 },
        ),
      ),
    )
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    const events: string[] = []
    await client.generate(
      { prompt: 'p' },
      { onProgress: (e) => events.push(e.kind) },
    )
    expect(events).toContain('request_sent')
    expect(events).toContain('response_received')
    expect(events).toContain('decoded')
  })

  it('AbortController.abort() -> reject AbortError + emit cancelled', async () => {
    /*
     * 模拟一个永远不 resolve 的 fetch (除非 signal abort).
     * 真实 MiniMax 同步路径 60-150s, 这里 await fetch 永挂; abort signal 触发后
     * fetch 抛 AbortError, 我们的 client 应当 emit 'cancelled' 而非 'failed'.
     */
    const fetchSpy = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    const ctrl = new AbortController()
    const events: string[] = []
    const p = client.generate(
      { prompt: 'p' },
      { signal: ctrl.signal, onProgress: (e) => events.push(e.kind) },
    )
    // 等一拍让 request_sent 先 emit 出来再触发 abort
    await new Promise((r) => setTimeout(r, 0))
    ctrl.abort()
    await expect(p).rejects.toThrow(/Aborted/)
    expect(events).toContain('request_sent')
    expect(events).toContain('cancelled')
    // 关键: 取消后不应继续走 'decoded' (那是 resolve 路径)
    expect(events).not.toContain('decoded')
  })

  it('onProgress: tick 心跳 —— 等待中至少有 1 次 tick', async () => {
    /*
     * 把 fetch 故意延迟 200ms, tickIntervalMs 设为 50ms,
     * 期望 await 完成前至少 emit 1 次 'tick'.
     */
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  data: { status: 2, audio: 'aa' },
                  base_resp: { status_code: 0, status_msg: 'ok' },
                }),
                { status: 200 },
              ),
            )
          }, 200)
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const client = createMinimaxMusicClient({ apiKey: 'k' })
    const ticks: number[] = []
    await client.generate(
      { prompt: 'p' },
      {
        tickIntervalMs: 50,
        onProgress: (e) => {
          if (e.kind === 'tick') ticks.push(e.elapsedMs)
        },
      },
    )
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    // tick.elapsedMs 单调递增 (不严格相等也行)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]!)
    }
  })
})
