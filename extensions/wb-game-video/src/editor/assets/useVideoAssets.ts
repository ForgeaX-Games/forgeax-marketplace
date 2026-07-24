import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createKinoVideoClient,
  KinoClientError,
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'
import {
  completePreparedVideoUpload,
  replaceVideoResource,
  uploadVideoResource,
  VideoUploadError,
  type PreparedVideoUpload,
} from './video-upload'
import { useKinoVideoCache, useKinoVideoResources } from './kinoVideoCacheStore'

export const DEFAULT_VIDEO_PAGE_SIZE = 20

export interface VideoAssetListItem {
  id: string
  label: string
  url: string
  durMs?: number
  type?: string
  updatedAt?: number
}

export interface VideoAssetsController {
  loading: boolean
  error: string | null
  items: VideoAssetListItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  uploadProgress: number | null
  uploadError: string | null
  canRetryComplete: boolean
  uploading: boolean
  mutating: boolean
  refresh: () => Promise<void>
  loadPage: (page: number) => Promise<void>
  loadMore: () => Promise<void>
  upload: (file: File) => Promise<KinoResourceDTO | undefined>
  replaceResource: (resourceId: string, file: File) => Promise<KinoResourceDTO | undefined>
  renameResource: (resourceId: string, name: string) => Promise<KinoResourceDTO | undefined>
  retryComplete: () => Promise<KinoResourceDTO | undefined>
  deleteResource: (resourceId: string) => Promise<void>
}

export interface UseVideoAssetsOptions {
  client?: KinoVideoClient
  initialPage?: number
  pageSize?: number
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof KinoClientError || error instanceof VideoUploadError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected error'
}

