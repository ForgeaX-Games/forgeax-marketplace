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
import type { Entity, NumOrExpr } from '../../runtime/schema/graph-schema'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import { hasOptionEventsInput } from './editors'
import { AttrSelect, EffectsEditor, EntitySelect, EventsEditor, TextValueInput, ValueInput, type ComponentEventLike, type EditorPickerCtx } from './editors'
import type { TextOrRef } from './TextValueEditor'
import { ColorPicker } from './ColorPicker'
import { compileValuePick, findEntity } from './valueExprPick'

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

function defaultPlaceholder(inp: ComponentInput): string | undefined {
  if (inp.default === undefined || inp.default === null || typeof inp.default === 'object') return undefined
  return String(inp.default)
}

function field(label: string, node: JSX.Element, title?: string): JSX.Element {
  return (
    <label style={rowStyle} title={title}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function compactField(
  label: string,
  node: JSX.Element,
  title: string,
  labelWidth?: CSSProperties['width'],
): JSX.Element {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: labelWidth ? 8 : 3,
        fontSize: 11,
        marginBottom: 2,
      }}
      title={title}
    >
      <span style={{
        width: labelWidth,
        flexBasis: labelWidth,
        opacity: 0.55,
        flexShrink: 0,
        maxWidth: labelWidth ?? 64,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
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
  if (typeof v === 'string') return v
  return typeof entityInput?.default === 'string' ? entityInput.default : ''
}

type HpValueMode = 'bound' | 'custom'

function isHpBarComponent(componentId: string): boolean {
  return componentId === 'BattlePlayerHpBar' || componentId === 'BattleEnemyHpBar'
}

function hpBinding(
  inputs: ComponentInput[],
  values: Record<string, unknown>,
): { entityId: string; attr: string } {
  const bindInput = inputs.find((input) => input.key === 'bind')
  const attrInput = inputs.find((input) => input.key === 'attr')
  return {
    entityId: typeof values.bind === 'string'
      ? values.bind
      : typeof bindInput?.default === 'string'
        ? bindInput.default
        : '',
    attr: typeof values.attr === 'string'
      ? values.attr
      : typeof attrInput?.default === 'string'
        ? attrInput.default
        : 'hp',
  }
}

function initialHpCustomValues(
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): { current: NumOrExpr; max: NumOrExpr } {
  const { entityId, attr } = hpBinding(inputs, values)
  const current = compileValuePick({
    mode: 'pick',
    terms: [{ op: '+', source: 'entity', refId: entityId, attr }],
  })
  const entity = findEntity(entities, entityId)
  const maxAttr = `${attr}Max`
  if (entity && (entity.attrs?.[maxAttr] !== undefined || entity.attrMeta?.[maxAttr] !== undefined)) {
    return {
      current,
      max: compileValuePick({
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: entityId, attr: maxAttr }],
      }),
    }
  }
  const declaredMax = entity?.attrMeta?.[attr]?.max
  if (typeof declaredMax === 'number') return { current, max: declaredMax }
  return { current, max: entity?.attrs?.[attr] ?? 0 }
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

/** 出口事件清单类输入（分组时归「事件」组，其余 inputs 归「参数」组）。 */
function isEventInput(inp: ComponentInput): boolean {
  return inp.component === 'events' || inp.component === 'hotspotEvents'
}

/** 组内小标题：比 NodeInspector 的 sectionLabel 再低一级（更小更淡），标示 details 内部的分组。 */
function groupLabel(text: string): JSX.Element {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.5, letterSpacing: 0.4, margin: '0 0 3px' }}>
      {text}
    </div>
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

/**
 * 复合输入（events / effects）在 compact 密度下的折叠壳。
 *
 * 右侧那个 `▾` 是必需的：`listStyle:'none'` 去掉了浏览器原生折叠三角，不补图标就看不出这一行
 * 可以点开去配（与 NodeInspector 的「组件」/「位置」折叠条同一套图标约定：右对齐、低透明度）。
 */
