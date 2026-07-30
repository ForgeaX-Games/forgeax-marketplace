/**
 * 音频资产缓存 —— 与 `kinoVideoCacheStore` 同款契约：
 *   1. 缓存里存**原始 `KinoResourceDTO`**（展示形状由壳层派生），多个消费者共用一次拉取；
 *   2. 端点失败留 `error`，**不**退化成一个看着正常的空结果；
 *   3. `refresh()` 是「音频上传成功后回灌」的入口，且失败不清空手上已有的资产。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioAssetCache, useAudioAssets } from '../audioAssetCacheStore'
import type { KinoResourceDTO, KinoResourcePage } from '../kino-api'

const list = vi.hoisted(() => vi.fn())

vi.mock('../kino-api', async () => {
  const actual = await vi.importActual<typeof import('../kino-api')>('../kino-api')
  return {
    ...actual,
    createKinoVideoClient: () => ({ list }),
  }
})

function resource(id: string, name?: string): KinoResourceDTO {
  return {
    resource_id: id,
    game_id: 'project-a',
    media_type: 'audio',
    name,
    url: `/api/v1/kino/resources/${id}/content`,
    created_at: 0,
    updated_at: 0,
  }
}

function page(items: KinoResourceDTO[]): KinoResourcePage {
  return { items, total: items.length, page: 1, page_size: 100 }
}

describe('audioAssetCacheStore', () => {
  beforeEach(() => {
    useAudioAssetCache.setState({ byGame: {} })
    list.mockReset()
  })

  it('两个消费者共用一次拉取（ensure 去重），缓存里是原始 KinoResourceDTO', async () => {
    list.mockResolvedValue(page([resource('aud-1', '战斗床')]))

    const first = renderHook(() => useAudioAssets('project-a'))
    const second = renderHook(() => useAudioAssets('project-a'))

    await waitFor(() => expect(first.result.current.items).toHaveLength(1))
    expect(first.result.current.items[0]).toEqual(resource('aud-1', '战斗床'))
    expect(second.result.current.items).toEqual(first.result.current.items)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'project-a',
      media_type: 'audio',
    }))

    first.unmount()
    second.unmount()
  })

  it('只拉自己 game 的资产，别的项目桶不受影响', async () => {
    list.mockResolvedValue(page([resource('aud-1')]))

    const hook = renderHook(() => useAudioAssets('project-a'))
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))

    expect(useAudioAssetCache.getState().byGame['project-b']).toBeUndefined()
    hook.unmount()
  })

  it('端点失败留 error，而不是一个看着正常的空结果', async () => {
    list.mockRejectedValue(new Error('HTTP 500'))

    const hook = renderHook(() => useAudioAssets('project-a'))

    await waitFor(() => expect(hook.result.current.error).toBe('HTTP 500'))
    expect(hook.result.current.items).toEqual([])
    expect(hook.result.current.loading).toBe(false)
    hook.unmount()
  })

  it('refresh() 重新拉取并回灌所有消费者', async () => {
    list.mockResolvedValue(page([]))
    const first = renderHook(() => useAudioAssets('project-a'))
    const second = renderHook(() => useAudioAssets('project-a'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    list.mockResolvedValue(page([resource('aud-new', '新上传')]))
    await act(() => first.result.current.refresh())

    await waitFor(() => expect(second.result.current.items).toHaveLength(1))
    expect(first.result.current.items[0]?.resource_id).toBe('aud-new')

    first.unmount()
    second.unmount()
  })

  it('上传、重命名和删除可以立即回灌共享缓存', () => {
    const cache = useAudioAssetCache.getState()
    cache.upsert('project-a', resource('aud-new', '新上传'))
    expect(useAudioAssetCache.getState().byGame['project-a']?.items.map((item) => item.name))
      .toEqual(['新上传'])

    cache.upsert('project-a', resource('aud-new', '新名称'))
    expect(useAudioAssetCache.getState().byGame['project-a']?.items.map((item) => item.name))
      .toEqual(['新名称'])

    cache.remove('project-a', 'aud-new')
    expect(useAudioAssetCache.getState().byGame['project-a']?.items).toEqual([])
  })

  it('首次拉取前的 upsert 不会让 ensure 把局部缓存误当完整列表', async () => {
    useAudioAssetCache.getState().upsert('project-a', resource('aud-new', '新上传'))
    list.mockResolvedValue(page([
      resource('aud-new', '新上传'),
      resource('aud-existing', '已有音乐'),
    ]))

    const hook = renderHook(() => useAudioAssets('project-a'))
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2))
    expect(list).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('refresh 成功后清掉上一次的 error（重试能把面板从失败态救回来）', async () => {
    list.mockRejectedValueOnce(new Error('HTTP 500'))
    const hook = renderHook(() => useAudioAssets('project-a'))
    await waitFor(() => expect(hook.result.current.error).toBe('HTTP 500'))

    list.mockResolvedValue(page([resource('aud-1')]))
    await act(() => hook.result.current.refresh())

    await waitFor(() => expect(hook.result.current.error).toBeNull())
    expect(hook.result.current.items).toHaveLength(1)
    hook.unmount()
  })

  it('刷新失败保留上一轮资产，只挂 error', async () => {
    list.mockResolvedValue(page([resource('aud-1', '战斗床')]))
    const hook = renderHook(() => useAudioAssets('project-a'))
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))

    list.mockRejectedValue(new Error('HTTP 503'))
    await act(() => hook.result.current.refresh())

    expect(hook.result.current.error).toBe('HTTP 503')
    expect(hook.result.current.items.map((a) => a.resource_id)).toEqual(['aud-1'])
    expect(hook.result.current.loading).toBe(false)
    hook.unmount()
  })

  it('迟到的应答不覆盖更新一轮的结果', async () => {
    let releaseSlow: (result: KinoResourcePage) => void = () => {}
    const slow = new Promise<KinoResourcePage>((resolve) => { releaseSlow = resolve })
    list.mockReturnValueOnce(slow)
    list.mockResolvedValueOnce(page([resource('aud-new')]))

    const cache = useAudioAssetCache.getState()
    const firstRound = cache.refresh('project-a')
    await cache.refresh('project-a')
    expect(useAudioAssetCache.getState().byGame['project-a']?.items.map((a) => a.resource_id)).toEqual(['aud-new'])

    releaseSlow(page([resource('aud-stale')]))
    await firstRound

    expect(useAudioAssetCache.getState().byGame['project-a']?.items.map((a) => a.resource_id)).toEqual(['aud-new'])
  })

  it('迟到的失败不覆盖更新一轮的结果', async () => {
    let rejectSlow: (e: Error) => void = () => {}
    const slow = new Promise<KinoResourcePage>((_, reject) => { rejectSlow = reject })
    list.mockReturnValueOnce(slow)
    list.mockResolvedValueOnce(page([resource('aud-new')]))

    const cache = useAudioAssetCache.getState()
    const firstRound = cache.refresh('project-a')
    await cache.refresh('project-a')

    rejectSlow(new Error('HTTP 500'))
    await firstRound

    const entry = useAudioAssetCache.getState().byGame['project-a']
    expect(entry?.error).toBeNull()
    expect(entry?.items.map((a) => a.resource_id)).toEqual(['aud-new'])
  })

  it('enabled=false 不拉（表面没有音乐字段就别打端点）', () => {
    renderHook(() => useAudioAssets('project-a', false))
    expect(list).not.toHaveBeenCalled()
  })
})
