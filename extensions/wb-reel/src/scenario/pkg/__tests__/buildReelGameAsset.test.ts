import { describe, it, expect } from 'vitest'
import { buildReelGameAsset } from '../buildReelGameAsset'

const scenario = {
  id: 's1',
  title: 'demo',
  rootSceneId: '1.1',
  schemaVersion: 8,
  defaultCharMs: 30,
  scenes: {
    '1.1': {
      id: '1.1',
      title: '镜头一',
      media: { kind: 'VIDEO', ref: 'm-aaa' },
      durationMs: 6000,
      dialogue: [],
      branches: [],
    },
  },
} as never

describe('buildReelGameAsset', () => {
  it('rewrites media refs to ./reel-media/<hash>.<ext> and emits the pack + files', async () => {
    const res = await buildReelGameAsset(scenario, {
      guid: '0190a0b1-0000-7000-8000-000000000001',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([1, 2, 3]), ext: 'mp4' }),
    })
    const entry = res.packJson.assets[0]!
    expect(entry.kind).toBe('reel-game')
    expect(entry.guid).toBe('0190a0b1-0000-7000-8000-000000000001')
    const rewritten = (entry.payload.scenario as unknown as { scenes: Record<string, { media: { ref: string } }> })['scenes']!['1.1']!
      .media.ref as string
    expect(rewritten).toMatch(/^\.\/reel-media\/[0-9a-f]{16}\.mp4$/)
    expect(res.mediaFiles).toHaveLength(1)
    expect(res.mediaFiles[0]!.path).toBe(rewritten.replace('./', ''))
    expect(res.mediaFiles[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('deduplicates identical bytes into a single media file', async () => {
    const twoRefs = {
      id: 's2',
      title: 'dup',
      rootSceneId: '1.1',
      schemaVersion: 8,
      defaultCharMs: 30,
      scenes: {
        '1.1': { id: '1.1', title: 'a', durationMs: 1000, media: { kind: 'IMAGE', ref: 'm-a' }, dialogue: [], branches: [] },
        '1.2': { id: '1.2', title: 'b', durationMs: 1000, media: { kind: 'IMAGE', ref: 'm-b' }, dialogue: [], branches: [] },
      },
    } as never
    const res = await buildReelGameAsset(twoRefs, {
      guid: '0190a0b1-0000-7000-8000-000000000003',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([9, 9]), ext: 'png' }),
    })
    expect(res.mediaFiles).toHaveLength(1)
  })

  it('leaves the ref unchanged and records it when media is missing', async () => {
    const res = await buildReelGameAsset(scenario, {
      guid: '0190a0b1-0000-7000-8000-000000000002',
      resolveBlob: async () => ({ kind: 'missing', reason: 'gone' }),
    })
    const sc = res.packJson.assets[0]!.payload.scenario as unknown as { scenes: Record<string, { media: { ref: string } }> }
    expect(sc['scenes']!['1.1']!.media.ref).toBe('m-aaa')
    expect(res.missing).toHaveLength(1)
  })

  it('keeps external refs untouched and records them', async () => {
    const res = await buildReelGameAsset(scenario, {
      guid: '0190a0b1-0000-7000-8000-000000000004',
      resolveBlob: async () => ({ kind: 'external', url: 'https://cdn/x.mp4' }),
    })
    const sc = res.packJson.assets[0]!.payload.scenario as unknown as { scenes: Record<string, { media: { ref: string } }> }
    expect(sc['scenes']!['1.1']!.media.ref).toBe('m-aaa')
    expect(res.external).toHaveLength(1)
  })

  it('emits a VideoAsset media asset for VIDEO media and fills the entry refs', async () => {
    const res = await buildReelGameAsset(scenario, {
      guid: '0190a0b1-0000-7000-8000-000000000010',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([1, 2, 3]), ext: 'mp4' }),
    })
    const entry = res.packJson.assets[0]!
    const media = res.packJson.assets.slice(1)
    expect(media).toHaveLength(1)
    const vid = media[0]!
    expect(vid.kind).toBe('video') // VideoAsset (引擎自有 kind)
    expect(vid.payload.url).toMatch(/^\.\/reel-media\/[0-9a-f]{16}\.mp4$/)
    expect(vid.payload).not.toHaveProperty('mime') // VideoAsset 只带 url
    expect(vid.refs).toEqual([])
    // 入口 refs = 引用到的媒体 GUID
    expect(entry.refs).toEqual([vid.guid])
    // GUID 是合法 UUIDv8 形态
    expect(vid.guid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('emits a raw-file media asset (with mime) for image media', async () => {
    const imgScenario = {
      id: 's-img', title: 'img', rootSceneId: '1.1', schemaVersion: 8, defaultCharMs: 30,
      scenes: { '1.1': { id: '1.1', title: 'a', durationMs: 1000, media: { kind: 'IMAGE', ref: 'm-a' }, dialogue: [], branches: [] } },
    } as never
    const res = await buildReelGameAsset(imgScenario, {
      guid: '0190a0b1-0000-7000-8000-000000000011',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([7, 7]), ext: 'png' }),
    })
    const img = res.packJson.assets[1]!
    expect(img.kind).toBe('raw-file')
    expect(img.payload.url).toMatch(/^\.\/reel-media\/[0-9a-f]{16}\.png$/)
    expect(img.payload.mime).toBe('image/png')
  })

  it('deduplicates identical bytes into a single media asset + single ref, deterministic GUID', async () => {
    const twoRefs = {
      id: 's2', title: 'dup', rootSceneId: '1.1', schemaVersion: 8, defaultCharMs: 30,
      scenes: {
        '1.1': { id: '1.1', title: 'a', durationMs: 1000, media: { kind: 'IMAGE', ref: 'm-a' }, dialogue: [], branches: [] },
        '1.2': { id: '1.2', title: 'b', durationMs: 1000, media: { kind: 'IMAGE', ref: 'm-b' }, dialogue: [], branches: [] },
      },
    } as never
    const res = await buildReelGameAsset(twoRefs, {
      guid: '0190a0b1-0000-7000-8000-000000000012',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([9, 9]), ext: 'png' }),
    })
    expect(res.mediaFiles).toHaveLength(1)
    const media = res.packJson.assets.slice(1)
    expect(media).toHaveLength(1)
    expect(res.packJson.assets[0]!.refs).toEqual([media[0]!.guid])
    // 同字节 ⇒ 同 GUID（内容寻址确定性）
    const res2 = await buildReelGameAsset(twoRefs, {
      guid: '0190a0b1-0000-7000-8000-000000000099',
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([9, 9]), ext: 'png' }),
    })
    expect(res2.packJson.assets[1]!.guid).toBe(media[0]!.guid)
  })
})
