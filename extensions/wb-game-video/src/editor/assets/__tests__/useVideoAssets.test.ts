import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useVideoAssets } from '../useVideoAssets'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'

const uploadState = vi.hoisted(() => ({
  impl: undefined as undefined | ((options: {
    onProgress?: (value: number) => void
  }) => Promise<KinoResourceDTO>),
  replaceImpl: undefined as undefined | ((options: {
    resourceId: string
    onProgress?: (value: number) => void
  }) => Promise<KinoResourceDTO>),
}))

vi.mock('../video-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../video-upload')>()
  return {
    ...actual,
    uploadVideoResource: (options: { onProgress?: (value: number) => void }) =>
      uploadState.impl
        ? uploadState.impl(options)
        : actual.uploadVideoResource(options as Parameters<typeof actual.uploadVideoResource>[0]),
    replaceVideoResource: (options: {
      resourceId: string
      onProgress?: (value: number) => void
    }) => uploadState.replaceImpl
      ? uploadState.replaceImpl(options)
      : Promise.reject(new Error('replace implementation missing')),
  }
})

function makeResource(overrides: Partial<KinoResourceDTO> = {}): KinoResourceDTO {
  return {
    resource_id: 'res-1',
    game_id: 'demo',
    media_type: 'video',
    url: 'http://object/res-1',
    name: 'Old name',
    type: 'UPLOAD',
    remark: 'note',
    source: 'upload',
    source_meta: { duration_ms: 5000, mime_type: 'video/mp4' },
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

function makeClient(overrides: Partial<KinoVideoClient> = {}): KinoVideoClient {
  const resource = makeResource()
  return {
    prepareUpload: vi.fn(),
    list: vi.fn(async () => ({ items: [resource], total: 1, page: 1, page_size: 20 })),
    get: vi.fn(async () => resource),
    create: vi.fn(),
    batch: vi.fn(),
    update: vi.fn(async () => resource),
    delete: vi.fn(async () => {}),
    playbackUrl: (id, gameId) => `/api/v1/kino/resources/${id}/content?game_id=${encodeURIComponent(gameId)}`,
    ...overrides,
  }
}

describe('useVideoAssets', () => {
  it('adds updated_at as a playback URL revision', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useVideoAssets('demo', { client }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items[0]?.url).toBe(
      '/api/v1/kino/resources/res-1/content?game_id=demo&v=2',
    )
  })

  it('replaces the same item without changing total', async () => {
    uploadState.replaceImpl = async ({ resourceId }) =>
      makeResource({ resource_id: resourceId, name: 'Replacement', updated_at: 30 })
    const client = makeClient({
      list: vi.fn()
        .mockResolvedValueOnce({
          items: [makeResource()],
          total: 1,
          page: 1,
          page_size: 20,
        })
        .mockRejectedValueOnce(new Error('refresh unavailable')),
    })
    const { result } = renderHook(() => useVideoAssets('demo', { client }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const replaceResource = (
      result.current as typeof result.current & {
        replaceResource?: (resourceId: string, file: File) => Promise<KinoResourceDTO | undefined>
      }
    ).replaceResource
    expect(replaceResource).toBeTypeOf('function')
    if (!replaceResource) return

    await act(async () => {
      await replaceResource(
        'res-1',
        new File(['video'], 'replacement.mp4', { type: 'video/mp4' }),
      )
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.total).toBe(1)
    expect(result.current.items[0]).toMatchObject({
      id: 'res-1',
      label: 'Replacement',
      updatedAt: 30,
      url: '/api/v1/kino/resources/res-1/content?game_id=demo&v=30',
    })
    uploadState.replaceImpl = undefined
  })

  it('keeps the old item when replacement fails', async () => {
    uploadState.replaceImpl = async () => {
      throw new Error('replacement failed')
    }
    const client = makeClient()
    const { result } = renderHook(() => useVideoAssets('demo', { client }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current.items[0]
    const replaceResource = (
      result.current as typeof result.current & {
        replaceResource?: (resourceId: string, file: File) => Promise<KinoResourceDTO | undefined>
      }
    ).replaceResource
    expect(replaceResource).toBeTypeOf('function')
    if (!replaceResource) return

    await act(async () => {
      await replaceResource(
        'res-1',
        new File(['video'], 'replacement.mp4', { type: 'video/mp4' }),
      )
    })

    expect(result.current.items).toEqual([before])
    expect(result.current.total).toBe(1)
    expect(result.current.uploadError).toBe('replacement failed')
    uploadState.replaceImpl = undefined
  })

  it('surfaces list errors instead of returning empty items silently', async () => {
    const client = makeClient({
      list: vi.fn(async () => {
        throw new Error('Unauthorized')
      }),
    })
    const { result } = renderHook(() => useVideoAssets('demo', { client }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Unauthorized')
    expect(result.current.items).toEqual([])
  })

  it('aborts the in-flight list request on unmount without updating state later', async () => {
    let resolveList: ((value: {
      items: KinoResourceDTO[]
      total: number
      page: number
      page_size: number
    }) => void) | undefined
    let observedSignal: AbortSignal | undefined
    const list = vi.fn((_query, options) => {
      observedSignal = options?.signal
      return new Promise<{
        items: KinoResourceDTO[]
        total: number
        page: number
        page_size: number
      }>((resolve) => {
        resolveList = resolve
      })
    })
    const client = makeClient({ list })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() => useVideoAssets('demo', { client }))

    await waitFor(() => expect(list).toHaveBeenCalledOnce())
    expect(observedSignal?.aborted).toBe(false)

    unmount()
    expect(observedSignal?.aborted).toBe(true)

    await act(async () => {
      resolveList?.({ items: [makeResource()], total: 1, page: 1, page_size: 20 })
      await Promise.resolve()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps upload progress active while a delete mutation completes', async () => {
    let finishUpload: ((resource: KinoResourceDTO) => void) | undefined
    let reportProgress: ((value: number) => void) | undefined
    uploadState.impl = (options) => {
      reportProgress = options.onProgress
      return new Promise<KinoResourceDTO>((resolve) => {
        finishUpload = resolve
      })
    }
    const client = makeClient()
    const { result } = renderHook(() => useVideoAssets('demo', { client }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let uploadPromise: Promise<KinoResourceDTO | undefined>
    act(() => {
      uploadPromise = result.current.upload(
        new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      )
    })
    await act(async () => {
      reportProgress?.(35)
    })
    expect(result.current.uploadProgress).toBe(35)

    await act(async () => {
      await result.current.deleteResource('res-1')
    })
    await act(async () => {
      reportProgress?.(70)
    })
    expect(result.current.uploadProgress).toBe(70)

    await act(async () => {
      finishUpload?.(makeResource({ resource_id: 'uploaded' }))
      await uploadPromise!
    })
    expect(result.current.uploadProgress).toBeNull()
    uploadState.impl = undefined
  })

  it('deduplicates resource ids while loading more pages', async () => {
    const first = makeResource({ resource_id: 'res-1' })
    const second = makeResource({ resource_id: 'res-2' })
    const third = makeResource({ resource_id: 'res-3' })
    const list = vi.fn(async (query: { page?: number }) => (
      query.page === 2
        ? { items: [second, third], total: 3, page: 2, page_size: 2 }
        : { items: [first, second], total: 3, page: 1, page_size: 2 }
    ))
    const client = makeClient({ list })
    const { result } = renderHook(() =>
      useVideoAssets('demo', { client, pageSize: 2 }),
    )
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasMore).toBe(true)

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.items.map((item) => item.id)).toEqual([
      'res-1',
      'res-2',
      'res-3',
    ])
    expect(result.current.hasMore).toBe(false)
  })

  it('keeps optimistic delete when background refresh fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        items: [makeResource()],
        total: 1,
        page: 1,
        page_size: 20,
      })
      .mockRejectedValueOnce(new Error('refresh failed'))
    const client = makeClient({ list })
    const { result } = renderHook(() => useVideoAssets('demo', { client }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.deleteResource('res-1')
    })

    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    await waitFor(() => expect(result.current.error).toBe('refresh failed'))
    expect(result.current.items).toEqual([])
  })
})
