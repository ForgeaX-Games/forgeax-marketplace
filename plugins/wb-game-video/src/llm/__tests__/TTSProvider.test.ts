import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createTtsClient,
  TTS_VOICE_PRESETS,
  DEFAULT_TTS_SAMPLE_TEXT,
} from '../TTSProvider'

/*
 * TTSProvider · TTS HTTP 客户端
 *
 * 设计契约:
 *   - 没 key/appId -> mock 路径, 返回 silent mp3 dataUrl, mock=true
 *   - 有 key/appId -> 走 fetch, 鉴权 header "Bearer; <key>" (注意分号)
 *   - HTTP 错 / code !== 3000 -> 抛 Error
 *   - DEFAULT_TTS_SAMPLE_TEXT 同时含有中文 / 数字 / 英文, 这是测试音色的关键
 *   - 内置音色 preset 至少含 1 男 1 女 1 童 1 特色
 */

describe('TTSProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mock 路径: 缺 key/appId -> silent mp3 占位, 不打网络', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const client = createTtsClient({ apiKey: '', appId: '' })
    const result = await client.synth({
      text: 'hello',
      voiceType: 'BV001_streaming',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.mock).toBe(true)
    expect(result.dataUrl.startsWith('data:audio/mpeg;base64,')).toBe(true)
    expect(result.base64.length).toBeGreaterThan(50)
  })

  it('真路径: 鉴权 header 带 "Bearer; <key>", body 结构符合上游协议', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 3000,
          message: 'Success',
          data: 'AAAA',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const client = createTtsClient({
      apiKey: 'tok-xyz',
      appId: 'app-123',
    })
    const result = await client.synth({
      text: '你好',
      voiceType: 'BV700_streaming',
      speedRatio: 1.2,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('/__tts__/api/v1/tts')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer; tok-xyz')
    const sentBody = JSON.parse(init.body) as Record<string, any>
    expect(sentBody.app.appid).toBe('app-123')
    expect(sentBody.app.cluster).toBe('volcano_tts')
    expect(sentBody.audio.voice_type).toBe('BV700_streaming')
    expect(sentBody.audio.speed_ratio).toBe(1.2)
    expect(sentBody.request.text).toBe('你好')
    expect(sentBody.request.operation).toBe('query')

    expect(result.mock).toBeUndefined()
    expect(result.dataUrl).toBe('data:audio/mpeg;base64,AAAA')
    expect(result.voiceType).toBe('BV700_streaming')
  })

  it('真路径: code !== 3000 -> 抛 Error 含 message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 4000,
            message: 'invalid voice_type',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const client = createTtsClient({ apiKey: 't', appId: 'a' })
    await expect(
      client.synth({ text: 'x', voiceType: 'INVALID' }),
    ).rejects.toThrow(/code=4000.*invalid voice_type/)
  })

  it('真路径: HTTP 非 2xx -> 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 503 })),
    )
    const client = createTtsClient({ apiKey: 't', appId: 'a' })
    await expect(
      client.synth({ text: 'x', voiceType: 'BV001_streaming' }),
    ).rejects.toThrow(/HTTP 503/)
  })

  it('preset 列表覆盖男女童特色四种 gender, voiceType 不重复', () => {
    const genders = new Set(TTS_VOICE_PRESETS.map((p) => p.gender))
    expect(genders.has('female')).toBe(true)
    expect(genders.has('male')).toBe(true)
    expect(genders.has('child')).toBe(true)
    expect(genders.has('special')).toBe(true)
    const ids = TTS_VOICE_PRESETS.map((p) => p.voiceType)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('默认试听文本同时含中文 + 数字 + 英文, 便于一耳判断音色', () => {
    expect(DEFAULT_TTS_SAMPLE_TEXT).toMatch(/[\u4e00-\u9fa5]/)
    expect(DEFAULT_TTS_SAMPLE_TEXT).toMatch(/[0-9]/)
    expect(DEFAULT_TTS_SAMPLE_TEXT).toMatch(/[A-Za-z]/)
  })
})
