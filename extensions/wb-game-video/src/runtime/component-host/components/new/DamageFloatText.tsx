/**
 * 伤害飘字（component id: `DamageFloatText`）—— value 支持固定数字或 `{expr}` 公式。
 * 公式绘制时从 SkinCtx 求值；位置与显示时段由外部 Overlay 编排。
 */
import type { ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import type { OverlayProps } from '../../rendererRegistry'
import { animationTimingStyle, injectCss, ensureBrushFont, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'
import { resolveNumericFloatDurationMs, resolveNumericFloatText, type NumericFloatTextInputs } from './numericFloatText'

export const DamageFloatTextManifest: ComponentManifest = {
  id: 'DamageFloatText',
  label: '伤害飘字',
  inputs: [
    { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: -25 },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#ff5a5a' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
  ],
  events: [],
}

export function DamageFloatText({ overlay, ctx, preview, previewTimeMs, previewPlaying }: OverlayProps): ReactNode {
  injectCss('damage-float-text', DAMAGE_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = resolveNumericFloatText(overlay.inputs as NumericFloatTextInputs, ctx, '-25')
  const textStyle = resolveTextAppearance(overlay.inputs as TextAppearanceInputs, { color: '#ff5a5a', fontSize: 3.5 })
  const durationMs = resolveNumericFloatDurationMs(overlay.inputs.durationMs)
  const frozen = preview && !previewPlaying
  return (
    <div
      className={`gv-damage-float-text${frozen ? ' is-preview-frozen' : ''}`}
      style={animationTimingStyle(durationMs, frozen ? previewTimeMs ?? 0 : undefined)}
    >
      <span data-overlay-fit-target style={textStyle}>{text}</span>
    </div>
  )
}

const DAMAGE_FLOAT_TEXT_CSS = `
.gv-damage-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-damage-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:var(--gv-text-font-size,3.5cqh);font-weight:800;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-damage-floatup var(--gv-animation-duration,1100ms) ease-out forwards}
.gv-damage-float-text.is-preview-frozen span{animation-play-state:paused;animation-delay:calc(0ms - var(--preview-t,0ms))}
@keyframes gv-damage-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
