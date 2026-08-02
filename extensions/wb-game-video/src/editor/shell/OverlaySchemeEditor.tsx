/**
 * OverlaySchemeEditor —— 单个「界面方案」（overlay）的展示 + 编辑。
 * 右栏两列：左 = 标题 + 画布（拖拽定位、选中）+ 组件清单（仅显示 + 选中联动，不含参数配置）；
 * 右 = 组件库（拖 chip 落地）。基础界面保留只读居中预览，但不显示设计框且不允许拖动。
 * 组件增删改经回调交给持有 scenario.ui.overlays 的上层（GraphConfigView）。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { Entity, Layout, Overlay, OverlayReaction, Variable } from '../../runtime/schema/graph-schema'
import {
  OverlayCatalogPreview,
} from './OverlayCatalogPreview'
import { ComponentLibrary } from './ComponentLibrary'
import { componentTypeLabel } from './editors'
import { aggregateOverlayEvents } from '../../runtime/schema/overlay-events'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import type { Formula } from '../persist/formula-authoring'
import { authoringOptionLabel } from '../authoring-option-label'
import {
  ComponentFormFields,
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type VariableCreateHandler,
} from './component-form-fields'
import { ComponentEventsEditor } from './ComponentEventsEditor'

const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
/** 组件行的删除 × ——小而醒目。 */
const rowDelBtn: CSSProperties = {
  flex: 'none',
  color: '#ff6b6b',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '0 4px',
}

function topmostChildId(children: Overlay['children']): string {
  return children.reduce<{ id: string; zIndex: number; index: number } | null>((top, child, index) => {
    const zIndex = typeof child.layout?.zIndex === 'number' ? child.layout.zIndex : 0
    if (!top || zIndex > top.zIndex || (zIndex === top.zIndex && index > top.index)) {
      return { id: child.id, zIndex, index }
    }
    return top
  }, null)?.id ?? ''
}

/**
 * 引用角标：被 N 个节点挂载引用；0 = 未被引用（灰）。
 * - `compact`（左栏窄列表用）：仅在被引用时渲一个 `⇢N` 迷你 pill；未引用时不占位（空 pill 只是噪音，
 *   还挤占标题宽度）。完整语义仍在 title 里。
 * - 非 compact（方案编辑头部，横向空间充足）：显示完整「被 N 个节点引用 / 未被引用」文案。
 */
export function UsageBadge({ count, compact = false }: { count: number; compact?: boolean }): JSX.Element | null {
  const used = count > 0
  if (compact && !used) return null
  const title = used ? `被 ${count} 个节点的 overlayNodes 引用` : '资源池里的闲置界面包（可保留）'
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
      title={title}
    >
      {compact ? `⇢${count}` : used ? `被 ${count} 个节点引用` : '未被引用'}
    </span>
  )
}

/**
 * 内容重复角标：本方案与另外 N 份界面方案**内容等价**（component + 位置 + 参数一致，见
 * overlay-dedup.ts）。只提示、不自动处理——作者自行决定删哪份。`others` 为空则不渲染。
 * `compact`（左栏窄列表用）：仅一个 `⧉` 图标；完整重复对象列表仍在 title 里。
 */
export function DuplicateBadge({
  others,
  compact = false,
}: {
  others: readonly string[]
  compact?: boolean
}): JSX.Element | null {
  if (others.length === 0) return null
  return (
    <span
      style={{
        fontSize: 10,
        padding: compact ? '1px 5px' : '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: 'rgba(200,149,90,0.16)',
        color: '#e0a35f',
        border: '1px solid rgba(200,149,90,0.45)',
      }}
      title={`内容与 ${others.join('、')} 重复`}
    >
      {compact ? '⧉' : '⧉ 重复'}
    </span>
  )
}

