/**
 * 字幕/对白（component id: `dialogue`）—— 显示一名角色说出的台词。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责固定的对白视觉。
 */
import type { ReactNode } from 'react'
import type { OverlayProps } from '../../rendererRegistry'
import type { ComponentDef } from '../../../registry/component-registry'
import { injectCss } from './skinRuntime'

export const dialogueComponent: ComponentDef = {
  label: '字幕/对白',
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string' },
    { key: 'text', label: '台词', valueType: 'string', default: '……' },
  ],
}

export function DialogueOverlay({ overlay }: OverlayProps): ReactNode {
  injectCss('dialogue', DIALOGUE_CSS)
  const speaker = typeof overlay.inputs.speaker === 'string' ? overlay.inputs.speaker : ''
  const text = typeof overlay.inputs.text === 'string' && overlay.inputs.text ? overlay.inputs.text : '……'

  return (
    <div className="gv-dialogue">
      <div className="gv-dialogue-box" data-overlay-fit-target>
        {speaker && <div className="gv-dialogue-speaker">{speaker}</div>}
        <div className="gv-dialogue-text">{text}</div>
      </div>
    </div>
  )
}

const DIALOGUE_CSS = `
.gv-dialogue{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}
.gv-dialogue-box{inline-size:min(88%,760px);padding:12px 16px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(12,14,18,.82);box-shadow:0 6px 24px rgba(0,0,0,.5);color:#f0f0f0}
.gv-dialogue-speaker{margin-block-end:4px;color:#ffd54a;font-size:13px;font-weight:700}
.gv-dialogue-text{font-size:15px;line-height:1.5}
`
