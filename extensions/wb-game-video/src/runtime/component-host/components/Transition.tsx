/**
 * 转场（component id: `transition`）—— 契约 + 渲染同文件。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { OverlayProps } from '../rendererRegistry'

export interface TransitionParams {
  durationMs?: number
  style?: 'fade' | 'wipe'
  color?: string
}

function ensureTransitionStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-transition-style')) return
  const s = document.createElement('style')
  s.id = 'gv-transition-style'
  s.textContent = '@keyframes gv-transition{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}'
  document.head.appendChild(s)
}

export const transitionComponent: ComponentDef<TransitionParams> = {
  label: '转场',
  inputs: [
    { key: 'durationMs', label: '时长ms', valueType: 'number', default: 600 },
    {
      key: 'style',
      label: '样式',
      valueType: 'string',
      default: 'fade',
      options: [
        { value: 'fade', label: '淡入淡出' },
        { value: 'wipe', label: '擦除' },
      ],
    },
    { key: 'color', label: '颜色', valueType: 'string', component: 'color' },
  ],
}

export function TransitionOverlay({ overlay }: OverlayProps): ReactNode {
  ensureTransitionStyle()
  const p = overlay.inputs as { durationMs?: number; color?: string }
  const dur = p.durationMs ?? 600
  return (
    <div
      className="gv-transition"
      style={{
        position: 'absolute',
        inset: 0,
        background: p.color ?? '#000',
        pointerEvents: 'none',
        animation: `gv-transition ${dur}ms ease-in-out forwards`,
      }}
    />
  )
}
