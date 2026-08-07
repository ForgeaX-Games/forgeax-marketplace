import { describe, expect, it } from 'vitest'
import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import { createWbGameVideoRouter } from './router'

describe('wb-game-video media routing', () => {
  it('advertises the exact media surface backed by the product Kino provider', async () => {
    const response = await createWbGameVideoRouter({} as WorkbenchExtensionContext).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/capabilities',
      headers: {},
      query: {},
      body: new Uint8Array(),
    })

    expect(JSON.parse(new TextDecoder().decode(response.body))).toEqual({
      code: 0,
      message: 'ok',
      data: {
        provider: 'kino',
        media_types: ['image', 'video', 'audio'],
        upload_mimes: [
          'video/mp4', 'image/png', 'image/jpeg', 'image/webp',
          'audio/mpeg', 'audio/wav',
        ],
      },
    })
  })

  it('projects host media without accepting a caller-selected game', async () => {
    const context = {
      gameId: 'game-1',
      media: {
        list: async () => [{
          id: 'video-1',
          filename: 'clip.mp4',
          type: 'video',
          url: '/host/video-1',
          contentType: 'video/mp4',
        }],
      },
    } as unknown as WorkbenchExtensionContext
    const router = createWbGameVideoRouter(context)

    const response = await router.handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/resources',
      headers: {},
      query: { game_id: ['game-1'], media_type: ['video'], page: ['1'], page_size: ['100'] },
      body: new Uint8Array(),
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({
      code: 0,
      data: {
        total: 1,
        items: [{ resource_id: 'video-1', game_id: 'game-1' }],
      },
    })
  })

  it('rejects a game_id that differs from the host context', async () => {
    const context = {
      gameId: 'game-1',
      media: { list: async () => [] },
    } as unknown as WorkbenchExtensionContext
    const response = await createWbGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/resources',
      headers: {},
      query: { game_id: ['game-2'] },
      body: new Uint8Array(),
    })

    expect(response.status).toBe(400)
  })

  it('completes batch resources through resumable Host media without caller-selected games', async () => {
    const completed: string[] = []
    const context = {
      gameId: 'game-1',
      media: {
        createUpload: async () => { throw new Error('unused') },
        getUpload: async () => null,
        writeUploadChunk: async () => null,
        completeUpload: async (gameId: string, uploadId: string) => {
          completed.push(`${gameId}:${uploadId}`)
          return {
            id: `asset-${uploadId}`,
            filename: `${uploadId}.mp4`,
            type: 'video',
            url: `/host/${uploadId}`,
            contentType: 'video/mp4',
          }
        },
        update: async (_gameId: string, _assetId: string, input: { filename?: string }) => ({
          id: _assetId,
          filename: input.filename,
          type: 'video',
          url: `/host/${_assetId}`,
          contentType: 'video/mp4',
        }),
      },
    } as unknown as WorkbenchExtensionContext
    const response = await createWbGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'POST',
      path: 'media/resources/batch',
      headers: { 'content-type': ['application/json'] },
      query: {},
      body: new TextEncoder().encode(JSON.stringify({
        game_id: 'game-1',
        resources: [
          { url: 'workbench-upload:upload-1', name: 'one.mp4' },
          { url: 'workbench-upload:upload-2', name: 'two.mp4' },
        ],
      })),
    })

    expect(response.status).toBe(200)
    expect(completed).toEqual(['game-1:upload-1', 'game-1:upload-2'])
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({
      data: {
        created_count: 2,
        skipped_count: 0,
        items: [
          { resource_id: 'asset-upload-1', game_id: 'game-1' },
          { resource_id: 'asset-upload-2', game_id: 'game-1' },
        ],
      },
    })
  })

  it('does not expose the product Kino route through the extension router', async () => {
    const response = await createWbGameVideoRouter({} as WorkbenchExtensionContext).handle({
      gameId: 'game-1', runtimeId: 'runtime-1', method: 'GET', path: 'api/v1/kino/resources', headers: {}, query: {}, body: new Uint8Array(),
    })

    expect(response.status).toBe(404)
  })
})
