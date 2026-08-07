import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { NodeAction, Overlay } from '../../runtime/schema/graph-schema'
import { EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import { DEFAULT_SPAWN_TTL_MS, spawnTemplateTtlMs } from '../../graph/canvas/timeline-geometry'
import { ComponentInputsDisclosure } from './ComponentInputsDisclosure'
import { SelectDropdown } from './SelectDropdown'

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

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

function cnOrdinal(prefix: string, ordinal: number): string {
  if (ordinal <= 0) return `${prefix}${ordinal}`
  if (ordinal < 10) return `${prefix}${CN_DIGITS[ordinal]}`
  if (ordinal === 10) return `${prefix}十`
  if (ordinal < 20) return `${prefix}十${CN_DIGITS[ordinal - 10]}`
  if (ordinal < 100) {
    const tens = Math.floor(ordinal / 10)
    const ones = ordinal % 10
    return `${prefix}${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`
  }
  return `${prefix}${ordinal}`
}

/** 按当前效果列表序号生成「效果一」「效果二」；删除后剩余项会按序重排，新增接在末尾。 */
export function effectActionTitle(ordinal: number): string {
  return cnOrdinal('效果', ordinal)
}

/** 按当前显示信息列表序号生成「显示信息一」…；删除后重排，新增接在末尾。 */
export function spawnActionTitle(ordinal: number): string {
  return cnOrdinal('显示信息', ordinal)
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      data-icon="trash-filled"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      width={14}
      height={14}
    >
      <path d="M7 0h6l1 2h5v2H1V2h5l1-2Zm-4 5h14l-1 15H4L3 5Zm4 3v9h2V8H7Zm4 0v9h2V8h-2Z" fillRule="evenodd" />
    </svg>
  )
}

function DurationNumberInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  return (
    <input
      aria-label="显示时长"
      type="number"
      min={0}
      value={draft}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        if (!next.trim()) return
        const parsed = Number(next)
        if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = Number(draft)
        if (!draft.trim() || !Number.isFinite(parsed) || parsed < 0) {
          setDraft(String(value))
        }
      }}
      style={{ flex: 1, minWidth: 0 }}
    />
  )
}