function complexDisclosure(key: string, head: string, hint: string, body: JSX.Element): JSX.Element {
  return (
    <details key={key} style={{ marginBottom: 4, fontSize: 11, width: '100%' }}>
      <summary
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          opacity: 0.85,
          listStyle: 'none',
        }}
        title={`${hint} · 点击展开编辑`}
      >
        <span>{head}</span>
        <span style={{ opacity: 0.4, marginLeft: 'auto' }}>▾</span>
      </summary>
      <div style={{ marginTop: 4 }}>{body}</div>
    </details>
  )
}

function renderInput(
  componentId: string,
  inp: ComponentInput,
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  onPatch: (key: string, value: unknown) => void,
  pickers: EditorPickerCtx | undefined,
  compact: boolean,
  labelWidth?: CSSProperties['width'],
): JSX.Element | null {
  const val = values[inp.key]
  const label = inp.label ?? inp.key
  const hint = fieldHint(inp)
  const wrap = (node: JSX.Element): JSX.Element =>
    compact ? compactField(label, node, hint, labelWidth) : field(label, node, hint)

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
    return complexDisclosure(inp.key, `${label} · ${summarizeComplex(inp, val)}`, hint, body)
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
    return complexDisclosure(inp.key, `${label} · ${summarizeComplex(inp, val)}`, hint, body)
  }
  if (inp.component === 'color') {
    return (
      <span key={inp.key}>
        {wrap(
          <ColorPicker
            value={typeof val === 'string' ? val : undefined}
            placeholder={defaultPlaceholder(inp)}
            onChange={(next) => onPatch(inp.key, next)}
          />,
        )}
      </span>
    )
  }
  if (inp.component === 'numberExpr') {
    const optional = inp.default === undefined
    return (
      <div
        key={inp.key}
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelWidth ?? 'max-content'} minmax(0, 1fr)`,
          columnGap: 8,
          alignItems: 'start',
          width: '100%',
          minWidth: 0,
          flexBasis: '100%',
          flexGrow: 0,
          flexShrink: 0,
          marginBottom: 6,
          fontSize: 11,
        }}
      >
        <span style={{ opacity: 0.55, flexShrink: 0, fontSize: 11, paddingTop: 5 }}>{label}</span>
        {inp.valueType === 'string' ? (
          <TextValueInput
            value={(val ?? inp.default) as TextOrRef | undefined}
            entities={pickers?.entities}
            variables={pickers?.variables}
            onChange={(next) => onPatch(inp.key, next)}
          />
        ) : (
          <ValueInput
            value={val as NumOrExpr | string | undefined}
            defaultValue={typeof inp.default === 'number' ? inp.default : undefined}
            entities={pickers?.entities}
            variables={pickers?.variables}
            formulas={pickers?.formulas}
            onChange={(next) => onPatch(inp.key, next)}
            onClear={optional ? () => onPatch(inp.key, undefined) : undefined}
            emptyLabel={label.includes('覆盖') ? '使用组件实时值' : '未设置（使用组件默认）'}
          />
        )}
      </div>
    )
  }
  if (inp.component === 'entity') {
    return (
      <span key={inp.key}>
        {wrap(
          <EntitySelect
            value={typeof val === 'string' ? val : (typeof inp.default === 'string' ? inp.default : '')}
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
            value={typeof val === 'string' ? val : (typeof inp.default === 'string' ? inp.default : '')}
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
    const defaultOption = typeof inp.default === 'string'
      ? inp.options.find((option) => option.value === inp.default)
      : undefined
    return (
      <span key={inp.key}>
        {wrap(
          <select
            value={typeof val === 'string' ? val : ''}
            onChange={(e) => onPatch(inp.key, e.target.value || undefined)}
            style={{ flex: compact ? undefined : 1, maxWidth: compact ? 110 : undefined, fontSize: 12 }}
            title={hint}
          >
            <option value="">
              {defaultOption ? `默认：${defaultOption.label}` : '（未选）'}
            </option>
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
              placeholder={defaultPlaceholder(inp)}
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
              placeholder={defaultPlaceholder(inp)}
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
  push('value', (v) => {
    if (typeof v === 'number') return `数值=${v}`
    if (v && typeof v === 'object' && typeof (v as { expr?: unknown }).expr === 'string') {
      const expr = (v as { expr: string }).expr
      return `公式=${expr.slice(0, 16)}${expr.length > 16 ? '…' : ''}`
    }
    return `数值=${String(v)}`
  })
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
  labelWidth,
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
  /** compact 模式的标签列宽；界面 Tab 传 `4em`，其它调用保持自适应。 */
  labelWidth?: CSSProperties['width']
}): JSX.Element | null {
  const compact = density === 'compact'
  const allInputs = getComponentManifest(componentId)?.inputs ?? []
  const availableInputs = excludeKeys?.length ? allInputs.filter((inp) => !excludeKeys.includes(inp.key)) : allInputs
  const hpBar = isHpBarComponent(componentId)
  const hpMode: HpValueMode = values.current !== undefined || values.max !== undefined ? 'custom' : 'bound'
  const inputs = hpBar
    ? availableInputs.filter((input) => hpMode === 'bound'
      ? input.key !== 'current' && input.key !== 'max'
      : input.key !== 'bind' && input.key !== 'attr')
    : availableInputs
  if (!inputs.length) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>该组件无可配 inputs（component={componentId}）</div>
  }
  const onPatch = (key: string, value: unknown) => onChange(patchValue(values, key, value))
  const setHpMode = (mode: HpValueMode): void => {
    if (!hpBar || mode === hpMode) return
    if (mode === 'bound') {
      const { current: _current, max: _max, ...rest } = values
      onChange(rest)
      return
    }
    onChange({
      ...values,
      ...initialHpCustomValues(availableInputs, values, pickers?.entities),
    })
  }
  /**
   * 分两组呈现（平铺混排时看不出层次）：
   *  - **参数**：标量 + 需专属编辑器的结构化参数（拍点 / 文字样式…）——都是「这个组件长什么样、怎么判定」
   *  - **事件**：`events` / `hotspotEvents` 出口清单——即蓝图出边要接的那些 id，语义与参数不同层
   * 只有一组时不加组标题与分隔线，保持原样（如字幕/血条只有参数、热点只有事件）。
   */
  const params = inputs.filter((i) => !isEventInput(i))
  const events = inputs.filter(isEventInput)
  const paramScalars = params.filter((i) => !isComplexInput(i))
  const paramComplexes = params.filter(isComplexInput)
  const grouped = params.length > 0 && events.length > 0
  return (
    <div>
      {hpBar ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${labelWidth ?? 'max-content'} minmax(0, 1fr)`,
            columnGap: 8,
            alignItems: 'center',
            width: '100%',
            marginBottom: 6,
            fontSize: 11,
          }}
        >
          <span style={{ opacity: 0.55 }}>血量方式</span>
          <div role="radiogroup" aria-label="血量方式" style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              role="radio"
              aria-checked={hpMode === 'bound'}
              className={hpMode === 'bound' ? 'gc-mini-action is-on' : 'gc-mini-action'}
              onClick={() => setHpMode('bound')}
            >
              绑定属性
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={hpMode === 'custom'}
              className={hpMode === 'custom' ? 'gc-mini-action is-on' : 'gc-mini-action'}
              onClick={() => setHpMode('custom')}
            >
              分别设置
            </button>
          </div>
        </div>
      ) : null}
      {params.length > 0 ? (
        <div style={grouped ? { marginBottom: 6 } : undefined}>
          {grouped ? groupLabel('参数配置') : null}
          {compact ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center' }}>
              {paramScalars.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, true, labelWidth))}
            </div>
          ) : (
            paramScalars.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, false, labelWidth))
          )}
          {paramComplexes.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, compact, labelWidth))}
        </div>
      ) : null}
      {events.length > 0 ? (
        <div style={grouped ? { borderTop: '1px solid #2f2f2f', paddingTop: 5 } : undefined}>
          {grouped ? groupLabel('事件配置') : null}
          {events.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, pickers, compact, labelWidth))}
        </div>
      ) : null}
    </div>
  )
}
