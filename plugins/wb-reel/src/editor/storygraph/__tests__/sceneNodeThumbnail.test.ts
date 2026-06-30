import { describe, it, expect } from 'vitest'
import type { Scene } from '../../../scenario/types'
import type { SceneImageRecord } from '../../../media/sceneImageCache'
import type { MediaEntry } from '../../../media/mediaStore'
import { computeNodeThumbnail } from '../sceneNodeThumbnail'

function makeScene(patch: Partial<Scene> = {}): Scene {
  return {
    id: 'sc-1',
    title: '测试场景',
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    durationMs: 3000,
    dialogue: [],
    branches: [],
    ...patch,
  } as Scene
}

function mediaEntry(id: string, url: string, mimeType = 'image/png'): MediaEntry {
  return {
    id,
    name: `${id}.${mimeType.split('/')[1] ?? 'bin'}`,
    mimeType,
    size: 1000,
    url,
    createdAt: 1,
  }
}

describe('computeNodeThumbnail', () => {
  it('cache.ready 优先，直接拿 dataUrl', () => {
    const scene = makeScene()
    const cache: SceneImageRecord = {
      status: 'ready',
      dataUrl: '/__reel__/assets/a-1',
      prompt: '',
      latencyMs: 0,
    }
    const out = computeNodeThumbnail(scene, cache, {})
    expect(out).toEqual({
      url: '/__reel__/assets/a-1',
      status: 'ready',
      mediaKind: 'image',
    })
  })

  it('cache.pending 要保留 pending 状态，即使场景里写了关键帧也优先响应"生成中"提示', () => {
    const scene = makeScene({
      media: { kind: 'IMAGE_PROMPT', ref: 'm-1', prompt: '' },
    })
    const cache: SceneImageRecord = {
      status: 'pending',
      promise: Promise.resolve(null),
      prompt: '',
    }
    const media = { 'm-1': mediaEntry('m-1', 'blob:old') }
    const out = computeNodeThumbnail(scene, cache, media)
    expect(out.status).toBe('pending')
    expect(out.url).toBe('blob:old')
    expect(out.mediaKind).toBe('image')
  })

  it('cache.error 也兜底显示旧图 + error 状态', () => {
    const scene = makeScene({
      media: { kind: 'IMAGE_PROMPT', ref: 'm-1', prompt: '' },
    })
    const cache: SceneImageRecord = {
      status: 'error',
      message: 'boom',
      prompt: '',
    }
    const media = { 'm-1': mediaEntry('m-1', 'blob:x') }
    const out = computeNodeThumbnail(scene, cache, media)
    expect(out).toEqual({ url: 'blob:x', status: 'error', mediaKind: 'image' })
  })

  it('cache 缺失时，VIDEO scene.media.ref 命中 mediaStore → mediaKind=video（让 SceneNode 用 <video> 预览）', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
    })
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out).toEqual({
      url: 'blob:video',
      status: 'ready',
      mediaKind: 'video',
    })
  })

  it('cache 缺失时，IMAGE_PROMPT scene.media.ref 也能兜底', () => {
    const scene = makeScene({
      media: { kind: 'IMAGE_PROMPT', ref: 'm-1', prompt: '' },
    })
    const media = { 'm-1': mediaEntry('m-1', 'blob:img') }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out).toEqual({
      url: 'blob:img',
      status: 'ready',
      mediaKind: 'image',
    })
  })

  it('cache 和 media.ref 都无，但 keyShot 有 keyframeMediaRef，命中', () => {
    const scene = makeScene({
      keyShotId: 'sh-1',
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-shot',
        },
      ],
    } as Partial<Scene>)
    const media = { 'm-shot': mediaEntry('m-shot', 'blob:shot') }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out).toEqual({
      url: 'blob:shot',
      status: 'ready',
      mediaKind: 'image',
    })
  })

  it('shot.keyframeMediaRef 指向视频 → mediaKind=video', () => {
    const scene = makeScene({
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-shot-vid',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-shot-vid': mediaEntry('m-shot-vid', 'blob:sv', 'video/webm'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.mediaKind).toBe('video')
    expect(out.url).toBe('blob:sv')
  })

  it('没 keyShotId 时用 shots[0]', () => {
    const scene = makeScene({
      shots: [
        {
          id: 'sh-first',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-first',
        },
      ],
    } as Partial<Scene>)
    const media = { 'm-first': mediaEntry('m-first', 'blob:first') }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.url).toBe('blob:first')
  })

  it('ref 指向不存在的 mediaId 时，返回 empty', () => {
    const scene = makeScene({
      media: { kind: 'IMAGE_PROMPT', ref: 'm-gone', prompt: '' },
    })
    const out = computeNodeThumbnail(scene, undefined, {})
    expect(out).toEqual({
      url: undefined,
      status: 'empty',
      mediaKind: 'image',
    })
  })

  it('完全什么都没有时 empty', () => {
    expect(computeNodeThumbnail(makeScene(), undefined, {})).toEqual({
      url: undefined,
      status: 'empty',
      mediaKind: 'image',
    })
  })

  it('mimeType 缺失时保守当 image（避免把未知类型丢给 <video>）', () => {
    const scene = makeScene({
      media: { kind: 'PLACEHOLDER', ref: 'm-u' },
    })
    const entry: MediaEntry = {
      id: 'm-u',
      name: 'x',
      mimeType: '',
      size: 0,
      url: 'blob:u',
      createdAt: 0,
    }
    const out = computeNodeThumbnail(scene, undefined, { 'm-u': entry })
    expect(out.mediaKind).toBe('image')
  })
})

