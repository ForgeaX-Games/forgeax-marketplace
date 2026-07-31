/**
 * 伤害飘字（component id: `damageFloatText`）—— value 支持固定数字或 `{expr}` 公式。
 * 公式绘制时从 SkinCtx 求值；位置与显示时段由外部 Overlay 编排。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../../registry/component-registry'
import type { OverlayProps } from '../../rendererRegistry'
import { injectCss, ensureBrushFont } from './skinRuntime'
import { resolveNumericFloatText, type NumericFloatTextInputs } from './numericFloatText'

export const damageFloatTextComponent: ComponentDef<NumericFloatTextInputs> = {
  label: '伤害飘字',
  inputs: [{ key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: -25 }],
}

export function DamageFloatTextOverlay({ overlay, ctx, preview }: OverlayProps): ReactNode {
  injectCss('damage-float-text', DAMAGE_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = resolveNumericFloatText(overlay.inputs as NumericFloatTextInputs, ctx, '-25')

  return (
    <div className={`gv-damage-float-text${preview ? ' is-preview' : ''}`}>
      <span data-overlay-fit-target>{text}</span>
    </div>
  )
}

const DAMAGE_FLOAT_TEXT_CSS = `
.gv-damage-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-damage-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:3.5cqh;font-weight:800;color:#ff5a5a;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-damage-floatup 1.1s ease-out forwards}
.gv-damage-float-text.is-preview span{animation:none;opacity:1;transform:none}
@keyframes gv-damage-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
