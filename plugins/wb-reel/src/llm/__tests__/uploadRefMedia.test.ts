/**
 * uploadRefMedia · 前端参考媒体登记测试（2026-06 退役 Python Flask 后端后）
 * ======================================================================
 *
 * 新行为：不再上传到任何后端，直接 `URL.createObjectURL(file)` 生成 blob: URL，
 * 并在本层做体积上限 + MIME 大类校验。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadRefMedia, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES } from '../uploadRefMedia'

describe('uploadRefMedia', () => {
  beforeEach(() => {
    // jsdom 默认不实现 URL.createObjectURL —— stub 成可断言的假实现。
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((f: File) => `blob:mock/${f.name}`),
      revokeObjectURL: vi.fn(),
    })
    // 确保不会真的发网络请求（新实现不应调用 fetch）。
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('uploadRefMedia 不应再发起网络请求')
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('video：返回 blob: URL + 文件名/大小，且不发网络请求', async () => {
    const file = new File(['fakedata'], 'clip.mp4', { type: 'video/mp4' })
    const out = await uploadRefMedia(file, 'video')
    expect(out.kind).toBe('video')
    expect(out.url).toBe('blob:mock/clip.mp4')
    expect(out.filename).toBe('clip.mp4')
    expect(out.originalName).toBe('clip.mp4')
    expect(out.size).toBe(file.size)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('audio：MIME 大类匹配时通过', async () => {
    const file = new File(['x'], 'bgm.mp3', { type: 'audio/mpeg' })
    const out = await uploadRefMedia(file, 'audio')
    expect(out.kind).toBe('audio')
    expect(out.url).toBe('blob:mock/bgm.mp3')
  })

  it('超过体积上限 → 抛 [SIZE] 且带 MB 提示', async () => {
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' })
    // File.size 由内容决定，这里用 defineProperty 伪造超限大小
    Object.defineProperty(big, 'size', { value: MAX_VIDEO_BYTES + 1 })
    await expect(uploadRefMedia(big, 'video')).rejects.toThrow(/\[SIZE\]/)
  })

  it('MIME 大类不一致（把音频塞进视频槽）→ 抛 [EXPECT]', async () => {
    const file = new File(['x'], 'mislabel.mp3', { type: 'audio/mpeg' })
    await expect(uploadRefMedia(file, 'video')).rejects.toThrow(/\[EXPECT\]/)
  })

  it('File.type 为空 → 放过（不强制 MIME 校验）', async () => {
    const file = new File(['x'], 'noext', { type: '' })
    const out = await uploadRefMedia(file, 'audio')
    expect(out.url).toBe('blob:mock/noext')
    expect(out.size).toBeLessThan(MAX_AUDIO_BYTES)
  })
})
