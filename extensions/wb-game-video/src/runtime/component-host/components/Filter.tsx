/**
 * 滤镜（component id: `filter`）—— 契约 + 渲染同文件。
 *
 * 视频轨预览的权威叠层仍由 `runtime/fx/video-fx` 解析后打到 `<video>`；
 * 本渲染器供 SkinRegistry / 试玩叠层路径使用（backdrop-filter 近似）。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import { FILTER_OPTIONS, FILTER_PRESETS } from '../../fx/video-fx'
import type { OverlayProps } from '../rendererRegistry'

export interface FilterParams {
  /** 预设 id（见 FILTER_PRESETS）。 */
  filter?: string
  /** 强度 0~1。 */
  intensity?: number
}

export const filterComponent: ComponentDef<FilterParams> = {
  label: '滤镜',
  inputs: [
    { key: 'filter', label: '滤镜', valueType: 'string', default: 'warm', options: FILTER_OPTIONS },
    { key: 'intensity', label: '强度', valueType: 'number', default: 1 },
  ],
}

export function FilterOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as FilterParams
  const id = typeof p.filter === 'string' ? p.filter : 'warm'
  const intensity = typeof p.intensity === 'number' && Number.isFinite(p.intensity) ? p.intensity : 1
  const css = FILTER_PRESETS.find((x) => x.id === id)?.css(intensity) ?? ''
  if (!css) return null
  return (
    <div
      className="gv-filter"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backdropFilter: css,
        WebkitBackdropFilter: css,
      }}
      title={`滤镜 · ${id}`}
    />
  )
}
