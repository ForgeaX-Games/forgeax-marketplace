/**
 * 状态提示（component id: `StatusNotice`）—— 展示一次性的属性变更、获得物品等结果反馈。
 * 业务侧负责生成完整文案；组件只负责统一的居中展示与短暂动画。
 */
import type { ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import type { OverlayProps } from '../../rendererRegistry'
import { animationTimingStyle, injectCss, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'

export const StatusNoticeManifest: ComponentManifest = {
  id: 'StatusNotice',
  label: '状态提示',
  inputs: [
    { key: 'text', label: '提示文字', valueType: 'string', default: '获得道具〈xxx〉' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1600 },
  ],
  events: [],
}

export function StatusNotice({ overlay, preview, previewPlaying, previewTimeMs }: OverlayProps): ReactNode {
  injectCss('status-notice', STATUS_NOTICE_CSS)
  const text = typeof overlay.inputs.text === 'string' && overlay.inputs.text ? overlay.inputs.text : '获得道具〈xxx〉'
  const durationMs = typeof overlay.inputs.durationMs === 'number' && Number.isFinite(overlay.inputs.durationMs) && overlay.inputs.durationMs > 0
    ? overlay.inputs.durationMs
    : 1600
  const frozen = preview && !previewPlaying
  const textStyle = resolveTextAppearance(overlay.inputs as TextAppearanceInputs, { color: '#f0f0f0', fontSize: 2.4 })

  return (
    <div
      className={`gv-status-notice${frozen ? ' is-preview-frozen' : ''}`}
      style={animationTimingStyle(durationMs, frozen ? previewTimeMs ?? 0 : undefined)}
    >
      <span data-overlay-fit-target style={textStyle}>{text}</span>
    </div>
  )
}

const STATUS_NOTICE_CSS = `
.gv-status-notice{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-status-notice span{font-size:var(--gv-text-font-size,2.4cqh);font-weight:700;line-height:1.5;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.7);white-space:pre-wrap;animation:gv-status-notice-in var(--gv-animation-duration,1600ms) ease-out forwards}
.gv-status-notice.is-preview-frozen span{animation-play-state:paused;animation-delay:calc(0ms - var(--preview-t,0ms))}
@keyframes gv-status-notice-in{0%{opacity:0;transform:translateY(16%) scale(.96)}12%{opacity:1;transform:translateY(0) scale(1)}78%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-12%) scale(1.02)}}
`
