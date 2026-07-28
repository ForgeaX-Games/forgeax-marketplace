/**
 * 音频资产（BGM 候选的料）查询 —— 与 `kinoVideoCacheStore`（「视频」字段那条路）**同款数据源**：
 * Kino `media_type: 'audio'`，按 game 分桶的共享缓存 + 显式 hydration。
 *
 * 为何不走 `/__gva__/assets?kind=audio`：资产库上传的音频落在 Kino（UUID id + provider），
 * 本地 manifest 里虽有镜像记录，但 `listAssets` 的 MediaAsset 门闸只认带 `productionType` 的
 * image/video —— 作者在「资产 › 音频」里能看到的曲子，节点 BGM 下拉却永远空。视频字段一开始
 * 就吃 Kino，BGM 对齐同一条路。
 *
 * 缓存存原始 `KinoResourceDTO`（展示形状由壳层派生），与视频侧同分工。
 */
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import {
  createKinoVideoClient,
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'

export interface AudioAssetCacheEntry {
  items: KinoResourceDTO[]
  total: number
  loading: boolean
  /** 非 null = 这次查询失败了（≠「库里没有音频」）；壳层据此报警并收回「库是空的」那句话。 */
  error: string | null
  generation: number
}

export interface AudioAssets extends AudioAssetCacheEntry {
  /** 重新拉一遍（音频上传成功后的回灌口）。 */
  refresh: () => Promise<void>
}

interface AudioAssetCacheStore {
  byGame: Record<string, AudioAssetCacheEntry | undefined>
  refresh: (gameId: string, client?: KinoVideoClient) => Promise<void>
  ensure: (gameId: string, client?: KinoVideoClient) => Promise<void>
}

const EMPTY: AudioAssetCacheEntry = {
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
  return error instanceof Error ? error.message : '无法加载音频素材'
}

export const useAudioAssetCache = create<AudioAssetCacheStore>((set, get) => ({
  byGame: {},

  async refresh(gameId, client) {
    const current = get().byGame[gameId] ?? EMPTY
    const generation = current.generation + 1
    set((state) => ({
      byGame: { ...state.byGame, [gameId]: { ...current, loading: true, error: null, generation } },
    }))
    try {
      const kino = clientOf(client)
      const items: KinoResourceDTO[] = []
      let total = 0
      for (let page = 1; page <= 100; page += 1) {
        const result = await kino.list({
          game_id: gameId,
          media_type: 'audio',
          page,
          page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
        })
        items.push(...result.items)
        total = result.total
        if (result.items.length === 0 || items.length >= total) break
      }
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: { ...state.byGame, [gameId]: { items, total, loading: false, error: null, generation } },
      }))
    } catch (error) {
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          // 失败保留上一轮资产：一次网络抖动不该把作者正在用的候选清光。
          [gameId]: { ...(state.byGame[gameId] ?? EMPTY), loading: false, error: message(error), generation },
        },
      }))
    }
  },

  async ensure(gameId, client) {
    if (get().byGame[gameId]) return
    await get().refresh(gameId, client)
  },
}))

/**
 * 项目级音频资产消费者：自己负责首次 hydration，表面只读状态。
 * `enabled=false` = 本表面没有音乐字段，别打端点。
 */
export function useAudioAssets(gameId: string, enabled = true): AudioAssets {
  const entry = useAudioAssetCache((state) => state.byGame[gameId])
  const ensure = useAudioAssetCache((state) => state.ensure)
  const refreshCache = useAudioAssetCache((state) => state.refresh)

  useEffect(() => {
    if (!enabled) return
    void ensure(gameId)
  }, [enabled, ensure, gameId])

  const refresh = useCallback(() => refreshCache(gameId), [gameId, refreshCache])
  return { ...(entry ?? EMPTY), refresh }
}
