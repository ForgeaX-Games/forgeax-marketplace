import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaStore } from '../mediaStore'
import { useAssetStore } from '../assetStore'

/**
 * mediaStore —— atRiskIds / retryPersist 行为契约（2026-05-12 引入）。
 *
 * 背景：Forge 反馈"生成了图但没上传，刷新后丢 2 张"。根因是 asset POST 失败 →
 * persistState='failed' → pendingIds 不包含它 → beforeunload 不拦 → 一刷就空。
 *
 * 本测试锁住两个修复：
 *   1) atRiskIds 同时返回 pending + failed（beforeunload 现在读这个）
 *   2) retryPersist 能把 failed 条目重新写盘；IDB 里没 blob 时返回 false
 */

function resetStores() {
  useMediaStore.setState({ entries: {} })
  useAssetStore.setState({ records: [], loaded: true, loading: false, error: null })
}

vi.mock('../mediaIdb', () => {
  // 内置一个轻量 fake IDB：retryPersist 会调 getMedia 取 blob 来重传
  const db = new Map<string, { id: string; blob: Blob; name: string; mimeType: string; size: number; createdAt: number }>()
  return {
    putMedia: vi.fn(async (m: { id: string; blob: Blob; name: string; mimeType: string; size: number; createdAt: number }) => {
      db.set(m.id, m)
    }),
    getAllMedia: vi.fn(async () => Array.from(db.values())),
    deleteMedia: vi.fn(async (id: string) => {
      db.delete(id)
    }),
    getMedia: vi.fn(async (id: string) => db.get(id) ?? null),
    __resetMediaIdbForTest: () => db.clear(),
  }
})

describe('mediaStore · atRiskIds', () => {
  beforeEach(() => {
    resetStores()
  })

  it('包含 pending', () => {
    useMediaStore.setState({
      entries: {
        'm-p': {
          id: 'm-p',
          name: 'p.png',
          mimeType: 'image/png',
          size: 1,
          url: 'data:x',
          createdAt: 1,
          persistState: 'pending',
        },
      },
    })
    expect(useMediaStore.getState().atRiskIds()).toEqual(['m-p'])
  })

  it('包含 failed —— 这是 beforeunload 本次修复的关键', () => {
    useMediaStore.setState({
      entries: {
        'm-f': {
          id: 'm-f',
          name: 'f.png',
          mimeType: 'image/png',
          size: 1,
          url: 'data:x',
          createdAt: 1,
          persistState: 'failed',
        },
      },
    })
    expect(useMediaStore.getState().atRiskIds()).toEqual(['m-f'])
  })

  it('不包含 saved', () => {
    useMediaStore.setState({
      entries: {
        'm-s': {
          id: 'm-s',
          name: 's.png',
          mimeType: 'image/png',
          size: 1,
          url: '/__reel__/assets/a-1',
          createdAt: 1,
          persistState: 'saved',
          persistedAssetId: 'a-1',
        },
      },
    })
    expect(useMediaStore.getState().atRiskIds()).toEqual([])
  })

  it('pendingIds 语义保持不变（只返回 pending，不含 failed）—— ingestAsync 老测试依赖这个', () => {
    useMediaStore.setState({
      entries: {
        'm-p': {
          id: 'm-p',
          name: 'p.png',
          mimeType: 'image/png',
          size: 1,
          url: 'data:x',
          createdAt: 1,
          persistState: 'pending',
        },
        'm-f': {
          id: 'm-f',
          name: 'f.png',
          mimeType: 'image/png',
          size: 1,
          url: 'data:x',
          createdAt: 1,
          persistState: 'failed',
        },
      },
    })
    expect(useMediaStore.getState().pendingIds()).toEqual(['m-p'])
    expect(useMediaStore.getState().atRiskIds().sort()).toEqual(['m-f', 'm-p'])
  })
})

