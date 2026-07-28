/**
 * 伤害飘字（component id: `damageFloatText`）—— 显示由外部解析完成的单行文本。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责固定的上浮淡出视觉。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { OverlayProps } from '../rendererRegistry'
import { injectCss, ensureBrushFont } from './skinRuntime'

export const damageFloatTextComponent: ComponentDef = {
  label: '伤害飘字',
  inputs: [{ key: 'text', label: '文本', valueType: 'string' }],
}

export function DamageFloatTextOverlay({ overlay }: OverlayProps): ReactNode {
  injectCss('damage-float-text', DAMAGE_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = typeof overlay.inputs.text === 'string' && overlay.inputs.text ? overlay.inputs.text : '-25'

  return (
    <div className="gv-damage-float-text">
      <span>{text}</span>
    </div>
  )
}

const DAMAGE_FLOAT_TEXT_CSS = `
.gv-damage-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-damage-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:3.5cqh;font-weight:800;color:#ff5a5a;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-damage-floatup 1.1s ease-out forwards}
@keyframes gv-damage-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
