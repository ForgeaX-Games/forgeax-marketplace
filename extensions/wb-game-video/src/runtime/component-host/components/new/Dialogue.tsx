/**
 * 字幕/对白（component id: `Dialogue`）—— 显示一名角色说出的台词。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责固定的对白视觉。
 */
import type { ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import type { OverlayProps } from '../../rendererRegistry'
import { injectCss, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'
import { resolveTextValue } from '../numericValue'

export const DialogueManifest: ComponentManifest = {
  id: 'Dialogue',
  label: '字幕/对白',
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string', component: 'numberExpr' },
    { key: 'text', label: '台词', valueType: 'string', default: '……', component: 'numberExpr' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color' },
    { key: 'fontSize', label: '字号', valueType: 'number' },
  ],
  events: [],
}

export function Dialogue({ overlay, ctx }: OverlayProps): ReactNode {
  injectCss('dialogue', DIALOGUE_CSS)
  const speaker = resolveTextValue(overlay.inputs.speaker, ctx) ?? ''
  const text = resolveTextValue(overlay.inputs.text, ctx) || '……'
  const textStyle = resolveTextAppearance(overlay.inputs as TextAppearanceInputs, { color: '#f0f0f0', fontSize: 2 })

  return (
    <div className="gv-dialogue">
      <div className="gv-dialogue-box" data-overlay-fit-target>
        {speaker && <div className="gv-dialogue-speaker">{speaker}</div>}
        <div className="gv-dialogue-text" style={textStyle}>{text}</div>
      </div>
    </div>
  )
}

const DIALOGUE_CSS = `
.gv-dialogue{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}
.gv-dialogue-box{inline-size:100%;box-sizing:border-box;padding:12px 16px;background:transparent}
.gv-dialogue-speaker{margin-block-end:4px;color:#ffd54a;font-size:13px;font-weight:700;text-align:center}
.gv-dialogue-text{font-size:var(--gv-text-font-size,2cqh);line-height:1.5;text-align:center}
`
