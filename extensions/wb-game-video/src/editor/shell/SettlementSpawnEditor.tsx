/**
 * 结算后显示组件（NodeAction.spawn）—— 选项 / QTE 结算区共用。
 * 本版：仅当前节点内演出，ttl 截断到节点时长；跳转换节点会清掉瞬态叠层。
 */
import type { CSSProperties, JSX } from 'react'
import type { Entity, Overlay, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { SpawnInputsEditor } from './spawn-inputs-editor'

export interface SettlementSpawnValue {
  from: string
  ttlMs?: number
  inputs?: Record<string, unknown>
}

export interface SpawnTemplateOption {
  value: string
  label: string
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const hint: CSSProperties = { fontSize: 11, opacity: 0.55, margin: '4px 0 0' }
const warn: CSSProperties = { fontSize: 11, color: '#e6a23c', margin: '4px 0 0' }

export function SettlementSpawnEditor({
  value,
  templates,
  overlays,
  entities,
  variables,
  formulas,
  maxTtlMs,
  hasJump,
  onChange,
}: {
  value: SettlementSpawnValue | undefined
  templates: SpawnTemplateOption[]
  overlays?: Record<string, Overlay>
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  formulas?: Record<string, Formula>
  /** 本节点时长上限（ms）；写入时截断，UI 提示用。 */
  maxTtlMs: number
  /** 该结算档已配置跳转边——本版 spawn 不会跨节点。 */
  hasJump?: boolean
  onChange: (next: SettlementSpawnValue | undefined) => void
}): JSX.Element {
  const enabled = !!value?.from
  const ttlCap = Math.max(100, Math.round(maxTtlMs))
  const ttlShown = value?.ttlMs != null && value.ttlMs > 0 ? value.ttlMs : ttlCap

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>结算后显示</div>
      {!enabled ? (
        <button
          type="button"
          style={{ fontSize: 12 }}
          disabled={templates.length === 0}
          onClick={() =>
            onChange({
              from: templates[0]?.value ?? '',
              ttlMs: Math.min(1200, ttlCap),
            })
          }
        >
          ＋ 显示组件
        </button>
      ) : (
        <div style={box}>
          <div style={rowStyle}>
            <span style={lbl}>模板</span>
            <select
              style={{ flex: 1, minWidth: 120 }}
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            >
              <option value="">（选组件模板）</option>
              {templates.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button type="button" style={{ color: '#ff6b6b', marginLeft: 'auto' }} onClick={() => onChange(undefined)}>
              移除
            </button>
          </div>
          <div style={rowStyle}>
            <span style={lbl}>存活ms</span>
            <input
              type="number"
              min={100}
              max={ttlCap}
              step={100}
              value={ttlShown}
              style={{ width: 100 }}
              title={`最长 ${ttlCap}ms（本节点时长）；本版不跨节点`}
              onChange={(e) => {
                const n = Number(e.target.value)
                onChange({
                  ...value,
                  ttlMs: Number.isFinite(n) ? Math.min(Math.max(100, n), ttlCap) : ttlCap,
                })
              }}
            />
            <span style={{ fontSize: 11, opacity: 0.5 }}>≤ {ttlCap}</span>
          </div>
          <SpawnInputsEditor
            from={value.from}
            inputs={value.inputs}
            overlays={overlays}
            pickers={{ entities, variables, formulas }}
            onChange={(inputs) => onChange({ ...value, inputs })}
          />
          <p style={hint}>仅在当前节点内显示，时长不超过本节点；离场或换节点会卸掉。</p>
          {hasJump ? (
            <p style={warn}>已配置跳转：结算后会立刻换节点，刷出的组件可能看不清。本版请先选「不跳转」。</p>
          ) : null}
        </div>
      )}
      {templates.length === 0 ? (
        <p style={hint}>暂无可用模板（请先在「通用样式」方案里放组件）</p>
      ) : null}
    </div>
  )
}
