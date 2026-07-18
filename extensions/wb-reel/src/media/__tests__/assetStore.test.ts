import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetStore, type AssetRecord } from '../assetStore'

/**
 * assetStore 单元测试 —— 用 fetch mock 验证：
 *   - refresh: 拉 manifest → 入 store（按时间倒序）
 *   - saveDataUrl: POST → 新记录在最前
 *   - remove / patch: 与 manifest 同步
 *   - list / latest 过滤逻辑
 *   - urlOf 路径拼接
 */

const ENDPOINT = '/__reel__/assets'

function rec(over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'img-1',
    kind: 'image',
    filename: 'blobs/img-1.png',
    mimeType: 'image/png',
    bytes: 100,
    createdAt: 1000,
    meta: {},
    ...over,
  }
}

interface FetchInit {
  method?: string
  body?: string
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('assetStore', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    useAssetStore.setState({
      records: [],
      loaded: false,
      loading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refresh 拉 manifest 后按 createdAt 倒序入仓', async () => {
    const a = rec({ id: 'a', createdAt: 100 })
    const b = rec({ id: 'b', createdAt: 300 })
    const c = rec({ id: 'c', createdAt: 200 })
    fetchMock.mockResolvedValueOnce(jsonResponse({ assets: [a, b, c] }))

    await useAssetStore.getState().refresh()

    const ids = useAssetStore.getState().records.map((r) => r.id)
    expect(ids).toEqual(['b', 'c', 'a'])
    expect(useAssetStore.getState().loaded).toBe(true)
    expect(useAssetStore.getState().loading).toBe(false)
    expect(useAssetStore.getState().error).toBeNull()
  })

  it('refresh 失败时记录 error 但仍标记 loaded', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await useAssetStore.getState().refresh()
    expect(useAssetStore.getState().loaded).toBe(true)
    expect(useAssetStore.getState().error).toMatch(/HTTP 500/)
  })

  it('saveDataUrl POST 新记录后立刻进 records 最前', async () => {
    const existing = rec({ id: 'old', createdAt: 100 })
    useAssetStore.setState({ records: [existing] })

    const created = rec({ id: 'new', createdAt: 500 })
    fetchMock.mockImplementationOnce((url: string, init: FetchInit) => {
      expect(url).toBe(ENDPOINT)
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body ?? '{}') as {
        kind: string
        dataUrl: string
        meta: Record<string, unknown>
      }
      expect(body.kind).toBe('image')
      expect(body.dataUrl).toMatch(/^data:image\/png;base64,/)
      expect(body.meta).toEqual({ sceneId: 's1', promptKind: 'scene' })
      return Promise.resolve(jsonResponse({ asset: created }, { status: 201 }))
    })

    const out = await useAssetStore.getState().saveDataUrl({
      kind: 'image',
      dataUrl: 'data:image/png;base64,AAAA',
      meta: { sceneId: 's1', promptKind: 'scene' },
    })
    expect(out?.id).toBe('new')

    const ids = useAssetStore.getState().records.map((r) => r.id)
    expect(ids).toEqual(['new', 'old'])
  })

  it('remove 成功后从 records 移除', async () => {
    const a = rec({ id: 'a', createdAt: 100 })
    const b = rec({ id: 'b', createdAt: 200 })
    useAssetStore.setState({ records: [b, a] })
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, id: 'a' }))

    const ok = await useAssetStore.getState().remove('a')
    expect(ok).toBe(true)
    expect(useAssetStore.getState().records.map((r) => r.id)).toEqual(['b'])
  })

  it('patch 成功后替换记录元数据', async () => {
    const a = rec({ id: 'a', createdAt: 100, meta: { note: 'old' } })
    useAssetStore.setState({ records: [a] })

    const patched = rec({ id: 'a', createdAt: 100, meta: { note: 'new', tags: ['x'] } })
    fetchMock.mockResolvedValueOnce(jsonResponse({ asset: patched }))

    const out = await useAssetStore.getState().patch('a', { note: 'new', tags: ['x'] })
    expect(out?.meta).toEqual({ note: 'new', tags: ['x'] })
    expect(useAssetStore.getState().records[0]?.meta.note).toBe('new')
  })

  it('list 按 sceneId/kind/promptKind 过滤', () => {
    const records: AssetRecord[] = [
      rec({ id: 'a', createdAt: 100, meta: { sceneId: 's1', promptKind: 'scene' } }),
      rec({ id: 'b', createdAt: 200, meta: { sceneId: 's1', promptKind: 'ui' } }),
      rec({
        id: 'c',
        createdAt: 300,
        meta: { sceneId: 's2', promptKind: 'scene' },
        kind: 'video',
      }),
    ]
    useAssetStore.setState({ records })

    const sceneAssets = useAssetStore.getState().list({ sceneId: 's1' })
    expect(sceneAssets.map((r) => r.id).sort()).toEqual(['a', 'b'])

    const sceneScene = useAssetStore
      .getState()
      .list({ sceneId: 's1', promptKind: 'scene' })
    expect(sceneScene.map((r) => r.id)).toEqual(['a'])

    const onlyVideos = useAssetStore.getState().list({ kind: 'video' })
    expect(onlyVideos.map((r) => r.id)).toEqual(['c'])
  })

  it('latest 按筛选取最新一条', () => {
    const records: AssetRecord[] = [
      rec({ id: 'a', createdAt: 300, meta: { sceneId: 's1', promptKind: 'scene' } }),
      rec({ id: 'b', createdAt: 500, meta: { sceneId: 's1', promptKind: 'scene' } }),
      rec({ id: 'c', createdAt: 700, meta: { sceneId: 's2', promptKind: 'scene' } }),
    ]
    useAssetStore.setState({ records })

    const latestS1 = useAssetStore
      .getState()
      .latest({ sceneId: 's1', promptKind: 'scene' })
    expect(latestS1?.id).toBe('b')

    const latestS2 = useAssetStore.getState().latest({ sceneId: 's2' })
    expect(latestS2?.id).toBe('c')

    const none = useAssetStore.getState().latest({ sceneId: 'nope' })
    expect(none).toBeUndefined()
  })

  it('urlOf 拼接为 /__reel__/assets/<id>', () => {
    expect(useAssetStore.getState().urlOf('img-x')).toBe('/__reel__/assets/img-x')
  })
})
