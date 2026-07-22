/**
 * ScenarioInspector —— 场景级配置：variables / entities / overlays 目录 / formulas。
 */
import type { CSSProperties, JSX } from 'react'
import type { AttrMeta, Entity, GameScenario, Layout, Overlay, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { OverlayChildStyleEditor } from './OverlayChildStyleEditor'
import { NEW_COMPONENT_PRESETS, sortSchemeIds } from '../demo/builtin-schemes'
import { TermChainEditor } from './TermChainEditor'
import { formulaTermsPreview } from './formulaApply'

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
  paddingTop: 6,
}

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

/** 自动分配与 Record key 对齐的 id（添加时用；用户不可手填）。 */
function allocId(prefix: string, existing: Record<string, unknown>): string {
  let i = Object.keys(existing).length
  let id = `${prefix}${i}`
  while (existing[id]) {
    i += 1
    id = `${prefix}${i}`
  }
  return id
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
}: {
  value: ScenarioMeta
  section?: ScenarioSection
  /** overlayId → 被多少节点挂载引用（资源池「已用/未用」角标）。 */
  overlayUsage?: Record<string, number>
  onChange: (next: ScenarioMeta) => void
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
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, title } })
  }
  const addScheme = () => {
    const id = allocId('scheme-', allOverlays)
    setOverlays({ ...allOverlays, [id]: { id, title: '新方案', children: [] } })
  }
  const removeScheme = (overlayId: string) => {
    const { [overlayId]: _drop, ...rest } = allOverlays
    setOverlays(rest)
  }
  const setVariables = (v: Record<string, Variable>) => onChange({ ...value, variables: v })
  const setEntities = (e: Record<string, Entity>) => onChange({ ...value, entities: e })
  const setFormulas = (f: Record<string, Formula>) => onChange({ ...value, formulas: f })

  return (
    <div style={{ padding: 10, overflow: 'auto', fontSize: 12 }}>
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
          {Object.entries(variables).map(([key, v]) => (
            <div key={key} style={box}>
              {field('id', <input value={v.id} readOnly style={{ flex: 1, opacity: 0.7 }} />)}
              {field(
                '名称',
                <input
                  value={v.name ?? ''}
                  onChange={(e) => setVariables({ ...variables, [key]: { ...v, id: key, name: e.target.value } })}
                  style={{ flex: 1 }}
                />,
              )}
              {field(
                '初值',
                <input
                  type="number"
                  value={v.initial ?? 0}
                  onChange={(e) => setVariables({ ...variables, [key]: { ...v, id: key, initial: Number(e.target.value) || 0 } })}
                  style={{ width: 90 }}
                />,
              )}
              <button
                style={del}
                onClick={() => {
                  const { [key]: _d, ...rest } = variables
                  setVariables(rest)
                }}
              >
                删除
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
              onChange={(next) => setEntities({ ...entities, [key]: { ...next, id: key } })}
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
                setFormulas({ ...formulas, [id]: { id, name: id, terms: [] } })
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
              entities={entities}
              variables={variables}
              onChange={(next) => setFormulas({ ...formulas, [key]: { ...next, id: key } })}
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
  onChange,
  onDelete,
}: {
  entKey: string
  ent: Entity
  onChange: (next: Entity) => void
  onDelete: () => void
}): JSX.Element {
  const attrs = ent.attrs ?? {}
  const attrMeta = ent.attrMeta ?? {}
  const setAttrs = (a: Record<string, number>) => onChange({ ...ent, id: entKey, attrs: a })
  const setAttrMeta = (m: Record<string, AttrMeta>) => onChange({ ...ent, id: entKey, attrMeta: m })
  const removeAttr = (ak: string) => {
    const { [ak]: _a, ...restAttrs } = attrs
    const { [ak]: _m, ...restMeta } = attrMeta
    onChange({ ...ent, id: entKey, attrs: restAttrs, attrMeta: Object.keys(restMeta).length ? restMeta : undefined })
  }

  return (
    <div style={box}>
      {field('id', <input value={ent.id} readOnly style={{ flex: 1, opacity: 0.7 }} />)}
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
            setAttrs({ ...attrs, [id]: 0 })
          }}
        >
          + 属性
        </button>
      </div>
      {Object.entries(attrs).map(([ak, av]) => (
        <div key={ak} style={rowStyle}>
          <input value={ak} readOnly style={{ width: 64, opacity: 0.7 }} title="属性 id：添加后固定，改「显示名」即可" />
          <input
            value={attrMeta[ak]?.label ?? ''}
            placeholder="显示名"
            onChange={(e) => setAttrMeta({ ...attrMeta, [ak]: { ...attrMeta[ak], label: e.target.value || undefined } })}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            value={av}
            onChange={(e) => setAttrs({ ...attrs, [ak]: Number(e.target.value) || 0 })}
            style={{ width: 70 }}
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
  entities,
  variables,
  onChange,
  onDelete,
}: {
  formulaKey: string
  formula: Formula
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  onChange: (next: Formula) => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div style={box}>
      {field('id', <input value={formula.id} readOnly style={{ flex: 1, opacity: 0.7 }} />)}
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
      <div style={{ margin: '6px 0 2px', fontSize: 11, opacity: 0.7 }}>条款（❓= 留空实体，应用公式时再填）</div>
      <TermChainEditor
        terms={formula.terms}
        entities={entities}
        variables={variables}
        allowHoleEntity
        onChange={(terms) => onChange({ ...formula, id: formulaKey, terms })}
      />
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6, wordBreak: 'break-word' }}>
        预览：{formulaTermsPreview(formula.terms, entities, variables)}
      </div>
      <button style={{ ...del, marginTop: 6 }} onClick={onDelete}>
        删除公式
      </button>
    </div>
  )
}
