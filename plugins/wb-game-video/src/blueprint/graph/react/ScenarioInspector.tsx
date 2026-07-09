/**
 * ScenarioInspector —— 场景级配置面板（P4 之全局层）。编辑 scenario 顶层数据：
 *   变量 variables / 实体 entities(attrs + attrMeta) / 全局 HUD ui.hud / 随机种子 rng.seed。
 * 与 NodeInspector（节点级）并列，改动经 onChange 合入 GraphStudio 的 meta 状态，随「保存」进 localStorage 版本。
 * 纯受控、不可变写回；所有 id 用文本框（无需读盘/枚举），HUD show 与 var kind 用下拉。
 */
import type { CSSProperties, JSX } from 'react'
import type { AttrMeta, EntitySpec, GameScenario, ReactiveRule, VarSpec } from '../graph-schema'
import { ConditionEditor } from './editors'
import { HUD_SKINS } from './skins'

export type ScenarioMeta = Pick<GameScenario, 'variables' | 'entities' | 'ui' | 'rng' | 'rules'>

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, fontSize: 12 }
const lbl: CSSProperties = { width: 60, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
const sectionTitle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: '1px solid #333', paddingTop: 6 }

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

const HUD_SHOWS = ['always', 'never', 'battle', 'qte']
const HUD_POS: Array<{ id: string; label: string }> = [
  { id: 'top-left', label: '左上' }, { id: 'top', label: '顶部居中' }, { id: 'top-right', label: '右上' },
  { id: 'bottom-left', label: '左下' }, { id: 'bottom', label: '底部居中' }, { id: 'bottom-right', label: '右下' },
]
const SHOW_LABEL: Record<string, string> = { always: '常驻', never: '隐藏', battle: '战斗中', qte: 'QTE时' }

/** 记录改键：删旧键、写新键（保持插入顺序尽量稳定）。 */
function renameKey<T>(rec: Record<string, T>, oldK: string, newK: string, val: T): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [k, v] of Object.entries(rec)) next[k === oldK ? newK : k] = k === oldK ? val : v
  return next
}

/** 场景级面板的分区：scene=随机种子（场景设置） / hud=全局HUD（界面） / variables=变量 / entities=实体 / rules=反应规则。 */
export type ScenarioSection = 'scene' | 'hud' | 'variables' | 'entities' | 'rules'

