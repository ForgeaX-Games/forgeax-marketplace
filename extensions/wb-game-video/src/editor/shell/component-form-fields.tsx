/**
 * 按组件 `ComponentManifest.inputs` 渲染 overlay child 的输入：
 * 有 `component`（color/entity/attr/events/hotspotEvents/effects/textStyle/qteCues…）优先用对应输入组件；
 * 否则按 `valueType`（string/number/boolean + `options`→select）出标量控件。
 *
 * 复合输入（`component: textStyle/effects/events/hotspotEvents/qteCues`，或 valueType='json'）：
 * events/hotspotEvents/effects 出结构化编辑器，textStyle/qteCues 暂交「视频」轨编辑器（见 docs/inputs-ssot.md）。
 * 填了 `component` 优先用它，否则按 valueType。
 * `component: 'entity'`：场景实体下拉（复用 EffectsEditor 同源的 EntitySelect，见 editors.tsx / metaCatalog.ts）。
 * `component: 'attr'`：绑定属性下拉——实时扫**同一 inputs 里 `component: 'entity'` 那一项**当前选中的实体的
 * attrs（复用同一份 AttrSelect，见 editors.tsx；与 EffectRow/ClauseRow 的实体→属性级联同源），实体项一变属性下拉即联动刷新。
 */
import type { CSSProperties, JSX } from 'react'
import type { ComponentInput } from '../../runtime/schema/node-config-schema'
import type { NumOrExpr } from '../../runtime/schema/graph-schema'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import { hasOptionEventsInput } from './editors'
import { AttrSelect, EffectsEditor, EntitySelect, EventsEditor, ValueInput, type ComponentEventLike, type EditorPickerCtx } from './editors'
import { ColorPicker } from './ColorPicker'

/**
 * events 编辑器的 variant 由触发的输入标记本身决定，不查组件 id 也不查任何跨组件分类表：
 * 标记是 `hotspotEvents` ⇒ 画面锚点 x/y；标记是 `events` 时再问 registry「这个组件的 inputs
 * 里有没有出口清单结构」（`hasOptionEventsInput`）来决定是「可配门控 condition」还是纯出口目录。
 */
function eventsVariantFor(componentId: string, marker: string): 'plain' | 'choice' | 'hotspot' {
  if (marker === 'hotspotEvents') return 'hotspot'
  return hasOptionEventsInput(componentId) ? 'choice' : 'plain'
}

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 72, opacity: 0.7, flexShrink: 0, fontSize: 11 }

function fieldHint(inp: ComponentInput): string {
  const name = inp.label ?? inp.key
  const parts = [`${name}（inputs.${inp.key}）`]
  if (inp.component) parts.push(`类型：${inp.component}`)
  else parts.push(`类型：${inp.valueType}`)
  if (inp.options?.length) parts.push(`可选：${inp.options.map((o) => o.label || o.value).join(' / ')}`)
  if (inp.default !== undefined) parts.push(`默认：${typeof inp.default === 'object' ? JSON.stringify(inp.default) : String(inp.default)}`)
  return parts.join(' · ')
}

