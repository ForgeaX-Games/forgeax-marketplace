import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AssetLibraryUploadError,
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  type ManagedAsset,
  useAssetLibrary,
} from '../assetLibraryClient'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'
import type { UploadTransport } from '../video-upload'

function client(): AssetLibraryClient {
  return {
    list: vi.fn(async (_game, kind): Promise<ManagedAsset[]> => {
      if (kind === 'image') return [{ id: 'image-1', kind, name: '封面', mime: 'image/png' }]
      if (kind === 'audio') return [{ id: 'bgm-1', kind, name: '主题曲', mime: 'audio/mpeg' }]
      return [{ id: 'title.woff2', kind, name: '标题字体', mime: 'font/woff2', source: 'local' }]
    }),
    upload: vi.fn(async (_game, kind, file): Promise<ManagedAsset> => ({ id: `${kind}-new`, kind, name: file.name })),
    rename: vi.fn(async (_game, id, name): Promise<ManagedAsset> => ({ id, kind: id.startsWith('bgm') ? 'audio' : 'image', name })),
    remove: vi.fn(async () => {}),
  }
}

describe('useAssetLibrary', () => {
  it('reports the missing API rather than pretending the manifest is empty', async () => {
    const { result } = renderHook(() => useAssetLibrary('demo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)
    expect(result.current.error).toMatch(/尚未启用/)
  })

  it('loads both asset groups from an injected client', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('demo', api))

    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(api.list).toHaveBeenCalledWith('demo', 'image', expect.anything())
    expect(api.list).toHaveBeenCalledWith('demo', 'audio', expect.anything())
    expect(api.list).toHaveBeenCalledWith('demo', 'font', expect.anything())
    expect(result.current.items.map((item) => item.kind)).toEqual(['image', 'audio', 'font'])
  })

  it('updates local state after uploading, renaming, and deleting', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('demo', api))
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => {
      await result.current.upload('image', new File(['x'], 'new.png', { type: 'image/png' }))
      await result.current.rename('image-new', '新封面')
      await result.current.remove('image-new')
    })

    expect(api.upload).toHaveBeenCalledWith('demo', 'image', expect.any(File))
    expect(api.rename).toHaveBeenCalledWith('demo', 'image-new', '新封面')
    expect(api.remove).toHaveBeenCalledWith('demo', 'image-new')
    expect(result.current.items.find((item) => item.id === 'image-new')).toBeUndefined()
  })
})

function resource(overrides: Partial<KinoResourceDTO> = {}): KinoResourceDTO {
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

function kino(): KinoVideoClient {
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
  it('maps audio list, upload, rename and deletion to provider-backed resource operations', async () => {
    const kinoClient = kino()
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = createKinoAssetLibraryClient({ client: kinoClient, transport })

    await expect(client.list('demo', 'audio')).resolves.toEqual([{
      id: 'audio-1',
      kind: 'audio',
      name: '主题曲',
      url: '/api/v1/kino/resources/audio-1/content?game_id=demo',
      mime: 'audio/mpeg',
      bytes: 12,
      updatedAt: 2,
      source: 'wb-game-video',
    }])

    const file = new File(['music'], 'theme.mp3', { type: 'audio/mpeg' })
    await client.upload('demo', 'audio', file)
    await client.rename('demo', 'audio-1', '新主题曲')
    await client.remove('demo', 'audio-1')

    expect(kinoClient.prepareUpload).toHaveBeenCalledWith({
      game_id: 'demo',
      file_name: 'theme.mp3',
      mime_type: 'audio/mpeg',
      bytes: file.size,
      extension: 'mp3',
    }, undefined)
    expect(transport.put).toHaveBeenCalledWith(file, expect.anything(), undefined, undefined)
    expect(kinoClient.create).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'demo',
      media_type: 'audio',
      name: 'theme',
      source_meta: { mime_type: 'audio/mpeg', extra: { bytes: file.size } },
    }), undefined)
    expect(kinoClient.get).toHaveBeenCalledWith('audio-1', 'demo', undefined)
    expect(kinoClient.update).toHaveBeenCalledWith('audio-1', expect.objectContaining({
      game_id: 'demo',
      media_type: 'audio',
      name: '新主题曲',
    }), undefined)
    expect(kinoClient.delete).toHaveBeenCalledWith('audio-1', 'demo', undefined)
  })

  it('rejects unsupported audio formats before requesting an upload', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'audio', new File(['x'], 'theme.flac', { type: 'audio/flac' })),
    ).rejects.toEqual(new AssetLibraryUploadError('不支持的音频格式；仅支持MP3、WAV、OGG、M4A 或 AAC 音频'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects images larger than the provider limit before preparing an upload', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })
    const oversized = new File(['x'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })

    await expect(client.upload('demo', 'image', oversized)).rejects.toEqual(
      new AssetLibraryUploadError('文件大小必须在 20 MB 以内'),
    )
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('requires audio/mp4 files to use the provider-supported m4a extension', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'audio', new File(['x'], 'theme.mp4', { type: 'audio/mp4' })),
    ).rejects.toEqual(new AssetLibraryUploadError('M4A 音频必须使用 .m4a 文件扩展名'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })
})
