/**
 * refResolver —— 把 scenario 里五花八门的媒体引用统一抓成 Blob。
 *
 * 引用形态（按优先识别顺序）：
 *   1) `data:…`                        base64 内联，直接解
 *   2) `blob:…`                        本会话的 ObjectURL，fetch() 抓得到
 *   3) `/__reel__/assets/<aid>`        Vite reel-assets 插件暴露的磁盘资产
 *   4) `/uploads/<fn>`                 Flask backend 的 multipart 上传
 *   5) `http(s)://…`                   外链（Seedance 产物 / 外部 CDN）
 *   6) `m-…`（mediaId）                mediaStore 内存条目 → 取 entry.url 再递归
 *   7) 其他非空字符串 → 作 fallback 相对路径抓
 *
 * 失败模式：
 *   · 外链 CORS / 404 / 过期                 → 返回 { kind: 'external', url }
 *   · data URL 坏掉                          → throw
 *   · mediaId 在 store 里没命中               → throw
 *
 * 这里**不**做重试、不做并发控制；调用方（exportScenarioPackage）负责
 * "并发度 + 失败收集"。
 */

import { useMediaStore } from '../../media/mediaStore'
import { useAssetStore } from '../../media/assetStore'

export type ResolvedRef =
  | { kind: 'blob'; blob: Blob; sourceUrl: string }
  | { kind: 'external'; url: string; reason?: string }

/**
 * "原始数据已丢失"的可识别错误 —— 调用方（导出流程）据此把
 * 引用归到 manifest.missingRefs 而不是普通 failure。
 *
 * 目前只在 mediaId 在 mediaStore + assetStore 都找不到时抛出。
 */
export class MissingRefError extends Error {
  readonly isMissing = true
  readonly ref: string
  constructor(ref: string, message: string) {
    super(message)
    this.name = 'MissingRefError'
    this.ref = ref
  }
}

export interface ResolveCtx {
  /**
   * 目标剧本 id —— 兜底 assetStore 反查时优先选 meta.scenarioId 命中本剧本的资产。
   * 避免历史里两个剧本的 mediaId 撞车时拿错另一个剧本的图。
   */
  scopeScenarioId?: string
}

export async function resolveRef(
  ref: string,
  ctx: ResolveCtx = {},
): Promise<ResolvedRef> {
  if (!ref) throw new Error('resolveRef: empty ref')

  // 1) data URL
  if (ref.startsWith('data:')) {
    const blob = dataUrlToBlob(ref)
    return { kind: 'blob', blob, sourceUrl: ref }
  }

  // 2) blob: URL（当前会话有效）
  if (ref.startsWith('blob:')) {
    const blob = await fetchAsBlob(ref)
    return { kind: 'blob', blob, sourceUrl: ref }
  }

  // 3) 本地前端资产
  if (ref.startsWith('/__reel__/assets/') || ref.startsWith('/uploads/')) {
    const blob = await fetchAsBlob(ref)
    return { kind: 'blob', blob, sourceUrl: ref }
  }

  // 4) 外链
  if (/^https?:\/\//i.test(ref)) {
    try {
      const blob = await fetchAsBlob(ref)
      return { kind: 'blob', blob, sourceUrl: ref }
    } catch (err) {
      // CORS / 403 / 离线：降级，交给导出方决定"外链清单"
      return {
        kind: 'external',
        url: ref,
        reason: (err as Error).message || 'fetch failed',
      }
    }
  }

  // 5) mediaId —— 先走 mediaStore 内存（快），没命中再兜底 assetStore 反查
  if (/^m-/.test(ref)) {
    const entry = useMediaStore.getState().entries[ref]
    if (entry) {
      // entry.url 的形态已经是上面 3/2/1 中某一种，递归即可
      return resolveRef(entry.url, ctx)
    }
    // 兜底：当前选中的剧本 mediaStore 里可能没有这个 id
    //   · 历史下拉里导出**别的**剧本 → mediaStore 只 hydrate 过活跃剧本
    //   · 作者跨 session 重开 → 启动时 hydrate 还没完成
    // 此时直接去 assetStore 里按 meta.mediaId 反查，拿到 /__reel__/assets/<id> 再 fetch。
    const viaAsset = await resolveViaAssetStoreByMediaId(
      ref,
      ctx.scopeScenarioId,
    )
    if (viaAsset) return viaAsset
    throw new MissingRefError(
      ref,
      `mediaId "${ref}" not found in mediaStore nor assetStore (meta.mediaId)`,
    )
  }

  // 6) 其他路径 —— 兜底当相对 URL
  const blob = await fetchAsBlob(ref)
  return { kind: 'blob', blob, sourceUrl: ref }
}

