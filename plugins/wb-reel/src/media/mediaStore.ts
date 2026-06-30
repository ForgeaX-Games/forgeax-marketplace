import { create } from 'zustand'
import { putMedia, deleteMedia, getMedia } from './mediaIdb'
import { gameQuery } from '../shell/gameScope'

/**
 * 媒体仓 —— 上传的视频/图像在此登记。
 *
 * 设计：
 *   - 同步 API（ingest / ingestDataUrl），UI 层不需要 await
 *   - id 空间 m-xxx 由前端 mint
 *   - 写入时 fire-and-forget 调 assetStore.saveDataUrl 落盘，meta.mediaId 回指
 *   - 刷新后由 hydrateMediaFromAssets 反查 assetStore 把 entries 重建
 *
 * 为什么不直接让 mediaStore 用 asset id 作为 key：
 *   - 调用点多处要同步拿到 id 往 scenario 里写，改 async 会污染整条链路
 *   - asset id 在 backend mint，前端异步等不到
 *
 * character.refImageId / character.turnaroundRefImageId / location.refImageId
 * 等字段存的都是这里的 mediaId —— 刷新后通过 asset meta.mediaId 回桥恢复。
 */

export interface MediaEntry {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
  createdAt: number
  /**
   * 持久化状态 —— 让 UI 感知到"还没真正落盘"：
   *   - 'pending'：正在写入 assetStore（blob URL 先占位，刷新前关页会丢）
   *   - 'saved'  ：asset 已落盘，url 可能已切到 /__reel__/assets/<assetId>
   *   - 'failed' ：写盘失败（网络/后端不在），当前会话能看，刷新会丢
   * 旧路径 ingest / ingestDataUrl 不会写这个字段（视作 'pending'），保持兼容。
   */
  persistState?: 'pending' | 'saved' | 'failed'
  /** 持久化完成后指向的 asset 记录 id；失败 / 未完成时 undefined */
  persistedAssetId?: string
  /**
   * 上传进度（仅在 persistState='pending' 期间有意义）。
   * loaded/total 字节，speed 是 bytes/s。total=0 表示浏览器还没拿到 Content-Length。
   * 由 mediaStore 内部按 200ms 节流写入，避免 UI 抖动。
   */
  progress?: { loaded: number; total: number; speed: number; updatedAt: number }
  /**
   * 取消正在进行的上传 —— 仅 ingestAsync 路径可用。调用后：
   *   · server 端不会写入这条 asset
   *   · entry.persistState 变为 'failed'
   *   · IDB 里仍保留 blob，未来可重试或清理
   * 老 ingest（fire-and-forget）路径没有 abort 句柄，UI 不应渲染取消按钮。
   */
  abort?: () => void
}

