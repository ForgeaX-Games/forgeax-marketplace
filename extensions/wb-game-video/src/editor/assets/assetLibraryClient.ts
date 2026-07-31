import { useCallback, useEffect, useState } from 'react'
import {
  MAX_KINO_RESOURCE_PAGE_SIZE,
  createKinoVideoClient,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'
import {
  BROWSER_UPLOAD_POLICIES,
  uploadProviderResource,
  VideoUploadError,
  type UploadTransport,
} from './video-upload'
import { useProjectAssetCache } from './projectAssetCacheStore'
import { deleteSequentially } from './batch-delete'

export type ManagedAssetKind = 'image' | 'audio' | 'font'

export interface ManagedAsset {
  id: string
  kind: ManagedAssetKind
  name: string
  url?: string
  mime?: string
  bytes?: number
  updatedAt?: number
  source?: string
}

export interface AssetLibraryClient {
  list(gameId: string, kind: ManagedAssetKind, options?: { signal?: AbortSignal }): Promise<ManagedAsset[]>
  upload(gameId: string, kind: ManagedAssetKind, file: File, options?: { signal?: AbortSignal }): Promise<ManagedAsset>
  rename(gameId: string, id: string, name: string, options?: { signal?: AbortSignal }): Promise<ManagedAsset>
  remove(gameId: string, id: string, options?: { signal?: AbortSignal }): Promise<void>
}

const MAX_ASSET_LIBRARY_PAGES = 100

export class AssetLibraryUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetLibraryUploadError'
  }
}

export interface CreateKinoAssetLibraryClientOptions {
  client?: KinoVideoClient
  transport?: UploadTransport
}

function displayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName
}

