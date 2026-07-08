import type { MediaEntry } from './mediaStore'
import type { StoredMedia } from './mediaIdb'

/**
 * hydrateMediaFromIdb —— 从 IndexedDB 的 StoredMedia 列表反向构造 MediaEntry。
 *
 * 启动时的调用次序（见 App.tsx tryHydrate）：
 *   1. assetStore.refresh() 拿到后端 records
 *   2. hydrateMediaFromAssets(records) —— 最优通路，url 指向 /__reel__/assets/<id>
 *   3. **hydrateMediaFromIdb(idbRecords)** —— 兜底：只对 #2 没覆盖的 mediaId
 *      生成一条 blob URL，让 UI 仍能播放
 *
 * 兜底优先级（调用方体现在 primeMediaEntry 的策略）：
 *   - 如果 mediaStore.entries 已经有这条 id（来自 asset hydrate 或同会话上传），
 *     primeMediaEntry 会跳过本函数产的 IDB 兜底条目（避免覆盖更权威的 asset URL）
 *   - 否则本函数产的条目上位，blob URL 可用
 *
 * 关键非对称：asset 通路 URL（/__reel__/assets/...）允许覆盖既有的 blob URL，
 * 但反过来不行。原因详见 mediaStore.primeMediaEntry 注释。
 *
 * 纯函数设计 + 独立 urlMaker（便于单测注入 mock URL）。
 * 本函数不负责 revokeObjectURL —— blob URL 的生命周期由 mediaStore.remove 兜底。
 */
export function hydrateMediaFromIdb(
  records: StoredMedia[],
  urlMaker: (blob: Blob) => string = defaultUrlMaker,
): Record<string, MediaEntry> {
  const out: Record<string, MediaEntry> = {}
  for (const r of records) {
    if (!r.id) continue
    out[r.id] = {
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      size: r.size,
      url: urlMaker(r.blob),
      createdAt: r.createdAt,
      // IDB 兜底的条目视为已持久（本地磁盘兜底也是"持久"的一种）
      persistState: 'saved',
    }
  }
  return out
}

function defaultUrlMaker(blob: Blob): string {
  if (typeof URL === 'undefined' || !URL.createObjectURL) return ''
  return URL.createObjectURL(blob)
}