interface MediaStore {
  entries: Record<string, MediaEntry>
  ingest: (file: File) => string
  /**
   * 异步上传：返回的 Promise 在 asset 真正落盘后 resolve。期间 entry.persistState='pending'，
   * entry.url 指向 blob URL 以便预览；resolve 时 url 切到 `/__reel__/assets/<assetId>`
   * 并把 persistState 标记为 'saved'。适合"上传后要立刻引用、且不能丢"的路径（如视频上传）。
   *
   * 失败（后端未启用 / 网络错）时 reject，并把 persistState 标为 'failed'；entry 仍然保留，
   * 当前会话内 blob URL 还能用，但下一次刷新会被回收。调用方可以据此提示用户。
   */
  ingestAsync: (file: File) => { id: string; done: Promise<void> }
  /**
   * 从 data URL 直接登记一条媒体（生图流水线产物入库用，免去 File 构造）。
   * 提供 name 便于资源面板识别。
   */
  ingestDataUrl: (
    dataUrl: string,
    opts?: {
      name?: string
      mimeType?: string
      /** v5（P3）· 资产归属，用于后续"按 shot 展示历史版本" */
      shotId?: string
      sceneId?: string
      /** 可选的版本号（同一 shot 内递增；ingest 方不计算，只透传给 asset meta） */
      version?: number
      /** 可选的人类可读名，例如 "scene-xxx · shot-yyy · v3" */
      humanReadableName?: string
      /** 该资产是否由某个旧资产"修改本镜"得来，存旧 assetId 用于历史树 */
      parentAssetId?: string
      /**
       * v6.8 · forge 路径调用方应显式传 promptKind 以便 manifest 区分:
       *   - 'character-ref'  角色参考图 (三视图 / 单人立绘)
       *   - 'location-ref'   场景参考图 (基准/角度)
       *   - 'prop-ref'       道具参考图
       *   - 'scene'          剧本树节点的场景画面
       * 不传则沿用旧行为 'upload', 兼容历史调用。
       */
      promptKind?: string
      /**
       * 资产标签，透传到 asset.meta.tags。
       * 素材库「生成卡片」用它给候选归组（cardTag）；其它调用方可不传。
       */
      tags?: string[]
    },
  ) => string
  remove: (id: string) => void
  /**
   * 就地把某条 entry 的预览 url 换掉（图像「保存至原图」编辑后调用）——
   * 让正在引用该 mediaId 的卡片/已采用场景立即看到新画面。会回收旧 blob URL。
   */
  replaceUrl: (id: string, url: string) => void
  get: (id: string) => MediaEntry | undefined
  /**
   * 返回当前还在 'pending' 的 mediaId 列表；beforeunload 用来判断是否阻止离开。
   *
   * **语义**：pending = "还在跑"，刷新会丢；失败（failed）不算 pending。
   * 这个契约被 ingestAsync 的测试断言锁住了（video 上传路径 await done 后期望 failed
   * 从 pendingIds 里消失），保持不变。
   *
   * 如果你想知道"刷新会不会丢" —— 用 `atRiskIds`，它把 failed 也算上。
   */
  pendingIds: () => string[]
  /**
   * 返回刷新后**会丢数据**的 mediaId —— pending + failed 合并。
   *
   * 语义：
   *   · pending：后端写盘还没返回，blob URL 仅本会话有效
   *   · failed：写盘已返回失败，url 仍是 blob / data URL，下次启动必丢
   * 两种都属于"scenario 里已经写了 m-xxx，但磁盘上没落实" —— 刷新就悬空。
   *
   * beforeunload / 页面级"提醒"挡拦都应该用这个，而不是 pendingIds。
   * Forge 2026-05 的"生了图刷新丢 2 张"就是因为 failed 没被这层拦住。
   */
  atRiskIds: () => string[]
  /**
   * 对一条 persistState='failed' 的条目重新尝试落盘。
   *
   * 做法：从 IDB 取回原 Blob（ingestDataUrl 时已经同步存过），再次调
   * assetStore.saveBlob。成功后走 markPersisted 正常流程，url 切到
   * `/__reel__/assets/<assetId>`；仍失败则保持 failed，UI 继续显示重试按钮。
   *
   * 当 IDB 里也没有这条记录（e.g. 用户开了隐私模式、quota 被占满）时，
   * 返回 false —— 这条图本质已丢，只能重新生图。
   */
  retryPersist: (id: string) => Promise<boolean>
}