export function NodeActionsEditor({
  actions,
  spawnOptions,
  overlays,
  pickers,
  allowAdvance = true,
  allowSpawn = true,
  allowHideOverlay = false,
  propertyLayout = false,
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
  /** 右栏属性面板布局；只改变新组件动作表单的展示，不改变动作数据。 */
  propertyLayout?: boolean
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
    <div
      data-node-actions={propertyLayout ? 'property' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: propertyLayout ? 0 : 6 }}
    >
      {actions.map((action, i) => {
        const isPropertyEffect = propertyLayout && action.kind === 'effect'
        const isPropertySpawn = propertyLayout && action.kind === 'spawn'
        const isPropertyAction = isPropertyEffect || isPropertySpawn
        const effectOrdinal = isPropertyEffect
          ? actions.slice(0, i + 1).filter((item) => item.kind === 'effect').length
          : 0
        const spawnOrdinal = isPropertySpawn
          ? actions.slice(0, i + 1).filter((item) => item.kind === 'spawn').length
          : 0
        const hasLaterPropertyAction = isPropertyAction
          && actions.slice(i + 1).some((item) => item.kind === 'effect' || item.kind === 'spawn')
        const spawnTemplate = action.kind === 'spawn' ? resolveSpawnTemplate(action.from, overlays) : undefined
        const spawnValues = action.kind === 'spawn'
          ? { ...(spawnTemplate?.inputs ?? {}), ...(action.inputs ?? {}) }
          : undefined
        const propertyTitle = isPropertyEffect
          ? effectActionTitle(effectOrdinal)
          : isPropertySpawn
            ? spawnActionTitle(spawnOrdinal)
            : ''
        return (
        <div
          key={i}
          data-action-index={i}
          data-action-kind={action.kind}
          data-property-effect-action={isPropertyEffect ? 'true' : undefined}
          data-property-spawn-action={isPropertySpawn ? 'true' : undefined}
          style={isPropertyAction
            ? {
              border: 0,
              borderRadius: 0,
              padding: '4px 0 12px',
              background: 'transparent',
              borderBottom: hasLaterPropertyAction ? '1px solid rgba(255,255,255,0.1)' : 0,
            }
            : { border: '1px solid #2a2a2a', borderRadius: 5, padding: '6px 8px', background: 'rgba(0,0,0,.22)' }}
        >
          {isPropertyAction ? (
            <div className="editor-property-effect-header">
              <b>{propertyTitle}</b>
              <button
                type="button"
                aria-label={isPropertyEffect ? '删除效果' : '删除显示信息'}
                title={`删除${propertyTitle}`}
                onClick={() => onChange(actions.filter((_, index) => index !== i))}
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
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
          )}
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
              propertyLayout={propertyLayout}
              onChange={(effects) => {
                if (propertyLayout && !effects?.length) {
                  onChange(actions.filter((_, index) => index !== i))
                  return
                }
                patchAt(i, { kind: 'effect', effects: effects ?? [] })
              }}
            />
          ) : null}
          {action.kind === 'spawn' ? (
            isPropertySpawn ? (
              <div data-property-spawn-editor>
                <div className="editor-property-cascade-field">
                  <span>界面或组件名</span>
                  <SelectDropdown
                    ariaLabel="界面或组件名"
                    value={action.from}
                    placeholder="选择界面或组件…"
                    options={spawnOptions}
                    onChange={(from) => patchAt(i, replaceSpawnTemplate(action, from))}
                  />
                </div>
                <div className="editor-property-cascade-field">
                  <span>消失方式</span>
                  <SelectDropdown
                    ariaLabel="消失方式"
                    value={action.ttlMs == null ? 'persistent' : 'duration'}
                    options={[
                      { value: 'persistent', label: '常驻' },
                      { value: 'duration', label: '按时长隐藏' },
                    ]}
                    onChange={(next) => {
                      if (next === 'persistent') {
                        const { ttlMs: _ttlMs, ...rest } = action
                        patchAt(i, rest)
                        return
                      }
                      patchAt(i, {
                        ...action,
                        ttlMs: action.ttlMs ?? initialSpawnTtlMs(action.from, overlays),
                      })
                    }}
                  />
                </div>
                {action.ttlMs != null ? (
                  <div className="editor-property-cascade-field">
                    <span>显示时长</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <DurationNumberInput
                        value={action.ttlMs}
                        onChange={(ttlMs) => patchAt(i, { ...action, ttlMs })}
                      />
                      <span style={{ fontSize: 12, opacity: 0.65, flex: 'none' }}>ms</span>
                    </span>
                  </div>
                ) : null}
                {spawnTemplate && spawnValues ? (
                  <ComponentInputsDisclosure
                    childId={spawnTemplate.id}
                    componentId={spawnTemplate.component}
                    values={spawnValues}
                    pickers={pickers}
                    labelWidth={labelWidth}
                    density="property"
                    onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                    onCreateEntity={onCreateEntity}
                    onCreateVariable={onCreateVariable}
                    onCreateFormula={onCreateFormula}
                  />
                ) : null}
              </div>
            ) : (
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
                      density="compact"
                      onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                      onCreateEntityAttribute={onCreateEntityAttribute}
                      onCreateEntity={onCreateEntity}
                      onCreateVariable={onCreateVariable}
                      onCreateFormula={onCreateFormula}
                    />
                  </div>
                ) : null}
              </>
            )
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
      <div
        data-node-action-add={propertyLayout ? 'true' : undefined}
        data-has-actions={propertyLayout && actions.length > 0 ? 'true' : undefined}
      >
        {propertyLayout ? <div className="editor-property-add-title">新增</div> : null}
        <div data-node-action-toolbar style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onChange([...actions, { kind: 'effect', effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)] }])}>
            {propertyLayout ? '添加效果' : '＋ 添加效果'}
          </button>
          {allowAdvance && !actions.some((action) => action.kind === 'advance') ? (
            <button type="button" onClick={() => onChange([...actions, { kind: 'advance', edgeId: '' }])}>＋ 沿边推进</button>
          ) : null}
          {allowSpawn && propertyLayout ? (
            <button
              type="button"
              disabled={spawnOptions.length === 0}
              title={spawnOptions.length === 0 ? '请先在「界面」中创建可用的界面模板' : '显示一个界面模板；位置沿用模板配置'}
              onClick={() => {
                const from = spawnOptions[0]?.value ?? ''
                onChange([...actions, {
                  kind: 'spawn',
                  from,
                  ...(from ? { ttlMs: initialSpawnTtlMs(from, overlays) } : {}),
                }])
              }}
            >
              添加界面
            </button>
          ) : null}
          {allowSpawn && !propertyLayout ? (
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
    </div>
  )
}
