import { describe, expect, it } from 'vitest'
import {
  buildSeedanceContent,
  SEEDANCE_MAX_REF_IMAGES,
} from '../seedanceContent'

describe('buildSeedanceContent', () => {
  it('只 prompt（无参考） → 仅一个 text part', () => {
    const { content, warnings } = buildSeedanceContent({
      composedText: 'hello world',
    })
    expect(content).toEqual([{ type: 'text', text: 'hello world' }])
    expect(warnings).toEqual([])
  })

  it('http/https reference image 直通，不做协议守卫', () => {
    const { content, warnings } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: ['https://cdn.example/a.png'],
    })
    expect(content).toHaveLength(2)
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example/a.png' },
      role: 'reference_image',
    })
    expect(warnings).toEqual([])
  })

  it('data:base64 reference image 不再被跳过 —— 原样透传（由本地后端处理）', () => {
    const dataUri = 'data:image/png;base64,AAAA'
    const { content, warnings } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: [dataUri],
    })
    expect(content).toHaveLength(2)
    expect(content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: dataUri },
      role: 'reference_image',
    })
    expect(warnings).toEqual([])
  })

  it('/uploads/… 相对路径原样透传', () => {
    const { content } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: ['/uploads/20260507_foo.png'],
    })
    expect(content[1]).toMatchObject({
      image_url: { url: '/uploads/20260507_foo.png' },
    })
  })

  it('支持最多 9 张参考图（Seedance 2.0 上限）', () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://x/${i}.png`)
    const { content, warnings } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: urls,
    })
    // 1 text + 9 image_url
    expect(content).toHaveLength(10)
    expect(warnings).toEqual([])
    expect(SEEDANCE_MAX_REF_IMAGES).toBe(9)
  })

  it('超过 9 张会被截断并 warning', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x/${i}.png`)
    const { content, warnings } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: urls,
    })
    expect(content).toHaveLength(10) // 1 text + 9 images
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('已截断')
    // 留前 9 张
    expect((content[9] as { image_url: { url: string } }).image_url.url).toBe(
      'https://x/8.png',
    )
  })

  it('空串 / 全空格 / undefined 自动过滤', () => {
    const { content } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: [
        '',
        '   ',
        // @ts-expect-error 故意测 runtime 兜底
        undefined,
        'https://ok.example/a.png',
      ],
    })
    expect(content).toHaveLength(2)
    expect((content[1] as { image_url: { url: string } }).image_url.url).toBe(
      'https://ok.example/a.png',
    )
  })

  it('referenceVideoUrl / referenceAudioUrl 会追加到末尾', () => {
    const { content } = buildSeedanceContent({
      composedText: 'x',
      referenceImageUrls: ['https://x/a.png'],
      referenceVideoUrl: 'https://x/v.mp4',
      referenceAudioUrl: 'https://x/a.mp3',
    })
    expect(content).toHaveLength(4)
    expect(content[2]).toMatchObject({
      type: 'video_url',
      video_url: { url: 'https://x/v.mp4' },
      role: 'reference_video',
    })
    expect(content[3]).toMatchObject({
      type: 'audio_url',
      audio_url: { url: 'https://x/a.mp3' },
      role: 'reference_audio',
    })
  })

  describe('mode=frames（首尾帧模式，官方互斥语义）', () => {
    it('仅首帧 → text + first_frame', () => {
      const { content, warnings } = buildSeedanceContent({
        composedText: 'x',
        mode: 'frames',
        firstFrameUrl: 'https://x/first.png',
      })
      expect(content).toHaveLength(2)
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://x/first.png' },
        role: 'first_frame',
      })
      expect(warnings).toEqual([])
    })

    it('首帧 + 尾帧 → first_frame + last_frame', () => {
      const { content, warnings } = buildSeedanceContent({
        composedText: 'x',
        mode: 'frames',
        firstFrameUrl: 'https://x/first.png',
        lastFrameUrl: 'https://x/last.png',
      })
      expect(content).toHaveLength(3)
      expect(content[1]).toMatchObject({ role: 'first_frame' })
      expect(content[2]).toMatchObject({
        role: 'last_frame',
        image_url: { url: 'https://x/last.png' },
      })
      expect(warnings).toEqual([])
    })

    it('只有尾帧无首帧 → 丢弃尾帧并 warning', () => {
      const { content, warnings } = buildSeedanceContent({
        composedText: 'x',
        mode: 'frames',
        lastFrameUrl: 'https://x/last.png',
      })
      expect(content).toEqual([{ type: 'text', text: 'x' }])
      expect(warnings.some((w) => w.includes('尾帧必须配首帧'))).toBe(true)
    })

    it('首尾帧模式忽略多模态参考输入并 warning（互斥）', () => {
      const { content, warnings } = buildSeedanceContent({
        composedText: 'x',
        mode: 'frames',
        firstFrameUrl: 'https://x/first.png',
        referenceImageUrls: ['https://x/ref.png'],
        referenceVideoUrl: 'https://x/v.mp4',
      })
      // text + first_frame，绝不含 reference_image / reference_video
      expect(content).toHaveLength(2)
      expect(content.some((p) => 'role' in p && p.role === 'reference_image')).toBe(false)
      expect(content.some((p) => 'role' in p && p.role === 'reference_video')).toBe(false)
      expect(warnings.some((w) => w.includes('互斥'))).toBe(true)
    })
  })

  it('mode=reference（显式）与默认行为一致', () => {
    const { content } = buildSeedanceContent({
      composedText: 'x',
      mode: 'reference',
      referenceImageUrls: ['https://x/a.png'],
    })
    expect(content[1]).toMatchObject({ role: 'reference_image' })
  })
})
