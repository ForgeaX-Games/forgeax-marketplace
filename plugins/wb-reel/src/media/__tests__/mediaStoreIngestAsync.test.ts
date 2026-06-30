import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaStore, primeMediaEntry } from '../mediaStore'
import { useAssetStore } from '../assetStore'

/*
 * mediaStore.ingestAsync —— 行为契约（2026-04-30 引入）：
 *
 *   1) 返回 { id, done } —— id 与 sync ingest 同规则（m-xxx）
 *   2) done.resolve 发生在 assetStore.saveBlob 返回后
 *   3) 成功路径：entry.url 被改写成 `/__reel__/assets/<assetId>`，
 *      persistState='saved'，persistedAssetId 写上 asset id；blob URL 被 revoke
 *   4) 失败路径：done reject，entry 保留，persistState='failed'，url 仍是 blob URL
 *   5) pendingIds() 在 done 完成前命中、完成后移除
 *
 * 不走真实 fetch：直接 mock assetStore.saveBlob。
 */

function resetStores() {
  useMediaStore.setState({ entries: {} })
  useAssetStore.setState({ records: [], loaded: true, loading: false, error: null })
}

function mkFile(name = 'test.mp4', type = 'video/mp4', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('mediaStore · ingestAsync', () => {
  beforeEach(() => {
    resetStores()
  })

  it('done 成功：entry.url 切到 /__reel__/assets/<assetId> + persistState=saved', async () => {
    const saveBlob = vi.fn(async () => ({
      id: 'a-1',
      kind: 'video' as const,
      filename: 'blobs/a-1.mp4',
      mimeType: 'video/mp4',
      bytes: 1024,
      createdAt: 100,
      meta: {},
    }))
    useAssetStore.setState({ saveBlob } as never)

    const { id, done } = useMediaStore.getState().ingestAsync(mkFile())
    const before = useMediaStore.getState().entries[id]!
    expect(before.persistState).toBe('pending')
    expect(before.url.startsWith('blob:') || before.url.length > 0).toBe(true)
    expect(useMediaStore.getState().pendingIds()).toContain(id)

    await done

    const after = useMediaStore.getState().entries[id]!
    expect(after.persistState).toBe('saved')
    expect(after.persistedAssetId).toBe('a-1')
    expect(after.url).toBe('/__reel__/assets/a-1')
    expect(useMediaStore.getState().pendingIds()).not.toContain(id)
  })

  it('done 失败：persistState=failed + entry 保留', async () => {
    const saveBlob = vi.fn(async () => null)
    useAssetStore.setState({ saveBlob } as never)

    const { id, done } = useMediaStore.getState().ingestAsync(mkFile())
    await expect(done).rejects.toBeDefined()
    const e = useMediaStore.getState().entries[id]!
    expect(e.persistState).toBe('failed')
    expect(e.persistedAssetId).toBeUndefined()
    expect(useMediaStore.getState().pendingIds()).not.toContain(id)
  })
})

describe('mediaStore · primeMediaEntry', () => {
  beforeEach(() => {
    resetStores()
  })

  it('hydrate 回来的条目默认 persistState=saved', () => {
    primeMediaEntry({
      id: 'm-hydrated',
      name: 'keep.mp4',
      mimeType: 'video/mp4',
      size: 2048,
      url: '/__reel__/assets/a-42',
      createdAt: 1,
    })
    const e = useMediaStore.getState().entries['m-hydrated']!
    expect(e).toBeDefined()
    expect(e.persistState).toBe('saved')
  })

  it('asset URL 来的 hydrate 覆盖内存里的 blob URL（修：异步上传完成后 NO PREVIEW）', () => {
    // 真实事故：IDB 兜底先 hydrate 了一条 blob URL，跨刷新已死链；之后 asset
    // hydrate 拿到磁盘上真正活着的 /__reel__/assets/<id>，必须覆盖死的 blob。
    useMediaStore.setState({
      entries: {
        'm-1': {
          id: 'm-1',
          name: 'stale.mp4',
          mimeType: 'video/mp4',
          size: 10,
          url: 'blob:dead-from-prev-session',
          createdAt: 2,
          persistState: 'saved',
        },
      },
    })
    primeMediaEntry({
      id: 'm-1',
      name: 'disk.mp4',
      mimeType: 'video/mp4',
      size: 999,
      url: '/__reel__/assets/a-1',
      createdAt: 1,
    })
    const e = useMediaStore.getState().entries['m-1']!
    expect(e.name).toBe('disk.mp4')
    expect(e.url).toBe('/__reel__/assets/a-1')
    expect(e.persistState).toBe('saved')
  })

  it('IDB 兜底（blob URL）不覆盖已存在条目（含可能更权威的 asset URL）', () => {
    useMediaStore.setState({
      entries: {
        'm-1': {
          id: 'm-1',
          name: 'authoritative.mp4',
          mimeType: 'video/mp4',
          size: 999,
          url: '/__reel__/assets/a-1',
          createdAt: 2,
          persistState: 'saved',
        },
      },
    })
    primeMediaEntry({
      id: 'm-1',
      name: 'fallback.mp4',
      mimeType: 'video/mp4',
      size: 10,
      url: 'blob:idb-fallback',
      createdAt: 1,
      persistState: 'saved',
    })
    const e = useMediaStore.getState().entries['m-1']!
    expect(e.name).toBe('authoritative.mp4')
    expect(e.url).toBe('/__reel__/assets/a-1')
  })

  it('已存在 pending 上传中的条目，asset URL 覆盖（持久化已成功，URL 切到磁盘）', () => {
    // 这是同会话内的常规路径：用户拖入视频 → mediaStore.ingest 写 blob URL +
    // pending → asset POST 成功 → markPersisted 改 url 到 asset，但若中间有
    // 一次 hydrate 跑过来，也应该一并切到 asset URL，而不是停在 blob。
    useMediaStore.setState({
      entries: {
        'm-1': {
          id: 'm-1',
          name: 'local.mp4',
          mimeType: 'video/mp4',
          size: 10,
          url: 'blob:live-this-session',
          createdAt: 2,
          persistState: 'pending',
        },
      },
    })
    primeMediaEntry({
      id: 'm-1',
      name: 'disk.mp4',
      mimeType: 'video/mp4',
      size: 999,
      url: '/__reel__/assets/a-1',
      createdAt: 1,
    })
    const e = useMediaStore.getState().entries['m-1']!
    expect(e.url).toBe('/__reel__/assets/a-1')
    // persistState 来自传入 entry（hydrate 默认 saved）
    expect(e.persistState).toBe('saved')
  })
})
