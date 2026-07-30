/**
 * spawn.inputs 第一层 key/value 编辑 —— 按模板组件 inputs 出字段，常量 / 表达式 / 引用。
 * 落盘仍为 Record（字面量 或 {expr}/{ref}）；不碰嵌套 JSON。
 */
import type { CSSProperties, JSX } from 'react'
import type { NumOrExpr, Overlay } from '../../runtime/schema/graph-schema'
import type { ComponentInput } from '../../runtime/schema/node-config-schema'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import { ValueInput, type EditorPickerCtx } from './editors'

type BindMode = 'literal' | 'expr' | 'ref'

const MODE_LABEL: Record<BindMode, string> = {
  literal: '常量',
  expr: '表达式',
  ref: '引用',
}

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }
const keyLbl: CSSProperties = { width: 72, opacity: 0.75, flexShrink: 0, fontSize: 11 }

function parseBind(v: unknown): { mode: BindMode; text: string } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (typeof o.expr === 'string') return { mode: 'expr', text: o.expr }
    if (typeof o.ref === 'string') return { mode: 'ref', text: o.ref }
  }
  if (typeof v === 'boolean' || typeof v === 'number') return { mode: 'literal', text: String(v) }
  if (typeof v === 'string') return { mode: 'literal', text: v }
  if (v == null) return { mode: 'literal', text: '' }
  return { mode: 'literal', text: '' }
}

function encodeBind(mode: BindMode, text: string, valueType?: ComponentInput['valueType']): unknown | undefined {
  const t = text.trim()
  if (mode === 'expr') return t ? { expr: t } : undefined
  if (mode === 'ref') return t ? { ref: t } : undefined
  if (!t) return undefined
  if (valueType === 'number') {
    const n = Number(t)
    return Number.isFinite(n) ? n : t
  }
  if (valueType === 'boolean') return t === 'true' || t === '1'
  return t
}

function resolveSpawnInputs(from: string, overlays?: Record<string, Overlay>): ComponentInput[] {
  const slash = from.indexOf('/')
  if (slash < 0) return []
  const overlayId = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  const child = overlays?.[overlayId]?.children.find((c) => c.id === childId)
  if (!child) return []
  return getComponentManifest(child.component)?.inputs ?? []
}

function ParamRow({
  inputKey,
  label,
  valueType,
  value,
  onChange,
  onClear,
}: {
  inputKey: string
  label: string
  valueType?: ComponentInput['valueType']
  value: unknown
  onChange: (next: unknown | undefined) => void
  onClear?: () => void
}): JSX.Element {
  const { mode, text } = parseBind(value)
  const setMode = (m: BindMode) => {
    if (m === mode) return
    if (m === 'expr') onChange(text.trim() ? { expr: text } : { expr: 'abs(delta)' })
    else if (m === 'ref') onChange(text.trim() ? { ref: text } : { ref: 'entity.ent-player.name' })
    else onChange(encodeBind('literal', text, valueType))
  }
  const setText = (t: string) => onChange(encodeBind(mode, t, valueType))
  const placeholder =
    mode === 'expr' ? 'abs(delta) 或 entity.ent-boss.attr.hp'
    : mode === 'ref' ? 'entity.ent-player.name'
    : valueType === 'number' ? '0'
    : valueType === 'boolean' ? 'true / false'
    : '文案'
  return (
    <div style={rowStyle}>
      <span style={keyLbl} title={inputKey}>{label}</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as BindMode)} style={{ fontSize: 11, width: 72 }}>
        {(Object.keys(MODE_LABEL) as BindMode[]).map((m) => (
          <option key={m} value={m}>{MODE_LABEL[m]}</option>
        ))}
      </select>
      {valueType === 'boolean' && mode === 'literal' ? (
        <select value={text === 'true' ? 'true' : 'false'} onChange={(e) => setText(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 80, fontSize: 12, fontFamily: mode === 'literal' ? undefined : 'monospace' }}
        />
      )}
      {onClear ? (
        <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={onClear} title="移除此参数覆盖">×</button>
      ) : null}
    </div>
  )
}

export function SpawnInputsEditor({
  from,
  inputs,
  overlays,
  pickers,
  onChange,
}: {
  from: string
  inputs: Record<string, unknown> | undefined
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  onChange: (next: Record<string, unknown> | undefined) => void
}): JSX.Element {
  const inputDefs = resolveSpawnInputs(from, overlays)
  const bag = inputs ?? {}
  const known = new Set(inputDefs.map((i) => i.key))
  const extras = Object.keys(bag).filter((k) => !known.has(k) && k !== 'component')

  const patchKey = (key: string, value: unknown | undefined) => {
    const next = { ...bag }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(Object.keys(next).length ? next : undefined)
  }

  const addExtra = () => {
    let i = 0
    let key = `param${i}`
    while (key in bag || known.has(key)) {
      i += 1
      key = `param${i}`
    }
    onChange({ ...bag, [key]: '' })
  }

  if (!from) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>先选模板，再配置传入参数</div>
  }

  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 6px' }}>
        传入参数（覆盖模板默认值；表达式可用 prev / next / delta）
      </div>
      {inputDefs.length === 0 && extras.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>该组件未声明入参，可手动加键</div>
      ) : null}
      {inputDefs.map((inp) => (
        inp.component === 'numberExpr' ? (
          <div key={inp.key} style={rowStyle}>
            <span style={keyLbl} title={inp.key}>{inp.label?.trim() || inp.key}</span>
            <ValueInput
              value={bag[inp.key] as NumOrExpr | undefined}
              defaultValue={typeof inp.default === 'number' ? inp.default : undefined}
              entities={pickers?.entities}
              variables={pickers?.variables}
              formulas={pickers?.formulas}
              onChange={(v) => patchKey(inp.key, v)}
            />
          </div>
        ) : (
          <ParamRow
            key={inp.key}
            inputKey={inp.key}
            label={inp.label?.trim() || inp.key}
            valueType={inp.valueType}
            value={bag[inp.key]}
            onChange={(v) => patchKey(inp.key, v)}
          />
        )
      ))}
      {extras.map((key) => (
        <ParamRow
          key={key}
          inputKey={key}
          label={key}
          value={bag[key]}
          onChange={(v) => patchKey(key, v)}
          onClear={() => patchKey(key, undefined)}
        />
      ))}
      <button type="button" style={{ marginTop: 2, fontSize: 11 }} onClick={addExtra}>＋ 参数</button>
    </div>
  )
}
