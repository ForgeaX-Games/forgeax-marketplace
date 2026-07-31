import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AssetLibraryUploadError,
  createExternalKinoAssetLibraryClient,
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  type ManagedAsset,
  useAssetLibrary,
} from '../assetLibraryClient'
import type { ExternalKinoResourceDTO, ExternalKinoVideoClient } from '../kino-api'
import type { UploadTransport } from '../video-upload'

const extensionFetch = vi.fn()

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => ({ extension: { fetch: extensionFetch } }),
  readExtensionJson: (response: Response) => response.json(),
}))

function client(): AssetLibraryClient {
  return {
    list: vi.fn(async (kind): Promise<ManagedAsset[]> => {
      if (kind === 'image') return [{ id: 'image-1', kind, name: '封面', mime: 'image/png' }]
      if (kind === 'audio') return [{ id: 'bgm-1', kind, name: '主题曲', mime: 'audio/mpeg' }]
      return [{ id: 'title.woff2', kind, name: '标题字体', mime: 'font/woff2', source: 'local' }]
    }),
    upload: vi.fn(async (kind, file): Promise<ManagedAsset> => ({ id: `${kind}-new`, kind, name: file.name })),
    rename: vi.fn(async (id, name): Promise<ManagedAsset> => ({ id, kind: id.startsWith('bgm') ? 'audio' : 'image', name })),
    remove: vi.fn(async () => {}),
  }
}

describe('useAssetLibrary', () => {
  it('reports the missing API rather than pretending the manifest is empty', async () => {
    const { result } = renderHook(() => useAssetLibrary())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)
    expect(result.current.error).toMatch(/尚未启用/)
  })

  it('loads all asset groups from an injected client', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary(api))

    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(api.list).toHaveBeenCalledWith('image', expect.anything())
    expect(api.list).toHaveBeenCalledWith('audio', expect.anything())
    expect(api.list).toHaveBeenCalledWith('font', expect.anything())
    expect(result.current.items.map((item) => item.kind)).toEqual(['image', 'audio', 'font'])
  })

  it('updates local state after uploading, renaming, and deleting', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary(api))
    await waitFor(() => expect(result.current.items).toHaveLength(3))

    await act(async () => {
      await result.current.upload('image', new File(['x'], 'new.png', { type: 'image/png' }))
      await result.current.rename('image-new', '新封面')
      await result.current.remove('image-new')
    })

    expect(api.upload).toHaveBeenCalledWith('image', expect.any(File))
    expect(api.rename).toHaveBeenCalledWith('image-new', '新封面')
    expect(api.remove).toHaveBeenCalledWith('image-new')
    expect(result.current.items.find((item) => item.id === 'image-new')).toBeUndefined()
  })
})

