/**
 * 「＋挂载 / 添加控件」候选覆盖物预设 —— 画廊内置 + nodia 界面方案（有序去重）。
 *
 * NodeInspector（右侧表单「覆盖物事件」的 ＋挂载）与 NodePreviewStage（左侧预览台「添加控件」）
 * 共用同一份列表，避免两处各持一份漂移。纯数据，无 React/DOM。
 */
import type { Overlay } from '../../runtime/schema/graph-schema'
import { BUILTIN_SCHEMES } from '../demo/builtin-schemes'
import { NODIA_SCHEME_OVERLAYS } from '../demo/nodia-scheme-overlays'

export const PRESET_SCHEME_OVERLAYS: readonly Overlay[] = [...BUILTIN_SCHEMES, ...NODIA_SCHEME_OVERLAYS]

export const PRESET_SCHEME_BY_ID: Readonly<Record<string, Overlay>> = Object.fromEntries(
  PRESET_SCHEME_OVERLAYS.map((o) => [o.id, o]),
)

/** 覆盖物展示名：目录 title → 预设 title → id（title 与 id 相同时只显示 id）。 */
export function overlayDisplayLabel(
  id: string,
  overlays?: Record<string, Overlay>,
): string {
  const title = overlays?.[id]?.title?.trim() || PRESET_SCHEME_BY_ID[id]?.title?.trim()
  return !title || title === id ? id : `${title} (${id})`
}