/**
 * 在 assetStore.records 里找 meta.mediaId === target 的资产。
 *
 * 如果 assetStore 还没 `refresh()` 过（启动时点 📦 就非常可能），
 * 主动触发一次 refresh；否则只能从现有 records 里找。
 *
 * 同一 mediaId 有多份资产（回滚历史等）时，取 createdAt 最新那条，与
 * hydrateMediaFromAssets 的策略保持一致。
 * 若提供 scopeScenarioId，优先在该 scenario 范围里找，找不到再全局兜底
 * —— 避免两个剧本巧合有同名 mediaId 时拿错图。
 */
async function resolveViaAssetStoreByMediaId(
  mid: string,
  scopeScenarioId?: string,
): Promise<ResolvedRef | null> {
  const store = useAssetStore.getState()
  if (!store.loaded) {
    await store.refresh()
  }
  const records = useAssetStore.getState().records

  const pickNewest = (
    filter: (scenarioId?: string) => boolean,
  ): { id: string; createdAt: number } | null => {
    let best: { id: string; createdAt: number } | null = null
    for (const r of records) {
      if (r.meta?.mediaId !== mid) continue
      if (!filter(r.meta?.scenarioId)) continue
      if (!best || r.createdAt > best.createdAt) {
        best = { id: r.id, createdAt: r.createdAt }
      }
    }
    return best
  }

  // 先按 scope；没中再放开到全局（兼容老 asset 没写 scenarioId 的情况）
  let best = scopeScenarioId
    ? pickNewest((sid) => sid === scopeScenarioId)
    : null
  if (!best) best = pickNewest(() => true)
  if (!best) return null

  const url = useAssetStore.getState().urlOf(best.id)
  const blob = await fetchAsBlob(url)
  return { kind: 'blob', blob, sourceUrl: url }
}

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''} · ${url}`)
  }
  return await res.blob()
}

/**
 * data URL → Blob（同步）。坏 base64 直接抛，交给调用方记录失败。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('bad dataUrl: missing comma')
  const header = dataUrl.slice(5, comma) // strip 'data:'
  const body = dataUrl.slice(comma + 1)
  const [mime, ...params] = header.split(';')
  const isBase64 = params.some((p) => p.trim().toLowerCase() === 'base64')
  let bytes: Uint8Array
  if (isBase64) {
    const bin = atob(body)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } else {
    // 极少见：非 base64 dataURL
    bytes = new TextEncoder().encode(decodeURIComponent(body))
  }
  // 注：TS 5.7+ 收紧了 BlobPart 对 Uint8Array 泛型的判断，
  // 显式转成 ArrayBuffer（slice 会复制；这里 bytes 本来就是我们 own 的）能规避。
  return new Blob([bytes.buffer as ArrayBuffer], {
    type: mime || 'application/octet-stream',
  })
}

/**
 * 猜测文件扩展名：优先 mime，再 fallback 到 sourceUrl 的尾巴。
 * 扩展名没有权威性，主要为了让打包后的包文件双击能直接预览。
 */
export function extForBlob(blob: Blob, sourceUrl?: string): string {
  const mime = (blob.type || '').toLowerCase()
  const byMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'weba',
    'audio/ogg': 'ogg',
  }
  if (mime && byMime[mime]) return byMime[mime]

  if (sourceUrl) {
    // 去 query / fragment，取末尾 dot 后缀
    const clean = sourceUrl.split('?')[0]!.split('#')[0]!
    const m = clean.match(/\.([a-zA-Z0-9]{1,5})$/)
    if (m) return m[1]!.toLowerCase()
  }
  return 'bin'
}
