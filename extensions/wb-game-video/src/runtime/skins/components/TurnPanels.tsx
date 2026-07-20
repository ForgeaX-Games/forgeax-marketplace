/**
 * 回合按钮面板（非阻塞可点击组件）——演示"一个 overlay 放多个组件、各自抛点击事件"。
 *
 * - `panelA`：单按钮 A（事件 `A`）。
 * - `panelB`：三按钮 B1 / B2 / B3（事件 `B1` / `B2` / `B3`）。
 * 摆放由 overlay 子项 `layout` 决定（本组件只负责内容，不写死位置/尺寸）。
 * 点击经 `props.emit(key)` → session.emitEvent → 挂载 event 反应（effect/spawn/advance），**不阻塞演出**。
 */
import type { OverlayProps } from '../rendererRegistry'
import type { ComponentDef } from '../../registry/component-registry'

const row: React.CSSProperties = { display: 'flex', gap: 8, width: '100%', height: '100%' }
const btn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(20,22,28,0.85)',
  color: '#f0e9d8',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

export function PanelA({ overlay, emit }: OverlayProps): JSX.Element {
  const label = typeof overlay.inputs?.label === 'string' && overlay.inputs.label.trim()
    ? overlay.inputs.label.trim()
    : 'A'
  return (
    <div style={row}>
      <button type="button" style={btn} onClick={() => emit?.('A')}>{label}</button>
    </div>
  )
}

export function PanelB({ emit }: OverlayProps): JSX.Element {
  return (
    <div style={row}>
      <button type="button" style={btn} onClick={() => emit?.('B1')}>B1</button>
      <button type="button" style={btn} onClick={() => emit?.('B2')}>B2</button>
      <button type="button" style={btn} onClick={() => emit?.('B3')}>B3</button>
    </div>
  )
}

export const panelAComponent: ComponentDef = {
  role: 'presentation',
  label: 'A 面板（单按钮）',
  inputs: [{ key: 'label', label: '按钮文案', valueType: 'string', default: 'A' }],
  events: [{ id: 'A', label: '按钮A' }],
}

export const panelBComponent: ComponentDef = {
  role: 'presentation',
  label: 'B 面板（三按钮）',
  inputs: [],
  events: [
    { id: 'B1', label: '按钮B1' },
    { id: 'B2', label: '按钮B2' },
    { id: 'B3', label: '按钮B3（跳转）' },
  ],
}