function bytes(resource: KinoResourceDTO): number | undefined {
  const value = resource.source_meta?.extra?.bytes
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function toManagedAsset(
  resource: KinoResourceDTO,
  kind: ManagedAssetKind,
  client: KinoVideoClient,
): ManagedAsset {
  return {
    id: resource.resource_id,
    kind,
    name: resource.name || resource.resource_id,
    url: client.playbackUrl(resource.resource_id, resource.game_id),
    mime: resource.source_meta?.mime_type,
    bytes: bytes(resource),
    updatedAt: resource.updated_at,
    source: resource.source,
  }
}

/**
 * Production adapter for assets in Kino's provider-backed resource API.
 * Resources are always previewed through its authenticated content endpoint.
 */
export function createKinoAssetLibraryClient(
  options: CreateKinoAssetLibraryClientOptions = {},
): AssetLibraryClient {
  const client = options.client ?? createKinoVideoClient()

  return {
    async list(gameId, kind, requestOptions) {
      const resources = new Map<string, ManagedAsset>()
      for (let page = 1; page <= MAX_ASSET_LIBRARY_PAGES; page += 1) {
        const response = await client.list({
          game_id: gameId,
          media_type: kind,
          page,
          page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
        }, requestOptions)
        for (const resource of response.items) {
          resources.set(resource.resource_id, toManagedAsset(resource, kind, client))
        }
        if (response.items.length === 0 || resources.size >= response.total) break
      }
      return [...resources.values()]
    },

    async upload(gameId, kind, file, requestOptions) {
      try {
        const resource = await uploadProviderResource({
          client,
          transport: options.transport,
          gameId,
          mediaType: kind,
          file,
        name: displayName(file.name),
          source: 'wb-game-video',
          sourceMeta: { extra: { bytes: file.size } },
          signal: requestOptions?.signal,
        })
        return toManagedAsset(resource, kind, client)
      } catch (error) {
        if (!(error instanceof VideoUploadError)) throw error
        const policy = BROWSER_UPLOAD_POLICIES[kind]
        if (error.code === 'invalid_media_type') {
          const supported = kind === 'image'
            ? 'PNG、JPEG、WebP 或 GIF 图片'
            : kind === 'audio'
              ? 'MP3、WAV、OGG、M4A 或 AAC 音频'
              : 'WOFF2、WOFF、TTF 或 OTF 字体'
          throw new AssetLibraryUploadError(`不支持的${kind === 'font' ? '字体' : kind === 'image' ? '图片' : '音频'}格式；仅支持${supported}`)
        }
        if (error.code === 'invalid_file_name') {
          throw new AssetLibraryUploadError(
            kind === 'audio' && file.type === 'audio/mp4'
              ? 'M4A 音频必须使用 .m4a 文件扩展名'
              : '文件名或扩展名与媒体格式不匹配',
          )
        }
        if (error.code === 'invalid_upload_size') {
          throw new AssetLibraryUploadError(
            `文件大小必须在 ${(policy.maxBytes / (1024 * 1024)).toFixed(0)} MB 以内`,
          )
        }
        throw error
      }
    },

    async rename(gameId, id, name, requestOptions) {
      const resource = await client.get(id, gameId, requestOptions)
      const updated = await client.update(id, {
        resource_id: id,
        game_id: gameId,
        media_type: resource.media_type,
        url: resource.url,
        name,
        type: resource.type,
        remark: resource.remark,
        source: resource.source,
        source_meta: resource.source_meta,
      }, requestOptions)
      if (updated.media_type !== 'image' && updated.media_type !== 'audio' && updated.media_type !== 'font') {
        throw new AssetLibraryUploadError('只能重命名图片、音频或字体资产')
      }
      return toManagedAsset(updated, updated.media_type, client)
    },

    async remove(gameId, id, requestOptions) {
      await client.delete(id, gameId, requestOptions)
    },
  }
}

export interface AssetLibraryController {
  available: boolean
  loading: boolean
  error: string | null
  uploading: ManagedAssetKind | null
  mutating: boolean
  items: ManagedAsset[]
  refresh(): Promise<void>
  upload(kind: ManagedAssetKind, file: File): Promise<ManagedAsset | undefined>
  rename(id: string, name: string): Promise<ManagedAsset | undefined>
  remove(id: string): Promise<void>
  removeMany(ids: readonly string[], onProgress?: (current: number, total: number) => void): Promise<{ completed: number, failedId?: string }>
}

const UNAVAILABLE_MESSAGE = '图片、BGM 与字体资源 API 尚未启用'

function kindLabel(kind: ManagedAssetKind): string {
  return kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '字体'
}

export function useAssetLibrary(gameId: string, client?: AssetLibraryClient): AssetLibraryController {
  const cache = useProjectAssetCache((state) => state.byGame[gameId])
  const refreshCached = useProjectAssetCache((state) => state.refresh)
  const upsertCached = useProjectAssetCache((state) => state.upsert)
  const removeCached = useProjectAssetCache((state) => state.remove)
  const kinds: ManagedAssetKind[] = ['image', 'audio', 'font']
  const items = kinds.flatMap((kind) => cache?.[kind]?.items ?? [])
  const loading = kinds.some((kind) => cache?.[kind]?.loading)
  const errors = kinds.flatMap((kind) => {
    const error = cache?.[kind]?.error
    return error ? [`${kindLabel(kind)}：${error}`] : []
  })
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<ManagedAssetKind | null>(null)
  const [mutating, setMutating] = useState(false)
  const error = !client
    ? UNAVAILABLE_MESSAGE
    : mutationError ?? (errors.length > 0 ? `部分资产加载失败；保留已缓存内容。${errors.join('；')}` : null)

  const refresh = useCallback(async () => {
    if (!client) {
      return
    }
    await Promise.all(kinds.map((kind) => refreshCached(gameId, kind, client)))
  }, [client, gameId, refreshCached])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const upload = useCallback(async (kind: ManagedAssetKind, file: File) => {
    if (!client) {
      return undefined
    }
    setUploading(kind)
    setMutationError(null)
    try {
      const asset = await client.upload(gameId, kind, file)
      upsertCached(gameId, asset)
      return asset
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      return undefined
    } finally {
      setUploading(null)
    }
  }, [client, gameId, upsertCached])

  const rename = useCallback(async (id: string, name: string) => {
    if (!client) {
      return undefined
    }
    const nextName = name.trim()
    if (!nextName) return undefined
    setMutating(true)
    setMutationError(null)
    try {
      const asset = await client.rename(gameId, id, nextName)
      upsertCached(gameId, asset)
      return asset
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      return undefined
    } finally {
      setMutating(false)
    }
  }, [client, gameId, upsertCached])

  const remove = useCallback(async (id: string) => {
    if (!client) {
      return
    }
    const current = useProjectAssetCache.getState().byGame[gameId]
    const asset = kinds
      .flatMap((kind) => current?.[kind]?.items ?? [])
      .find((item) => item.id === id)
    if (!asset) return
    setMutating(true)
    setMutationError(null)
    try {
      await client.remove(gameId, id)
      removeCached(gameId, asset.kind, id)
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      throw cause
    } finally {
      setMutating(false)
    }
  }, [client, gameId, removeCached])

  const removeMany = useCallback(async (ids: readonly string[], onProgress?: (current: number, total: number) => void) => {
    if (!client || ids.length === 0) return { completed: 0 }
    setMutating(true)
    setMutationError(null)
    const result = await deleteSequentially(ids, async (id) => {
      const current = useProjectAssetCache.getState().byGame[gameId]
      const asset = kinds.flatMap((kind) => current?.[kind]?.items ?? []).find((item) => item.id === id)
      if (!asset) return
      await client.remove(gameId, id)
      removeCached(gameId, asset.kind, id)
    }, ({ current, total }) => onProgress?.(current, total))
    setMutating(false)
    if (result.error) setMutationError(result.error instanceof Error ? result.error.message : '资产操作失败')
    return { completed: result.completed, failedId: result.failedId }
  }, [client, gameId, removeCached])

  return { available: Boolean(client), loading, error, uploading, mutating, items, refresh, upload, rename, remove, removeMany }
}
