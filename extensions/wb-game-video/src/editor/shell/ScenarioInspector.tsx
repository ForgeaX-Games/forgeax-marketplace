/**
 * ScenarioInspector —— 场景级配置：variables / entities / overlays 目录 / formulas / 默认 BGM。
 */
import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { AttrMeta, Entity, GameScenario, Layout, Overlay, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { OverlayChildStyleEditor } from './OverlayChildStyleEditor'
import { NEW_COMPONENT_PRESETS, sortSchemeIds } from '../demo/builtin-schemes'
import { FormulaTextEditor } from './FormulaTextEditor'
import { LooseNumberInput } from './TermChainEditor'
import type { ScenarioIdRename } from '../persist/scenario-id'
import { nextUniqueOverlayTitle, overlayTitleExists } from './overlay-title'

export type ScenarioMeta = Pick<GameScenario, 'variables' | 'entities' | 'ui'> & {
  formulas?: Record<string, Formula>
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, fontSize: 12 }
const lbl: CSSProperties = { width: 60, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
const sectionTitle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 12,
  borderTop: '1px solid #333',
  padding: '6px 0',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--gc-panel, #1b1713)',
}
const variableGridColumns = 'minmax(0, 0.9fr) minmax(0, 1.5fr) minmax(3.5rem, 0.55fr) 2rem'
const entityAttrGrid = 'minmax(4.5rem, 0.45fr) minmax(0, 0.9fr) minmax(7rem, 1.25fr) 2rem'

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function EditableIdInput({ value, existing, rename, onRename, label }: {
  value: string
  existing: Record<string, unknown>
  rename: Omit<ScenarioIdRename, 'newId'> | { kind: 'attribute'; entityId: string; oldId: string }
  onRename: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
  label: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const next = draft.trim()
  const error = !next ? 'ID 不能为空' : next !== value && Object.hasOwn(existing, next) ? 'ID 已存在' : ''
  const commit = (): void => {
    if (error) { window.alert(`${label} 无法修改：${error}`); setDraft(value); return }
    if (next === value) return
    const result = onRename({ ...rename, newId: next } as ScenarioIdRename)
    if (!result.ok) { window.alert(`${label} 无法修改：ID 已存在`); setDraft(value) }
  }
  return <input value={draft} aria-label={label} aria-invalid={Boolean(error)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() } }} />
}

/** 自动分配与 Record key 对齐的 id（添加时用）。 */
function allocId(prefix: string, existing: Record<string, unknown>): string {
  let i = Object.keys(existing).length
  let id = `${prefix}${i}`
  while (existing[id]) {
    i += 1
    id = `${prefix}${i}`
  }
  return id
}

const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

function clampRuleValue(value: number, meta: Pick<AttrMeta, 'min' | 'max'> | undefined): number {
  let next = value
  if (meta?.min !== undefined) next = Math.max(meta.min, next)
  if (meta?.max !== undefined) next = Math.min(meta.max, next)
  return next
}

function normalizeRange<T extends Pick<AttrMeta, 'min' | 'max' | 'initial'>>(
  meta: T,
  changedField: 'min' | 'max' | 'initial',
): T {
  const next = { ...meta }
  if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
    if (changedField === 'min') next.max = next.min
    else next.min = next.max
  }
  if (next.initial !== undefined) next.initial = clampRuleValue(next.initial, next)
  return next as T
}

function AttributeIdInput({
  id,
  onCommit,
}: {
  id: string
  onCommit: (nextId: string) => string | undefined
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const commit = (input: HTMLInputElement): void => {
    const nextId = draft.trim()
    if (!nextId) return
    const error = onCommit(nextId)
    if (error) {
      input.setCustomValidity(error)
      input.reportValidity()
      return
    }
    input.setCustomValidity('')
  }

  return (
    <input
      value={draft}
      placeholder={id}
      aria-label={`属性「${id}」的 id`}
      pattern="[A-Za-z_][A-Za-z0-9_-]*"
      style={{ width: 84 }}
      title="属性 id：用于 entity.<实体id>.attr.<属性id> 引用；修改已有 id 可能需要同步检查公式和绑定"
      onChange={(e) => {
        e.currentTarget.setCustomValidity('')
        setDraft(e.currentTarget.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget)
        }
        if (e.key === 'Escape') {
          setDraft('')
          e.currentTarget.setCustomValidity('')
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => commit(e.currentTarget)}
    />
  )
}


/** 引用角标：被 N 个节点挂载引用；0 = 未被引用（灰）。 */
function UsageBadge({ count }: { count: number }): JSX.Element {
  const used = count > 0
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: used ? 'rgba(80,180,120,0.16)' : 'rgba(255,255,255,0.06)',
        color: used ? '#7fdda6' : '#8a8a8a',
        border: `1px solid ${used ? 'rgba(80,180,120,0.4)' : 'rgba(255,255,255,0.12)'}`,
      }}
      title={used ? `被 ${count} 个节点的 overlayNodes 引用` : '资源池里的闲置界面包（可保留）'}
    >
      {used ? `被 ${count} 个节点引用` : '未被引用'}
    </span>
  )
}

