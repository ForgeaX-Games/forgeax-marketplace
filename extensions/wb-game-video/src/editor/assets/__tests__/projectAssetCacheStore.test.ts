import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetLibraryClient, ManagedAsset } from '../assetLibraryClient'
import { useProjectAssetCache } from '../projectAssetCacheStore'

function asset(id: string, kind: ManagedAsset['kind'] = 'audio'): ManagedAsset {
  return { id, kind, name: id }
}

function client(list: AssetLibraryClient['list']): AssetLibraryClient {
  return {
    list,
    upload: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }
}

describe('projectAssetCacheStore', () => {
  beforeEach(() => {
    useProjectAssetCache.setState({ byGame: {} })
  })

  it('按项目和类型分桶，并让重复 ensure 共用已有数据', async () => {
    const list = vi.fn(async () => [asset('bgm-1')])
    const api = client(list)

    await useProjectAssetCache.getState().ensure('project-a', 'audio', api)
    await useProjectAssetCache.getState().ensure('project-a', 'audio', api)

    expect(list).toHaveBeenCalledTimes(1)
    expect(useProjectAssetCache.getState().byGame['project-a']?.audio?.items).toEqual([asset('bgm-1')])
  })

  it('刷新失败时保留该类型上一轮成功数据', async () => {
    const api = client(vi.fn(async () => [asset('bgm-1')]))
    await useProjectAssetCache.getState().refresh('project-a', 'audio', api)
    api.list = vi.fn(async () => { throw new Error('HTTP 503') })

    await useProjectAssetCache.getState().refresh('project-a', 'audio', api)

    const entry = useProjectAssetCache.getState().byGame['project-a']?.audio
    expect(entry?.items).toEqual([asset('bgm-1')])
    expect(entry?.error).toBe('HTTP 503')
  })

  it('上传、改名和删除直接同步共享桶', () => {
    const cache = useProjectAssetCache.getState()
    cache.upsert('project-a', asset('bgm-1'))
    cache.upsert('project-a', { ...asset('bgm-1'), name: '新名称' })
    cache.upsert('project-a', asset('cover-1', 'image'))
    cache.remove('project-a', 'audio', 'bgm-1')

    expect(useProjectAssetCache.getState().byGame['project-a']?.audio?.items).toEqual([])
    expect(useProjectAssetCache.getState().byGame['project-a']?.image?.items).toEqual([asset('cover-1', 'image')])
  })
})
