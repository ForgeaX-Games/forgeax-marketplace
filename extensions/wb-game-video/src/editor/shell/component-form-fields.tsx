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
import { getComponentManifest, hasOptionEventsInput } from '../../runtime/registry/component-registry'
import { AttrSelect, EffectsEditor, EntitySelect, EventsEditor, type ComponentEventLike, type EditorPickerCtx } from './editors'

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

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
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

function renderInput(
  componentId: string,
  inp: ComponentInput,
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  onPatch: (key: string, value: unknown) => void,
  pickers?: EditorPickerCtx,
): JSX.Element | null {
  const val = values[inp.key]
  const label = inp.label ?? inp.key
  // 有 component 优先用它渲染（复合编辑器）；events / effects 直接出结构化子编辑器，textStyle / qteCues 暂交「视频」轨。
  if (inp.component === 'events' || inp.component === 'hotspotEvents') {
    return (
      <div key={inp.key} style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
        <EventsEditor
          value={Array.isArray(val) ? (val as ComponentEventLike[]) : undefined}
          variant={eventsVariantFor(componentId, inp.component)}
          pickers={pickers}
          onChange={(events) => onPatch(inp.key, events)}
        />
      </div>
    )
  }
  if (inp.component === 'effects') {
    return (
      <div key={inp.key} style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
        <EffectsEditor
          value={Array.isArray(val) ? (val as never) : undefined}
          pickers={pickers}
          onChange={(effs) => onPatch(inp.key, effs)}
        />
      </div>
    )
  }
  if (inp.component === 'color') {
    return field(label, (
      <input
        value={typeof val === 'string' ? val : ''}
        placeholder="#ffffff"
        onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
        style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
      />
    ))
  }
  if (inp.component === 'entity') {
    return field(label, (
      <EntitySelect
        value={typeof val === 'string' ? val : ''}
        entities={pickers?.entities}
        onChange={(id) => onPatch(inp.key, id || undefined)}
      />
    ))
  }
  if (inp.component === 'attr') {
    return field(label, (
      <AttrSelect
        entityId={boundEntityId(inputs, values)}
        value={typeof val === 'string' ? val : ''}
        entities={pickers?.entities}
        onChange={(attr) => onPatch(inp.key, attr || undefined)}
      />
    ))
  }
  if (inp.component) {
    // 其它输入组件（textStyle / qteCues / 未接入的）暂交「视频」轨编辑器。
    return (
      <div key={inp.key} style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>
        {label}：请用「{inp.component}」编辑器（暂在「视频」轨配置）
      </div>
    )
  }
  if (inp.options) {
    return field(label, (
      <select
        value={typeof val === 'string' ? val : ''}
        onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
        style={{ flex: 1, fontSize: 12 }}
      >
        <option value="">（未选）</option>
        {inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ))
  }
  switch (inp.valueType) {
    case 'number':
      return field(label, (
        <input
          type="number"
          value={typeof val === 'number' ? val : ''}
          onChange={(e) => onPatch(inp.key, e.target.value === '' ? undefined : Number(e.target.value))}
          style={{ flex: 1, fontSize: 12 }}
        />
      ))
    case 'boolean':
      return field(label, (
        <input type="checkbox" checked={Boolean(val)} onChange={(e) => onPatch(inp.key, e.target.checked)} />
      ))
    case 'string':
    default:
      return field(label, (
        <input
          value={typeof val === 'string' ? val : ''}
          onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
          style={{ flex: 1, fontSize: 12 }}
        />
      ))
  }
}

/** 由组件 manifest.inputs 驱动的通用配置面板（标量 + select；复合项提示跳过）。 */
export function ComponentFormFields({
  componentId,
  values,
  onChange,
  pickers,
  excludeKeys,
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
}): JSX.Element | null {
  const allInputs = getComponentManifest(componentId)?.inputs ?? []
  const inputs = excludeKeys?.length ? allInputs.filter((inp) => !excludeKeys.includes(inp.key)) : allInputs
  if (!inputs.length) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>该组件无可配 inputs（component={componentId}）</div>
  }
  const onPatch = (key: string, value: unknown) => onChange(patchValue(values, key, value))
  return (
    <div>
      {inputs.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers))}
    </div>
  )
}
