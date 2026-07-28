/**
 * 增益飘字（component id: `gainFloatText`）—— 显示由外部解析完成的单行文本。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责固定的上浮淡出视觉。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { OverlayProps } from '../rendererRegistry'
import { injectCss, ensureBrushFont } from './skinRuntime'

export const gainFloatTextComponent: ComponentDef = {
  label: '增益飘字',
  inputs: [{ key: 'text', label: '文本', valueType: 'string' }],
}

export function GainFloatTextOverlay({ overlay }: OverlayProps): ReactNode {
  injectCss('gain-float-text', GAIN_FLOAT_TEXT_CSS)
  ensureBrushFont()
  const text = typeof overlay.inputs.text === 'string' && overlay.inputs.text ? overlay.inputs.text : '+50'

  return (
    <div className="gv-gain-float-text">
      <span>{text}</span>
    </div>
  )
}

const GAIN_FLOAT_TEXT_CSS = `
.gv-gain-float-text{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-gain-float-text span{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:3.5cqh;font-weight:800;color:#ffd54a;text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap;animation:gv-gain-floatup 1.1s ease-out forwards}
@keyframes gv-gain-floatup{0%{opacity:0;transform:translateY(-20%) scale(.9)}15%{opacity:1;transform:translateY(-60%) scale(1.1)}100%{opacity:0;transform:translateY(-140%) scale(1)}}
`
