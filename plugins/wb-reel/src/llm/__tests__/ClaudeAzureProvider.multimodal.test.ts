/**
 * Phase 5 · 多模态（image content blocks）契约测试。
 *
 * 关心三件事：
 *   1. 不传 images → content 仍是 string（向后兼容，老调用零回归）。
 *   2. 传 images → content 是 block 数组，先 image 后 text；data URL 前缀被剥离。
 *   3. 非法 data URL / 非白名单 mime → 抛对应错误，让调用方决定退路径。
 *
 * 这里不依赖任何 LLM 网络调用，全部用 fetch mock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeAzureProvider } from '../ClaudeAzureProvider'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

interface CapturedRequest {
  url: string
  body: Record<string, unknown>
}

function installFetchMock(): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = []
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: BodyInit }) => {
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(bodyText) as Record<string, unknown>
    } catch {
      parsed = { _raw: bodyText }
    }
    captured.push({ url: String(url), body: parsed })
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { captured }
}

function makeProvider(): ClaudeAzureProvider {
  return new ClaudeAzureProvider({
    apiKey: 'k',
    apiBase: 'https://example/anthropic',
    model: 'claude-opus-4-6',
  })
}

describe('ClaudeAzureProvider · multimodal (Phase 5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('不传 images：messages[0].content 仍是字符串（向后兼容）', async () => {
    const { captured } = installFetchMock()
    const llm = makeProvider()

    await llm.generate({ systemPrompt: 'sys', userPrompt: 'hello world' })

    expect(captured.length).toBe(1)
    const messages = (captured[0]?.body.messages as { content: unknown }[]) ?? []
    expect(messages[0]?.content).toBe('hello world')
  })

  it('传 images：content 是 block 数组，先 image 后 text，base64 前缀已剥离', async () => {
    const { captured } = installFetchMock()
    const llm = makeProvider()

    await llm.generate({
      systemPrompt: 'sys',
      userPrompt: '请描述这张图',
      images: [{ dataUrl: PNG_DATA_URL, label: '概念图 #1' }],
    })

    const blocks = (captured[0]?.body.messages as { content: unknown }[])[0]
      ?.content as Array<Record<string, unknown>>
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks).toHaveLength(2)

    expect(blocks[0]?.type).toBe('image')
    const source = blocks[0]?.source as Record<string, unknown>
    expect(source.type).toBe('base64')
    expect(source.media_type).toBe('image/png')
    expect(source.data).toBe(PNG_BASE64)
    expect(String(source.data)).not.toMatch(/^data:/)

    expect(blocks[1]?.type).toBe('text')
    expect(blocks[1]?.text).toBe('请描述这张图')
  })

  it('多张图：全部图片排在文本之前（vision 最佳实践）', async () => {
    const { captured } = installFetchMock()
    const llm = makeProvider()

    await llm.generate({
      systemPrompt: 'sys',
      userPrompt: 'describe all',
      images: [
        { dataUrl: PNG_DATA_URL, label: 'a' },
        { dataUrl: PNG_DATA_URL, label: 'b' },
      ],
    })

    const blocks = (captured[0]?.body.messages as { content: unknown }[])[0]
      ?.content as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.type).toBe('image')
    expect(blocks[1]?.type).toBe('image')
    expect(blocks[2]?.type).toBe('text')
  })

  it('非 base64 data URL → 抛 [MULTIMODAL_BAD_DATA_URL]', async () => {
    installFetchMock()
    const llm = makeProvider()

    await expect(
      llm.generate({
        systemPrompt: 'sys',
        userPrompt: 'x',
        images: [{ dataUrl: 'https://example.com/foo.png', label: 'bad' }],
      }),
    ).rejects.toThrow(/MULTIMODAL_BAD_DATA_URL/)
  })

  it('非白名单 mime（image/svg+xml）→ 抛 [MULTIMODAL_BAD_MIME]', async () => {
    installFetchMock()
    const llm = makeProvider()

    await expect(
      llm.generate({
        systemPrompt: 'sys',
        userPrompt: 'x',
        images: [{ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', label: 'bad' }],
      }),
    ).rejects.toThrow(/MULTIMODAL_BAD_MIME/)
  })

  it('jpeg / webp / gif 都通过白名单', async () => {
    const { captured } = installFetchMock()
    const llm = makeProvider()

    for (const mime of ['image/jpeg', 'image/webp', 'image/gif']) {
      await llm.generate({
        systemPrompt: 'sys',
        userPrompt: 'x',
        images: [{ dataUrl: `data:${mime};base64,${PNG_BASE64}` }],
      })
    }

    expect(captured).toHaveLength(3)
    for (const c of captured) {
      const blocks = (c.body.messages as { content: unknown }[])[0]
        ?.content as Array<Record<string, unknown>>
      expect(blocks[0]?.type).toBe('image')
    }
  })
})
