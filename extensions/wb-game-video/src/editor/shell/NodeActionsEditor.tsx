import type { CSSProperties, JSX, ReactNode } from 'react'
import type { NodeAction, Overlay } from '../../runtime/schema/graph-schema'
import { EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import { ComponentInputsDisclosure } from './ComponentInputsDisclosure'
import { DEFAULT_SPAWN_TTL_MS, spawnTemplateTtlMs } from '../../graph/canvas/timeline-geometry'

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

/**
 * 新绑定一个界面时的显示时长：优先读模板 `window` 声明的可见长度，模板没声明结束时用
 * `DEFAULT_SPAWN_TTL_MS`。
 *
 * 不落成常驻是刻意的：常驻的结束固定在节点末端，拖动结算点会把界面拉长/压短，而作者的心智
 * 是「这个界面有个时长，整体跟着结算点平移」。要常驻在「消失方式」里显式选。
 */
function initialSpawnTtlMs(from: string, overlays?: Record<string, Overlay>): number {
  const template = resolveSpawnTemplate(from, overlays)
  return (template ? spawnTemplateTtlMs(template) : undefined) ?? DEFAULT_SPAWN_TTL_MS
}

function field(
  label: string,
  control: ReactNode,
  labelWidth?: CSSProperties['width'],
): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12, minWidth: 0 }}>
      <span style={{ width: labelWidth ?? 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>{control}</span>
    </label>
  )
}

function removeActionLabel(action: NodeAction): string {
  if (action.kind === 'effect') return '移除效果'
  if (action.kind === 'spawn') return '解除绑定'
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
  hideOverlayOptions = [],
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  labelWidth,
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
  /** 当前节点内可被条件隐藏的已有界面挂载。 */
  hideOverlayOptions?: ActionOption[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  labelWidth?: CSSProperties['width']
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
                  ? '绑定界面'
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
              createAttribute={onCreateEntityAttribute
                ? { onCreate: onCreateEntityAttribute }
                : undefined}
              createEntity={onCreateEntity
                ? { onCreate: onCreateEntity }
                : undefined}
              createVariable={onCreateVariable
                ? { onCreate: onCreateVariable }
                : undefined}
              createFormula={onCreateFormula
                ? { onCreate: onCreateFormula }
                : undefined}
              allowAdd={false}
              allowedKinds={SETTLEMENT_EFFECT_KINDS}
              labelWidth={labelWidth}
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
              ), labelWidth)}
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
                      // 从常驻切回定时：同样先问模板，模板没写结束才用默认值。
                      ttlMs: action.ttlMs ?? initialSpawnTtlMs(action.from, overlays),
                    })
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <option value="persistent">常驻</option>
                  <option value="duration">按时长隐藏</option>
                </select>
              ), labelWidth)}
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
              ), labelWidth) : null}
              {spawnTemplate && spawnValues ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px' }}>组件属性</div>
                  <ComponentInputsDisclosure
                    childId={spawnTemplate.id}
                    componentId={spawnTemplate.component}
                    values={spawnValues}
                    pickers={pickers}
                    labelWidth={labelWidth}
                    onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                    onCreateEntity={onCreateEntity}
                    onCreateVariable={onCreateVariable}
                    onCreateFormula={onCreateFormula}
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
          ), labelWidth) : null}
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
            aria-label="绑定界面"
            value=""
            disabled={spawnOptions.length === 0}
            title={spawnOptions.length === 0
              ? '请先在「界面」中创建可用的界面模板'
              : '把一个界面模板绑到本动作上；出现时刻跟随本结算，位置沿用模板配置'}
            onChange={(event) => {
              const from = event.target.value
              if (!from) return
              onChange([...actions, { kind: 'spawn', from, ttlMs: initialSpawnTtlMs(from, overlays) }])
            }}
            style={{ maxWidth: 140, fontSize: 11 }}
          >
            <option value="">+ 绑定界面</option>
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