let _seq = 0
function nextId(): string {
  _seq++
  return `m-${Date.now().toString(36)}-${_seq}`
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  entries: {},
  ingest: (file) => {
    const id = nextId()
    const url = URL.createObjectURL(file)
    const entry: MediaEntry = {
      id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url,
      createdAt: Date.now(),
      persistState: 'pending',
    }
    set((s) => ({ entries: { ...s.entries, [id]: entry } }))
    // 双通道持久化（都是 fire-and-forget）：
    //   1) IDB 本地兜底 —— 即便后端挂也能刷新恢复（用户反馈"上传视频刷新就丢"的根因）
    //   2) assetStore 落盘 —— dev server 在线时优先用磁盘 URL，省 blob 内存
    void putMedia({
      id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      createdAt: entry.createdAt,
      blob: file,
    })
    void persistFileToAsset(id, file).then(
      (ok) => markPersisted(id, ok),
      () => markPersisted(id, null),
    )
    return id
  },
  ingestAsync: (file) => {
    const id = nextId()
    const url = URL.createObjectURL(file)
    const controller = new AbortController()
    const entry: MediaEntry = {
      id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url,
      createdAt: Date.now(),
      persistState: 'pending',
      progress: { loaded: 0, total: file.size, speed: 0, updatedAt: Date.now() },
      abort: () => {
        controller.abort()
      },
    }
    set((s) => ({ entries: { ...s.entries, [id]: entry } }))
    // IDB 兜底：与后端并行，保证刷新能恢复（即便 backend saveBlob 失败）
    void putMedia({
      id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      createdAt: entry.createdAt,
      blob: file,
    })

    // 节流：onProgress 触发频率高（典型每 64KB 一次），200ms 节流够用
    let lastEmit = 0
    let lastLoaded = 0
    let lastTs = Date.now()
    const onProgress = (loaded: number, total: number): void => {
      const now = Date.now()
      if (now - lastEmit < 200 && loaded < total) return
      const dt = (now - lastTs) / 1000
      const dBytes = loaded - lastLoaded
      const speed = dt > 0 ? Math.round(dBytes / dt) : 0
      lastEmit = now
      lastLoaded = loaded
      lastTs = now
      useMediaStore.setState((s) => {
        const cur = s.entries[id]
        if (!cur || cur.persistState !== 'pending') return s
        return {
          entries: {
            ...s.entries,
            [id]: {
              ...cur,
              progress: { loaded, total: total || cur.size, speed, updatedAt: now },
            },
          },
        }
      })
    }

    const done = persistFileToAsset(id, file, {
      onProgress,
      signal: controller.signal,
    }).then(
      (assetId) => {
        markPersisted(id, assetId)
        if (!assetId) {
          throw new Error(controller.signal.aborted ? 'aborted' : 'persist failed')
        }
      },
      (err) => {
        markPersisted(id, null)
        throw err
      },
    )
    return { id, done }
  },
  ingestDataUrl: (dataUrl, opts) => {
    const id = nextId()
    const mimeType = opts?.mimeType ?? sniffMimeFromDataUrl(dataUrl) ?? 'image/png'
    const entry: MediaEntry = {
      id,
      name: opts?.name ?? `${id}.${extFromMime(mimeType)}`,
      mimeType,
      // data URL 没有精确 size，这里用编码长度做近似
      size: Math.max(0, Math.floor((dataUrl.length * 3) / 4)),
      url: dataUrl,
      createdAt: Date.now(),
      persistState: 'pending',
    }
    set((s) => ({ entries: { ...s.entries, [id]: entry } }))
    // IDB 兜底：data URL → Blob 存盘，刷新时能恢复
    // 失败（data URL 损坏等）静默；后端通路还在跑
    const blob = tryDataUrlToBlob(dataUrl, mimeType)
    if (blob) {
      void putMedia({
        id,
        name: entry.name,
        mimeType: entry.mimeType,
        size: entry.size,
        createdAt: entry.createdAt,
        blob,
      })
    }
    // 落盘（fire-and-forget）：meta.mediaId=本次 id，刷新时通过它回桥
    // v5（P3）· 把 shotId / sceneId / version / humanReadableName / parentAssetId
    //           透传进 asset meta，让"历史版本"面板能按 shotId 过滤
    void persistDataUrlToAsset(id, dataUrl, entry, {
      shotId: opts?.shotId,
      sceneId: opts?.sceneId,
      version: opts?.version,
      humanReadableName: opts?.humanReadableName,
      parentAssetId: opts?.parentAssetId,
      promptKind: opts?.promptKind,
      tags: opts?.tags,
    }).then(
      (ok) => markPersisted(id, ok),
      () => markPersisted(id, null),
    )
    return id
  },
  remove: (id) =>
    set((s) => {
      const e = s.entries[id]
      if (e?.url && e.url.startsWith('blob:')) URL.revokeObjectURL(e.url)
      // 同步清 IDB 兜底，避免用户"删了视频下次刷新又冒出来" + 占用存储配额
      void deleteMedia(id)
      const { [id]: _omit, ...rest } = s.entries
      return { entries: rest }
    }),
  replaceUrl: (id, url) =>
    set((s) => {
      const e = s.entries[id]
      if (!e) return s
      if (e.url && e.url.startsWith('blob:') && e.url !== url) URL.revokeObjectURL(e.url)
      return { entries: { ...s.entries, [id]: { ...e, url } } }
    }),
  get: (id) => get().entries[id],
  pendingIds: () => {
    const out: string[] = []
    for (const [id, e] of Object.entries(get().entries)) {
      if (e.persistState === 'pending') out.push(id)
    }
    return out
  },
  atRiskIds: () => {
    // pending + failed 合并：两者刷新都会丢 m-xxx → 悬空引用
    const out: string[] = []
    for (const [id, e] of Object.entries(get().entries)) {
      if (e.persistState === 'pending' || e.persistState === 'failed') {
        out.push(id)
      }
    }
    return out
  },
  retryPersist: async (id) => {
    const entry = get().entries[id]
    if (!entry) return false
    // 已经 saved 的直接返回成功
    if (entry.persistState === 'saved' && entry.persistedAssetId) return true

    // 从 IDB 拉原 blob；ingestDataUrl / ingest / ingestAsync 三个入口都做过 putMedia
    const stored = await getMedia(id)
    if (!stored || !stored.blob) return false

    // 重置为 pending，让 UI / atRiskIds 能看到"正在重试"
    useMediaStore.setState((s) => {
      const cur = s.entries[id]
      if (!cur) return s
      return {
        entries: { ...s.entries, [id]: { ...cur, persistState: 'pending' } },
      }
    })
    try {
      const assetId = await persistBlobToAsset(id, stored.blob, entry)
      markPersisted(id, assetId)
      return !!assetId
    } catch {
      markPersisted(id, null)
      return false
    }
  },
}))

