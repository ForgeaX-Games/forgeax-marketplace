/**
 * Overlay 子组件样式编辑 —— 界面 tab 用；按 component 类型展示皮肤 / 文字预设选择。
 */
import type { CSSProperties, JSX } from 'react'
import type { GraphTextStyle, OverlayChild } from '../../runtime/schema/graph-schema'
import { HUD_SKINS } from '../../runtime/skins/components'
import { GraphTextStylePicker } from './GraphTextStylePicker'

const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 12 }
const lbl: CSSProperties = { width: 72, opacity: 0.7, flexShrink: 0, fontSize: 11 }

const COMPONENT_LABEL: Record<string, string> = {
  dialogue: '字幕',
  floatText: '飘字',
  qte: 'QTE',
  choice: '选项',
  battleHpBar: 'HUD 血条',
}

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={row}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

export function OverlayChildStyleEditor({
  child,
  onPatchParams,
  onPatchComponent,
}: {
  child: OverlayChild
  onPatchParams: (patch: Record<string, unknown>) => void
  onPatchComponent: (component: string) => void
}): JSX.Element {
  const inputs = child.inputs ?? {}
  const kind = child.component
  const title = COMPONENT_LABEL[kind] ?? kind

  if (HUD_SKINS.some((s) => s.id === kind) || kind === 'battleHpBar') {
    const skin = HUD_SKINS.some((s) => s.id === child.component) ? child.component : ''
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{child.id} · HUD</div>
        {field(
          'HUD 皮肤',
          <select value={skin} onChange={(e) => onPatchComponent(e.target.value)} style={{ flex: 1 }}>
            {HUD_SKINS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>,
        )}
      </div>
    )
  }

  if (kind === 'dialogue') {
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{child.id} · {title}</div>
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={lbl}>字幕样式</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GraphTextStylePicker
              group="subtitle"
              value={inputs.style as GraphTextStyle | undefined}
              onChange={(style) => onPatchParams({ style })}
            />
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'floatText') {
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{child.id} · {title}</div>
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={lbl}>飘字样式</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GraphTextStylePicker
              group="overlay"
              value={inputs.style as GraphTextStyle | undefined}
              onChange={(style) => onPatchParams({ style })}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.55 }}>
      {child.id} · {title}（暂无可编辑样式）
    </div>
  )
}
