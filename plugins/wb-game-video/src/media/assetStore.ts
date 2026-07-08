import { create } from 'zustand'
import { gameQuery } from '../shell/gameScope'

/**
 * 资产仓 —— 与 dev server 上的 .reel-assets/ 通信，**所有生成图/视频都落磁盘**。
 *
 * 与 sceneImageCache（短期内存 cache）/ mediaStore（拖入视频内存 URL）的区别：
 *
 *   ┌────────────────────┬────────────────────┬────────────────────┐
 *   │   类型             │   存储             │   生命周期         │
 *   ├────────────────────┼────────────────────┼────────────────────┤
 *   │ assetStore         │ 磁盘 .reel-assets/ │ 永久（直至手动删） │
 *   │ sceneImageCache    │ 内存（zustand）   │ 当前页面会话       │
 *   │ mediaStore         │ 内存（blob URL）  │ 当前页面会话       │
 *   └────────────────────┴────────────────────┴────────────────────┘
 *
 * UI 应**优先**调 assetStore：每次"用 GPT-Image-2 生成"或"拖入媒体"都落盘并写入 manifest，
 * 切换场景再回来时直接通过 sceneId 读出该场景的全部历史。sceneImageCache 仅用于
 * 当前会话的 promise 共享与 in-flight 去重，不再是真相之源。
 *
 * 端点：见 vite-plugin-reel-assets.mts。
 */

const ENDPOINT = '/__reel__/assets'

export interface AssetMeta {
  scenarioId?: string
  sceneId?: string
  /**
   * 提示词归类：
   *   - 'scene'         场景画面（StagePane 渲染、Player 背景）
   *   - 'ui'            UI 风格参考
   *   - 'video'         视频生成
   *   - 'character-ref' 角色参考图
   *   - 'choice-bg'     选项卡背景
   *   - 'upload'        用户拖入的素材
   */
  promptKind?:
    | 'scene'
    | 'ui'
    | 'video'
    | 'character-ref'
    | 'choice-bg'
    | 'upload'
    | string
  prompt?: string
  model?: string
  latencyMs?: number
  /** 来源标记，便于以后筛选：'gpt-image-2' / 'manual' / 'imported' / etc. */
  source?: string
  note?: string
  tags?: string[]
  /**
   * 前端 mediaStore 生成的临时 id（m-xxx）。
   *
   * 为什么需要这个回指：mediaStore 是内存 store，刷新会丢；scenario 里
   * character.refImageId / location.refImageId 存的就是 mediaId。启动时
   * 需要按 meta.mediaId 反查 asset，把它的 url 灌回 mediaStore 同 id 条目，
   * 这样 scenario 里的引用才依然有效。
   *
   * 只由 mediaStore.ingestDataUrl / ingest 自动写入，UI 不直接构造。
   */
  mediaId?: string
  /**
   * v4（2026-05-07）· 精细化资产谱系，支撑"每个 shot 有自己版本链"的 UX：
   *
   *   · shotId           —— 归属 shot（scene 内第几个分镜）；scene 级资产可空。
   *   · version          —— 同一 shot + promptKind 下的第几版（锻造/重生产时 +1）。
   *   · parentAssetId    —— 上一版的 assetId；第一版为空。用于"回滚到上一版"。
   *   · humanReadableName —— 可选的作者起的名字 / 自动生成的 `<scene>-<shot>-v<n>`。
   *
   * 对应作者原话："生成的图像视频，命名好，做好版本、文件管理"。
   * 这些字段只是 meta；不强制写，老 asset 读取时 undefined 视为"未知"。
   */
  shotId?: string
  version?: number
  parentAssetId?: string
  humanReadableName?: string
}

export interface AssetRecord {
  id: string
  kind: 'image' | 'video'
  filename: string
  mimeType: string
  bytes: number
  createdAt: number
  /** 就地编辑（画笔/打码/翻转）覆盖原图后的时间戳；用于客户端 cache-bust */
  editedAt?: number
  meta: AssetMeta
}

interface AssetStoreState {
  records: AssetRecord[]
  loaded: boolean
  loading: boolean
  /** 上次读取/写入失败的原因（不阻塞 UI，但会在面板上显示提示） */
  error: string | null