/**
 * 把一条 mediaEntry 恢复到内存 store（由 hydrateMediaFromAssets / hydrateMediaFromIdb 调用）。
 *
 * 冲突策略（2026-05-15 修：异步上传完成后 NO PREVIEW 真实事故）：
 *
 *   - **新 entry 来自 asset 通路（url 以 /__reel__/assets/ 开头）→ 无条件覆盖**。
 *     原因：asset URL 是磁盘上 immutable cache 的真相之源，永远活着；
 *     而内存里残留的 entry 可能是：
 *       1. 上一次会话的 IDB 兜底 blob URL —— 跨刷新已经死链
 *       2. 旧的 asset URL 指向已被覆盖/删除的 asset —— 同样死链
 *       3. 内存 ingest 时刚生成的 blob URL —— 当前会话有效但跨页就死
 *     **任何一种情况下，replace 成磁盘 URL 都更安全**。
 *
 *     旧策略 "已存在 → 保留 blob URL 因为它对当前会话更快" 在这条事故里被证伪：
 *       App.tsx 启动时序中，IDB 兜底 hydrate 先跑（占了坑），asset hydrate 后跑
 *       但被 "已存在" 跳过 → mediaStore 永远停留在死的 blob URL → 用户重新上传
 *       的视频虽然落盘成功，UI 却看不到（NO PREVIEW）。
 *
 *   - 新 entry 来自 IDB 兜底（blob URL）→ 仅在 mediaStore 还没这条 id 时填充。
 *     不要让 IDB 路径覆盖 asset 路径写入的"权威 URL"。
 */
export function primeMediaEntry(entry: MediaEntry): void {
  const isAssetUrl = entry.url.startsWith('/__reel__/assets/')
  useMediaStore.setState((s) => {
    const existing = s.entries[entry.id]
    if (existing && !isAssetUrl) return s
    // hydrate 的条目一律视为 'saved'：它就是从 asset / IDB 反查出来的
    const primed: MediaEntry = {
      ...entry,
      persistState: entry.persistState ?? 'saved',
    }
    if (existing && isAssetUrl) {
      // 旧 entry 是 blob: → 在替换前 revoke，避免 ObjectURL 句柄泄漏
      if (existing.url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(existing.url)
        } catch {
          // 失败无所谓，浏览器最终会回收
        }
      }
    }
    return { entries: { ...s.entries, [entry.id]: primed } }
  })
}

async function persistFileToAsset(
  mediaId: string,
  file: File,
  opts?: {
    onProgress?: (loaded: number, total: number) => void
    signal?: AbortSignal
  },
): Promise<string | null> {
  try {
    const { useAssetStore } = await import('./assetStore')
    // 取当前剧本 id —— 让资产绑定到"这是哪个剧本上传的图/视频"，
    // 便于：
    //   a) 未来删除剧本时级联清理（见 scenarioPersistBoot.removeScenarioFromHistory）
    //   b) 资产面板按剧本过滤（后续能做"本剧本已上传的素材"视图）
    // 动态 import 打破循环依赖（scenario → media → scenario）
    const { useScenarioStore } = await import('../scenario/scenarioStore')
    const scenarioId = useScenarioStore.getState().scenario.id
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    const asset = await useAssetStore.getState().saveBlob({
      kind,
      blob: file,
      meta: {
        mediaId,
        scenarioId,
        promptKind: 'upload',
        source: 'manual',
        note: file.name,
      },
      onProgress: opts?.onProgress,
      signal: opts?.signal,
    })
    return asset?.id ?? null
  } catch {
    // 后端中间件不在（非 dev）或网络故障：静默失败 —— 当前会话不阻塞，刷新会丢
    return null
  }
}

/**
 * retryPersist 使用 —— 从 IDB 拿到 Blob 后重走落盘。
 * 和 persistFileToAsset 共享同一 saveBlob 接口；差别只是
 * 这里没有 File 包装（retry 现场不构造 File），直接走 Blob。
 */
