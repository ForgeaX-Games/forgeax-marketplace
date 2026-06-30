import { describe, it, expect } from 'vitest'
import { buildReelGameAsset } from '../buildReelGameAsset'

const scenario = {
  id: 's1',
  title: 'demo',
  scenes: {
    '1.1': {
      id: '1.1',
      media: { kind: 'VIDEO', ref: 'm-aaa' },
      durationMs: 6000,
      dialogue: [],
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
    const rewritten = (entry.payload.scenario as never as Record<string, never>)['scenes']!['1.1']!
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
      scenes: {
        '1.1': { id: '1.1', media: { kind: 'IMAGE', ref: 'm-a' }, dialogue: [] },
        '1.2': { id: '1.2', media: { kind: 'IMAGE', ref: 'm-b' }, dialogue: [] },
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
    const sc = res.packJson.assets[0]!.payload.scenario as never as Record<string, never>
    expect(sc['scenes']!['1.1']!.media.ref).toBe('m-aaa')
    expect(res.missing).toHaveLength(1)
  })

  it('keeps external refs untouched and records them', async () => {
    const res = await buildReelGameAsset(scenario, {
      guid: '0190a0b1-0000-7000-8000-000000000004',
      resolveBlob: async () => ({ kind: 'external', url: 'https://cdn/x.mp4' }),
    })
    const sc = res.packJson.assets[0]!.payload.scenario as never as Record<string, never>
    expect(sc['scenes']!['1.1']!.media.ref).toBe('m-aaa')
    expect(res.external).toHaveLength(1)
  })
})
