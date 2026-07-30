/**
 * 增益飘字（component id: `GainFloatText`）—— value 支持固定数字或 `{expr}` 公式。
 * 公式绘制时从 SkinCtx 求值；位置与显示时段由外部 Overlay 编排。
 */
import type { ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import type { OverlayProps } from '../../rendererRegistry'
import { injectCss, ensureBrushFont } from './skinRuntime'
import { resolveNumericFloatText, type NumericFloatTextInputs } from './numericFloatText'

export const GainFloatTextManifest: ComponentManifest = {
  id: 'GainFloatText',
  label: '增益飘字',
  inputs: [{ key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: 50 }],
  events: [],
}

export function GainFloatText({ overlay, ctx, preview }: OverlayProps): ReactNode {
  injectCss('gain-float-text', GAIN_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = resolveNumericFloatText(overlay.inputs as NumericFloatTextInputs, ctx, '+50')

  return (
    <div className={`gv-gain-float-text${preview ? ' is-preview' : ''}`}>
      <span data-overlay-fit-target>{text}</span>
    </div>
  )
}

const GAIN_FLOAT_TEXT_CSS = `
.gv-gain-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-gain-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:3.5cqh;font-weight:800;color:#ffd54a;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-gain-floatup 1.1s ease-out forwards}
.gv-gain-float-text.is-preview span{animation:none;opacity:1;transform:none}
@keyframes gv-gain-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
