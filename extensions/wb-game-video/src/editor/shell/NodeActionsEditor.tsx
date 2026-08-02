import type { JSX, ReactNode } from 'react'
import type { NodeAction, Overlay } from '../../runtime/schema/graph-schema'
import { EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import type { EntityAttributeCreateHandler } from './component-form-fields'
import { ComponentInputsDisclosure } from './ComponentInputsDisclosure'

export interface ActionOption {
  value: string
  label: string
}

const SETTLEMENT_EFFECT_KINDS = ['attr', 'var'] as const

function replaceSpawnTemplate(
  action: Extract<NodeAction, { kind: 'spawn' }>,
  from: string,
): Extract<NodeAction, { kind: 'spawn' }> {
  const { inputs: _inputs, layout: _layout, ...lifecycle } = action
  return { ...lifecycle, from }
}

function resolveSpawnTemplate(from: string, overlays?: Record<string, Overlay>) {
  const slash = from.indexOf('/')
  if (slash < 0) return undefined
  const overlayId = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  return overlays?.[overlayId]?.children.find((child) => child.id === childId)
}

function field(label: string, control: ReactNode): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12, minWidth: 0 }}>
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>{control}</span>
    </label>
  )
}

function removeActionLabel(action: NodeAction): string {
  if (action.kind === 'effect') return '移除效果'
  if (action.kind === 'spawn') return '移除界面'
  if (action.kind === 'hideOverlay') return '移除隐藏动作'
  return '移除推进'
}

export function NodeActionsEditor({
  actions,
  spawnOptions,
  overlays,
  pickers,
  allowAdvance = true,
  allowSpawn = true,
  allowHideOverlay = false,
  defaultSpawnTtlMs,
  hideOverlayOptions = [],
  onCreateEntityAttribute,
  renderAdvance,
  onChange,
}: {
  actions: NodeAction[]
  edgeOptions?: ActionOption[]
  spawnOptions: ActionOption[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  allowAdvance?: boolean
  allowSpawn?: boolean
  allowHideOverlay?: boolean
  /** 新增瞬态界面时的默认显示时长；省略则保持既有的节点内常驻语义。 */
  defaultSpawnTtlMs?: number
  /** 当前节点内可被条件隐藏的已有界面挂载。 */
  hideOverlayOptions?: ActionOption[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  renderAdvance?: (action: Extract<NodeAction, { kind: 'advance' }>, index: number) => ReactNode
  onChange: (next: NodeAction[]) => void
}): JSX.Element {
  const patchAt = (i: number, action: NodeAction) =>
    onChange(actions.map((current, index) => (index === i ? action : current)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {actions.map((action, i) => {
        const spawnTemplate = action.kind === 'spawn' ? resolveSpawnTemplate(action.from, overlays) : undefined
        const spawnValues = action.kind === 'spawn'
          ? { ...(spawnTemplate?.inputs ?? {}), ...(action.inputs ?? {}) }
          : undefined
        return (
        <div
          key={i}
          data-action-index={i}
          data-action-kind={action.kind}
          style={{ border: '1px solid #2a2a2a', borderRadius: 5, padding: '6px 8px', background: 'rgba(0,0,0,.22)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <b style={{ fontSize: 11 }}>
              {action.kind === 'effect'
                ? '施加效果'
                : action.kind === 'spawn'
                  ? '显示界面'
                  : action.kind === 'hideOverlay'
                    ? '隐藏界面'
                    : '沿边推进'}
            </b>
            <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => onChange(actions.filter((_, index) => index !== i))}>{removeActionLabel(action)}</button>
          </div>
          {action.kind === 'effect' ? (
            <EffectsEditor
              value={action.effects}
              pickers={pickers}
              allowAdd={false}
              allowedKinds={SETTLEMENT_EFFECT_KINDS}
              onChange={(effects) => patchAt(i, { kind: 'effect', effects: effects ?? [] })}
            />
          ) : null}
          {action.kind === 'spawn' ? (
            <>
              {field('界面', (
                <select
                  value={action.from}
                  onChange={(e) => patchAt(i, replaceSpawnTemplate(action, e.target.value))}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <option value="">（选组件模板）</option>
                  {spawnOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ))}
              {field('消失方式', (
                <select
                  aria-label="消失方式"
                  value={action.ttlMs == null ? 'persistent' : 'duration'}
                  onChange={(e) => {
                    if (e.target.value === 'persistent') {
                      const { ttlMs: _ttlMs, ...rest } = action
                      patchAt(i, rest)
                      return
                    }
                    patchAt(i, {
                      ...action,
                      ttlMs: action.ttlMs ?? defaultSpawnTtlMs ?? 1200,
                    })
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <option value="persistent">常驻</option>
                  <option value="duration">按时长隐藏</option>
                </select>
              ))}
              {action.ttlMs != null ? field('显示时长', (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
                  <input
                    aria-label="显示时长"
                    type="number"
                    min={0}
                    value={action.ttlMs ?? ''}
                    onChange={(e) => patchAt(i, { ...action, ttlMs: e.target.value === '' ? undefined : Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <span style={{ fontSize: 11, opacity: 0.65 }}>ms</span>
                </span>
              )) : null}
              {spawnTemplate && spawnValues ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px' }}>组件属性</div>
                  <ComponentInputsDisclosure
                    childId={spawnTemplate.id}
                    componentId={spawnTemplate.component}
                    values={spawnValues}
                    pickers={pickers}
                    onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {action.kind === 'hideOverlay' ? field('目标界面', (
            <select
              aria-label="目标界面"
              value={action.mountId}
              onChange={(e) => patchAt(i, { ...action, mountId: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            >
              {!hideOverlayOptions.some((option) => option.value === action.mountId) ? (
                <option value={action.mountId}>原界面已失效</option>
              ) : null}
              {hideOverlayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )) : null}
          {action.kind === 'advance' && renderAdvance ? renderAdvance(action, i) : null}
          {action.kind === 'advance' && !renderAdvance ? <div style={{ fontSize: 11, color: '#ce9178' }}>请选择目标节点</div> : null}
        </div>
        )
      })}
      <div data-node-action-toolbar style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onChange([...actions, { kind: 'effect', effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)] }])}>＋ 添加效果</button>
        {allowAdvance && !actions.some((action) => action.kind === 'advance') ? (
          <button type="button" onClick={() => onChange([...actions, { kind: 'advance', edgeId: '' }])}>＋ 沿边推进</button>
        ) : null}
        {allowSpawn ? (
          <select
            aria-label="添加显示界面"
            value=""
            disabled={spawnOptions.length === 0}
            title={spawnOptions.length === 0 ? '请先在「界面」中创建可用的界面模板' : '显示一个界面模板；位置沿用模板配置'}
            onChange={(event) => {
              if (!event.target.value) return
              onChange([...actions, {
                kind: 'spawn',
                from: event.target.value,
                ...(defaultSpawnTtlMs != null ? { ttlMs: defaultSpawnTtlMs } : {}),
              }])
            }}
            style={{ maxWidth: 140, fontSize: 11 }}
          >
            <option value="">+ 添加界面</option>
            {spawnOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : null}
        {allowHideOverlay ? (
          <button
            type="button"
            disabled={hideOverlayOptions.length === 0}
            title={hideOverlayOptions.length === 0 ? '请先在当前节点添加界面' : '隐藏当前节点中已经显示的界面'}
            onClick={() => onChange([...actions, { kind: 'hideOverlay', mountId: hideOverlayOptions[0]!.value }])}
          >
            ＋ 隐藏界面
          </button>
        ) : null}
      </div>
    </div>
  )
}
