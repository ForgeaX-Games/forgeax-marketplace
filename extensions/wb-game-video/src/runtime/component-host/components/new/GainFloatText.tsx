/**
 * 增益飘字（component id: `GainFloatText`）—— value 支持固定数字或 `{expr}` 公式。
 * 公式绘制时从 SkinCtx 求值；位置与显示时段由外部 Overlay 编排。
 */
import type { ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import type { OverlayProps } from '../../rendererRegistry'
import { injectCss, ensureBrushFont, previewTStyle, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'
import { resolveNumericFloatText, type NumericFloatTextInputs } from './numericFloatText'

export const GainFloatTextManifest: ComponentManifest = {
  id: 'GainFloatText',
  label: '增益飘字',
  inputs: [
    { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: 50 },
    { key: 'color', label: '字色', valueType: 'string', component: 'color' },
    { key: 'fontSize', label: '字号', valueType: 'number' },
  ],
  events: [],
}

export function GainFloatText({ overlay, ctx, preview, previewTimeMs, previewPlaying }: OverlayProps): ReactNode {
  injectCss('gain-float-text', GAIN_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = resolveNumericFloatText(overlay.inputs as NumericFloatTextInputs, ctx, '+50')
  const textStyle = resolveTextAppearance(overlay.inputs as TextAppearanceInputs, { color: '#ffd54a', fontSize: 3.5 })

  const frozen = preview && !previewPlaying
  return (
    <div
      className={`gv-gain-float-text${frozen ? ' is-preview-frozen' : ''}`}
      style={frozen ? previewTStyle(previewTimeMs ?? 0) : undefined}
    >
      <span data-overlay-fit-target style={textStyle}>{text}</span>
    </div>
  )
}

const GAIN_FLOAT_TEXT_CSS = `
.gv-gain-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-gain-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:var(--gv-text-font-size,3.5cqh);font-weight:800;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-gain-floatup 1.1s ease-out forwards}
.gv-gain-float-text.is-preview-frozen span{animation-play-state:paused;animation-delay:calc(0ms - var(--preview-t,0ms))}
@keyframes gv-gain-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
