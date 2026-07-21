/**
 * 画面特效（component id: `fx`）—— 契约 + 渲染同文件。
 *
 * 视频轨预览的权威叠层仍由 `runtime/fx/video-fx` 解析；本渲染器供 SkinRegistry / 试玩叠层
 * 路径画闪白/染色/暗角等（震屏/变焦在叠层上用 transform 近似）。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import { FX_OPTIONS, FX_PRESETS, type FxKindId } from '../../fx/video-fx'
import type { OverlayProps } from '../rendererRegistry'

export interface FxParams {
  /** 特效 id（flash/tint/vignette/shake/zoom）。 */
  fx?: string
  /** 强度 0~1。 */
  intensity?: number
  /** 颜色（flash/tint 用）。 */
  color?: string
}

export const fxComponent: ComponentDef<FxParams> = {
  label: '特效',
  inputs: [
    { key: 'fx', label: '特效', valueType: 'string', default: 'flash', options: FX_OPTIONS },
    { key: 'intensity', label: '强度', valueType: 'number', default: 1 },
    { key: 'color', label: '颜色', valueType: 'string', component: 'color' },
  ],
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function FxOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as FxParams
  const fx = (p.fx as FxKindId) ?? 'flash'
  const intensity = clamp01(typeof p.intensity === 'number' ? p.intensity : 1)
  const color = p.color || FX_PRESETS.find((x) => x.id === fx)?.defaultColor || '#ffffff'
  const base: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

  if (fx === 'flash') {
    return <div className="gv-fx" style={{ ...base, background: color, opacity: 0.55 * intensity }} title="特效 · 闪白" />
  }
  if (fx === 'tint') {
    return (
      <div
        className="gv-fx"
        style={{ ...base, background: color, mixBlendMode: 'multiply', opacity: 0.55 * intensity }}
        title="特效 · 染色"
      />
    )
  }
  if (fx === 'vignette') {
    const dark = 0.85 * intensity
    return (
      <div
        className="gv-fx"
        style={{
          ...base,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${dark}) 100%)`,
        }}
        title="特效 · 暗角"
      />
    )
  }
  if (fx === 'shake') {
    const amp = 7 * intensity
    return (
      <div
        className="gv-fx"
        style={{ ...base, transform: `translate(${amp}px, ${-amp * 0.6}px)` }}
        title="特效 · 震屏"
      />
    )
  }
  if (fx === 'zoom') {
    return (
      <div
        className="gv-fx"
        style={{ ...base, transform: `scale(${1 + 0.12 * intensity})`, transformOrigin: 'center' }}
        title="特效 · 变焦"
      />
    )
  }
  return null
}