  refresh: () => Promise<void>
  /** 直接传 dataUrl + meta，前端不需要拆 base64 */
  saveDataUrl: (input: {
    kind: 'image' | 'video'
    dataUrl: string
    meta: AssetMeta
  }) => Promise<AssetRecord | null>
  saveBlob: (input: {
    kind: 'image' | 'video'
    blob: Blob
    meta: AssetMeta
    /**
     * 上传进度回调（仅请求体上传部分，不含响应等待）。
     * loaded/total 单位 bytes；total 在某些浏览器上传第一帧前可能为 0。
     */
    onProgress?: (loaded: number, total: number) => void
    /** 取消上传 —— signal.aborted 时 saveBlob 返回 null 并不报错 */
    signal?: AbortSignal
  }) => Promise<AssetRecord | null>
  remove: (id: string) => Promise<boolean>
  /**
   * 就地替换一张图像的内容（编辑后「保存至原图」）——
   * id / mediaId / tags 不变，仅 blob 字节更新并打 editedAt（cache-bust）。
   * 仅图像可用。
   */
  replaceDataUrl: (id: string, dataUrl: string) => Promise<AssetRecord | null>
  /**
   * 按 scenarioId 批量删除 —— 剧本从历史里移除时调用，
   * 把该剧本名下的所有 assets（manifest + blob）一并 GC。
   * 返回实际删除的条数；失败不会回滚，但会把 error 写到 store。
   */
  removeByScenarioId: (scenarioId: string) => Promise<number>
  patch: (id: string, meta: Partial<AssetMeta>) => Promise<AssetRecord | null>

  /** 选择器辅助：按筛选条件返回切片（按时间倒序，最新在前） */
  list: (filter?: {
    sceneId?: string
    scenarioId?: string
    kind?: 'image' | 'video'
    promptKind?: AssetMeta['promptKind']
  }) => AssetRecord[]
  /** 按筛选取最新一条；常用于"拿当前 scene 最近一次生成的图" */
  latest: (filter: {
    sceneId?: string
    scenarioId?: string
    kind?: 'image' | 'video'
    promptKind?: AssetMeta['promptKind']
  }) => AssetRecord | undefined
  urlOf: (id: string) => string
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result ?? ''))
    r.onerror = () => rej(r.error ?? new Error('FileReader failed'))
    r.readAsDataURL(blob)
  })
}

function sortDesc(list: AssetRecord[]): AssetRecord[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}

function applyFilter(
  list: AssetRecord[],
  f: {
    sceneId?: string
    scenarioId?: string
    kind?: 'image' | 'video'
    promptKind?: AssetMeta['promptKind']
  },
): AssetRecord[] {
  return list.filter((a) => {
    if (f.kind && a.kind !== f.kind) return false
    if (f.sceneId && a.meta.sceneId !== f.sceneId) return false
    if (f.scenarioId && a.meta.scenarioId !== f.scenarioId) return false
    if (f.promptKind && a.meta.promptKind !== f.promptKind) return false
    return true
  })
}

