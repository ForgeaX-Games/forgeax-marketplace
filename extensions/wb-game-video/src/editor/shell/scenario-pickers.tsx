/**
 * 场景级字段选择器 —— 实体 / 属性 / 变量等从 scenario 派生，支持选手动输入。
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Entity, Variable } from '../../runtime/schema/graph-schema'

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }

function field(label: string, node: ReactNode): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function entityLabel(e: Entity): string {
  return e.name && e.name !== e.id ? `${e.name} (${e.id})` : e.id
}

function varLabel(v: Variable): string {
  return v.name && v.name !== v.id ? `${v.name} (${v.id})` : v.id
}

function attrLabel(e: Entity | undefined, attr: string): string {
  const meta = e?.attrMeta?.[attr]?.label
  return meta && meta !== attr ? `${meta} (${attr})` : attr
}

/** 实体 id：下拉 + 可选手动。 */
export function EntityPicker({
  value,
  entities,
  onChange,
  allowEmpty,
}: {
  value: string
  entities?: Record<string, Entity>
  onChange: (id: string) => void
  allowEmpty?: boolean
}): JSX.Element {
  const list = Object.values(entities ?? {})
  const known = list.some((e) => e.id === value)
  const [manual, setManual] = useState(value !== '' && !known && list.length > 0)
  if (manual || list.length === 0) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="ent-boss" style={{ flex: 1, fontSize: 12 }} />
        {list.length > 0 ? (
          <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(false)} title="改回下拉选择">列表</button>
        ) : null}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
        {allowEmpty ? <option value="">（选实体）</option> : null}
        {list.map((e) => <option key={e.id} value={e.id}>{entityLabel(e)}</option>)}
        {!known && value ? <option value={value}>{value}</option> : null}
      </select>
      <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(true)} title="手动输入 id">手动</button>
    </span>
  )
}

/** 属性名：依实体 attrs 下拉 + 可选手动。 */
export function AttrPicker({
  entityId,
  value,
  entities,
  onChange,
}: {
  entityId: string
  value: string
  entities?: Record<string, Entity>
  onChange: (attr: string) => void
}): JSX.Element {
  const ent = entities?.[entityId]
  const keys = Object.keys(ent?.attrs ?? {})
  const known = keys.includes(value)
  const [manual, setManual] = useState(value !== '' && !known && keys.length > 0)
  if (manual || keys.length === 0) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="hp" style={{ flex: 1, fontSize: 12 }} />
        {keys.length > 0 ? (
          <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(false)}>列表</button>
        ) : null}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
        <option value="">（选属性）</option>
        {keys.map((a) => <option key={a} value={a}>{attrLabel(ent, a)}</option>)}
        {!known && value ? <option value={value}>{value}</option> : null}
      </select>
      <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(true)}>手动</button>
    </span>
  )
}

/** 变量 / flag id：下拉 + 可选手动。 */
export function VariablePicker({
  value,
  variables,
  onChange,
  allowEmpty,
  placeholder = 'qi',
}: {
  value: string
  variables?: Record<string, Variable>
  onChange: (id: string) => void
  allowEmpty?: boolean
  placeholder?: string
}): JSX.Element {
  const list = Object.values(variables ?? {})
  const known = list.some((v) => v.id === value)
  const [manual, setManual] = useState(value !== '' && !known && list.length > 0)
  if (manual || list.length === 0) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1, fontSize: 12 }} />
        {list.length > 0 ? (
          <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(false)}>列表</button>
        ) : null}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: 1 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
        {allowEmpty ? <option value="">（选变量）</option> : null}
        {list.map((v) => <option key={v.id} value={v.id}>{varLabel(v)}</option>)}
        {!known && value ? <option value={value}>{value}</option> : null}
      </select>
      <button type="button" style={{ fontSize: 11 }} onClick={() => setManual(true)}>手动</button>
    </span>
  )
}

export { field as pickerField }