export function ScenarioInspector({ value, nodeIds, section, onChange }: { value: ScenarioMeta; nodeIds: string[]; section?: ScenarioSection; onChange: (next: ScenarioMeta) => void }): JSX.Element {
  const variables = value.variables ?? {}
  const entities = value.entities ?? {}
  const hud = (value.ui?.hud ?? []) as Array<{ element?: string; show?: string; component?: string; label?: string; pos?: string }>
  const seed = value.rng?.seed ?? 0
  const rules = value.rules ?? []
  const show = (s: ScenarioSection) => !section || section === s

  const setVariables = (v: Record<string, VarSpec>) => onChange({ ...value, variables: v })
  const setEntities = (e: Record<string, EntitySpec>) => onChange({ ...value, entities: e })
  const setHud = (h: Array<{ element?: string; show?: string; component?: string; label?: string; pos?: string }>) => onChange({ ...value, ui: { ...value.ui, hud: h } })
  const setRules = (r: ReactiveRule[]) => onChange({ ...value, rules: r.length ? r : undefined })
  const patchRule = (i: number, p: Partial<ReactiveRule>) => setRules(rules.map((r, idx) => (idx === i ? { ...r, ...p } : r)))

  return (
    <div style={{ padding: 10, overflow: 'auto', fontSize: 12 }}>
      {show('scene') && field('随机种子', <input type="number" value={seed} onChange={(e) => onChange({ ...value, rng: { seed: Number(e.target.value) || 0 } })} style={{ width: 120 }} />)}

      {show('variables') && (<>
      {/* ── 变量 ── */}
      <div style={sectionTitle}>
        <b>变量</b>
        <button
          onClick={() => {
            const id = `var${Object.keys(variables).length}`
            setVariables({ ...variables, [id]: { id, name: id, kind: 'number', initial: 0 } })
          }}
        >
          + 变量
        </button>
      </div>
      {Object.entries(variables).map(([key, v]) => (
        <div key={key} style={box}>
          {field('id', <input value={v.id ?? key} onChange={(e) => setVariables(renameKey(variables, key, e.target.value, { ...v, id: e.target.value }))} style={{ flex: 1 }} />)}
          {field('名称', <input value={v.name ?? ''} onChange={(e) => setVariables({ ...variables, [key]: { ...v, name: e.target.value } })} style={{ flex: 1 }} />)}
          {field('类型', (
            <select value={v.kind ?? 'number'} onChange={(e) => setVariables({ ...variables, [key]: { ...v, kind: e.target.value as 'number' | 'flag' } })}>
              <option value="number">数值</option>
              <option value="flag">标记</option>
            </select>
          ))}
          {field('初值', <input type="number" value={v.initial ?? 0} onChange={(e) => setVariables({ ...variables, [key]: { ...v, initial: Number(e.target.value) || 0 } })} style={{ width: 90 }} />)}
          {field('min', <input type="number" value={v.min ?? 0} onChange={(e) => setVariables({ ...variables, [key]: { ...v, min: Number(e.target.value) || undefined } })} style={{ width: 90 }} />)}
          {field('max', <input type="number" value={v.max ?? 0} onChange={(e) => setVariables({ ...variables, [key]: { ...v, max: Number(e.target.value) || undefined } })} style={{ width: 90 }} />)}
          <button style={del} onClick={() => { const { [key]: _drop, ...rest } = variables; setVariables(rest) }}>删除变量</button>
        </div>
      ))}
      </>)}

      {show('entities') && (<>
      {/* ── 实体 ── */}
      <div style={sectionTitle}>
        <b>实体</b>
        <button
          onClick={() => {
            const id = `ent-${Object.keys(entities).length}`
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
          onChange={(nextKey, next) => setEntities(renameKey(entities, key, nextKey, next))}
          onDelete={() => { const { [key]: _drop, ...rest } = entities; setEntities(rest) }}
        />
      ))}
      </>)}

      {show('hud') && (<>
      {/* ── 全局 HUD ── */}
      <div style={sectionTitle}>
        <b>全局 HUD</b>
        <button onClick={() => setHud([...hud, { element: '', show: 'always' }])}>+ HUD项</button>
      </div>
      {hud.map((h, i) => (
        <div key={i} style={box}>
          {field('元素', <input value={h.element ?? ''} onChange={(e) => setHud(hud.map((x, idx) => (idx === i ? { ...x, element: e.target.value } : x)))} placeholder="playerHp" style={{ flex: 1 }} />)}
          {field('显示', (
            <select value={h.show ?? 'always'} onChange={(e) => setHud(hud.map((x, idx) => (idx === i ? { ...x, show: e.target.value } : x)))}>
              {HUD_SHOWS.map((s) => <option key={s} value={s}>{SHOW_LABEL[s] ?? s}</option>)}
            </select>
          ))}
          {field('组件', (
            <select value={h.component ?? ''} onChange={(e) => setHud(hud.map((x, idx) => (idx === i ? { ...x, component: e.target.value || undefined } : x)))} style={{ flex: 1 }}>
              <option value="">内置（默认血条/数值）</option>
              {HUD_SKINS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          ))}
          {field('名称', <input value={h.label ?? ''} onChange={(e) => setHud(hud.map((x, idx) => (idx === i ? { ...x, label: e.target.value || undefined } : x)))} placeholder="空藏" style={{ flex: 1 }} />)}
          {field('位置', (
            <select value={h.pos ?? ''} onChange={(e) => setHud(hud.map((x, idx) => (idx === i ? { ...x, pos: e.target.value || undefined } : x)))} style={{ flex: 1 }}>
              <option value="">默认（按角色）</option>
              {HUD_POS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          ))}
          <button style={del} onClick={() => setHud(hud.filter((_, idx) => idx !== i))}>删除</button>
        </div>
      ))}
      </>)}

      {show('rules') && (<>
      {/* ── 图级反应规则（即时判负/判胜）── */}
      <div style={sectionTitle}>
        <b>反应规则（即时判负/胜）</b>
        <button onClick={() => setRules([...rules, { when: { all: [] }, goto: nodeIds[0] ?? '' }])}>+ 规则</button>
      </div>
      <div style={{ opacity: 0.55, fontSize: 11, marginTop: 2 }}>状态变化后条件成立即跳转到目标节点（不必等演出结束）。</div>
      {rules.map((r, i) => (
        <div key={i} style={box}>
          {field('id', <input value={r.id ?? ''} onChange={(e) => patchRule(i, { id: e.target.value || undefined })} placeholder="boss-dead" style={{ flex: 1 }} />)}
          {field('跳转到', (
            <select value={r.goto} onChange={(e) => patchRule(i, { goto: e.target.value })} style={{ flex: 1 }}>
              <option value="">（选节点）</option>
              {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          ))}
          {field('仅一次', <input type="checkbox" checked={!!r.once} onChange={(e) => patchRule(i, { once: e.target.checked || undefined })} />)}
          {field('复位全局', <input type="checkbox" checked={!!r.resetGlobals} onChange={(e) => patchRule(i, { resetGlobals: e.target.checked || undefined })} />)}
          <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>条件（AND 全部成立）</div>
          <ConditionEditor value={r.when} nodeIds={nodeIds} onChange={(when) => patchRule(i, { when: when ?? { all: [] } })} />
          <button style={{ ...del, marginTop: 4 }} onClick={() => setRules(rules.filter((_, idx) => idx !== i))}>删除规则</button>
        </div>
      ))}
      </>)}
    </div>
  )
}

// ── 单实体：id/name/kind + attrs(键值) + attrMeta(每 attr min/max/initial/label) ──
function EntityRow({ entKey, ent, onChange, onDelete }: { entKey: string; ent: EntitySpec; onChange: (nextKey: string, next: EntitySpec) => void; onDelete: () => void }): JSX.Element {
  const attrs = ent.attrs ?? {}
  const attrMeta = ent.attrMeta ?? {}
  const setAttrs = (a: Record<string, number>) => onChange(ent.id ?? entKey, { ...ent, attrs: a })
  const setAttrMeta = (m: Record<string, AttrMeta>) => onChange(ent.id ?? entKey, { ...ent, attrMeta: m })

  return (
    <div style={box}>
      {field('id', <input value={ent.id ?? entKey} onChange={(e) => onChange(e.target.value, { ...ent, id: e.target.value })} style={{ flex: 1 }} />)}
      {field('名称', <input value={ent.name ?? ''} onChange={(e) => onChange(ent.id ?? entKey, { ...ent, name: e.target.value })} style={{ flex: 1 }} />)}
      {field('kind', <input value={ent.kind ?? ''} onChange={(e) => onChange(ent.id ?? entKey, { ...ent, kind: e.target.value })} placeholder="player/boss" style={{ flex: 1 }} />)}

      <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>attrs</div>
      {Object.entries(attrs).map(([ak, av]) => (
        <div key={ak} style={rowStyle}>
          <input value={ak} onChange={(e) => setAttrs(renameNum(attrs, ak, e.target.value))} placeholder="attack" style={{ flex: 1 }} />
          <input type="number" value={av} onChange={(e) => setAttrs({ ...attrs, [ak]: Number(e.target.value) || 0 })} style={{ width: 90 }} />
          <button style={del} onClick={() => { const { [ak]: _d, ...rest } = attrs; setAttrs(rest) }}>×</button>
        </div>
      ))}
      <button onClick={() => setAttrs({ ...attrs, [`attr${Object.keys(attrs).length}`]: 0 })}>+ attr</button>

      <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0 2px' }}>attrMeta（约束/显示）</div>
      {Object.entries(attrMeta).map(([mk, mv]) => (
        <div key={mk} style={{ ...box, marginTop: 4 }}>
          {field('attr', <input value={mk} onChange={(e) => setAttrMeta(renameMeta(attrMeta, mk, e.target.value))} placeholder="hp" style={{ flex: 1 }} />)}
          {field('min', <input type="number" value={mv.min ?? 0} onChange={(e) => setAttrMeta({ ...attrMeta, [mk]: { ...mv, min: Number(e.target.value) || undefined } })} style={{ width: 90 }} />)}
          {field('max', <input type="number" value={mv.max ?? 0} onChange={(e) => setAttrMeta({ ...attrMeta, [mk]: { ...mv, max: Number(e.target.value) || undefined } })} style={{ width: 90 }} />)}
          {field('初值', <input type="number" value={mv.initial ?? 0} onChange={(e) => setAttrMeta({ ...attrMeta, [mk]: { ...mv, initial: Number(e.target.value) || undefined } })} style={{ width: 90 }} />)}
          {field('显示名', <input value={mv.label ?? ''} onChange={(e) => setAttrMeta({ ...attrMeta, [mk]: { ...mv, label: e.target.value || undefined } })} style={{ flex: 1 }} />)}
          <button style={del} onClick={() => { const { [mk]: _d, ...rest } = attrMeta; setAttrMeta(rest) }}>删除</button>
        </div>
      ))}
      <button onClick={() => setAttrMeta({ ...attrMeta, hp: { min: 0, max: 100, initial: 100, label: '生命' } })}>+ attrMeta</button>

      <div>
        <button style={{ ...del, marginTop: 6 }} onClick={onDelete}>删除实体</button>
      </div>
    </div>
  )
}

function renameNum(rec: Record<string, number>, oldK: string, newK: string): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [k, v] of Object.entries(rec)) next[k === oldK ? newK : k] = v
  return next
}
function renameMeta(rec: Record<string, AttrMeta>, oldK: string, newK: string): Record<string, AttrMeta> {
  const next: Record<string, AttrMeta> = {}
  for (const [k, v] of Object.entries(rec)) next[k === oldK ? newK : k] = v
  return next
}
