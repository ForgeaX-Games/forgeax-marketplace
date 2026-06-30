import type { SearchHotspot, SearchSegmentClip } from '../scenario/types'

/**
 * 搜索段触发/完成的纯函数（镜像 minigameHit）。
 */

/** 到达某未完成搜索段的 startMs → 取 startMs 最小的一条触发。 */
export function nextSearchToTrigger(opts: {
  clips: SearchSegmentClip[]
  elapsedMs: number
  completedIds: Set<string>
}): SearchSegmentClip | null {
  const cand = opts.clips
    .filter((c) => !opts.completedIds.has(c.id) && opts.elapsedMs + 1 >= c.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  return cand[0] ?? null
}

/** 本段参与的热点（hotspotIds 为空 = 全场景热点）。 */
export function segmentHotspots(
  segment: SearchSegmentClip,
  allLoot: SearchHotspot[],
): SearchHotspot[] {
  if (!segment.hotspotIds?.length) return allLoot
  const set = new Set(segment.hotspotIds)
  return allLoot.filter((h) => set.has(h.id))
}

/** 给定本段热点与已拾取键集合，判断是否满足完成条件。 */
export function isSegmentComplete(
  segment: SearchSegmentClip,
  sceneId: string,
  hotspots: SearchHotspot[],
  lootedKeys: Set<string>,
): boolean {
  if (hotspots.length === 0) return true
  const picked = hotspots.filter((h) => lootedKeys.has(`${sceneId}:${h.id}`))
  if ((segment.completeWhen ?? 'all') === 'any') return picked.length >= 1
  return picked.length >= hotspots.length
}