function resource(overrides: Partial<ExternalKinoResourceDTO> = {}): ExternalKinoResourceDTO {
  return {
    resource_id: 'audio-1',
    game_id: 'demo',
    media_type: 'audio',
    name: '主题曲',
    url: 'https://storage.example/theme.mp3',
    source: 'wb-game-video',
    source_meta: { mime_type: 'audio/mpeg', extra: { bytes: 12 } },
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

function kino(): ExternalKinoVideoClient {
  return {
    prepareUpload: vi.fn(async () => ({
      upload: { method: 'PUT' as const, url: 'https://storage.example/upload', headers: {}, expires_at: '2099-01-01' },
      object_url: 'https://storage.example/object',
      upload_token: 'token',
    })),
    list: vi.fn(async () => ({ items: [resource()], total: 1, page: 1, page_size: 100 })),
    get: vi.fn(async () => resource()),
    create: vi.fn(async () => resource()),
    batch: vi.fn(),
    update: vi.fn(async () => resource({ name: '新主题曲' })),
    delete: vi.fn(async () => {}),
    playbackUrl: vi.fn((id, game) => `/api/v1/kino/resources/${id}/content?game_id=${game}`),
  }
}

describe('createKinoAssetLibraryClient', () => {
  it('uses host-bound media routes without sending or requiring a caller game id', async () => {
    const { game_id: _gameId, ...response } = resource({ url: '/host/media/audio-1', name: '原名' })
    const uploadId = '0123456789abcdef0123456789abcdef'
    extensionFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { items: [response] } }), {
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: {
        upload: {
          method: 'PUT',
          url: `media/uploads/${uploadId}`,
          headers: { 'content-type': 'audio/mpeg' },
          expires_at: '2099-01-01T00:00:00.000Z',
          chunk_size: 512 * 1024,
          chunk_count: 1,
        },
        object_url: `workbench-upload:${uploadId}`,
        upload_token: uploadId,
      } }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: response }), {
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { ...response, name: '新主题曲' } }), {
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = createKinoAssetLibraryClient()
    const file = new File(['music'], 'theme.mp3', { type: 'audio/mpeg' })

    await expect(client.list('audio')).resolves.toEqual([expect.objectContaining({
      id: 'audio-1', url: '/host/media/audio-1',
    })])
    await client.upload('audio', file)
    await client.rename('audio-1', '新主题曲')
    await client.remove('audio-1')

    expect(extensionFetch).toHaveBeenNthCalledWith(1, 'media/resources?media_type=audio', expect.anything())
    expect(extensionFetch).toHaveBeenNthCalledWith(2, 'media/image-assets/upload', expect.objectContaining({
      method: 'POST',
    }))
    expect(extensionFetch).toHaveBeenNthCalledWith(
      3,
      `media/uploads/${uploadId}?chunk_index=0&chunk_count=1`,
      expect.objectContaining({ method: 'PUT', body: expect.any(Blob) }),
    )
    expect(extensionFetch).toHaveBeenNthCalledWith(4, 'media/resources', expect.objectContaining({
      method: 'POST',
    }))
    expect(extensionFetch).toHaveBeenNthCalledWith(5, 'media/resources/audio-1', expect.objectContaining({ method: 'PUT' }))
    expect(extensionFetch).toHaveBeenNthCalledWith(6, 'media/resources/audio-1', expect.objectContaining({ method: 'DELETE' }))
    const prepareBody = JSON.parse(String(extensionFetch.mock.calls[1]?.[1]?.body))
    const createBody = JSON.parse(String(extensionFetch.mock.calls[3]?.[1]?.body))
    expect(prepareBody).not.toHaveProperty('game_id')
    expect(createBody).not.toHaveProperty('game_id')
  })

  it('keeps every default browser upload request below the 1 MiB host limit', async () => {
    const uploadId = 'fedcba9876543210fedcba9876543210'
    const file = new File([new Uint8Array(1024 * 1024 + 5)], 'large.png', { type: 'image/png' })
    extensionFetch.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === 'media/image-assets/upload') {
        return new Response(JSON.stringify({ code: 0, data: {
          upload: {
            method: 'PUT',
            url: `media/uploads/${uploadId}`,
            headers: { 'content-type': 'image/png' },
            expires_at: '2099-01-01T00:00:00.000Z',
            chunk_size: 512 * 1024,
            chunk_count: 3,
          },
          object_url: `workbench-upload:${uploadId}`,
          upload_token: uploadId,
        } }), { headers: { 'content-type': 'application/json' } })
      }
      if (path.startsWith(`media/uploads/${uploadId}?`)) {
        expect((init?.body as Blob).size).toBeLessThan(1024 * 1024)
        return new Response(null, { status: 204 })
      }
      if (path === 'media/resources') {
        return new Response(JSON.stringify({ code: 0, data: resource({
          resource_id: 'large-image',
          media_type: 'image',
          name: 'large',
          url: '/host/media/large-image',
        }) }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected request ${path}`)
    })

    const uploaded = await createKinoAssetLibraryClient().upload('image', file)

    expect(uploaded).toMatchObject({ id: 'large-image', kind: 'image' })
    expect(extensionFetch.mock.calls.filter(([path]) =>
      String(path).startsWith(`media/uploads/${uploadId}?`),
    )).toHaveLength(3)
  })

  it('keeps the legacy Kino adapter explicitly bound to its external game id', async () => {
    const kinoClient = kino()
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = createExternalKinoAssetLibraryClient({ client: kinoClient, transport, gameId: '猫' })

    await expect(client.list('audio')).resolves.toEqual([{
      id: 'audio-1',
      kind: 'audio',
      name: '主题曲',
      url: '/api/v1/kino/resources/audio-1/content?game_id=猫',
      mime: 'audio/mpeg',
      bytes: 12,
      updatedAt: 2,
      source: 'wb-game-video',
    }])

    const file = new File(['music'], 'theme.mp3', { type: 'audio/mpeg' })
    await client.upload('audio', file)
    await client.rename('audio-1', '新主题曲')
    await client.remove('audio-1')

    expect(kinoClient.prepareUpload).toHaveBeenCalledWith({
      game_id: '猫',
      file_name: 'theme.mp3',
      mime_type: 'audio/mpeg',
      bytes: file.size,
      extension: 'mp3',
    }, undefined)
    expect(transport.put).toHaveBeenCalledWith(file, expect.anything(), undefined, undefined)
    expect(kinoClient.create).toHaveBeenCalledWith(expect.objectContaining({
      game_id: '猫',
      media_type: 'audio',
      name: 'theme',
      source_meta: { mime_type: 'audio/mpeg', extra: { bytes: file.size } },
    }), undefined)
    expect(kinoClient.get).toHaveBeenCalledWith('audio-1', '猫', undefined)
    expect(kinoClient.update).toHaveBeenCalledWith('audio-1', expect.objectContaining({
      game_id: '猫',
      media_type: 'audio',
      name: '新主题曲',
    }), undefined)
    expect(kinoClient.delete).toHaveBeenCalledWith('audio-1', '猫', undefined)
  })

  it('rejects unsupported audio formats before requesting an upload', async () => {
    const kinoClient = kino()
    const client = createExternalKinoAssetLibraryClient({ client: kinoClient, gameId: '猫' })

    await expect(
      client.upload('audio', new File(['x'], 'theme.flac', { type: 'audio/flac' })),
    ).rejects.toEqual(new AssetLibraryUploadError('不支持的音频格式；仅支持MP3、WAV、OGG、M4A 或 AAC 音频'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects images larger than the provider limit before preparing an upload', async () => {
    const kinoClient = kino()
    const client = createExternalKinoAssetLibraryClient({ client: kinoClient, gameId: '猫' })
    const oversized = new File(['x'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })

    await expect(client.upload('image', oversized)).rejects.toEqual(
      new AssetLibraryUploadError('文件大小必须在 20 MB 以内'),
    )
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('requires audio/mp4 files to use the provider-supported m4a extension', async () => {
    const kinoClient = kino()
    const client = createExternalKinoAssetLibraryClient({ client: kinoClient, gameId: '猫' })

    await expect(
      client.upload('audio', new File(['x'], 'theme.mp4', { type: 'audio/mp4' })),
    ).rejects.toEqual(new AssetLibraryUploadError('M4A 音频必须使用 .m4a 文件扩展名'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })
})