function field(label: string, node: JSX.Element, title?: string): JSX.Element {
  return (
    <label style={rowStyle} title={title}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function compactField(label: string, node: JSX.Element, title: string): JSX.Element {
  return (
    <label
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, marginBottom: 2 }}
      title={title}
    >
      <span style={{ opacity: 0.55, flexShrink: 0, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {node}
    </label>
  )
}

function patchValue(
  values: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (value === undefined || value === '') {
    const { [key]: _drop, ...rest } = values
    return rest
  }
  return { ...values, [key]: value }
}

/**
 * `component: 'attr'` 依赖同一 inputs 列表里 `component: 'entity'` 那一项的当前取值——
 * 即「绑定属性」总是跟随「绑定对象」联动（对齐 EffectRow/ClauseRow 里 entityId→attr 的下拉级联）。
 * 取第一个 entity 项即可：目前一个组件最多一个实体绑定入口（如 battleHpBar 的 bind）。
 */
function boundEntityId(inputs: ComponentInput[], values: Record<string, unknown>): string {
  const entityInput = inputs.find((i) => i.component === 'entity')
  const v = entityInput ? values[entityInput.key] : undefined
  return typeof v === 'string' ? v : ''
}

function isComplexInput(inp: ComponentInput): boolean {
  return (
    inp.component === 'events'
    || inp.component === 'hotspotEvents'
    || inp.component === 'effects'
    || inp.component === 'qteCues'
    || inp.component === 'textStyle'
  )
}

function summarizeComplex(inp: ComponentInput, val: unknown): string {
  if (Array.isArray(val)) {
    if (inp.component === 'events' || inp.component === 'hotspotEvents') {
      const labels = val.map((e) => {
        if (e && typeof e === 'object' && 'label' in e && typeof (e as { label?: unknown }).label === 'string') {
          return (e as { label: string }).label
        }
        if (e && typeof e === 'object' && 'id' in e) return String((e as { id: unknown }).id)
        return '?'
      })
      return `${val.length} 项${labels.length ? `（${labels.slice(0, 4).join('·')}${labels.length > 4 ? '…' : ''}）` : ''}`
    }
    return `${val.length} 项`
  }
  if (inp.component) return `在「视频」轨配置`
  return '已配置'
}

function renderInput(
  componentId: string,
  inp: ComponentInput,
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  onPatch: (key: string, value: unknown) => void,
  pickers: EditorPickerCtx | undefined,
  compact: boolean,
): JSX.Element | null {
  const val = values[inp.key]
  const label = inp.label ?? inp.key
  const hint = fieldHint(inp)
  const wrap = (node: JSX.Element): JSX.Element =>
    compact ? compactField(label, node, hint) : field(label, node, hint)

  // 有 component 优先用它渲染（复合编辑器）；events / effects 直接出结构化子编辑器，textStyle / qteCues 暂交「视频」轨。
  if (inp.component === 'events' || inp.component === 'hotspotEvents') {
    const body = (
      <EventsEditor
        value={Array.isArray(val) ? (val as ComponentEventLike[]) : undefined}
        variant={eventsVariantFor(componentId, inp.component)}
        pickers={pickers}
        onChange={(events) => onPatch(inp.key, events)}
      />
    )
    if (!compact) {
      return (
        <div key={inp.key} style={{ marginBottom: 6 }} title={hint}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
          {body}
        </div>
      )
    }
    return (
      <details key={inp.key} style={{ marginBottom: 4, fontSize: 11, width: '100%' }}>
        <summary
          style={{ cursor: 'pointer', opacity: 0.85, listStyle: 'none' }}
          title={hint}
        >
          {label} · {summarizeComplex(inp, val)}
        </summary>
        <div style={{ marginTop: 4 }}>{body}</div>
      </details>
    )
  }
  if (inp.component === 'effects') {
    const body = (
      <EffectsEditor
        value={Array.isArray(val) ? (val as never) : undefined}
        pickers={pickers}
        onChange={(effs) => onPatch(inp.key, effs)}
      />
    )
    if (!compact) {
      return (
        <div key={inp.key} style={{ marginBottom: 6 }} title={hint}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
          {body}
        </div>
      )
    }
    return (
      <details key={inp.key} style={{ marginBottom: 4, fontSize: 11, width: '100%' }}>
        <summary style={{ cursor: 'pointer', opacity: 0.85, listStyle: 'none' }} title={hint}>
          {label} · {summarizeComplex(inp, val)}
        </summary>
        <div style={{ marginTop: 4 }}>{body}</div>
      </details>
    )
  }
  if (inp.component === 'color') {
    return (
      <span key={inp.key}>
        {wrap(
          <ColorPicker
            value={typeof val === 'string' ? val : undefined}
            onChange={(next) => onPatch(inp.key, next)}
          />,
        )}
      </span>
    )
  }
  if (inp.component === 'numberExpr') {
    return (
      <div key={inp.key} style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
        <ValueInput
          value={val as NumOrExpr | undefined}
          entities={pickers?.entities}
          variables={pickers?.variables}
          formulas={pickers?.formulas}
          onChange={(next) => onPatch(inp.key, next)}
        />
      </div>
    )
  }
  if (inp.component === 'entity') {
    return (
      <span key={inp.key}>
        {wrap(
          <EntitySelect
            value={typeof val === 'string' ? val : ''}
            entities={pickers?.entities}
            onChange={(id) => onPatch(inp.key, id || undefined)}
          />,
        )}
      </span>
    )
  }
  if (inp.component === 'attr') {
    return (
      <span key={inp.key}>
        {wrap(
          <AttrSelect
            entityId={boundEntityId(inputs, values)}
            value={typeof val === 'string' ? val : ''}
            entities={pickers?.entities}
            onChange={(attr) => onPatch(inp.key, attr || undefined)}
          />,
        )}
      </span>
    )
  }
  if (inp.component) {
    // 其它输入组件（textStyle / qteCues / 未接入的）暂交「视频」轨编辑器。
    const tip = `${hint} · 请用「${inp.component}」编辑器（暂在「视频」轨配置）`
    if (compact) {
      return (
        <span key={inp.key} style={{ fontSize: 11, opacity: 0.55 }} title={tip}>
          {label}→视频轨
        </span>
      )
    }
    return (
      <div key={inp.key} style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }} title={tip}>
        {label}：请用「{inp.component}」编辑器（暂在「视频」轨配置）
      </div>
    )
  }
  if (inp.options) {
    return (
      <span key={inp.key}>
        {wrap(
          <select
            value={typeof val === 'string' ? val : ''}
            onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
            style={{ flex: compact ? undefined : 1, maxWidth: compact ? 110 : undefined, fontSize: 12 }}
            title={hint}
          >
            <option value="">（未选）</option>
            {inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>,
        )}
      </span>
    )
  }
  switch (inp.valueType) {
    case 'number':
      return (
        <span key={inp.key}>
          {wrap(
            <input
              type="number"
              value={typeof val === 'number' ? val : ''}
              onChange={(e) => onPatch(inp.key, e.target.value === '' ? undefined : Number(e.target.value))}
              style={{ width: compact ? 56 : undefined, flex: compact ? undefined : 1, fontSize: 12 }}
              title={hint}
            />,
          )}
        </span>
      )
    case 'boolean':
      return (
        <span key={inp.key}>
          {wrap(
            <input
              type="checkbox"
              checked={Boolean(val)}
              onChange={(e) => onPatch(inp.key, e.target.checked)}
              title={hint}
            />,
          )}
        </span>
      )
    case 'string':
    default:
      return (
        <span key={inp.key}>
          {wrap(
            <input
              value={typeof val === 'string' ? val : ''}
              onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
              style={{ width: compact ? 88 : undefined, flex: compact ? undefined : 1, fontSize: 12 }}
              title={hint}
            />,
          )}
        </span>
      )
  }
}

/** 摘要若干常见 inputs，供折叠标题一行展示。 */
export function summarizeComponentInputs(values: Record<string, unknown>): string {
  const bits: string[] = []
  const push = (key: string, fmt?: (v: unknown) => string) => {
    const v = values[key]
    if (v === undefined || v === '') return
    bits.push(fmt ? fmt(v) : `${key}=${String(v)}`)
  }
  push('x', (v) => `x=${v}`)
  push('y', (v) => `y=${v}`)
  push('timeoutMs', (v) => `${v}ms`)
  push('glyph')
  push('label')
  push('bind')
  push('attr')
  push('speaker')
  push('text', (v) => `「${String(v).slice(0, 12)}${String(v).length > 12 ? '…' : ''}」`)
  if (Array.isArray(values.events)) {
    const evs = values.events as Array<{ id?: string; label?: string }>
    bits.push(evs.map((e) => e.label || e.id || '?').slice(0, 4).join('/'))
  }
  return bits.slice(0, 5).join(' · ')
}

/** 由组件 manifest.inputs 驱动的通用配置面板（标量 + select；复合项提示跳过）。 */
export function ComponentFormFields({
  componentId,
  values,
  onChange,
  pickers,
  excludeKeys,
  density = 'default',
}: {
  componentId: string
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  pickers?: EditorPickerCtx
  /**
   * 排除某些字段——已有专属编辑器接管时用（如 x/y 走 PositionEditor、
   * speaker 走「显示说话人前缀」开关、events 走结算区自带的分支编辑）。
   */
  excludeKeys?: string[]
  /** compact：节点检视器等窄栏——标量并排、复合项折叠。 */
  density?: 'default' | 'compact'
}): JSX.Element | null {
  const compact = density === 'compact'
  const allInputs = getComponentManifest(componentId)?.inputs ?? []
  const inputs = excludeKeys?.length ? allInputs.filter((inp) => !excludeKeys.includes(inp.key)) : allInputs
  if (!inputs.length) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>该组件无可配 inputs（component={componentId}）</div>
  }
  const onPatch = (key: string, value: unknown) => onChange(patchValue(values, key, value))
  const scalars = inputs.filter((i) => !isComplexInput(i))
  const complexes = inputs.filter((i) => isComplexInput(i))
  return (
    <div>
      {compact ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center' }}>
          {scalars.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, true))}
        </div>
      ) : (
        scalars.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, false))
      )}
      {complexes.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, compact))}
    </div>
  )
}
