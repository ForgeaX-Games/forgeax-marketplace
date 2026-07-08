/**
 * SeedanceProvider 集成测试（v3.9 · 对齐 2026-05 官方样例）
 *
 * 重点（新）：
 *   1. request body 顶层字段：model / ratio / duration / generate_audio / watermark
 *   2. content[] 里的 role 标签：reference_image（最多 2）/ reference_video / reference_audio
 *   3. prompt 文本部分**不再**拼 `--resolution` / `--ratio` / `--duration`
 *   4. 旧入口 referenceImageDataUrl 仍等价于首帧（兼容已有调用点）
 *
 * 策略：mock 全局 fetch，抓 createTask 的 request body，断言结构。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SeedanceProvider } from '../VideoProvider'

interface MockCall {
  url: string
  body?: string
}

function mockFetchOkFlow(): { calls: MockCall[] } {
  const calls: MockCall[] = []
  let pollCount = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, body: bodyStr })

      if (init?.method === 'POST' && url.endsWith('/tasks')) {
        return new Response(JSON.stringify({ id: 'task-mock-1' }), {
          status: 200,
        }) as unknown as Response
      }
      pollCount++
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({ id: 'task-mock-1', status: 'running' }),
          { status: 200 },
        ) as unknown as Response
      }
      return new Response(
        JSON.stringify({
          id: 'task-mock-1',
          status: 'succeeded',
          content: { video_url: 'https://cdn.example/mock.mp4' },
        }),
        { status: 200 },
      ) as unknown as Response
    }),
  )
  return { calls }
}

interface SeedanceBody {
  model: string
  content: Array<Record<string, unknown>>
  ratio?: string
  duration?: number
  generate_audio?: boolean
  watermark?: boolean
}

describe('SeedanceProvider · 真实 API 契约（顶层字段 + role 标签）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function runWithFastPoll<T>(run: () => Promise<T>): Promise<T> {
    const p = run()
    await vi.runAllTimersAsync()
    return p
  }

  function parsePost(calls: MockCall[]): SeedanceBody {
    const post = calls.find((c) => c.url.endsWith('/tasks'))
    expect(post).toBeDefined()
    return JSON.parse(post!.body!) as SeedanceBody
  }

  it('T2V · 默认 1080p → body 顶层 ratio/duration/generate_audio/watermark', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      size: '1080p',
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: '一个镜头', durationSec: 5 }),
    )
    const body = parsePost(calls)
    expect(body.ratio).toBe('16:9')
    expect(body.duration).toBe(5)
    // generateAudio 默认开启（与官方样例一致）
    expect(body.generate_audio).toBe(true)
    expect(body.watermark).toBe(false)

    // prompt 文本不再含 CLI 风格参数
    const textEntry = body.content.find((c) => c.type === 'text') as {
      text: string
    }
    expect(textEntry.text).not.toMatch(/--resolution/)
    expect(textEntry.text).not.toMatch(/--ratio/)
    expect(textEntry.text).not.toMatch(/--duration/)
    expect(textEntry.text).toBe('一个镜头')
  })

  it('竖屏 1080p-portrait → body.ratio = 9:16', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      size: '1080p-portrait',
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: '竖屏', durationSec: 10 }),
    )
    expect(parsePost(calls).ratio).toBe('9:16')
  })

  it('I2V · 单首帧（旧入口 referenceImageDataUrl）→ role=first_frame（官方图生视频语义）', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
    })
    await runWithFastPoll(() =>
      prov.generate({
        prompt: 'I2V',
        durationSec: 5,
        referenceImageDataUrl: 'https://cdn.example/a.png',
      }),
    )
    const body = parsePost(calls)
    const imgs = body.content.filter((c) => c.type === 'image_url') as Array<{
      image_url: { url: string }
      role: string
    }>
    expect(imgs).toHaveLength(1)
    expect(imgs[0].image_url.url).toBe('https://cdn.example/a.png')
    // 订正：单张图生视频是「首帧」语义，role=first_frame（非 reference_image）
    expect(imgs[0].role).toBe('first_frame')
    expect(body.ratio).toBe('16:9')
  })

  it('首尾帧双图 · first_frame + last_frame 顺序 A→B（首尾帧模式）', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({ provider: 'seedance', apiKey: 'k' })
    await runWithFastPoll(() =>
      prov.generate({
        prompt: 'AB',
        durationSec: 5,
        startFrameImageUrl: 'https://cdn/a.png',
        endFrameImageUrl: 'https://cdn/b.png',
      }),
    )
    const body = parsePost(calls)
    const imgs = body.content.filter((c) => c.type === 'image_url') as Array<{
      image_url: { url: string }
      role: string
    }>
    expect(imgs).toHaveLength(2)
    expect(imgs[0].image_url.url).toBe('https://cdn/a.png')
    expect(imgs[0].role).toBe('first_frame')
    expect(imgs[1].image_url.url).toBe('https://cdn/b.png')
    expect(imgs[1].role).toBe('last_frame')
  })

  it('多模态参考模式 · reference_image×2 + 1 video + 1 audio，各带 role 标签', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({ provider: 'seedance', apiKey: 'k' })
    await runWithFastPoll(() =>
      prov.generate({
        prompt: '全量',
        durationSec: 11,
        mode: 'reference',
        referenceImageUrls: ['https://cdn/a.png', 'https://cdn/b.png'],
        referenceVideoUrl: 'https://cdn/v.mp4',
        referenceAudioUrl: 'https://cdn/s.mp3',
      }),
    )
    const body = parsePost(calls)
    const byType = (t: string) => body.content.filter((c) => c.type === t)
    expect(byType('image_url')).toHaveLength(2)
    expect((byType('image_url')[0] as { role: string }).role).toBe('reference_image')
    expect(byType('video_url')).toHaveLength(1)
    expect(byType('audio_url')).toHaveLength(1)
    const video = byType('video_url')[0] as { role: string }
    const audio = byType('audio_url')[0] as { role: string }
    expect(video.role).toBe('reference_video')
    expect(audio.role).toBe('reference_audio')
    expect(body.duration).toBe(11)
  })

  it('VideoConfig.generateAudio=false 可关闭自动出音轨', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      generateAudio: false,
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: 'noBGM', durationSec: 5 }),
    )
    expect(parsePost(calls).generate_audio).toBe(false)
  })

  it('VideoRequest.generateAudio 优先级高于 VideoConfig', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      generateAudio: true,
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: 'x', durationSec: 5, generateAudio: false }),
    )
    expect(parsePost(calls).generate_audio).toBe(false)
  })

  it('VideoConfig.watermark=true 写进 body', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      watermark: true,
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: 'mark', durationSec: 5 }),
    )
    expect(parsePost(calls).watermark).toBe(true)
  })

  it('model 字段原样透传（支持 endpoint id "ep-xxx" 或 "doubao-*"）', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      model: 'ep-xxxxxxxxxxxxxx-xxxxx',
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: 'x', durationSec: 5 }),
    )
    expect(parsePost(calls).model).toBe('ep-xxxxxxxxxxxxxx-xxxxx')
  })

  it('持久化老数据 · size=1280x720 → resolution 720p + ratio 16:9（订正：resolution 是真字段）', async () => {
    const { calls } = mockFetchOkFlow()
    const prov = new SeedanceProvider({
      provider: 'seedance',
      apiKey: 'k',
      size: '1280x720',
    })
    await runWithFastPoll(() =>
      prov.generate({ prompt: 'legacy', durationSec: 5 }),
    )
    const body = parsePost(calls) as SeedanceBody & { resolution?: string }
    expect(body.ratio).toBe('16:9')
    // 订正：当前官方文档 resolution 为真字段，现在直接下发
    expect(body.resolution).toBe('720p')
  })
})

describe('SeedanceProvider · v6 P3-C · 独立 createTask / pollTask（store 接管路径）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function flush<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return p
  }

  it('createTask 只提交，返回 taskId 和 warnings', async () => {
    mockFetchOkFlow()
    const prov = new SeedanceProvider({ provider: 'seedance', apiKey: 'k' })
    const res = await prov.createTask({ prompt: 'hi', durationSec: 5 })
    expect(res.taskId).toBe('task-mock-1')
    expect(Array.isArray(res.warnings)).toBe(true)
  })

  it('pollTask 在 succeeded 时返回 { status: completed, videoUrl }', async () => {
    mockFetchOkFlow()
    const prov = new SeedanceProvider({ provider: 'seedance', apiKey: 'k' })
    const updates: Array<{ status: string; api_status?: string }> = []
    const result = await flush(
      prov.pollTask('task-mock-1', {
        onUpdate: (t) => updates.push({ status: t.status, api_status: t.api_status }),
        pollIntervalMs: 10,
      }),
    )
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://cdn.example/mock.mp4')
    // 至少一次 onUpdate（running → generating 映射）
    expect(updates.some((u) => u.api_status === 'running')).toBe(true)
    expect(updates.some((u) => u.status === 'generating')).toBe(true)
  })

  it('getProviderKind 返回 "seedance"', () => {
    const prov = new SeedanceProvider({ provider: 'seedance', apiKey: 'k' })
    expect(prov.getProviderKind()).toBe('seedance')
  })
})