describe('mediaStore · retryPersist', () => {
  beforeEach(async () => {
    resetStores()
    // 清掉 fake IDB（mock 里暴露的 helper）
    const m = await import('../mediaIdb')
    ;(m as unknown as { __resetMediaIdbForTest: () => void }).__resetMediaIdbForTest()
  })

  it('entry 不存在 → 返回 false', async () => {
    const ok = await useMediaStore.getState().retryPersist('m-nope')
    expect(ok).toBe(false)
  })

  it('entry 已 saved → 直接返回 true（幂等，不会再次 POST）', async () => {
    useMediaStore.setState({
      entries: {
        'm-s': {
          id: 'm-s',
          name: 's.png',
          mimeType: 'image/png',
          size: 1,
          url: '/__reel__/assets/a-1',
          createdAt: 1,
          persistState: 'saved',
          persistedAssetId: 'a-1',
        },
      },
    })
    const saveBlob = vi.fn()
    useAssetStore.setState({ saveBlob } as never)
    const ok = await useMediaStore.getState().retryPersist('m-s')
    expect(ok).toBe(true)
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('failed 条目 + IDB 有 blob + 后端成功 → persistState=saved, url 切到 /__reel__/assets/xxx', async () => {
    // 先把 blob 塞进 fake IDB
    const { putMedia } = await import('../mediaIdb')
    await putMedia({
      id: 'm-f',
      name: 'f.png',
      mimeType: 'image/png',
      size: 3,
      createdAt: 1,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    })
    useMediaStore.setState({
      entries: {
        'm-f': {
          id: 'm-f',
          name: 'f.png',
          mimeType: 'image/png',
          size: 3,
          url: 'blob:lost',
          createdAt: 1,
          persistState: 'failed',
        },
      },
    })
    const saveBlob = vi.fn(async () => ({
      id: 'a-77',
      kind: 'image' as const,
      filename: 'blobs/a-77.png',
      mimeType: 'image/png',
      bytes: 3,
      createdAt: 2,
      meta: {},
    }))
    useAssetStore.setState({ saveBlob } as never)

    const ok = await useMediaStore.getState().retryPersist('m-f')
    expect(ok).toBe(true)
    expect(saveBlob).toHaveBeenCalledTimes(1)
    const e = useMediaStore.getState().entries['m-f']!
    expect(e.persistState).toBe('saved')
    expect(e.persistedAssetId).toBe('a-77')
    expect(e.url).toBe('/__reel__/assets/a-77')
  })

  it('failed 条目 + IDB 没 blob → 返回 false（用户清过浏览器数据的兜底）', async () => {
    useMediaStore.setState({
      entries: {
        'm-f': {
          id: 'm-f',
          name: 'f.png',
          mimeType: 'image/png',
          size: 3,
          url: 'blob:lost',
          createdAt: 1,
          persistState: 'failed',
        },
      },
    })
    const saveBlob = vi.fn()
    useAssetStore.setState({ saveBlob } as never)
    const ok = await useMediaStore.getState().retryPersist('m-f')
    expect(ok).toBe(false)
    expect(saveBlob).not.toHaveBeenCalled()
    // entry 保持 failed
    expect(useMediaStore.getState().entries['m-f']!.persistState).toBe('failed')
  })

  it('retryPersist 过程中 entry.persistState 先切到 pending（让 UI 能显示"重试中"）', async () => {
    const { putMedia } = await import('../mediaIdb')
    await putMedia({
      id: 'm-f',
      name: 'f.png',
      mimeType: 'image/png',
      size: 3,
      createdAt: 1,
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    })
    useMediaStore.setState({
      entries: {
        'm-f': {
          id: 'm-f',
          name: 'f.png',
          mimeType: 'image/png',
          size: 3,
          url: 'blob:lost',
          createdAt: 1,
          persistState: 'failed',
        },
      },
    })

    // saveBlob 挂起 —— 期间探一眼 state
    let resolveFn!: (v: null) => void
    const pendingPromise = new Promise<null>((res) => {
      resolveFn = res
    })
    const saveBlob = vi.fn(() => pendingPromise)
    useAssetStore.setState({ saveBlob } as never)

    const retryPromise = useMediaStore.getState().retryPersist('m-f')
    // 给 microtask 一轮让 setState 落地
    await Promise.resolve()
    expect(useMediaStore.getState().entries['m-f']!.persistState).toBe('pending')

    resolveFn(null) // 模拟"还是失败"
    const ok = await retryPromise
    expect(ok).toBe(false)
    expect(useMediaStore.getState().entries['m-f']!.persistState).toBe('failed')
  })
})
