/**
 * 场景级字段选择器 —— 实体 / 属性 / 变量从 scenario 派生。
 *
 * 纯下拉：引用必须来自已声明项（实体 / 属性 / 变量），不提供手动输入。列表为空时给声明引导，
 * 已选中但失效的 id 标红提示，让作者一眼看出该引用指向了不存在的声明。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { Entity, Variable } from '../../runtime/schema/graph-schema'
import { authoringOptionLabel } from '../authoring-option-label'

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const selectStyle: CSSProperties = { flex: 1, fontSize: 12, minWidth: 0, boxSizing: 'border-box' }
const emptyHint: CSSProperties = { flex: 1, fontSize: 11, opacity: 0.65, lineHeight: 1.4 }
// 已选中但已失效（引用指向不存在的声明）——红色错误态，对齐 FormulaAstEditor 的 --gc-danger。
const staleOption: CSSProperties = { color: 'var(--gc-danger, #e66)' }

function field(label: string, node: ReactNode): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function entityLabel(e: Entity): string {
  return authoringOptionLabel(e.name, e.id)
}

function varLabel(v: Variable): string {
  return authoringOptionLabel(v.name, v.id)
}

function attrLabel(e: Entity | undefined, attr: string): string {
  const meta = e?.attrMeta?.[attr]?.label
  return authoringOptionLabel(meta, attr)
}

/** 实体 id：纯下拉，只能选已声明实体。 */
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
  if (list.length === 0) {
    return <span style={emptyHint}>请先在「规则 → 实体」声明实体</span>
  }
  const known = list.some((e) => e.id === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, ...(!known && value ? staleOption : {}) }}>
      {allowEmpty ? <option value="">（选实体）</option> : null}
      {list.map((e) => <option key={e.id} value={e.id}>{entityLabel(e)}</option>)}
      {!known && value ? <option value={value}>⚠ {value}（已失效）</option> : null}
    </select>
  )
}

/** 属性名：依所选实体的 attrs 纯下拉。 */
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
  if (keys.length === 0) {
    return <span style={emptyHint}>{entityId ? '该实体尚无属性，请到「规则 → 实体」补属性' : '请先选实体'}</span>
  }
  const known = keys.includes(value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, ...(!known && value ? staleOption : {}) }}>
      <option value="">（选属性）</option>
      {keys.map((a) => <option key={a} value={a}>{attrLabel(ent, a)}</option>)}
      {!known && value ? <option value={value}>⚠ {value}（已失效）</option> : null}
    </select>
  )
}

/** 变量 id：纯下拉，只能选已声明变量。 */
export function VariablePicker({
  value,
  variables,
  onChange,
  allowEmpty,
}: {
  value: string
  variables?: Record<string, Variable>
  onChange: (id: string) => void
  allowEmpty?: boolean
}): JSX.Element {
  const list = Object.values(variables ?? {})
  if (list.length === 0) {
    return <span style={emptyHint}>请先在「规则 → 变量」声明变量</span>
  }
  const known = list.some((v) => v.id === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, ...(!known && value ? staleOption : {}) }}>
      {allowEmpty ? <option value="">（选变量）</option> : null}
      {list.map((v) => <option key={v.id} value={v.id}>{varLabel(v)}</option>)}
      {!known && value ? <option value={value}>⚠ {value}（已失效）</option> : null}
    </select>
  )
}

export { field as pickerField }
