/**
 * 字幕/对白（component id: `dialogue`）—— 契约 + 渲染同文件。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { GraphTextStyle } from '../../schema/graph-schema'
import type { OverlayProps } from '../rendererRegistry'
import { anchorStyle } from './defaultUi'

export interface DialogueParams {
  speaker?: string
  text: string
  color?: string
  /** 文本样式（字幕预设快照）。 */
  style?: GraphTextStyle
  /** 归一化位置（缺省=底部居中字幕带）。 */
  x?: number
  y?: number
}

const dialogueBoxStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  background: 'rgba(12,14,18,0.82)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#f0f0f0',
  pointerEvents: 'none',
  boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
}

export const dialogueComponent: ComponentDef<DialogueParams> = {
  label: '字幕/对白',
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string', default: '' },
    { key: 'text', label: '台词', valueType: 'string', default: '' },
    { key: 'color', label: '说话人色', valueType: 'string', component: 'color' },
    { key: 'style', label: '样式', valueType: 'string', component: 'textStyle' },
    { key: 'x', label: 'x', valueType: 'number' },
    { key: 'y', label: 'y', valueType: 'number' },
  ],
  validate: (p) => (p.text ? [] : ['dialogue 需要 text']),
}

export function DialogueOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as { speaker?: string; text?: string; color?: string; x?: number; y?: number }
  // 单一渲染模式：始终居中锚点定位（缺省底部居中），minWidth 防空文本塌陷、maxWidth 限幅。
  // 尺寸稳定 → 画布拖拽/钳制一致（不再有「首拖塌陷 / 首拖窄」）。
  const boxPos = anchorStyle(p.x ?? 0.5, p.y ?? 0.9, { minWidth: '40%' })
  return (
    <div className="gv-dialogue" style={{ ...boxPos, ...dialogueBoxStyle }}>
      {p.speaker && (
        <div style={{ fontWeight: 700, fontSize: 13, color: p.color ?? '#ffd54a', marginBottom: 4 }}>
          {p.speaker}
        </div>
      )}
      <div style={{ fontSize: 15, lineHeight: 1.5 }}>{p.text}</div>
    </div>
  )
}
