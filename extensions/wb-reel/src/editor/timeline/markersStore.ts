/**
 * markersStore（迁移垫片）—— 标记点已纳入 scenario（scene.markers，见 types.ts），
 * 由 scenarioStore 的 addMarker/removeMarker/renameMarker 管理、随项目落盘，并可被
 * 智能体经 reel:add-marker / reel:remove-marker 寻址。
 *
 * 早期版本（v9 之前）把标记点存在 localStorage 的按场景分桶里。这里只保留一次性
 * 迁移入口 takeLegacyMarkers：读出某场景的旧标记并从存档里抹掉（避免重复迁移），
 * 调用方（Timeline）再写进 scene.markers。
 */

import type { TimelineMarker } from '../../scenario/types'

const STORAGE_KEY = 'reel-studio.timeline.markers.v1'

type LegacyMap = Record<string, TimelineMarker[]>

function loadAll(): LegacyMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as LegacyMap
  } catch {
    /* 损坏存档忽略 */
  }
  return {}
}

/**
 * 取出并清除某场景的旧版（localStorage）标记点；用于一次性迁移进 scene.markers。
 * 没有旧数据时返回空数组。
 */
export function takeLegacyMarkers(sceneId: string): TimelineMarker[] {
  if (typeof localStorage === 'undefined') return []
  const map = loadAll()
  const found = map[sceneId]
  if (!found || found.length === 0) return []
  delete map[sceneId]
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 忽略 */
  }
  return found
    .filter((m) => m && typeof m.ms === 'number' && typeof m.id === 'string')
    .map((m) => ({ id: m.id, ms: Math.max(0, Math.round(m.ms)), ...(m.label ? { label: m.label } : {}) }))
}
