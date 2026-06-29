import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetStore, type AssetRecord } from '../assetStore'
import { useSceneImageCache } from '../sceneImageCache'
import type { ImageClient, ImageRequest, ImageResult } from '../../llm/types'

/**
 * sceneImageCache 行为契约：
 *
 *   - loadFromDisk(): **绝不**调网络，只查 assetStore；
 *     这个契约是 StagePane 修复"切关卡 / 刷新页面会自动消耗 token"bug 的关键点，
 *     一旦回归到旧行为这个测试就会立刻爆。
 *   - ensure(): 命中磁盘历史 → 不发请求；缺失 → 才走 client.generate。
 *   - retry(): 无论缓存如何都强制走 client.generate。
 */

function makeAsset(over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'img-x',
    kind: 'image',
    filename: 'blobs/img-x.png',
    mimeType: 'image/png',
    bytes: 1,
    createdAt: 1000,
    meta: {},
    ...over,
  }
}

function makeImageClient(): ImageClient & {
  readonly calls: number
} {
  let n = 0
  const client: ImageClient = {
    generate: async (req: ImageRequest): Promise<ImageResult> => {
      n += 1
      return {
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        base64: 'AAAA',
        prompt: req.prompt,
        latencyMs: 1,
      }
    },
    ping: async () => ({ ok: true, latencyMs: 0 }),
    getModel: () => 'mock',
    getProviderName: () => 'mock',
  }
  return Object.defineProperty(client, 'calls', {
    get: () => n,
    enumerable: true,
  }) as ImageClient & { readonly calls: number }
}

describe('sceneImageCache', () => {
  beforeEach(() => {
    useSceneImageCache.getState().clear()
    useAssetStore.setState({
      records: [],
      loaded: true,
      loading: false,
      error: null,
    })
    // saveDataUrl 走 fetch；测试里默默 mock 掉，避免后台落盘抛错
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ asset: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('loadFromDisk', () => {
    it('磁盘为空 → 返回 false 且不写入任何记录', () => {
      const ok = useSceneImageCache
        .getState()
        .loadFromDisk('scene-a', '一张图')
      expect(ok).toBe(false)
      expect(useSceneImageCache.getState().records['scene-a']).toBeUndefined()
    })

    it('磁盘有该 sceneId 的历史 → 写入 ready，dataUrl 走资产 URL', () => {
      useAssetStore.setState({
        records: [
          makeAsset({
            id: 'img-1',
            createdAt: 100,
            meta: { sceneId: 'scene-a', promptKind: 'scene', prompt: 'old' },
          }),
        ],
        loaded: true,
      })

      const ok = useSceneImageCache
        .getState()
        .loadFromDisk('scene-a', 'fallback')
      expect(ok).toBe(true)

      const rec = useSceneImageCache.getState().records['scene-a']
      expect(rec?.status).toBe('ready')
      if (rec?.status === 'ready') {
        expect(rec.dataUrl).toContain('img-1')
        expect(rec.assetId).toBe('img-1')
        expect(rec.prompt).toBe('old')
      }
    })

    it('已经 ready → 直接返回 true，不重复读盘', () => {
      useSceneImageCache.getState().put('scene-a', '/x', 'p', 'a-1')
      // 故意把磁盘清空，证明第二次 loadFromDisk 不会回退到 false
      useAssetStore.setState({ records: [], loaded: true })

      const ok = useSceneImageCache.getState().loadFromDisk('scene-a')
      expect(ok).toBe(true)
      const rec = useSceneImageCache.getState().records['scene-a']
      expect(rec?.status).toBe('ready')
    })
  })

  describe('ensure', () => {
    it('磁盘命中 → 不调用 client.generate', async () => {
      useAssetStore.setState({
        records: [
          makeAsset({
            id: 'img-1',
            meta: { sceneId: 'scene-a', promptKind: 'scene' },
          }),
        ],
        loaded: true,
      })
      const client = makeImageClient()

      await useSceneImageCache
        .getState()
        .ensure('scene-a', 'p', client)
      expect(client.calls).toBe(0)
    })

    it('磁盘没历史 → 才发请求', async () => {
      const client = makeImageClient()
      await useSceneImageCache
        .getState()
        .ensure('scene-b', '一张图', client)
      expect(client.calls).toBe(1)
      expect(useSceneImageCache.getState().records['scene-b']?.status).toBe(
        'ready',
      )
    })
  })

  describe('retry', () => {
    it('即使有 ready 记录也强制重发', async () => {
      useSceneImageCache.getState().put('scene-c', '/old', 'p', 'a-old')
      const client = makeImageClient()

      await useSceneImageCache.getState().retry('scene-c', 'p', client)
      expect(client.calls).toBe(1)
    })
  })
})
