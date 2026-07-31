import type { JSX, ReactNode } from 'react'
import type { NodeAction, Overlay } from '../../runtime/schema/graph-schema'
import { EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import { SpawnInputsEditor } from './spawn-inputs-editor'

export interface ActionOption {
  value: string
  label: string
}

function field(label: string, control: ReactNode): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12, minWidth: 0 }}>
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>{control}</span>
    </label>
  )
}

export function NodeActionsEditor({
  actions,
  edgeOptions = [],
  spawnOptions,
  overlays,
  pickers,
  allowAdvance = true,
  allowSpawn = true,
  onChange,
}: {
  actions: NodeAction[]
  edgeOptions?: ActionOption[]
  spawnOptions: ActionOption[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  allowAdvance?: boolean
  allowSpawn?: boolean
  onChange: (next: NodeAction[]) => void
}): JSX.Element {
  const patchAt = (i: number, action: NodeAction) =>
    onChange(actions.map((current, index) => (index === i ? action : current)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {actions.map((action, i) => (
        <div key={i} style={{ border: '1px solid #2a2a2a', borderRadius: 5, padding: '6px 8px', background: 'rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <b style={{ fontSize: 11 }}>
              {action.kind === 'effect' ? '施加效果' : action.kind === 'spawn' ? '生成组件' : '沿边推进'}
            </b>
            <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => onChange(actions.filter((_, index) => index !== i))}>移除</button>
          </div>
          {action.kind === 'effect' ? (
            <EffectsEditor value={action.effects} pickers={pickers} onChange={(effects) => patchAt(i, { kind: 'effect', effects: effects ?? [] })} />
          ) : null}
          {action.kind === 'spawn' ? (
            <>
              {field('模板', (
                <select value={action.from} onChange={(e) => patchAt(i, { ...action, from: e.target.value })} style={{ flex: 1, minWidth: 0 }}>
                  <option value="">（选组件模板）</option>
                  {spawnOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ))}
              {field('存活ms', (
                <input type="number" value={action.ttlMs ?? 0} onChange={(e) => patchAt(i, { ...action, ttlMs: Number(e.target.value) || undefined })} style={{ flex: 1, minWidth: 0 }} />
              ))}
              <SpawnInputsEditor from={action.from} inputs={action.inputs} overlays={overlays} pickers={pickers} onChange={(inputs) => patchAt(i, { ...action, inputs })} />
            </>
          ) : null}
          {action.kind === 'advance' ? field('走边', (
            <select value={action.edgeId} onChange={(e) => patchAt(i, { kind: 'advance', edgeId: e.target.value })} style={{ flex: 1, minWidth: 0 }}>
              <option value="">（选出边）</option>
              {edgeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )) : null}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onChange([...actions, { kind: 'effect', effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)] }])}>＋ 效果</button>
        {allowSpawn ? (
          <button type="button" onClick={() => onChange([...actions, { kind: 'spawn', from: spawnOptions[0]?.value ?? '' }])}>＋ 生成组件</button>
        ) : null}
        {allowAdvance ? <button type="button" onClick={() => onChange([...actions, { kind: 'advance', edgeId: edgeOptions[0]?.value ?? '' }])}>＋ 沿边推进</button> : null}
      </div>
    </div>
  )
}
