import { describe, expect, test, vi } from 'vitest'
import { resolveAssetImagePayload, type OrchestrateCtx } from './orchestrate'
import type { MediaAsset } from '../../src/editor/assets/registry-types'

describe('provider-backed generation references', () => {
  test('loads uploaded images through the shared content API', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
    const ctx: OrchestrateCtx = {
      dir: '/tmp/assets',
      gameId: 'demo-game',
      env: { FORGEAX_SERVER_PORT: '18999' },
      fetchImpl,
    }
    const asset: MediaAsset = {
      id: 'uploaded-image',
      kind: 'image',
      productionType: 'character_ref',
      status: 'ready',
      provider: { kind: 'cos', ref: 'demo/uploaded-image.png' },
      createdAt: 1,
      updatedAt: 1,
    }

    const payload = await resolveAssetImagePayload(ctx, asset)
    expect(payload).toMatchObject({
      base64: 'AQID',
      dataUrl: 'data:image/png;base64,AQID',
      mime: 'image/png',
    })
    expect([...payload.bytes]).toEqual([1, 2, 3])
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:18999/api/v1/kino/resources/uploaded-image/content?game_id=demo-game',
    )
  })

  test('fails loudly when provider content cannot be read', async () => {
    const asset: MediaAsset = {
      id: 'missing-image',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      provider: { kind: 's3', ref: 'demo/missing-image.png' },
      createdAt: 1,
      updatedAt: 1,
    }

    await expect(resolveAssetImagePayload({
      dir: '/tmp/assets',
      gameId: 'demo-game',
      env: {},
      fetchImpl: vi.fn(async () => new Response(null, { status: 404 })),
    }, asset)).rejects.toThrow('参考图 missing-image 读取失败（HTTP 404）')
  })
})