export type ScenarioSection = 'overlays' | 'variables' | 'entities' | 'formulas'

export function ScenarioInspector({
  value,
  section,
  overlayUsage,
  onChange,
  onRenameId = () => ({ ok: false, reason: 'not_found' }),
}: {
  value: ScenarioMeta
  section?: ScenarioSection
  /** overlayId → 被多少节点挂载引用（资源池「已用/未用」角标）。 */
  overlayUsage?: Record<string, number>
  onChange: (next: ScenarioMeta) => void
  onRenameId?: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
}): JSX.Element {
  const show = (s: ScenarioSection) => !section || section === s
  const variables = value.variables ?? {}
  const entities = value.entities ?? {}
  const formulas = value.formulas ?? {}
  const allOverlays = value.ui?.overlays ?? {}
  // 「通用样式」= 自由方案；排除每节点自动内容 overlay（node:*，那是时间轴的内容容器）。
  // 内置方案（静态/动态组件方案）固定置顶，其余按目录原有顺序跟后，见 sortSchemeIds。
  const schemeIds = sortSchemeIds(Object.keys(allOverlays).filter((id) => !id.startsWith('node:')))
  const setOverlays = (overlays: Record<string, Overlay>) => onChange({ ...value, ui: { ...value.ui, overlays } })
  const patchOverlayChildInMeta = (
    overlayId: string,
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    setOverlays({
      ...allOverlays,
      [overlayId]: {
        ...ov,
        children: ov.children.map((c) =>
          c.id !== childId
            ? c
            : {
                ...c,
                ...(patch.component != null ? { component: patch.component } : {}),
                inputs: patch.inputs ? { ...c.inputs, ...patch.inputs } : c.inputs,
                layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
              },
        ),
      },
    })
  }
  const addSchemeChild = (overlayId: string, presetId: string) => {
    const ov = allOverlays[overlayId]
    const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === presetId)
    if (!ov || !preset) return
    const childId = `${presetId}-${Object.keys(ov.children).length}-${Date.now().toString(36)}`
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, children: [...ov.children, preset.make(childId)] } })
  }
  const removeSchemeChild = (overlayId: string, childId: string) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, children: ov.children.filter((c) => c.id !== childId) } })
  }
  const renameScheme = (overlayId: string, title: string) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    if (overlayTitleExists(allOverlays, title, overlayId)) {
      window.alert(`界面方案名称「${title.trim()}」已存在`)
      return
    }
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, title } })
  }
  const addScheme = () => {
    const id = allocId('scheme-', allOverlays)
    setOverlays({
      ...allOverlays,
      [id]: { id, title: nextUniqueOverlayTitle(allOverlays), children: [] },
    })
  }
  const removeScheme = (overlayId: string) => {
    const { [overlayId]: _drop, ...rest } = allOverlays
    setOverlays(rest)
  }
  const setVariables = (v: Record<string, Variable>) => onChange({ ...value, variables: v })
  const setEntities = (e: Record<string, Entity>) => onChange({ ...value, entities: e })
  const setFormulas = (f: Record<string, Formula>) => onChange({ ...value, formulas: f })

  return (
    <div style={{ padding: 10, fontSize: 12 }}>
      {show('overlays') && (
        <>
          <div style={sectionTitle}>
            <b>通用样式 · 界面方案</b>
            <button onClick={addScheme}>+ 方案</button>
          </div>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 6 }}>
            自由可复用的界面方案（与节点解耦）：预览显示该方案的全部组件；节点在蓝图/挂载处引用方案。
          </div>
          {schemeIds.length === 0 ? (
            <div style={{ opacity: 0.5 }}>暂无方案</div>
          ) : (
            schemeIds.map((id) => {
              const ov = allOverlays[id]
              if (!ov) return null
              return (
                <div key={id} style={box}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <input
                      value={ov.title ?? ''}
                      placeholder={id}
                      onChange={(e) => renameScheme(id, e.target.value)}
                      style={{ flex: 1, fontWeight: 600 }}
                    />
                    <UsageBadge count={overlayUsage?.[id] ?? 0} />
                    <button style={del} onClick={() => removeScheme(id)}>删除</button>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>{id}</div>
                  <OverlayCatalogPreview overlay={ov} entities={entities} variables={variables} />
                  <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>组件（{ov.children.length}）</span>
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) addSchemeChild(id, e.target.value) }}
                        style={{ fontSize: 11 }}
                      >
                        <option value="">+ 添加组件…</option>
                        {NEW_COMPONENT_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    {ov.children.map((child) => (
                      <div key={child.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <OverlayChildStyleEditor
                            child={child}
                            onPatchParams={(patch) => patchOverlayChildInMeta(id, child.id, { inputs: patch })}
                            onPatchComponent={(component) => patchOverlayChildInMeta(id, child.id, { component })}
                            onPatchLayout={(patch) => patchOverlayChildInMeta(id, child.id, { layout: patch })}
                          />
                        </div>
                        <button style={{ ...del, marginTop: 6 }} onClick={() => removeSchemeChild(id, child.id)} title="移除组件">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}

      {show('variables') && (
        <>
          <div style={sectionTitle}>
            <b>变量</b>
            <button
              onClick={() => {
                const id = allocId('var', variables)
                setVariables({ ...variables, [id]: { id, name: id, initial: 0 } })
              }}
            >
              + 变量
            </button>
          </div>
          {Object.keys(variables).length > 0 ? (
            <div
              aria-hidden
              style={{
                display: 'grid',
                gridTemplateColumns: variableGridColumns,
                gap: 8,
                padding: '0 10px',
                margin: '8px 0 2px',
                color: 'var(--gc-faint, #8c8377)',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            >
              <span>ID</span>
              <span>名称</span>
              <span>初值</span>
              <span />
            </div>
          ) : null}
          {Object.entries(variables).map(([key, v]) => (
            <div
              key={key}
              style={{
                ...box,
                display: 'grid',
                gridTemplateColumns: variableGridColumns,
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                background: 'rgba(255,255,255,0.025)',
              }}
            >
              <EditableIdInput value={v.id} existing={variables} rename={{ kind: 'variable', oldId: key }} onRename={onRenameId} label="变量 ID" />
              <input
                value={v.name ?? ''}
                placeholder="变量名称"
                aria-label={`${v.id} 的名称`}
                onChange={(e) => setVariables({ ...variables, [key]: { ...v, id: key, name: e.target.value } })}
                style={{ width: '100%', minWidth: 0 }}
              />
              <LooseNumberInput
                value={v.initial ?? 0}
                aria-label={`${v.id} 的初值`}
                title="初值"
                emptyValue={0}
                onChange={(initial) => setVariables({
                  ...variables,
                  [key]: {
                    ...v,
                    id: key,
                    initial: clampRuleValue(initial, v),
                  },
                })}
                style={{ width: '100%', minWidth: 0 }}
              />
              <button
                style={{ ...del, marginLeft: 0, padding: 0, width: '2rem', height: '2rem' }}
                onClick={() => {
                  const { [key]: _d, ...rest } = variables
                  setVariables(rest)
                }}
                title={`删除变量「${v.name || v.id}」`}
                aria-label={`删除变量「${v.name || v.id}」`}
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}

      {show('entities') && (
        <>
          <div style={sectionTitle}>
            <b>实体</b>
            <button
              onClick={() => {
                const id = allocId('ent-', entities)
                setEntities({ ...entities, [id]: { id, name: id, attrs: {}, attrMeta: {} } })
              }}
            >
              + 实体
            </button>
          </div>
          {Object.entries(entities).map(([key, ent]) => (
            <EntityRow
              key={key}
              entKey={key}
              ent={ent}
              entities={entities}
              onChange={(next) => setEntities({ ...entities, [key]: { ...next, id: key } })}
              onRename={onRenameId}
              onDelete={() => {
                const { [key]: _drop, ...rest } = entities
                setEntities(rest)
              }}
            />
          ))}
        </>
      )}

      {show('formulas') && (
        <>
          <div style={sectionTitle}>
            <b>公式</b>
            <button
              onClick={() => {
                const id = allocId('formula-', formulas)
                setFormulas({
                  ...formulas,
                  [id]: {
                    id,
                    name: id,
                    ast: { t: 'num', id: 'n0', v: 0 },
                    draftEmpty: true,
                  },
                })
              }}
            >
              + 公式
            </button>
          </div>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 6 }}>
            定义可复用的计算公式（如伤害公式）；条款里的「实体」可留空，蓝图/时间轴应用该公式时再选具体实体填空。
          </div>
          {Object.keys(formulas).length === 0 ? <div style={{ opacity: 0.5 }}>暂无公式</div> : null}
          {Object.entries(formulas).map(([key, f]) => (
            <FormulaRow
              key={key}
              formulaKey={key}
              formula={f}
              formulas={formulas}
              entities={entities}
              variables={variables}
              onChange={(next) => setFormulas({ ...formulas, [key]: { ...next, id: key } })}
              onRename={onRenameId}
              onDelete={() => {
                const { [key]: _drop, ...rest } = formulas
                setFormulas(rest)
              }}
            />
          ))}
        </>
      )}

    </div>
  )
}

function EntityRow({
  entKey,
  ent,
  entities,
  onChange,
  onRename,
  onDelete,
}: {
  entKey: string
  ent: Entity
  entities: Record<string, Entity>
  onChange: (next: Entity) => void
  onRename: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
  onDelete: () => void
}): JSX.Element {
  const attrs = ent.attrs ?? {}
  const attrMeta = ent.attrMeta ?? {}
  const [editableAttrIds, setEditableAttrIds] = useState<Set<string>>(() => new Set())
  const setAttrs = (a: Record<string, number>) => onChange({ ...ent, id: entKey, attrs: a })
  const setAttrMeta = (m: Record<string, AttrMeta>) => onChange({ ...ent, id: entKey, attrMeta: m })
  const setAttrValue = (attrId: string, value: number) => {
    const nextAttrs = { ...attrs, [attrId]: value }
    const nextMeta = { ...attrMeta }

    // `<attr>Max` is the editor's established pairing convention (hp/hpMax,
    // stamina/staminaMax, ...). Rules author both the runtime seed in attrs and
    // its template metadata, so keep both halves coherent in one edit.
    const pairedBase = attrId.endsWith('Max')
      ? attrId.slice(0, -3)
      : Object.hasOwn(nextAttrs, `${attrId}Max`)
        ? attrId
        : ''
    if (
      pairedBase
      && Object.hasOwn(nextAttrs, pairedBase)
      && Object.hasOwn(nextAttrs, `${pairedBase}Max`)
    ) {
      const pairedMaxValue = nextAttrs[`${pairedBase}Max`] ?? 0
      const pairedCurrentValue = nextAttrs[pairedBase] ?? 0
      const pairedMeta = normalizeRange({
        ...nextMeta[pairedBase],
        max: pairedMaxValue,
      }, 'max')
      nextAttrs[`${pairedBase}Max`] = pairedMeta.max ?? pairedMaxValue
      nextAttrs[pairedBase] = clampRuleValue(pairedCurrentValue, pairedMeta)
      nextMeta[pairedBase] = {
        ...pairedMeta,
        initial: nextAttrs[pairedBase],
      }
    } else if (nextMeta[attrId]?.initial !== undefined) {
      nextAttrs[attrId] = clampRuleValue(value, nextMeta[attrId])
      nextMeta[attrId] = { ...nextMeta[attrId], initial: nextAttrs[attrId] }
    } else {
      nextAttrs[attrId] = clampRuleValue(value, nextMeta[attrId])
    }

    onChange({
      ...ent,
      id: entKey,
      attrs: nextAttrs,
      attrMeta: Object.keys(nextMeta).length ? nextMeta : undefined,
    })
  }
  const renameAttr = (currentId: string, nextId: string): string | undefined => {
    const id = nextId.trim()
    if (!id) return '属性 id 不能为空'
    if (!ATTR_ID_PATTERN.test(id)) return '属性 id 需以字母或下划线开头，仅可包含字母、数字、下划线和短横线'
    if (id !== currentId && Object.hasOwn(attrs, id)) return `属性 id「${id}」已存在`
    if (id === currentId) return undefined

    const nextAttrs = Object.fromEntries(
      Object.entries(attrs).map(([key, value]) => [key === currentId ? id : key, value]),
    )
    const nextMeta = Object.fromEntries(
      Object.entries(attrMeta).map(([key, value]) => [key === currentId ? id : key, value]),
    )
    onChange({
      ...ent,
      id: entKey,
      attrs: nextAttrs,
      attrMeta: Object.keys(nextMeta).length ? nextMeta : undefined,
    })
    return undefined
  }
  const removeAttr = (ak: string) => {
    const { [ak]: _a, ...restAttrs } = attrs
    const { [ak]: _m, ...restMeta } = attrMeta
    onChange({ ...ent, id: entKey, attrs: restAttrs, attrMeta: Object.keys(restMeta).length ? restMeta : undefined })
  }

  return (
    <div style={box}>
      {field('id', <EditableIdInput value={ent.id} existing={entities} rename={{ kind: 'entity', oldId: entKey }} onRename={onRename} label="实体 ID" />)}
      {field(
        '名称',
        <input
          value={ent.name ?? ''}
          onChange={(e) => onChange({ ...ent, id: entKey, name: e.target.value })}
          style={{ flex: 1 }}
        />,
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 2px' }}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>attrs（公式里 entity.{entKey}.attr.&lt;名&gt; 引用）</span>
        <button
          style={{ fontSize: 11 }}
          onClick={() => {
            const id = allocId('attr', attrs)
            setEditableAttrIds((current) => new Set(current).add(id))
            setAttrs({ ...attrs, [id]: 0 })
          }}
        >
          + 属性
        </button>
      </div>
      {Object.entries(attrs).map(([ak, av]) => (
        <div key={ak} style={{ ...rowStyle, display: 'grid', gridTemplateColumns: entityAttrGrid, gap: 8, flexWrap: 'nowrap', marginBottom: 6, padding: '5px 0 7px', borderBottom: '1px solid rgba(255,255,255,.055)' }}>
          <EditableIdInput value={ak} existing={attrs} rename={{ kind: 'attribute', entityId: entKey, oldId: ak }} onRename={onRename} label={`${ent.id} 的属性 ID`} />
          <input
            value={attrMeta[ak]?.label ?? ''}
            placeholder="显示名"
            onChange={(e) => setAttrMeta({ ...attrMeta, [ak]: { ...attrMeta[ak], label: e.target.value || undefined } })}
            style={{ minWidth: 0, width: '100%' }}
          />
          <LooseNumberInput
            value={av}
            aria-label={`属性「${ak}」的数值`}
            emptyValue={0}
            onChange={(value) => setAttrValue(ak, value)}
            style={{ minWidth: 0, width: '100%' }}
            title="当前/初始数值"
          />
          <button style={del} onClick={() => removeAttr(ak)} title="删除该属性">×</button>
        </div>
      ))}
      {Object.keys(attrs).length === 0 ? <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>暂无属性</div> : null}
      <button style={{ ...del, marginTop: 6 }} onClick={onDelete}>
        删除实体
      </button>
    </div>
  )
}

function FormulaRow({
  formulaKey,
  formula,
  formulas,
  entities,
  variables,
  onChange,
  onRename,
  onDelete,
}: {
  formulaKey: string
  formula: Formula
  formulas: Record<string, Formula>
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  onChange: (next: Formula) => void
  onRename: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
  onDelete: () => void
}): JSX.Element {
  return (
    <div style={box}>
      {field('id', <EditableIdInput value={formula.id} existing={formulas} rename={{ kind: 'formula', oldId: formulaKey }} onRename={onRename} label="公式 ID" />)}
      {field(
        '名称',
        <input
          value={formula.name ?? ''}
          onChange={(e) => onChange({ ...formula, id: formulaKey, name: e.target.value })}
          style={{ flex: 1 }}
        />,
      )}
      {field(
        '描述',
        <input
          value={formula.description ?? ''}
          placeholder="如：伤害 = 攻击力 × 倍率 - 防御力"
          onChange={(e) => onChange({ ...formula, id: formulaKey, description: e.target.value || undefined })}
          style={{ flex: 1 }}
        />,
      )}
      <div style={{ margin: '6px 0 2px', fontSize: 11, opacity: 0.7 }}>公式（留空位 = 应用时再填的参数/实体）</div>
      <FormulaTextEditor
        ast={formula.ast}
        empty={formula.draftEmpty}
        entities={entities}
        variables={variables}
        onEmpty={formula.draftEmpty
          ? () => onChange({ ...formula, id: formulaKey, draftEmpty: true })
          : undefined}
        onChange={(ast) => onChange({
          ...formula,
          id: formulaKey,
          ast,
          draftEmpty: undefined,
        })}
      />
      <button style={{ ...del, marginTop: 6 }} onClick={onDelete}>
        删除公式
      </button>
    </div>
  )
}