async function persistBlobToAsset(
  mediaId: string,
  blob: Blob,
  entry: MediaEntry,
): Promise<string | null> {
  try {
    const { useAssetStore } = await import('./assetStore')
    const { useScenarioStore } = await import('../scenario/scenarioStore')
    const scenarioId = useScenarioStore.getState().scenario.id
    const kind = entry.mimeType.startsWith('video/') ? 'video' : 'image'
    const asset = await useAssetStore.getState().saveBlob({
      kind,
      blob,
      meta: {
        mediaId,
        scenarioId,
        promptKind: 'upload',
        source: 'manual',
        note: entry.name,
      },
    })
    return asset?.id ?? null
  } catch {
    return null
  }
}

async function persistDataUrlToAsset(
  mediaId: string,
  dataUrl: string,
  entry: MediaEntry,
  extraMeta?: {
    shotId?: string
    sceneId?: string
    version?: number
    humanReadableName?: string
    parentAssetId?: string
    promptKind?: string
    tags?: string[]
  },
): Promise<string | null> {
  try {
    const { useAssetStore } = await import('./assetStore')
    const { useScenarioStore } = await import('../scenario/scenarioStore')
    const scenarioId = useScenarioStore.getState().scenario.id
    const kind = entry.mimeType.startsWith('video/') ? 'video' : 'image'
    const asset = await useAssetStore.getState().saveDataUrl({
      kind,
      dataUrl,
      meta: {
        mediaId,
        scenarioId,
        promptKind: extraMeta?.promptKind ?? 'upload',
        source: 'manual',
        note: entry.name,
        ...(extraMeta?.shotId !== undefined && { shotId: extraMeta.shotId }),
        ...(extraMeta?.sceneId !== undefined && { sceneId: extraMeta.sceneId }),
        ...(extraMeta?.version !== undefined && { version: extraMeta.version }),
        ...(extraMeta?.humanReadableName !== undefined && {
          humanReadableName: extraMeta.humanReadableName,
        }),
        ...(extraMeta?.parentAssetId !== undefined && {
          parentAssetId: extraMeta.parentAssetId,
        }),
        ...(extraMeta?.tags !== undefined && { tags: extraMeta.tags }),
      },
    })
    return asset?.id ?? null
  } catch {
    return null
  }
}

/**
 * 把 mediaStore 里的一条 entry 标记为"已落盘 / 落盘失败"。
 *
 * 成功路径（assetId 非空）：
 *   - 把 persistState 标为 'saved'
 *   - 把 url 切到 `/__reel__/assets/<assetId>`（动态 import 避免在纯函数/单测里抓循环）
 *     这样即便 blob URL 被 GC 也不影响播放；也让 Player 端直接用磁盘 URL
 *   - 把本地 blob URL revoke，释放内存
 *
 * 失败（assetId == null）：
 *   - 标 'failed'；保留原 blob URL，当前会话依然能播/看，只是刷新会丢。
 */
function markPersisted(mediaId: string, assetId: string | null): void {
  useMediaStore.setState((s) => {
    const e = s.entries[mediaId]
    if (!e) return s
    if (assetId) {
      // 必须带 ?game=<slug>，与 assetStore.urlOf 一致：后端 handleGetBlob 按
      // 单桶解析，缺 ?game= 会落到全局 .reel-assets 而非本 game 的 reel/assets，
      // 导致刚落盘的媒体在刷新前 404（per-game 试玩链路曾因此闪断）。
      const newUrl = `/__reel__/assets/${encodeURIComponent(assetId)}${gameQuery()}`
      // blob URL revoke 放在 set 之外也可以，这里就近处理便于读逻辑
      if (e.url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(e.url)
        } catch {
          /* ignore */
        }
      }
      return {
        entries: {
          ...s.entries,
          [mediaId]: { ...e, url: newUrl, persistState: 'saved', persistedAssetId: assetId },
        },
      }
    }
    return {
      entries: {
        ...s.entries,
        [mediaId]: { ...e, persistState: 'failed' },
      },
    }
  })
}

function sniffMimeFromDataUrl(dataUrl: string): string | undefined {
  const m = dataUrl.match(/^data:([^;,]+)[;,]/)
  return m ? m[1] : undefined
}

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  const tail = mime.split('/')[1] ?? 'bin'
  return tail
}

/**
 * data URL → Blob。仅用于 ingestDataUrl 把生图结果同时存进 IDB 兜底。
 * 出错返回 null —— 由调用方决定跳过 IDB 还是报错（这里选择静默跳过）。
 */
function tryDataUrlToBlob(dataUrl: string, mimeType: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    const b64 = dataUrl.slice(comma + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mimeType })
  } catch {
    return null
  }
}