describe('computeNodeThumbnail · posterUrl（视频节点静态封面）', () => {
  it('视频节点 + keyShot.keyframeMediaRef 指向图片 → posterUrl 填入该图 URL', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
      keyShotId: 'sh-1',
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-poster',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
      'm-poster': mediaEntry('m-poster', 'blob:poster', 'image/png'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.mediaKind).toBe('video')
    expect(out.url).toBe('blob:video')
    expect(out.posterUrl).toBe('blob:poster')
  })

  it('没 keyShotId 时退化到 shots[0].keyframeMediaRef 当封面', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
      shots: [
        {
          id: 'sh-first',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-first-img',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
      'm-first-img': mediaEntry('m-first-img', 'blob:first', 'image/png'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.posterUrl).toBe('blob:first')
  })

  it('视频节点但没有 shots / 关键帧 → posterUrl 为 undefined（SceneNode 自己回退抓首帧）', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
    })
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.mediaKind).toBe('video')
    expect(out.url).toBe('blob:video')
    expect(out.posterUrl).toBeUndefined()
  })

  it('关键帧 ref 意外指向另一段视频时 → 不当封面（避免 <img> 加载视频失败）', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
      keyShotId: 'sh-1',
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-bad',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
      'm-bad': mediaEntry('m-bad', 'blob:bad', 'video/mp4'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.posterUrl).toBeUndefined()
  })

  it('keyShot 无关键帧但 shots[0] 有 → 用 shots[0] 当封面', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
      keyShotId: 'sh-2',
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-img-0',
        },
        {
          id: 'sh-2',
          order: 1,
          framing: 'close',
          prompt: '',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
      'm-img-0': mediaEntry('m-img-0', 'blob:k0', 'image/png'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.posterUrl).toBe('blob:k0')
  })

  it('纯 image 节点不应带 posterUrl（它本身就是静图）', () => {
    const scene = makeScene({
      media: { kind: 'IMAGE_PROMPT', ref: 'm-1', prompt: '' },
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-other',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-1': mediaEntry('m-1', 'blob:img'),
      'm-other': mediaEntry('m-other', 'blob:other'),
    }
    const out = computeNodeThumbnail(scene, undefined, media)
    expect(out.mediaKind).toBe('image')
    expect(out.posterUrl).toBeUndefined()
  })

  it('cache.pending/error 时即便底图是视频也不填 posterUrl（状态层级优先）', () => {
    const scene = makeScene({
      media: { kind: 'VIDEO', ref: 'm-vid' },
      keyShotId: 'sh-1',
      shots: [
        {
          id: 'sh-1',
          order: 0,
          framing: 'medium',
          prompt: '',
          keyframeMediaRef: 'm-poster',
        },
      ],
    } as Partial<Scene>)
    const media = {
      'm-vid': mediaEntry('m-vid', 'blob:video', 'video/mp4'),
      'm-poster': mediaEntry('m-poster', 'blob:poster', 'image/png'),
    }
    const pending: SceneImageRecord = {
      status: 'pending',
      promise: Promise.resolve(null),
      prompt: '',
    }
    const out = computeNodeThumbnail(scene, pending, media)
    expect(out.status).toBe('pending')
    expect(out.posterUrl).toBeUndefined()
  })
})
