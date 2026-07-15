/**
 * ScenarioInspector —— 场景级配置：variables / entities / overlays 目录 / rng / reactions。
 */
import type { CSSProperties, JSX } from 'react'
import type { AttrMeta, Entity, GameScenario, Reaction, Variable } from '../../runtime/schema/graph-schema'
import { ConditionEditor } from './editors'

export type ScenarioMeta = Pick<GameScenario, 'variables' | 'entities' | 'ui' | 'rng' | 'reactions'>

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

export type ScenarioSection = 'scene' | 'overlays' | 'variables' | 'entities' | 'rules'

export function ScenarioInspector({
  value,
  nodeIds,
  section,
  onChange,
}: {
  value: ScenarioMeta
  nodeIds: string[]
  section?: ScenarioSection
  onChange: (next: ScenarioMeta) => void
}): JSX.Element {
  const show = (s: ScenarioSection) => !section || section === s
  const variables = value.variables ?? {}
  const entities = value.entities ?? {}
  const reactions = value.reactions ?? []
  const seed = value.rng?.seed ?? 0
  const overlayIds = Object.keys(value.ui?.overlays ?? {})
  const setVariables = (v: Record<string, Variable>) => onChange({ ...value, variables: v })
  const setEntities = (e: Record<string, Entity>) => onChange({ ...value, entities: e })
  const setReactions = (r: Reaction[]) => onChange({ ...value, reactions: r.length ? r : undefined })
  const patchReaction = (i: number, p: Partial<Reaction>) => setReactions(reactions.map((r, idx) => (idx === i ? { ...r, ...p } : r)))

  return (
    <div style={{ padding: 10, overflow: 'auto', fontSize: 12 }}>
      {show('scene') &&
        field(
          '随机种子',
          <input
            type="number"
            value={seed}
            onChange={(e) => onChange({ ...value, rng: { seed: Number(e.target.value) || 0 } })}
            style={{ width: 120 }}
          />,
        )}

      {show('overlays') && (
        <>
          <div style={sectionTitle}>
            <b>Overlays</b>
          </div>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 6 }}>
            可复用界面包目录（children 在界面编辑器维护；节点经 overlayNodes 挂载）。
          </div>
          {overlayIds.length === 0 ? (
            <div style={{ opacity: 0.5 }}>暂无 overlays</div>
          ) : (
            overlayIds.map((id) => (
              <div key={id} style={box}>
                {id}
                <span style={{ opacity: 0.5, marginLeft: 8 }}>
                  {(value.ui?.overlays?.[id]?.children.length ?? 0)} children
                </span>
              </div>
            ))
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

      {show('rules') && (
        <>
          <div style={sectionTitle}>
            <b>局级 reactions（即时判负/胜）</b>
            <button
              onClick={() =>
                setReactions([
                  ...reactions,
                  {
                    when: { type: 'state', condition: { all: [] } },
                    do: [{ kind: 'goto', targetNodeId: nodeIds[0] ?? '' }],
                  },
                ])
              }
            >
              + 规则
            </button>
          </div>
          {reactions.map((r, i) => {
            const cond = r.when.type === 'state' ? r.when.condition : { all: [] }
            const goto = r.do.find((a) => a.kind === 'goto')
            return (
              <div key={i} style={box}>
                {field(
                  '跳转到',
                  <select
                    value={goto && goto.kind === 'goto' ? goto.targetNodeId : ''}
                    onChange={(e) =>
                      patchReaction(i, {
                        when: { type: 'state', condition: cond },
                        do: [{ kind: 'goto', targetNodeId: e.target.value }],
                      })
                    }
                    style={{ flex: 1 }}
                  >
                    <option value="">（选节点）</option>
                    {nodeIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>,
                )}
                <ConditionEditor
                  value={cond}
                  nodeIds={nodeIds}
                  onChange={(when) =>
                    patchReaction(i, {
                      when: { type: 'state', condition: when ?? { all: [] } },
                      do: r.do,
                    })
                  }
                />
                <button style={{ ...del, marginTop: 4 }} onClick={() => setReactions(reactions.filter((_, idx) => idx !== i))}>
                  删除规则
                </button>
              </div>
            )
          })}
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
      <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>attrs</div>
      {Object.entries(attrs).map(([ak, av]) => (
        <div key={ak} style={rowStyle}>
          <input value={ak} readOnly style={{ flex: 1 }} />
          <input
            type="number"
            value={av}
            onChange={(e) => setAttrs({ ...attrs, [ak]: Number(e.target.value) || 0 })}
            style={{ width: 90 }}
          />
        </div>
      ))}
      <button style={{ ...del, marginTop: 6 }} onClick={onDelete}>
        删除实体
      </button>
      {/* silence unused */}
      <span style={{ display: 'none' }}>{Object.keys(attrMeta).length}{setAttrMeta.length}</span>
    </div>
  )
}