export const useAssetStore = create<AssetStoreState>((set, get) => ({
  records: [],
  loaded: false,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${ENDPOINT}${gameQuery()}`, { method: 'GET' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { assets?: AssetRecord[] }
      set({
        records: sortDesc(json.assets ?? []),
        loaded: true,
        loading: false,
      })
    } catch (e) {
      set({
        loading: false,
        loaded: true, // 即便失败也标记 loaded，避免无限 spinner
        error: (e as Error).message,
      })
    }
  },

  saveDataUrl: async ({ kind, dataUrl, meta }) => {
    try {
      const res = await fetch(`${ENDPOINT}${gameQuery()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, dataUrl, meta }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { asset?: AssetRecord }
      const asset = json.asset ?? null
      if (asset) {
        set((s) => ({ records: sortDesc([asset, ...s.records]) }))
      }
      return asset
    } catch (e) {
      set({ error: (e as Error).message })
      return null
    }
  },

  saveBlob: async ({ kind, blob, meta, onProgress, signal }) => {
    // 用 XMLHttpRequest 而不是 fetch：
    //   · upload.onprogress 是浏览器原生支持上传进度的唯一稳路径
    //     （fetch 上传 progress 需要 ReadableStream + duplex full request streaming，
    //     Chromium 116+ 才稳，Safari 不行）
    //   · xhr.abort() 让"取消上传"实现简单
    // 协议同 fetch 版：x-reel-meta 走 URL-encoded JSON + x-reel-meta-encoded:1
    return new Promise<AssetRecord | null>((resolve) => {
      const xhr = new XMLHttpRequest()
      let aborted = false
      const onAbort = (): void => {
        aborted = true
        try {
          xhr.abort()
        } catch {
          /* ignore */
        }
      }
      if (signal) {
        if (signal.aborted) {
          resolve(null)
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      xhr.open('POST', `${ENDPOINT}/binary${gameQuery()}`, true)
      xhr.setRequestHeader(
        'content-type',
        blob.type || (kind === 'video' ? 'video/mp4' : 'image/png'),
      )
      xhr.setRequestHeader('x-reel-kind', kind)
      xhr.setRequestHeader('x-reel-meta-encoded', '1')
      xhr.setRequestHeader('x-reel-meta', encodeURIComponent(JSON.stringify(meta)))

      xhr.upload.onprogress = (e: ProgressEvent): void => {
        if (!onProgress) return
        try {
          onProgress(e.loaded, e.lengthComputable ? e.total : 0)
        } catch {
          /* 调用方崩了不应连累上传 */
        }
      }

      xhr.onload = (): void => {
        signal?.removeEventListener('abort', onAbort)
        if (xhr.status < 200 || xhr.status >= 300) {
          set({ error: `HTTP ${xhr.status}` })
          resolve(null)
          return
        }
        try {
          const json = JSON.parse(xhr.responseText) as { asset?: AssetRecord }
          const asset = json.asset ?? null
          if (asset) {
            set((s) => ({ records: sortDesc([asset, ...s.records]) }))
          }
          resolve(asset)
        } catch (e) {
          set({ error: (e as Error).message })
          resolve(null)
        }
      }
      xhr.onerror = (): void => {
        signal?.removeEventListener('abort', onAbort)
        set({ error: 'upload network error' })
        resolve(null)
      }
      xhr.onabort = (): void => {
        signal?.removeEventListener('abort', onAbort)
        // abort 是主动取消（用户点 cancel 或 signal.abort()）—— 不视作 error
        if (!aborted) set({ error: 'upload aborted' })
        resolve(null)
      }

      xhr.send(blob)
    })
  },

  remove: async (id) => {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}${gameQuery()}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      set((s) => ({ records: s.records.filter((r) => r.id !== id) }))
      return true
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
  },

  replaceDataUrl: async (id, dataUrl) => {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}${gameQuery()}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { asset?: AssetRecord }
      const asset = json.asset ?? null
      if (asset) {
        set((s) => ({
          records: sortDesc(s.records.map((r) => (r.id === id ? asset : r))),
        }))
      }
      return asset
    } catch (e) {
      set({ error: (e as Error).message })
      return null
    }
  },

  removeByScenarioId: async (scenarioId) => {
    // 先找出当前 store 里属于该剧本的所有 id
    const targetIds = get()
      .records.filter((r) => r.meta?.scenarioId === scenarioId)
      .map((r) => r.id)
    if (targetIds.length === 0) return 0

    // 并发删（后端是文件系统，并发写不冲突；但控制一下 max 6 避免烧连接）
    let deleted = 0
    const CHUNK = 6
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const chunk = targetIds.slice(i, i + CHUNK)
      const results = await Promise.all(
        chunk.map((id) =>
          fetch(`${ENDPOINT}/${encodeURIComponent(id)}${gameQuery()}`, { method: 'DELETE' })
            .then((r) => r.ok)
            .catch(() => false),
        ),
      )
      deleted += results.filter(Boolean).length
    }

    // 本地 state 一次性剔除（无论服务端成功与否，我们都不希望僵尸记录留在 UI）
    set((s) => ({
      records: s.records.filter((r) => r.meta?.scenarioId !== scenarioId),
    }))
    return deleted
  },

  patch: async (id, meta) => {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}${gameQuery()}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { asset?: AssetRecord }
      const asset = json.asset ?? null
      if (asset) {
        set((s) => ({
          records: sortDesc(s.records.map((r) => (r.id === id ? asset : r))),
        }))
      }
      return asset
    } catch (e) {
      set({ error: (e as Error).message })
      return null
    }
  },

  list: (filter) => {
    const all = get().records
    if (!filter) return all
    return applyFilter(all, filter)
  },

  latest: (filter) => {
    const list = applyFilter(get().records, filter)
    if (list.length === 0) return undefined
    // 不依赖 records 排序，遍历找最大 createdAt 的那一条
    return list.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
  },

  urlOf: (id) => `${ENDPOINT}/${encodeURIComponent(id)}${gameQuery()}`,
}))

// 应用启动时拉一次（dev 中间件不在时静默失败）
let bootStarted = false
export function bootAssetStore(): void {
  if (bootStarted) return
  bootStarted = true
  void useAssetStore.getState().refresh()
}