export function appendVideoRevision(url: string, updatedAt: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(String(updatedAt))}`
}

function toListItem(dto: KinoResourceDTO, client: KinoVideoClient): VideoAssetListItem {
  return {
    id: dto.resource_id,
    label: dto.name?.trim() || dto.resource_id,
    url: appendVideoRevision(
      client.playbackUrl(dto.resource_id, dto.game_id),
      dto.updated_at,
    ),
    durMs: dto.source_meta?.duration_ms,
    type: dto.type,
    updatedAt: dto.updated_at,
  }
}

function mergeUniqueItems(
  existing: VideoAssetListItem[],
  incoming: VideoAssetListItem[],
): VideoAssetListItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}

export function useVideoAssets(
  gameId: string,
  options: UseVideoAssetsOptions = {},
): VideoAssetsController {
  const pageSize = Math.min(options.pageSize ?? DEFAULT_VIDEO_PAGE_SIZE, MAX_KINO_RESOURCE_PAGE_SIZE)
  const initialPage = options.initialPage ?? 1
  const client = useMemo(
    () => options.client ?? createKinoVideoClient(),
    [options.client],
  )
  const cacheUpsert = useKinoVideoCache((s) => s.upsert)
  const cacheRemove = useKinoVideoCache((s) => s.remove)
  const kinoResources = useKinoVideoResources(gameId, !options.client)

  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localItems, setLocalItems] = useState<VideoAssetListItem[]>([])
  const [localTotal, setLocalTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [retryPrepared, setRetryPrepared] = useState<PreparedVideoUpload | null>(null)
  const [uploading, setUploading] = useState(false)
  const [mutating, setMutating] = useState(false)

  const listGeneration = useRef(0)
  const uploadGeneration = useRef(0)
  const crudGeneration = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    abortRef.current = new AbortController()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const fetchPage = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      const generation = ++listGeneration.current
      setLocalLoading(true)
      setLocalError(null)
      try {
        const result = await client.list({
          game_id: gameId,
          media_type: 'video',
          page: targetPage,
          page_size: pageSize,
        }, { signal: abortRef.current?.signal })
        if (!mountedRef.current || generation !== listGeneration.current) {
          return
        }
        const mapped = result.items.map((dto) => toListItem(dto, client))
        setLocalItems((prev) => (
          mode === 'append'
            ? mergeUniqueItems(prev, mapped)
            : mergeUniqueItems([], mapped)
        ))
        setLocalTotal(result.total)
        setPage(result.page)
      } catch (err) {
        if (!mountedRef.current || generation !== listGeneration.current) {
          return
        }
        setLocalError(safeErrorMessage(err))
      } finally {
        if (mountedRef.current && generation === listGeneration.current) {
          setLocalLoading(false)
        }
      }
    },
    [client, gameId, pageSize],
  )

  const refresh = useCallback(async () => {
    if (options.client) {
      await fetchPage(1, 'replace')
      return
    }
    await kinoResources.refresh()
  }, [fetchPage, kinoResources, options.client])

  const loadPage = useCallback(
    async (targetPage: number) => {
      if (options.client) {
        await fetchPage(targetPage, 'replace')
        return
      }
      setPage(targetPage)
    },
    [fetchPage, options.client],
  )

  const items = options.client
    ? localItems
    : kinoResources.items
      .slice(0, page * pageSize)
      .map((dto) => toListItem(dto, client))
  const total = options.client ? localTotal : kinoResources.total
  const loading = options.client ? localLoading : kinoResources.loading
  const error = options.client ? localError : localError ?? kinoResources.error

  const loadMore = useCallback(async () => {
    if (items.length >= total) {
      return
    }
    if (options.client) {
      await fetchPage(page + 1, 'append')
      return
    }
    await loadPage(page + 1)
  }, [fetchPage, items.length, loadPage, options.client, page, total])

  useEffect(() => {
    if (!options.client) return
    void fetchPage(initialPage, 'replace')
  }, [fetchPage, gameId, initialPage, options.client])

  const upsertCacheResource = useCallback(
    (resource: KinoResourceDTO, replacementResourceId?: string) => {
      if (options.client) return
      cacheUpsert(
        gameId,
        replacementResourceId ? { ...resource, resource_id: replacementResourceId } : resource,
      )
    },
    [cacheUpsert, gameId, options.client],
  )

  const runUpload = useCallback(
    async (
      file: File,
      replacementResourceId?: string,
    ): Promise<KinoResourceDTO | undefined> => {
      const generation = ++uploadGeneration.current
      setUploading(true)
      setUploadError(null)
      setUploadProgress(0)
      setRetryPrepared(null)
      try {
        const sharedOptions = {
          client,
          gameId,
          file,
          onProgress: (value: number) => {
            if (mountedRef.current && generation === uploadGeneration.current) {
              setUploadProgress(value)
            }
          },
          signal: abortRef.current?.signal,
        }
        const resource = replacementResourceId
          ? await replaceVideoResource({
              ...sharedOptions,
              resourceId: replacementResourceId,
            })
          : await uploadVideoResource(sharedOptions)
        if (!mountedRef.current || generation !== uploadGeneration.current) {
          return undefined
        }
        if (replacementResourceId) {
          const replacement = toListItem(
            { ...resource, resource_id: replacementResourceId },
            client,
          )
          setLocalItems((currentItems) => currentItems.map((item) =>
            item.id === replacementResourceId ? replacement : item))
        }
        upsertCacheResource(resource, replacementResourceId)
        await refresh()
        return resource
      } catch (err) {
        if (!mountedRef.current || generation !== uploadGeneration.current) {
          return undefined
        }
        setUploadError(safeErrorMessage(err))
        if (err instanceof VideoUploadError && err.retryState) {
          setRetryPrepared(err.retryState)
        }
        return undefined
      } finally {
        if (mountedRef.current && generation === uploadGeneration.current) {
          setUploading(false)
          setUploadProgress(null)
        }
      }
    },
    [client, gameId, refresh, upsertCacheResource],
  )

  const upload = useCallback(
    async (file: File): Promise<KinoResourceDTO | undefined> => runUpload(file),
    [runUpload],
  )

  const replaceResource = useCallback(
    async (
      resourceId: string,
      file: File,
    ): Promise<KinoResourceDTO | undefined> => runUpload(file, resourceId),
    [runUpload],
  )

  const renameResource = useCallback(
    async (resourceId: string, name: string): Promise<KinoResourceDTO | undefined> => {
      const nextName = name.trim()
      if (!nextName) {
        return undefined
      }
      const generation = ++crudGeneration.current
      setMutating(true)
      setLocalError(null)
      try {
        const current = await client.get(resourceId, gameId, {
          signal: abortRef.current?.signal,
        })
        const resource = await client.update(resourceId, {
          resource_id: resourceId,
          game_id: gameId,
          media_type: 'video',
          url: current.url,
          name: nextName,
          type: current.type,
          remark: current.remark,
          source: current.source,
          source_meta: current.source_meta,
        }, {
          signal: abortRef.current?.signal,
        })
        if (!mountedRef.current || generation !== crudGeneration.current) {
          return undefined
        }
        const renamed = toListItem(resource, client)
        setLocalItems((currentItems) => currentItems.map((item) =>
          item.id === resourceId ? renamed : item))
        upsertCacheResource(resource)
        return resource
      } catch (err) {
        if (!mountedRef.current || generation !== crudGeneration.current) {
          return undefined
        }
        setLocalError(safeErrorMessage(err))
        return undefined
      } finally {
        if (mountedRef.current && generation === crudGeneration.current) {
          setMutating(false)
        }
      }
    },
    [client, gameId, refresh, upsertCacheResource],
  )

  const retryComplete = useCallback(async (): Promise<KinoResourceDTO | undefined> => {
    if (!retryPrepared) {
      return undefined
    }
    const generation = ++uploadGeneration.current
    setUploading(true)
    setUploadError(null)
    setUploadProgress(99)
    try {
      const resource = await completePreparedVideoUpload({
        client,
        prepared: retryPrepared,
        onProgress: (value) => {
          if (mountedRef.current && generation === uploadGeneration.current) {
            setUploadProgress(value)
          }
        },
        signal: abortRef.current?.signal,
      })
      if (!mountedRef.current || generation !== uploadGeneration.current) {
        return undefined
      }
      if (retryPrepared.replacementResourceId) {
        const replacementId = retryPrepared.replacementResourceId
        const replacement = toListItem(
          { ...resource, resource_id: replacementId },
          client,
        )
        setLocalItems((currentItems) => currentItems.map((item) =>
          item.id === replacementId ? replacement : item))
      }
      upsertCacheResource(resource, retryPrepared.replacementResourceId)
      setRetryPrepared(null)
      await refresh()
      return resource
    } catch (err) {
      if (!mountedRef.current || generation !== uploadGeneration.current) {
        return undefined
      }
      setUploadError(safeErrorMessage(err))
      if (err instanceof VideoUploadError && err.retryState) {
        setRetryPrepared(err.retryState)
      }
      return undefined
    } finally {
      if (mountedRef.current && generation === uploadGeneration.current) {
        setUploading(false)
        setUploadProgress(null)
      }
    }
  }, [client, gameId, refresh, retryPrepared, upsertCacheResource])

  const deleteResource = useCallback(
    async (resourceId: string) => {
      const generation = ++crudGeneration.current
      setMutating(true)
      setLocalError(null)
      try {
        await client.delete(resourceId, gameId, {
          signal: abortRef.current?.signal,
        })
        if (!mountedRef.current || generation !== crudGeneration.current) {
          return
        }
        setLocalItems((currentItems) =>
          currentItems.filter((item) => item.id !== resourceId))
        setLocalTotal((currentTotal) => Math.max(0, currentTotal - 1))
        if (!options.client) {
          cacheRemove(gameId, resourceId)
        }
        await refresh()
      } catch (err) {
        if (!mountedRef.current || generation !== crudGeneration.current) {
          return
        }
        setLocalError(safeErrorMessage(err))
        throw err
      } finally {
        if (mountedRef.current && generation === crudGeneration.current) {
          setMutating(false)
        }
      }
    },
    [cacheRemove, client, gameId, options.client, refresh],
  )

  const hasMore = items.length < total

  return {
    loading,
    error,
    items,
    total,
    page,
    pageSize,
    hasMore,
    uploadProgress,
    uploadError,
    canRetryComplete: retryPrepared != null,
    uploading,
    mutating,
    refresh,
    loadPage,
    loadMore,
    upload,
    replaceResource,
    renameResource,
    retryComplete,
    deleteResource,
  }
}
