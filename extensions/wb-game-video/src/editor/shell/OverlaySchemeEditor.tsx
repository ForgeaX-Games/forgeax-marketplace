/**
 * OverlaySchemeEditor —— 单个「界面方案」（overlay）的展示 + 编辑。
 * 中栏 = 标题 + 画布 + 控件库/图层 tabs；右栏 = 选中组件的参数与事件。
 * 基础界面保留只读居中预览，但不显示设计框、不允许结构编辑，也不展示控件库。
 * 组件增删改经回调交给持有 scenario.ui.overlays 的上层（GraphConfigView）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { getInspectorMountOptions } from '../../host-init'
import type { Entity, Layout, Overlay, OverlayReaction, Variable } from '../../runtime/schema/graph-schema'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { ComponentLibrary } from './ComponentLibrary'
import { componentTypeLabel } from './editors'
import type { Formula } from '../persist/formula-authoring'
import {
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type VariableCreateHandler,
} from './component-form-fields'
import { ComponentPropertyPanel } from './ComponentPropertyPanel'
import {
  collectCurrentOverlayKeyBindingSites,
  findKeyBindingConflicts,
  keyConflictChildIds,
} from './keyBindingConflicts'
import { injectStyleOnce } from '../../styles/injectStyle'

const WORKSPACE_CSS = `
.ose-root {
  display:flex; overflow:hidden; flex:1; min-width:0; min-height:0; height:100%;
  font-size:12px; background:#2c2c2c; color:#d2d2d2;
}
.ose-workspace {
  position:relative; display:flex; flex:1; flex-direction:column; min-width:0; min-height:0;
  overflow:hidden; background:#2c2c2c; container-type:inline-size;
}
.ose-stage {
  position:relative; flex:none; min-height:180px;
  max-height:min(calc(100% - 190px), 56.25cqw);
  overflow:hidden; background:#000;
}
.ose-bottom {
  display:flex; flex:1 1 0; flex-direction:column; min-height:184px; overflow:hidden;
  background:#2c2c2c;
}
.ose-stage-resizer {
  position:relative; z-index:90; flex:0 0 5px; width:100%; padding:0; border:0;
  border-top:1px solid rgba(255,255,255,.2); border-bottom:1px solid #1f1f1f;
  background:#2c2c2c; cursor:ns-resize; touch-action:none;
}
.ose-stage-resizer::after {
  content:''; position:absolute; left:50%; top:1px; width:28px; height:1px;
  transform:translateX(-50%); background:rgba(255,255,255,.28);
}
.ose-stage-resizer:hover,.ose-stage-resizer:focus-visible { background:#3a3a3a; outline:none; }
.ose-stage-resizer:hover::after,.ose-stage-resizer:focus-visible::after { background:#ff9c2a; }
.ose-stage-resizer:active { cursor:ns-resize; }
.ose-tabs {
  display:flex; flex:none; align-items:stretch; gap:18px; height:42px; padding:0 14px;
  border-bottom:1px solid rgba(255,255,255,.2);
}
.ose-tabs button {
  position:relative; border:0; padding:0 2px; background:transparent; color:#a4a4a4;
  font:inherit; font-size:14px; cursor:pointer;
}
.ose-tabs button:hover { background:transparent; }
.ose-tabs button[aria-selected="true"] { color:#ff9c2a; }
.ose-panel { flex:1; min-height:0; overflow:hidden; }
.ose-layers { height:100%; padding:12px 14px 16px; box-sizing:border-box; overflow:auto; }
.ose-layer {
  display:flex; width:100%; gap:8px; align-items:center; box-sizing:border-box; min-height:32px;
  padding:5px 8px; border:1px solid transparent; border-bottom-color:rgba(255,255,255,.1);
  border-radius:0; cursor:pointer;
  text-align:left; background:transparent; color:#bbb;
}
.ose-layer:hover { background:#363636; }
.ose-layer[aria-pressed="true"] { border-color:#ff9c2a; background:rgba(255,156,42,.1); color:#f1f1f1; }
.ose-layer-dot { flex:none; width:7px; height:7px; border-radius:50%; background:#686868; }
.ose-layer[aria-pressed="true"] .ose-layer-dot { background:#ff9c2a; box-shadow:0 0 0 3px rgba(255,156,42,.16); }
.ose-layer-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ose-layer-id { opacity:.42; margin-left:6px; }
.ose-root > [data-testid="component-property-panel"] {
  flex:0 1 480px !important; width:39.3% !important; max-width:480px !important; min-width:280px !important;
  border-left-color:#1f1f1f !important; background:#2c2c2c !important;
}
`

function topmostChildId(children: Overlay['children']): string {
  return children.reduce<{ id: string; zIndex: number; index: number } | null>((top, child, index) => {
    const zIndex = typeof child.layout?.zIndex === 'number' ? child.layout.zIndex : 0
    if (!top || zIndex > top.zIndex || (zIndex === top.zIndex && index > top.index)) {
      return { id: child.id, zIndex, index }
    }
    return top
  }, null)?.id ?? ''
}

const MIN_STAGE_PERCENT = 30
const MIN_BOTTOM_HEIGHT_PX = 190

/** 舞台拉伸上限：既保留底部工作区，又不超过当前可用宽度对应的完整 16:9 高度。 */
export function overlayStageMaxPercent(
  workspace: Pick<DOMRect, 'width' | 'height'> | undefined,
): number {
  if (!workspace || workspace.width <= 0 || workspace.height <= 0) return 100
  const aspectHeight = workspace.width * 9 / 16
  const bottomLimitedHeight = Math.max(0, workspace.height - MIN_BOTTOM_HEIGHT_PX)
  const maxHeight = Math.min(aspectHeight, bottomLimitedHeight)
  return Math.max(MIN_STAGE_PERCENT, Math.min(100, maxHeight / workspace.height * 100))
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
  locked = false,
  onAddChild,
  onRemoveChild,
  onPatchChild,
  onReactionsChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: OverlaySchemeEditorProps): JSX.Element {
  injectStyleOnce('overlay-scheme-workspace', WORKSPACE_CSS)
  const [selectedChildId, setSelectedChildId] = useState('')
  const workspaceRef = useRef<HTMLElement>(null)
  const resizingStageRef = useRef(false)
  const [stagePercent, setStagePercent] = useState(56)
  const [bottomTab, setBottomTab] = useState<'library' | 'layers'>(
    locked || overlay.children.length > 0 ? 'layers' : 'library',
  )
  const [keyConflictFocusRequest, setKeyConflictFocusRequest] = useState<
    { childId: string; nonce: number } | undefined
  >()
  // 交互热区重叠冲突（DOM 实测，来自画布回调）——组件清单里对应行标红。
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())
  const overlays = useMemo(
    () => overlayCatalog ?? { [overlayId]: overlay },
    [overlay, overlayCatalog, overlayId],
  )
  const keyConflicts = useMemo(
    () => findKeyBindingConflicts(
      collectCurrentOverlayKeyBindingSites(overlay, overlays),
    ),
    [overlay, overlays],
  )
  const keyConflictIds = useMemo(
    () => keyConflictChildIds(overlayId, keyConflicts),
    [keyConflicts, overlayId],
  )
  const selectedChild = overlay.children.find((child) => child.id === selectedChildId)
  const { inspectorEl, onInspectorTabChange } = getInspectorMountOptions()
  // 插槽 tab 用当前选中对象命名——没选中组件时退回方案名，和蓝图的「节点编辑」平级。
  const inspectorTabLabel = selectedChild
    ? componentTypeLabel(selectedChild.component)
    : overlay.title || overlayId
  useEffect(() => {
    if (!onInspectorTabChange) return
    try {
      onInspectorTabChange({ label: inspectorTabLabel, selected: !!selectedChild })
    } catch (err) {
      console.error('[wb-game-video] onInspectorTabChange failed', err)
    }
  }, [inspectorTabLabel, selectedChild, onInspectorTabChange])
  // 离开界面视图时交还页签，否则宿主留着一个点进去空白的死页签。
  const releaseInspectorTabRef = useRef(onInspectorTabChange)
  useEffect(() => {
    releaseInspectorTabRef.current = onInspectorTabChange
  }, [onInspectorTabChange])
  useEffect(() => () => {
    try {
      releaseInspectorTabRef.current?.({ label: '', selected: false })
    } catch (err) {
      console.error('[wb-game-video] onInspectorTabChange failed', err)
    }
  }, [])

  useEffect(() => {
    setBottomTab(locked || overlay.children.length > 0 ? 'layers' : 'library')
  }, [locked, overlayId])

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

  const propertyPanel = (
    <ComponentPropertyPanel
      overlay={overlay}
      overlays={overlayCatalog}
      selectedChild={selectedChild}
      entities={entities}
      variables={variables}
      formulas={formulas}
      itemIds={itemIds}
      locked={locked}
      onRemoveChild={(childId) => {
        onRemoveChild(childId)
        if (selectedChildId === childId) setSelectedChildId('')
      }}
      onPatchChild={onPatchChild}
      onReactionsChange={onReactionsChange}
      onCreateEntityAttribute={onCreateEntityAttribute}
      onCreateEntity={onCreateEntity}
      onCreateVariable={onCreateVariable}
      onCreateFormula={onCreateFormula}
      keyConflicts={keyConflicts}
      keyConflictFocusRequest={keyConflictFocusRequest}
    />
  )

  return (
    <div className="ose-root">
      <main
        ref={workspaceRef}
        data-testid="overlay-scheme-workspace"
        className="ose-workspace"
      >
        <div
          className="ose-stage"
          data-testid="overlay-stage-region"
          style={{ height: `${stagePercent}%` }}
        >
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
            keyConflictChildIds={keyConflictIds}
            onKeyConflictIconClick={(childId) => {
              setSelectedChildId(childId)
              setKeyConflictFocusRequest((current) => ({
                childId,
                nonce: (current?.nonce ?? 0) + 1,
              }))
            }}
            showDesignCanvas={!locked}
            centerChildren={locked}
            showTimeScrubber={false}
            showSelectionFrames={locked}
            fillAvailableHeight
          />
        </div>

        <button
          type="button"
          className="ose-stage-resizer"
          role="separator"
          aria-label="调整画布区域高度"
          aria-orientation="horizontal"
          aria-valuemin={MIN_STAGE_PERCENT}
          aria-valuemax={100}
          aria-valuenow={Math.round(stagePercent)}
          onPointerDown={(event) => {
            resizingStageRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!resizingStageRef.current) return
            const rect = workspaceRef.current?.getBoundingClientRect()
            if (!rect || rect.height <= 0) return
            const next = ((event.clientY - rect.top) / rect.height) * 100
            setStagePercent(Math.max(
              MIN_STAGE_PERCENT,
              Math.min(overlayStageMaxPercent(rect), next),
            ))
          }}
          onPointerUp={(event) => {
            resizingStageRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            resizingStageRef.current = false
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const max = overlayStageMaxPercent(workspaceRef.current?.getBoundingClientRect())
            setStagePercent((current) => Math.max(
              MIN_STAGE_PERCENT,
              Math.min(max, current + (event.key === 'ArrowDown' ? 2 : -2)),
            ))
          }}
        />

        <section className="ose-bottom" data-testid="overlay-library-region">
          <div role="tablist" aria-label="界面方案工具" className="ose-tabs">
            {!locked ? (
              <button
                type="button"
                role="tab"
                aria-selected={bottomTab === 'library'}
                onClick={() => setBottomTab('library')}
              >
                控件库
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={bottomTab === 'layers'}
              onClick={() => setBottomTab('layers')}
            >
              图层
            </button>
          </div>
          {bottomTab === 'library' && !locked ? (
            <div role="tabpanel" aria-label="控件库" className="ose-panel">
              <ComponentLibrary />
            </div>
          ) : (
            <div role="tabpanel" aria-label="图层" data-testid="overlay-layers" className="ose-panel ose-layers">
              {overlay.children.length === 0 ? (
                <div style={{ fontSize: 11, opacity: 0.5 }}>从控件库拖组件到画布添加。</div>
              ) : null}
              {overlay.children.map((child) => {
                const selected = child.id === selectedChildId
                const hotspotWarn = warnIds.has(child.id)
                const keyWarn = keyConflictIds.has(child.id)
                const warn = hotspotWarn || keyWarn
                const warnTitle = keyWarn
                  ? '交互按键与其它界面或组件重复'
                  : '与另一交互组件热区重叠，运行时点击会互相遮挡'
                return (
                  <button
                    type="button"
                    key={child.id}
                    onClick={() => setSelectedChildId(child.id)}
                    title={child.id}
                    aria-pressed={selected}
                    className="ose-layer"
                    style={warn ? { borderColor: '#ff6b6b', background: 'rgba(255,107,107,.08)' } : undefined}
                  >
                    <span className="ose-layer-dot" />
                    <span className="ose-layer-label">
                      {componentTypeLabel(child.component)}
                      <span className="ose-layer-id">· {child.id}</span>
                    </span>
                    {warn ? (
                      <span style={{ flex: 'none', color: '#ff6b6b', fontSize: 11 }} title={warnTitle}>⚠</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </main>
      {/* 宿主给了 inspectorEl 时，参数面板搬到 Agent 右侧那个通用插槽里（本视图自己命名 tab）；
          没有宿主 slot 的形态（standalone / dev host）仍留在中栏右侧。
          宿主自己管页签时没选中组件页签会消失，此时不塞内容，免得留下点不到的死 DOM。 */}
      {inspectorEl
        ? createPortal(
          onInspectorTabChange && !selectedChild ? null : propertyPanel,
          inspectorEl,
        )
        : propertyPanel}
    </div>
  )
}