export interface OverlaySchemeEditorProps {
  overlayId: string
  overlay: Overlay
  overlays?: Record<string, Overlay>
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  formulas?: Record<string, Formula>
  itemIds?: readonly string[]
  usageCount: number
  /**
   * 结构锁定态（基础覆盖物单组件方案）：
   * 可编辑 inputs 和目录事件动作；组件只读居中预览，不可删除方案、增删组件或拖动。
   */
  locked?: boolean
  /** 与本方案内容重复的其它方案 id（component+位置+参数等价，见 overlay-dedup.ts）；空 = 无重复。 */
  duplicateOf?: readonly string[]
  onRename: (title: string) => void
  onRemove: () => void
  /** 组件库拖到画布落地：presetId（可选带初始 place）；返回新 child id（用于选中 + 拖入吸附）。 */
  onAddChild: (
    presetId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ) => string | undefined | void
  onRemoveChild: (childId: string) => void
  onPatchChild: (
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => void
  onReactionsChange: (reactions: OverlayReaction[] | undefined) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}

export function OverlaySchemeEditor({
  overlayId,
  overlay,
  overlays: overlayCatalog,
  entities,
  variables,
  formulas,
  itemIds = [],
  usageCount,
  locked = false,
  duplicateOf = [],
  onRename,
  onRemove,
  onAddChild,
  onRemoveChild,
  onPatchChild,
  onReactionsChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: OverlaySchemeEditorProps): JSX.Element {
  const [selectedChildId, setSelectedChildId] = useState('')
  // 交互热区重叠冲突（DOM 实测，来自画布回调）——组件清单里对应行标红。
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())
  const selectedChild = overlay.children.find((child) => child.id === selectedChildId)
  const selectedEvents = selectedChild
    ? aggregateOverlayEvents(
        { id: overlay.id, children: [selectedChild] },
        getComponentManifest,
        { mountId: overlay.id },
      )
    : []
  const overlays = overlayCatalog ?? { [overlay.id]: overlay }
  const spawnOptions = Object.values(overlays).flatMap((definition) =>
    definition.children.map((child) => {
      const value = `${definition.id}/${child.id}`
      const name = [definition.title?.trim(), componentTypeLabel(child.component)]
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join(' · ')
      return { value, label: authoringOptionLabel(name, value) }
    }))

  // 进入方案时默认选中视觉最上层组件（zIndex 高者优先，同层级后渲染者优先）；
  // 双字幕等完全重叠时，默认选择因此与眼前实际可见的那一层一致。
  // 参数/事件因此始终紧跟画布出现，不要求作者先猜到还需额外点击一次。
  useEffect(() => {
    setSelectedChildId((current) =>
      overlay.children.some((child) => child.id === current)
        ? current
        : topmostChildId(overlay.children))
  }, [overlayId, overlay.children])

  // Backspace/Delete 删除选中组件；经 onRemoveChild→setMeta 天然进 zundo 撤销历史。锁定态（基础覆盖物）不删。
  // 护栏：输入框/下拉/可编辑区、以及焦点在左侧方案列表（.gc-list）内一律放行给它们。
  // 选中组件的方向键 = 微调位置，由画布 OverlayCatalogPreview 处理；切换选中交回鼠标点选 / 左侧列表上下键。
  useEffect(() => {
    if (locked) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedChildId) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (t?.closest?.('.gc-list')) return
      e.preventDefault()
      onRemoveChild(selectedChildId)
      setSelectedChildId('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChildId, onRemoveChild, locked])

  const confirmRemove = (): void => {
    const label = overlay.title?.trim() || overlayId
    const usageWarning = usageCount > 0
      ? `当前仍被 ${usageCount} 个节点引用，删除后这些挂载将无法解析界面。`
      : ''
    if (
      typeof window !== 'undefined'
      && typeof window.confirm === 'function'
      && !window.confirm(`确定删除自定义界面方案「${label}」？${usageWarning}`)
    ) return
    onRemove()
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, overflow: 'auto', fontSize: 12, flex: 1, minWidth: 0 }}>
      {/* ── 左列：标题 + 画布 + 组件清单 ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input
            value={overlay.title ?? ''}
            placeholder={overlayId}
            onChange={(e) => onRename(e.target.value)}
            style={{ flex: 1, fontWeight: 600 }}
          />
          <UsageBadge count={usageCount} />
          <DuplicateBadge others={duplicateOf} />
          {!locked && <button style={del} onClick={confirmRemove}>删除</button>}
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>
          {overlayId}
          {locked && <span style={{ marginLeft: 8, color: '#c8955a' }}>· 基础界面（单组件，位置固定）</span>}
        </div>
        {duplicateOf.length > 0 && (
          <div
            style={{
              margin: '0 0 8px',
              padding: '6px 8px',
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.5,
              background: 'rgba(200,149,90,0.12)',
              border: '1px solid rgba(200,149,90,0.4)',
              color: '#e0a35f',
            }}
          >
            ⧉ 本方案与 {duplicateOf.join('、')} 内容重复（组件 + 位置 + 参数一致），可考虑删除其一。
          </div>
        )}

        <OverlayCatalogPreview
          overlay={overlay}
          entities={entities}
          variables={variables}
          selectedChildId={selectedChildId}
          onSelectChild={setSelectedChildId}
          onAddChild={
            locked
              ? undefined
              : (presetId, place) => {
                  const id = onAddChild(presetId, place)
                  if (typeof id === 'string') setSelectedChildId(id)
                  return id
                }
          }
          onPatchChildLayout={locked
            ? undefined
            : (childId, patch) => onPatchChild(childId, { layout: patch })}
          onWarnChange={locked ? undefined : setWarnIds}
          showDesignCanvas={!locked}
          centerChildren={locked}
          showTimeScrubber={false}
          showSelectionFrames={locked}
        />

        {/* 组件清单：仅显示画布里有哪些组件 + 与画布双向选中，不含参数配置。 */}
        <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>组件（{overlay.children.length}）</div>
          {overlay.children.length === 0 && (
            <div style={{ fontSize: 11, opacity: 0.5 }}>从右侧组件库拖组件到画布添加。</div>
          )}
          {overlay.children.map((child) => {
            const selected = child.id === selectedChildId
            const warn = warnIds.has(child.id)
            return (
              <div
                key={child.id}
                onPointerDown={() => setSelectedChildId(child.id)}
                title={child.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '5px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: `1px solid ${warn ? '#ff6b6b' : selected ? 'var(--gc-accent, #c8955a)' : 'transparent'}`,
                  background: selected ? 'rgba(200,149,90,0.12)' : warn ? 'rgba(255,107,107,0.08)' : 'transparent',
                }}
              >
                {/* 前方 active 标识：选中=实心强调点，未选中=暗点。 */}
                <span
                  style={{
                    flex: 'none',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: selected ? 'var(--gc-accent, #c8955a)' : 'rgba(255,255,255,0.2)',
                    boxShadow: selected ? '0 0 0 3px rgba(200,149,90,0.25)' : 'none',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#f6f1e9' : '#c9c0b2' }}>
                  {componentTypeLabel(child.component)}
                  <span style={{ opacity: 0.45, marginLeft: 6 }}>· {child.id}</span>
                </span>
                {warn && <span style={{ flex: 'none', color: '#ff6b6b', fontSize: 11 }} title="与另一交互组件热区重叠，运行时点击会互相遮挡">⚠</span>}
                {!locked && (
                  <button
                    style={rowDelBtn}
                    title="移除组件"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveChild(child.id)
                      if (selected) setSelectedChildId('')
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {selectedChild ? (
          <div data-testid="overlay-selected-child-editor" style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              参数 · {componentTypeLabel(selectedChild.component)}
            </div>
            {locked ? (
              <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 6 }}>
                基础界面不能增删或拖动组件；可以修改参数和事件动作。
              </div>
            ) : null}
            <ComponentFormFields
              componentId={selectedChild.component}
              values={selectedChild.inputs ?? {}}
              pickers={{ entities, variables, formulas, itemIds }}
              density="compact"
              labelWidth="7em"
              onChange={(inputs) => onPatchChild(selectedChild.id, { inputs })}
              onCreateEntityAttribute={onCreateEntityAttribute}
              onCreateEntity={onCreateEntity}
              onCreateVariable={onCreateVariable}
              onCreateFormula={onCreateFormula}
            />
            {selectedEvents.length > 0 ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, margin: '10px 0 6px' }}>事件</div>
                {locked ? (
                  <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 6 }}>
                    这里配置的事件动作会被所有使用该基础界面的挂载继承。
                  </div>
                ) : null}
                <fieldset
                  data-testid="overlay-event-editor"
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <ComponentEventsEditor
                    mode="catalog"
                    events={selectedEvents}
                    catalogReactions={overlay.reactions}
                    spawnOptions={spawnOptions}
                    overlays={overlays}
                    pickers={{ entities, variables, formulas, itemIds }}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                    onCreateEntity={onCreateEntity}
                    onCreateVariable={onCreateVariable}
                    onCreateFormula={onCreateFormula}
                    onCatalogChange={onReactionsChange}
                  />
                </fieldset>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── 右列：组件库（锁定态不显，改提示） ── */}
      {locked ? (
        <div style={{ minWidth: 150, width: 168, fontSize: 11, opacity: 0.5, lineHeight: 1.5 }}>
          基础界面固定为单组件，预览中居中显示且不可拖动。
        </div>
      ) : (
        <ComponentLibrary />
      )}
    </div>
  )
}
