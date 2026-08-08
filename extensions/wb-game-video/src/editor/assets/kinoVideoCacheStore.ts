import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import {
  createKinoVideoClient,
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'

export interface KinoVideoCacheEntry {
  items: KinoResourceDTO[]
  total: number
  loading: boolean
  error: string | null
  generation: number
}

export interface KinoVideoResources extends KinoVideoCacheEntry {
  refresh: () => Promise<void>
}

interface KinoVideoCacheStore {
  byGame: Record<string, KinoVideoCacheEntry | undefined>
  refresh: (gameId: string, client?: KinoVideoClient) => Promise<void>
  ensure: (gameId: string, client?: KinoVideoClient) => Promise<void>
  upsert: (gameId: string, item: KinoResourceDTO) => void
  remove: (gameId: string, resourceId: string) => void
}

type KinoVideoCacheMessage =
  | { type: 'upsert', gameId: string, item: KinoResourceDTO }
  | { type: 'remove', gameId: string, resourceId: string }

const CHANNEL = 'wb-game-video:kino-video-cache-sync'
let channel: BroadcastChannel | null = null
let applyingRemote = false

const EMPTY: KinoVideoCacheEntry = {
  items: [],
  total: 0,
  loading: false,
  error: null,
  generation: 0,
}

let defaultClient: KinoVideoClient | undefined

function clientOf(client?: KinoVideoClient): KinoVideoClient {
  defaultClient ??= createKinoVideoClient()
  return client ?? defaultClient
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load Kino videos'
}

export const useKinoVideoCache = create<KinoVideoCacheStore>((set, get) => ({
  byGame: {},

  async refresh(gameId, client) {
    const current = get().byGame[gameId] ?? EMPTY
    const generation = current.generation + 1
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameId]: { ...current, loading: true, error: null, generation },
      },
    }))
    try {
      const kino = clientOf(client)
      const items: KinoResourceDTO[] = []
      let total = 0
      let received = 0
      for (let page = 1; page <= 100; page += 1) {
        const result = await kino.list({
          game_id: gameId,
          media_type: 'video',
          page,
          page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
        })
        // The video workspace must never trust an upstream page to be
        // type-pure: an image record in a cached or misrouted response must
        // not surface as a playable video card.
        items.push(...result.items.filter((item) => item.media_type === 'video'))
        received += result.items.length
        total = result.total
        if (result.items.length === 0 || received >= total) break
      }
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameId]: { items, total, loading: false, error: null, generation },
        },
      }))
    } catch (error) {
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameId]: { ...state.byGame[gameId] ?? EMPTY, loading: false, error: message(error), generation },
        },
      }))
    }
  },

  async ensure(gameId, client) {
    if (get().byGame[gameId]) return
    await get().refresh(gameId, client)
  },

  upsert(gameId, item) {
    set((state) => {
      const cache = state.byGame[gameId] ?? EMPTY
      const existing = cache.items.findIndex((entry) => entry.resource_id === item.resource_id)
      const items = existing < 0
        ? [item, ...cache.items]
        : cache.items.map((entry, index) => index === existing ? item : entry)
      return {
        byGame: {
          ...state.byGame,
          [gameId]: { ...cache, items, total: existing < 0 ? cache.total + 1 : cache.total },
        },
      }
    })
    if (!applyingRemote) channel?.postMessage({ type: 'upsert', gameId, item } satisfies KinoVideoCacheMessage)
  },

  remove(gameId, resourceId) {
    set((state) => {
      const cache = state.byGame[gameId] ?? EMPTY
      const items = cache.items.filter((item) => item.resource_id !== resourceId)
      return {
        byGame: {
          ...state.byGame,
          [gameId]: { ...cache, items, total: Math.min(cache.total, items.length) },
        },
      }
    })
    if (!applyingRemote) channel?.postMessage({ type: 'remove', gameId, resourceId } satisfies KinoVideoCacheMessage)
  },
}))

function validMessage(value: unknown): value is KinoVideoCacheMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<KinoVideoCacheMessage> & { item?: Partial<KinoResourceDTO> }
  if (typeof candidate.gameId !== 'string' || candidate.gameId.length === 0) return false
  if (candidate.type === 'remove') {
    return typeof candidate.resourceId === 'string' && candidate.resourceId.length > 0
  }
  return candidate.type === 'upsert'
    && candidate.item?.game_id === candidate.gameId
    && candidate.item.media_type === 'video'
    && typeof candidate.item.resource_id === 'string'
    && candidate.item.resource_id.length > 0
}

/** Keeps the left and center Workbench panes on the same canonical video list. */
export function installKinoVideoCacheSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (!validMessage(event.data)) return
    applyingRemote = true
    try {
      if (event.data.type === 'upsert') {
        useKinoVideoCache.getState().upsert(event.data.gameId, event.data.item)
      } else {
        useKinoVideoCache.getState().remove(event.data.gameId, event.data.resourceId)
      }
    } finally {
      applyingRemote = false
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}

/**
 * Project-scoped Kino resource consumer. It owns initial cache hydration so
 * editor surfaces only consume resource state; call `refresh()` to re-pull.
 */
export function useKinoVideoResources(gameId: string, enabled = true): KinoVideoResources {
  const entry = useKinoVideoCache((state) => state.byGame[gameId])
  const ensure = useKinoVideoCache((state) => state.ensure)
  const refreshCache = useKinoVideoCache((state) => state.refresh)

  useEffect(() => {
    if (!enabled) return
    void ensure(gameId)
  }, [enabled, ensure, gameId])

  const refresh = useCallback(() => refreshCache(gameId), [gameId, refreshCache])
  return { ...(entry ?? EMPTY), refresh }
}
