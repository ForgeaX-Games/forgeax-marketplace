import type { AssetRecord } from './assetStore'
import type { MediaEntry } from './mediaStore'

/**
 * hydrateMediaFromAssets —— 从 assetStore 的 records 反向构造 mediaStore entries。
 *
 * 契机：刷新后 mediaStore 是空的，但 scenario 里的 character.refImageId /
 * turnaroundRefImageId / location.refImageId 仍然指向 m-xxx。
 * mediaStore.ingestDataUrl 在写入时会把 mediaId 存到 asset meta，启动时
 * 只要遍历 assetStore records，对每个带 meta.mediaId 的 asset 合成一条
 * MediaEntry（url 走 `/__reel__/assets/<id>` 端点），UI 里通过 mediaId 查询就能
 * 再次看到图。
 *
 * 纯函数设计：
 *   - 输入 (records, urlOf, [filter])
 *   - 输出 Record<mediaId, MediaEntry>，不 set 任何 store —— 由调用方决定怎么 merge
 *   - 多条 asset 指向同一 mediaId 时，保留 createdAt 最新那条（作者可能重新生了图）
 *   - 没有 meta.mediaId 的 asset 忽略（那些是系统生的场景图，走 sceneImageCache 恢复）
 *
 * 2026-05 补丁: 加 `filter.scenarioId` 参数。 老实现完全不看 scenarioId,
 *   导致跨剧本资产污染 —— 用户拉新版本后, 某个 mediaId 在多个 scenario 下都有
 *   asset record (旧 v6.7 烙 demo-001 时代留下的), hydrate 会拿 createdAt 最大那条
 *   填进 mediaStore, 把"上一份剧本最新生成的图"覆盖到当前剧本的同 mediaId 引用。
 *   现在调用方应传 scenarioId, 只 hydrate 当前剧本; 切剧本时再 rehydrate 即可。
 *
 *   不传 filter (老调用): 维持原行为, 兼容只调用一次的早期路径。
 */
export interface HydrateFilter {
  /** 只 hydrate 该 scenario 名下的 asset; 不传则不过滤 (兼容老行为) */
  scenarioId?: string
}

export function hydrateMediaFromAssets(
  records: AssetRecord[],
  urlOf: (assetId: string) => string,
  filter?: HydrateFilter,
): Record<string, MediaEntry> {
  const out: Record<string, MediaEntry> = {}
  for (const a of records) {
    const mid = a.meta.mediaId
    if (!mid) continue
    if (filter?.scenarioId !== undefined) {
      // 只 hydrate 当前剧本; meta.scenarioId 缺失 (老 asset 没记 scenarioId)
      // 时不放行 —— 宁可少 hydrate 一条也不要跨剧本污染。 mediaStore 自己
      // 之后写入时会重新建立 m-xxx → MediaEntry 的关联。
      if (a.meta.scenarioId !== filter.scenarioId) continue
    }
    const existing = out[mid]
    if (existing && existing.createdAt >= a.createdAt) continue
    out[mid] = {
      id: mid,
      name: a.filename,
      mimeType: a.mimeType,
      size: a.bytes,
      url: urlOf(a.id),
      createdAt: a.createdAt,
    }
  }
  return out
}
