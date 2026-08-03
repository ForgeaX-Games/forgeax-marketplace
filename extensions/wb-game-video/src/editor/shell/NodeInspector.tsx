/**
 * NodeInspector —— 节点配置面板。选中画布节点后编辑其 `node.data`、overlay reactions 与出边。
 * Overlay 事件作者 SSOT = 各挂载 `overlayNodes[].reactions`；走向经 do 内 advance + 边。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Entity, GameEdge, GameGraph, GraphCondition, Overlay, OverlayChild, RoutingSettlement, SubFlowPackDef, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { authoringOptionLabel } from '../authoring-option-label'
import { getSubFlowPack, getSubProcess } from '../../runtime/schema/graph-schema'
import { patchNodeBgm, type AudioOption } from './bgm-authoring'
import type { NodeAction, OverlayReaction, Reaction, OverlayEventRef } from '../../runtime/schema/node-config-schema'
import { createOverlayMount, overlayMountId } from '../../runtime/schema/node-config-schema'
import { aggregateOverlayEvents, resolveEventReactionDo } from '../../runtime/schema/overlay-events'
import { resolveMountChildren } from '../../runtime/schema/expand-overlay'
import { deriveOutputs, getComponentManifest } from '../../runtime/registry/component-registry'
import {
  connect,
  disconnect,
  reconnect,
  removeNode,
  setSettlementAdvanceTarget,
  updateEdgeData,
  updateEventRouteTiming,
  updateNodeData,
  upsertBranchEdge,
  makeEmptySubFlowPack,
  attachSubProcess,
  type NodeDataPatch,
} from '../../graph/edit/graph-edit'
import { mergeFlowHandles, flowHandleDisplay } from '../../graph/flow-handle-labels'
import { ConditionEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import { ComponentInputsDisclosure } from './ComponentInputsDisclosure'
import { overlayDisplayLabel, PRESET_SCHEME_BY_ID } from './schemeOverlays'
import { listSchemeAndBaseOverlayIds } from '../demo/builtin-schemes'
import { NodeActionsEditor } from './NodeActionsEditor'
import { ComponentEventsEditor } from './ComponentEventsEditor'
import { resolveMountLayoutForChildren } from '../../runtime/schema/layout'
import { LooseNumberInput } from './TermChainEditor'

const OVERLAY_CONFIG_CONTROL_WIDTH = '320px'
const OVERLAY_CONFIG_BASE_LABELS = ['类型', '实体', '属性', '操作', '数值来源', '数值']

function estimatedLabelUnits(label: string): number {
  return Array.from(label).reduce((units, char) => {
    if (/\s/.test(char)) return units + 0.35
    return units + (/[\x00-\x7F]/.test(char) ? 0.62 : 1)
  }, 0)
}

function overlayConfigLabelWidth(children: OverlayChild[]): string {
  const labels = [
    ...OVERLAY_CONFIG_BASE_LABELS,
    ...children.flatMap((child) =>
      (getComponentManifest(child.component)?.inputs ?? [])
        .filter((input) => input.key !== 'x' && input.key !== 'y')
        .map((input) => input.label?.trim() || input.key)),
  ]
  const maxUnits = Math.max(4, ...labels.map(estimatedLabelUnits))
  return `${Math.ceil(maxUnits * 11 + 8)}px`
}

/**
 * 「播放动作」下拉的 hover 说明 —— 面板上不再铺开这些解释（只留表单本身），所以三条动作的
 * 语义全压在这一条 tooltip 里。逐句对着 `bgm-stack.ts` 核过：
 * - push：`apply` 压新帧，旧帧留在下面，等这层被结束时 `resume` 回到它；
 * - replace：只换栈顶帧的播放字段，被顶掉的那首**没有**留在栈上（栈空、或栈顶是弹不掉的
 *   文档床时退化成 push）；
 * - stop：`stop()` 结束栈顶那层、回到下一层，栈顶已是文档床时返回 null（一条指令都不发，D13）。
 *
 * 「离开本节点不结束」必须说：调度层弹 `callStack` 帧、局内清空 `callStack` 都**不动** BGM 栈
 * （见 `engine.ts` 的 `advanceAuto` / `consumeRedirect`），「包进子流程就会自己收掉」是作者最
 * 容易替引擎脑补出来的一条不存在的规则。
 */
const BGM_MODE_TITLE = '留空 = 这里不换音乐，继续播上层正在响的那首。配了就一直播：走边离开本节点、弹回外层子流程/子蓝图都不结束，只有在该停的节点上选「结束当前音乐」，或跳转 / 重开一局才会退掉它。\n起播并记住上一首 = 这层被结束时回到它；换曲不记住 = 顶掉正在响的那首、层数不变（正响的是文档默认床轨时例外：它是地板顶不掉，会另起一层）；结束当前音乐 = 结束正在响的这层，回到上一层还没结束的那首（只剩文档床时什么都不做）。'

function serializableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sparseOverlayInputOverride(
  base: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    if (!serializableEqual(value, base?.[key])) out[key] = value
  }
  return out
}

function row(label: string, node: ReactNode): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        marginBottom: 4,
        fontSize: 12,
        minWidth: 0,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      {/* 约束右侧控件：长 select 文案不得撑破父层 */}
      <span style={{ flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center' }}>{node}</span>
    </label>
  )
}

function AdvanceTargetRow({
  sourceLabel,
  currentTarget,
  nodeOptions,
  onChange,
}: {
  sourceLabel: string
  currentTarget: string
  nodeOptions: OptItem[]
  onChange: (targetId: string) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: 4, fontSize: 12 }}>
      <span style={{ opacity: 0.7, flexShrink: 0 }}>从</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sourceLabel}>{sourceLabel}</span>
      <span style={{ opacity: 0.7, flexShrink: 0 }}>到</span>
      <select aria-label="目标节点" value={currentTarget} onChange={(event) => onChange(event.target.value)} style={{ flex: 1, minWidth: 0 }}>
        <option value="">（无 · 只做副作用）</option>
        {nodeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

function RouteTimingEditor({
  edge,
  routingSettlement,
  defaultAtMs = 1000,
  onChange,
}: {
  edge: GameEdge
  routingSettlement?: RoutingSettlement
  defaultAtMs?: number
  onChange: (transition: 'immediate' | 'onSettlement', settlement?: RoutingSettlement) => void
}): JSX.Element {
  const timing = edge.data?.transition === 'onSettlement'
    ? routingSettlement?.type === 'at' ? 'at' : 'complete'
    : 'immediate'
  return (
    <>
      {row('跳转时机', (
        <select
          value={timing}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'immediate') onChange('immediate')
            else if (value === 'at') onChange('onSettlement', { type: 'at', ms: Math.max(0, Math.round(defaultAtMs)) })
            else onChange('onSettlement', { type: 'complete' })
          }}
          style={{ flex: 1 }}
        >
          <option value="immediate">立即跳转</option>
          <option value="complete">当前节点播放结束时</option>
          <option value="at">播放到指定时间时</option>
        </select>
      ))}
      {timing === 'at' ? row('结算时间', (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <LooseNumberInput
            value={routingSettlement?.type === 'at' ? routingSettlement.ms : 0}
            emptyValue={0}
            onChange={(value) => onChange('onSettlement', {
              type: 'at',
              ms: Math.max(0, value),
            })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={{ fontSize: 11, opacity: 0.65 }}>ms</span>
        </span>
      )) : null}
    </>
  )
}

/** 悬停 / 模块内聚焦时边框微亮；`nested` 仅略缩进，底色与父级一致。 */
const HOVER_CARD_CLASS = 'ni-hover-card'
const HOVER_CARD_NESTED = 'ni-hover-card--nested'
/** 图标按钮：对齐宿主侧栏 `.sb-icon-btn`（透明底、无边框、hover 才提亮）；无 padding，按钮尺寸 = 图标尺寸。 */
const ICON_BTN_CLASS = 'ni-icon-btn'
const HOVER_CARD_STYLE_ID = 'ni-hover-card-style-v8'

function ensureHoverCardStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(HOVER_CARD_STYLE_ID)) return
  for (const id of [
    'ni-hover-card-style',
    'ni-hover-card-style-v2',
    'ni-hover-card-style-v3',
    'ni-hover-card-style-v4',
    'ni-hover-card-style-v5',
    'ni-hover-card-style-v6',
    'ni-hover-card-style-v7',
  ]) {
    document.getElementById(id)?.remove()
  }
  const el = document.createElement('style')
  el.id = HOVER_CARD_STYLE_ID
  el.textContent = `
.${HOVER_CARD_CLASS} {
  margin-top: 8px;
  border-radius: 6px;
  padding: 8px;
  border: 1px solid #333;
  background: #141414;
  transition: border-color 120ms ease;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.${HOVER_CARD_CLASS}:hover,
.${HOVER_CARD_CLASS}:focus-within {
  border-color: #4ea1ff;
}
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED} {
  margin-left: 6px;
  border-color: #2c2c2c;
}
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED}:hover,
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED}:focus-within {
  border-color: #6bc4a8;
}
.${ICON_BTN_CLASS} {
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--faint, #8c8377);
  flex-shrink: 0;
  line-height: 0;
}
.${ICON_BTN_CLASS}:hover {
  color: var(--txt, #f6f1e9);
  background: rgba(255, 255, 255, 0.08);
}
.${ICON_BTN_CLASS}:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: -1px;
}
`
  document.head.appendChild(el)
}

function HoverCard({
  header,
  children,
  nested,
  accent,
  anchorRef,
  anchorId,
}: {
  header: ReactNode
  children: ReactNode
  /** 子模块（如覆盖物下的事件）：略缩进；悬停青绿边，底色与父级同。 */
  nested?: boolean
  /** 聚焦态：橙色描边 + 微高亮底（预览台选中该挂载时）。 */
  accent?: boolean
  /** 时间轴选中后滚入右侧可视区的卡片根节点。 */
  anchorRef?: (element: HTMLDivElement | null) => void
  anchorId?: string
}): JSX.Element {
  ensureHoverCardStyle()
  return (
    <div
      ref={anchorRef}
      data-focus-anchor={anchorId}
      className={nested ? `${HOVER_CARD_CLASS} ${HOVER_CARD_NESTED}` : HOVER_CARD_CLASS}
      style={accent ? { outline: '1px solid #f08840', outlineOffset: 1 } : undefined}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: '1px solid #262626',
        }}
      >
        {header}
      </div>
      {children}
    </div>
  )
}

function sectionLabel(text: string): JSX.Element {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px', letterSpacing: 0.2 }}>
      {text}
    </div>
  )
}

/** 与引擎 resolveEventReactions 同序查找挂载 event 反应的 do（兼容 A / panelA:A 等写法）。 */
function eventReactionDo(reactions: Reaction[] | undefined, ev: OverlayEventRef): NodeAction[] {
  return resolveEventReactionDo(reactions, ev.localEventId, ev.childId, ev.mountId) ?? []
}

/** 清理节点挂载 reaction 的全部历史别名；目录 reaction 的稳定 key 由 ComponentEventsEditor 单独维护。 */
function eventKeySet(ev: OverlayEventRef): Set<string> {
  const keys = new Set<string>([ev.localEventId, ev.eventId])
  keys.add(`${ev.childId}:${ev.localEventId}`)
  keys.add(`${ev.mountId}:${ev.localEventId}`)
  keys.add(`${ev.mountId}:${ev.childId}:${ev.localEventId}`)
  return keys
}

function upsertEventReaction(
  reactions: Reaction[] | undefined,
  ev: OverlayEventRef,
  doActions: NodeAction[],
): Reaction[] | undefined {
  const keys = eventKeySet(ev)
  const rest = (reactions ?? []).filter((r) => !(r.when.type === 'event' && keys.has(r.when.id)))
  if (doActions.length) rest.push({ when: { type: 'event', id: ev.localEventId }, do: doActions })
  return rest.length ? rest : undefined
}

/** 本节点上某交互出口（sourceHandle = localEventId）的出边。 */
function handleEdges(graph: GameGraph, nodeId: string, handle: string) {
  return graph.edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === handle)
}

/**
 * 「覆盖物事件 → 目标节点」捷径：upsert `sourceHandle=localEventId` 的边，并把 advance 写到**当前挂载**。
 * 同 handle 已有多条边（加权边池）时不改边，仅提示走「出边」。
 * 清空目标 = 拆掉该 handle 下出边（disconnect 会清掉指向它们的 advance）。
 */
function routeMountEventToNode(
  graph: GameGraph,
  nodeId: string,
  mountIndex: number,
  ev: OverlayEventRef,
  targetId: string,
): GameGraph {
  const handle = ev.localEventId
  const pool = handleEdges(graph, nodeId, handle)
  if (!targetId) {
    let g = graph
    for (const e of pool) g = disconnect(g, e.id)
    return g
  }
  if (pool.length > 1) return graph

  let g = upsertBranchEdge(graph, { source: nodeId, sourceHandle: handle, target: targetId })
  const edge = handleEdges(g, nodeId, handle).find((e) => e.target === targetId)
    ?? handleEdges(g, nodeId, handle)[0]
  if (!edge) return g

  const node = g.nodes.find((n) => n.id === nodeId)
  if (!node?.data.overlayNodes?.[mountIndex]) return g

  // 保留本事件已有的 effect/spawn（任一挂载上的），只换成指向新边的 advance；收拢到当前挂载。
  let preserved: NodeAction[] = []
  for (const m of node.data.overlayNodes) {
    const doList = eventReactionDo(m.reactions, ev)
    if (doList.length) {
      preserved = doList.filter((a) => a.kind !== 'advance')
      break
    }
  }
  const keys = eventKeySet(ev)
  const strip = (rs: Reaction[] | undefined): Reaction[] | undefined => {
    const next = (rs ?? []).filter((r) => !(r.when.type === 'event' && keys.has(r.when.id)))
    return next.length ? next : undefined
  }
  const mounts = node.data.overlayNodes.map((m, i) => {
    let reactions = strip(m.reactions)
    if (i === mountIndex) {
      const doActions: NodeAction[] = [...preserved, { kind: 'advance', edgeId: edge.id }]
      reactions = [...(reactions ?? []), { when: { type: 'event', id: handle }, do: doActions }]
    }
    return { ...m, reactions }
  })
  const dataReactions = strip(node.data.reactions)
  return updateNodeData(g, nodeId, { overlayNodes: mounts, reactions: dataReactions })
}

/** 历史生命周期相位仍可读取；作者侧新增和编辑统一落成精确的 `at(ms)`。 */
function isLifecycle(r: Reaction): boolean {
  return r.when.type === 'enter' || r.when.type === 'at' || r.when.type === 'exit' || r.when.type === 'complete'
}

/** 下拉项：value 落盘、label 展示（组件中文名等）。 */
interface OptItem {
  value: string
  label: string
}
type SettlementTriggerType = 'at' | 'condition' | 'shown' | 'hidden'
const SETTLEMENT_TRIGGER_LABEL: Record<SettlementTriggerType, string> = {
  at: '播到 X ms',
  condition: '条件结算',
  shown: '界面出现',
  hidden: '界面消失',
}
function isReactive(r: Reaction): boolean {
  return r.when.type === 'watch'
    || r.when.type === 'state'
    || r.when.type === 'shown'
    || r.when.type === 'hidden'
}
function isSettlement(r: Reaction): boolean {
  return isLifecycle(r) || isReactive(r)
}
function settlementTriggerType(r: Reaction): SettlementTriggerType {
  const type = r.when.type
  if (type === 'watch' || type === 'state') return 'condition'
  return type === 'shown' || type === 'hidden' ? type : 'at'
}

function watchPathFromCondition(condition: GraphCondition): string {
  if (condition.all.length !== 1) return ''
  const clause = condition.all[0]!
  if (clause.type === 'attr') return `entity.${clause.entityId}.attr.${clause.attr}`
  if (clause.type === 'var') return `var.${clause.varId}`
  return clause.type === 'score' ? 'score' : ''
}

function lifecycleAtMs(r: Reaction, durationMs?: number): number {
  if (r.when.type === 'at') return r.when.ms
  if (r.when.type === 'enter') return 0
  return Math.max(0, Math.round(durationMs ?? 0))
}

function isSettlementControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('button, input, select, textarea, label, a, summary, details, [role="button"], [contenteditable="true"]'))
}

function legacyPhaseHint(r: Reaction): string | null {
  if (r.when.type === 'at') return null
  if (r.when.type === 'complete') {
    return r.when.if
      ? '旧「收尾」相位 · 带 if 条件（仍生效）：改这条会丢弃条件并落成播到 ms'
      : '旧「收尾」相位（仍生效，作 if 分支的兜底）：改这条即落成播到 ms'
  }
  if (r.when.type === 'exit') return '旧「离开前」相位（任何离开路径都触发）：改这条即落成播到 ms'
  return '旧「进入时」相位：改这条即落成播到 ms'
}

function LifecycleReactionsEditor({
  reactions,
  sourceLabel,
  nodeOptions,
  durationMs,
  insertMs,
  focusedIndex,
  focusAnchorRevision,
  onFocusIndex,
  pickers,
  entities,
  variables,
  advanceEdgeFor,
  advanceTargetFor,
  onAdvanceTargetChange,
  routingSettlement,
  onSetAdvanceTiming,
  componentOptions,
  spawnOptions,
  hideOverlayOptions,
  overlays,
  fieldTree,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  onChange,
}: {
  reactions: Reaction[] | undefined
  sourceLabel: string
  nodeOptions: OptItem[]
  durationMs?: number
  insertMs?: number
  focusedIndex?: number | null
  focusAnchorRevision?: number
  onFocusIndex?: (lifecycleIndex: number | null) => void
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  advanceEdgeFor: (edgeId: string) => GameEdge | undefined
  advanceTargetFor: (edgeId: string) => string
  onAdvanceTargetChange: (settlementIndex: number, actionIndex: number, targetId: string) => void
  routingSettlement?: RoutingSettlement
  onSetAdvanceTiming: (
    edgeId: string,
    transition: 'immediate' | 'onSettlement',
    settlement?: RoutingSettlement,
  ) => void
  componentOptions: OptItem[]
  spawnOptions: OptItem[]
  hideOverlayOptions: OptItem[]
  overlays?: Record<string, Overlay>
  fieldTree: FieldNode[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  onChange: (next: Reaction[] | undefined) => void
}): JSX.Element {
  const settlements = (reactions ?? []).filter(isSettlement)
  const rest = (reactions ?? []).filter((r) => !isSettlement(r))
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const commit = (next: Reaction[]) => {
    const merged = [...next, ...rest]
    onChange(merged.length ? merged : undefined)
  }
  const patchAt = (i: number, r: Reaction) => commit(settlements.map((c, j) => (j === i ? r : c)))
  const removeAt = (i: number) => {
    if (focusedIndex === i) onFocusIndex?.(null)
    else if (focusedIndex != null && focusedIndex > i) onFocusIndex?.(focusedIndex - 1)
    commit(settlements.filter((_, j) => j !== i))
  }
  const setType = (i: number, type: SettlementTriggerType) => {
    const current = settlements[i]!
    const when: Reaction['when'] =
      type === 'at'
        ? { type: 'at', ms: lifecycleAtMs(current, durationMs) }
        : type === 'condition'
          ? { type: 'watch', of: '', on: 'change' }
          : { type, of: componentOptions[0]?.value ?? '' }
    patchAt(i, { ...current, when })
  }

  useEffect(() => {
    if (focusAnchorRevision == null || focusedIndex == null) return
    itemRefs.current[focusedIndex]?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, [focusAnchorRevision])

  useEffect(() => {
    if (focusedIndex != null && focusedIndex >= settlements.length) onFocusIndex?.(null)
  }, [focusedIndex, settlements.length, onFocusIndex])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {settlements.length === 0 ? <div style={{ fontSize: 11, opacity: 0.6 }}>无结算</div> : null}
      {settlements.map((r, i) => {
        const atMs = lifecycleAtMs(r, durationMs)
        const legacy = isLifecycle(r) ? legacyPhaseHint(r) : null
        const triggerType = settlementTriggerType(r)
        const watchWhen = r.when.type === 'watch' ? r.when : null
        const stateWhen = r.when.type === 'state' ? r.when : null
        const conditionMode = stateWhen ? 'state' : (watchWhen?.on ?? 'change')
        const componentWhen = r.when.type === 'shown' || r.when.type === 'hidden' ? r.when : null
        const focused = focusedIndex === i
        return (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el }}
            data-lifecycle-effect-index={i}
            data-settlement-index={i}
            data-selected={focused ? 'true' : 'false'}
            onClick={(event) => {
              if (isSettlementControlTarget(event.target)) return
              onFocusIndex?.(i)
            }}
            style={{
              border: `1px solid ${focused ? '#5ad4c0' : '#2a2a2a'}`,
              borderRadius: 6,
              padding: 6,
              transition: 'border-color 120ms ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
              <select
                value={triggerType}
                onChange={(e) => setType(i, e.target.value as SettlementTriggerType)}
                style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}
                title="触发条件"
              >
                {(Object.keys(SETTLEMENT_TRIGGER_LABEL) as SettlementTriggerType[]).map((type) => (
                  <option key={type} value={type}>{SETTLEMENT_TRIGGER_LABEL[type]}</option>
                ))}
              </select>
              <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => removeAt(i)}>
                删除结算
              </button>
            </div>
            {triggerType === 'at' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 12, opacity: 0.8, flexShrink: 0 }}>播到</span>
                <LooseNumberInput
                  value={atMs}
                  emptyValue={0}
                  title={durationMs ? `本节点演出 ${durationMs}ms` : undefined}
                  onChange={(value) => patchAt(i, { ...r, when: { type: 'at', ms: Math.max(0, value) } })}
                  style={{ width: 88, minWidth: 0 }}
                />
                <span style={{ fontSize: 11, opacity: 0.65, flexShrink: 0 }}>ms</span>
              </span>
            ) : null}
            {watchWhen || stateWhen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {row('条件类型', (
                  <select
                    aria-label="条件类型"
                    value={conditionMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'change' | 'inc' | 'dec' | 'state'
                      const when: Reaction['when'] = mode === 'state'
                        ? { type: 'state', condition: stateWhen?.condition ?? { all: [] } }
                        : {
                            type: 'watch',
                            of: watchWhen?.of ?? (stateWhen ? watchPathFromCondition(stateWhen.condition) : ''),
                            on: mode,
                          }
                      patchAt(i, { ...r, when })
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="change">数值变化</option>
                    <option value="inc">数值增加</option>
                    <option value="dec">数值减少</option>
                    <option value="state">条件满足</option>
                  </select>
                ))}
                {watchWhen ? (
                  <WatchFieldEditor
                    tree={fieldTree}
                    value={watchWhen.of}
                    onChange={(of) => patchAt(i, { ...r, when: { ...watchWhen, of } })}
                  />
                ) : null}
                {stateWhen ? (
                  <ConditionEditor
                    value={stateWhen.condition}
                    nodeIds={nodeOptions.map((option) => option.value)}
                    pickers={pickers}
                    entities={entities}
                    variables={variables}
                    onChange={(condition) => patchAt(i, {
                      ...r,
                      when: { type: 'state', condition: condition ?? { all: [] } },
                    })}
                  />
                ) : null}
              </div>
            ) : null}
            {componentWhen ? row('界面', (
              <select
                value={componentWhen.of}
                onChange={(e) => patchAt(i, { ...r, when: { type: componentWhen.type, of: e.target.value } })}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">（选界面）</option>
                {componentWhen.of && !componentOptions.some((option) => option.value === componentWhen.of) ? (
                  <option value={componentWhen.of}>{componentWhen.of}（旧配置）</option>
                ) : null}
                {componentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )) : null}
            {legacy ? <div style={{ fontSize: 10, color: '#e8b339', marginBottom: 4 }}>{legacy}</div> : null}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '8px 0 4px' }}>动作</div>
            <NodeActionsEditor
              actions={r.do}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={pickers}
              allowSpawn={triggerType === 'condition'}
              allowHideOverlay={triggerType === 'condition'}
              defaultSpawnTtlMs={1200}
              hideOverlayOptions={hideOverlayOptions}
              onCreateEntityAttribute={onCreateEntityAttribute}
              onCreateEntity={onCreateEntity}
              onCreateVariable={onCreateVariable}
              onCreateFormula={onCreateFormula}
              renderAdvance={(action, actionIndex) => {
                const edge = action.edgeId ? advanceEdgeFor(action.edgeId) : undefined
                return (
                  <>
                    <AdvanceTargetRow
                      sourceLabel={sourceLabel}
                      currentTarget={advanceTargetFor(action.edgeId)}
                      nodeOptions={nodeOptions}
                      onChange={(targetId) => onAdvanceTargetChange(i, actionIndex, targetId)}
                    />
                    {edge ? (
                      <RouteTimingEditor
                        edge={edge}
                        routingSettlement={routingSettlement}
                        defaultAtMs={atMs}
                        onChange={(transition, settlement) => onSetAdvanceTiming(action.edgeId, transition, settlement)}
                      />
                    ) : null}
                  </>
                )
              }}
              onChange={(actions) => {
                const advanceIndex = r.do.findIndex((action) => action.kind === 'advance')
                if (advanceIndex >= 0 && !actions.some((action) => action.kind === 'advance')) {
                  onAdvanceTargetChange(i, advanceIndex, '')
                  return
                }
                patchAt(i, { ...r, do: actions })
              }}
            />
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => {
          const nextIndex = settlements.length
          commit([...settlements, {
            when: { type: 'at', ms: Math.max(0, Math.round(insertMs ?? 0)) },
            do: [{ kind: 'effect', effects: [createDefaultEffect('attr', entities ?? pickers?.entities, variables ?? pickers?.variables)] }],
          }])
          onFocusIndex?.(nextIndex)
        }}
      >
        ＋ 结算
      </button>
    </div>
  )
}

function OverlayReactionsEditor({
  events,
  catalogReactions,
  reactions,
  edgeOptions,
  routeHints,
  spawnOptions,
  overlays,
  pickers,
  labelWidth,
  entities,
  variables,
  nodeOptions,
  graph,
  nodeId,
  onChange,
  onRouteTo,
  routingSettlement,
  onSetRouteTiming,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: {
  events: OverlayEventRef[]
  catalogReactions?: OverlayReaction[]
  reactions: Reaction[] | undefined
  edgeOptions: OptItem[]
  /** eventId → 出边目标摘要（有 advance 或默认推进时都能看见去哪）。 */
  routeHints?: Record<string, string>
  spawnOptions: OptItem[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  labelWidth: string
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 目标节点下拉（不含当前节点）。 */
  nodeOptions: OptItem[]
  graph: GameGraph
  nodeId: string
  onChange: (next: Reaction[] | undefined) => void
  /** 选目标节点：upsert 边 + 本挂载 advance；空串 = 清除该出口边。 */
  onRouteTo: (ev: OverlayEventRef, targetId: string) => void
  routingSettlement?: RoutingSettlement
  onSetRouteTiming: (
    ev: OverlayEventRef,
    transition: 'immediate' | 'onSettlement',
    settlement?: RoutingSettlement,
  ) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}): JSX.Element | null {
  if (!events.length) return null
  const catalog = pickers ?? { entities, variables }
  return (
    <div style={{ marginTop: 4 }}>
      {sectionLabel('事件响应')}
      <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2, lineHeight: 1.4 }}>
        目录动作先执行，挂载动作按顺序追加；选目标节点会同步写出边。
      </div>
      <ComponentEventsEditor
        mode="mount"
        events={events}
        catalogReactions={catalogReactions}
        mountReactions={reactions}
        edgeOptions={edgeOptions}
        spawnOptions={spawnOptions}
        overlays={overlays}
        pickers={catalog}
        labelWidth={labelWidth}
        allowSpawn={false}
        onCreateEntityAttribute={onCreateEntityAttribute}
        onCreateEntity={onCreateEntity}
        onCreateVariable={onCreateVariable}
        onCreateFormula={onCreateFormula}
        onMountActionsChange={(event, actions) => onChange(upsertEventReaction(reactions, event, actions))}
        renderRoute={(event) => {
          const actions = eventReactionDo(reactions, event)
          const pool = handleEdges(graph, nodeId, event.localEventId)
          const advance = actions.find((action): action is Extract<NodeAction, { kind: 'advance' }> => action.kind === 'advance')
          const advanceEdge = advance ? graph.edges.find((edge) => edge.id === advance.edgeId) : undefined
          const multiPool = pool.length > 1
          const currentTarget = multiPool ? '' : (advanceEdge?.target ?? (pool.length === 1 ? pool[0]!.target : ''))
          const routeEdge = advanceEdge ?? pool[0]
          const hint = routeHints?.[event.localEventId] ?? routeHints?.[event.eventId]
          const sourceNode = graph.nodes.find((candidate) => candidate.id === nodeId)
          const sourceLabel = sourceNode ? authoringOptionLabel(sourceNode.data.name, sourceNode.id) : nodeId
          return (
            <div style={{ marginTop: 6 }}>
              {multiPool ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: 4, fontSize: 12 }}>
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>从</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sourceLabel}>{sourceLabel}</span>
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>到</span>
                  <span style={{ fontSize: 11, color: '#ce9178', minWidth: 0 }}>多目标边池（{pool.length}）· 请在「出边」调整 {hint ?? ''}</span>
                </div>
              ) : (
                <AdvanceTargetRow
                  sourceLabel={sourceLabel}
                  currentTarget={currentTarget}
                  nodeOptions={nodeOptions}
                  onChange={(targetId) => onRouteTo(event, targetId)}
                />
              )}
              {routeEdge ? (
                <RouteTimingEditor
                  edge={routeEdge}
                  routingSettlement={routingSettlement}
                  onChange={(transition, settlement) => onSetRouteTiming(event, transition, settlement)}
                />
              ) : null}
            </div>
          )
        }}
      />
    </div>
  )
}

// ── watch 字段级联选择（对象 → 字段 → …，最多 5 层）+ 手动输入 ────────────────────
/** 字段树节点：seg 拼进 expr 路径；有 children 则可继续下钻，叶子即完整路径。 */
export interface FieldNode {
  seg: string
  label: string
  children?: FieldNode[]
}

/** 由 scenario 的实体/变量派生可监听字段树：entity.<id>.attr.<name> / var.<id> / score。 */
function buildFieldTree(
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): FieldNode[] {
  const ents: FieldNode[] = Object.values(entities ?? {}).map((e) => ({
    seg: e.id,
    label: authoringOptionLabel(e.name, e.id),
    children: [
      {
        seg: 'attr',
        label: '属性',
        children: Object.keys(e.attrs ?? {}).map((a) => ({
          seg: a,
          label: authoringOptionLabel(e.attrMeta?.[a]?.label, a),
        })),
      },
    ],
  }))
  const vars: FieldNode[] = Object.values(variables ?? {}).map((v) => ({
    seg: v.id,
    label: authoringOptionLabel(v.name, v.id),
  }))
  return [
    { seg: 'entity', label: '实体', children: ents },
    { seg: 'var', label: '变量', children: vars },
    { seg: 'score', label: '分数' },
  ]
}

/** 路径 segs 是否能在字段树中逐级命中（决定默认走级联还是手动）。 */
function pathInTree(tree: FieldNode[], path: string): boolean {
  if (!path) return true
  let opts: FieldNode[] | undefined = tree
  for (const seg of path.split('.')) {
    const hit: FieldNode | undefined = opts?.find((o) => o.seg === seg)
    if (!hit) return false
    opts = hit.children
  }
  return true
}

const MAX_FIELD_LEVELS = 5

/** watch.of 编辑：级联下拉（选对象→选字段…）+ 手动输入兜底。 */
function WatchFieldEditor({
  tree,
  value,
  onChange,
}: {
  tree: FieldNode[]
  value: string
  onChange: (path: string) => void
}): JSX.Element {
  const [manual, setManual] = useState<boolean>(!!value && !pathInTree(tree, value))
  const segs = value ? value.split('.') : []
  // 逐层收集可选项：level0=根；选中且有 children 才展开下一层。
  const levels: Array<{ opts: FieldNode[]; cur: string }> = []
  let opts: FieldNode[] | undefined = tree
  let depth = 0
  while (opts && opts.length && depth < MAX_FIELD_LEVELS) {
    const cur = segs[depth] ?? ''
    levels.push({ opts, cur })
    const hit: FieldNode | undefined = opts.find((o) => o.seg === cur)
    if (!hit) break
    opts = hit.children
    depth++
  }
  const pick = (level: number, seg: string) => {
    const next = seg ? [...segs.slice(0, level), seg] : segs.slice(0, level)
    onChange(next.join('.'))
  }
  return (
    <>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
        <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>字段</span>
        <label style={{ fontSize: 11, opacity: 0.7, display: 'flex', gap: 3, alignItems: 'center' }}>
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> 手动
        </label>
      </label>
      {manual ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="entity.ent-boss.attr.hp"
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {levels.map((lv, k) => (
            <select
              key={k}
              value={lv.cur}
              onChange={(e) => pick(k, e.target.value)}
              style={{ fontSize: 12, maxWidth: 150 }}
            >
              <option value="">{k === 0 ? '（选对象）' : '（选字段）'}</option>
              {lv.opts.map((o) => <option key={o.seg} value={o.seg}>{o.label}</option>)}
            </select>
          ))}
          <span style={{ fontSize: 11, opacity: 0.5, alignSelf: 'center', fontFamily: 'monospace' }}>{value || '—'}</span>
        </div>
      )}
    </>
  )
}

/** 单条出边编辑：目标优先 → 条件可选 → 交互出口可选（默认可默认推进）。 */
function EdgeRouteEditor({
  edge,
  nodeIds,
  nodeLabel,
  flowHandleOptions,
  pickers,
  entities,
  variables,
  onReconnect,
  onPatchData,
  onDelete,
}: {
  edge: import('../../runtime/schema/graph-schema').GameEdge
  nodeIds: string[]
  nodeLabel: (id: string) => string
  flowHandleOptions: Array<{ value: string; label: string }>
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onReconnect: (patch: { target?: string; sourceHandle?: string }) => void
  onPatchData: (data: import('../../runtime/schema/graph-schema').EdgeRouting) => void
  onDelete: () => void
}): JSX.Element {
  const handleVal = edge.sourceHandle ?? 'default'
  const inList = flowHandleOptions.some((h) => h.value === handleVal)
  const [customMode, setCustomMode] = useState(!inList)

  return (
    <div style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }}>
      {row('目标', (
        <select value={edge.target} onChange={(ev) => onReconnect({ target: ev.target.value })} style={{ flex: 1 }}>
          {nodeIds.map((id) => <option key={id} value={id}>{nodeLabel(id)}</option>)}
        </select>
      ))}
      <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>条件（可选；空 = 恒真，自动推进时可用）</div>
      <ConditionEditor
        value={edge.data?.condition}
        nodeIds={nodeIds}
        pickers={pickers}
        entities={entities}
        variables={variables}
        onChange={(condition) => onPatchData({ condition: condition as GraphCondition })}
      />
      {row('交互出口', (
        <select
          value={customMode ? '__custom__' : handleVal}
          onChange={(ev) => {
            const v = ev.target.value
            if (v === '__custom__') {
              setCustomMode(true)
              return
            }
            setCustomMode(false)
            onReconnect({ sourceHandle: v })
          }}
          style={{ flex: 1 }}
          title="默认推进即可连线跑通；选项/QTE 结果分支再改"
        >
          {flowHandleOptions.map((h) => (
            <option key={h.value} value={h.value}>{h.label}</option>
          ))}
          <option value="__custom__">自定义…</option>
        </select>
      ))}
      {customMode ? row('出口 id', (
        <input
          value={handleVal}
          onChange={(ev) => onReconnect({ sourceHandle: ev.target.value.trim() || 'default' })}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
          placeholder="default / ying / pass …"
          title="与交互 outcome 同名才会被点选命中；否则播完仍走默认推进边"
        />
      )) : null}
      {row('权重', (
        <input
          type="number"
          value={edge.data?.weight ?? ''}
          onChange={(ev) => {
            const value = ev.target.value
            onPatchData({ weight: value === '' ? undefined : Number(value) })
          }}
          style={{ flex: 1 }}
          placeholder="未设"
          title="多条无条件默认推进边时按权重随机；留空表示未设"
        />
      ))}
      <button type="button" style={{ color: '#ff6b6b', marginTop: 4 }} onClick={onDelete}>🗑 删除边</button>
    </div>
  )
}

/** 节点「视频」下拉项：id 写入 media.ref；label 仅展示。 */
export interface VideoOption {
  id: string
  label: string
}

export function NodeInspector({
  graph,
  nodeId,
  videoOptions = [],
  audioOptions = [],
  packs = [],
  isRefAllowed,
  overlays,
  entities,
  variables,
  formulas,
  focusedMountId,
  focusedLifecycleIndex,
  settlementInsertMs,
  focusAnchorRevision,
  onFocusMount,
  onFocusLifecycle,
  previewOpen,
  onTogglePreview,
  onChange,
  onPacksChange,
  onEnsureOverlay,
  onDropOverlayIfOrphan,
  onRemoveMount,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  onJump,
}: {
  graph: GameGraph
  nodeId: string | null
  videoOptions?: VideoOption[]
  /** 作用域 BGM 的音频资产候选（Kino media_type=audio，与资产库一致）；与「视频」下拉同款。 */
  audioOptions?: AudioOption[]
  /** 本局子蓝图包（随 scenario 保存）。 */
  packs?: readonly SubFlowPackDef[]
  /**
   * 某个既有蓝图 id 能否被当前编辑的蓝图引用（自引用 + 会成环的候选均应返回 false）——
   * 上层（GraphStudio）有 store 访问权，据此算好再传下来，本组件不深挖 store。
   * 未传则不做任何过滤（兜底旧行为）。
   */
  isRefAllowed?: (packId: string) => boolean
  overlays?: Record<string, Overlay>
  /** 场景实体 / 变量目录（供 effects / condition 下拉、选取式公式与 watch 字段级联下拉）。 */
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 公式库（「规则 → 公式」维护）；供 effects/numberExpr 数值字段开出「应用公式」模式。 */
  formulas?: Record<string, Formula>
  /**
   * 预览台当前聚焦的挂载 id（覆盖物）。非空时右侧只展开该挂载的配置卡片，其余折叠为标题行；
   * 空 = 平铺展开全部挂载（默认）。
   */
  focusedMountId?: string | null
  /** 预览台时间轴当前选中的结算（子集序号）；本区域据此高亮对应配置块。 */
  focusedLifecycleIndex?: number | null
  /** 新增定时结算的插入时刻；没有时间轴选中时省略并回落到 0ms。 */
  settlementInsertMs?: number
  /** 每次从预览/时间轴发起选中都会递增；确保重复选同一项也重新滚动。 */
  focusAnchorRevision?: number
  /** 点击某挂载卡片标题时上抛（与预览台双向联动）；再次点同一张 = 取消聚焦（回到全展开）。 */
  onFocusMount?: (mountId: string | null) => void
  /** 点击某条结算时上抛（与时间轴菱形双向联动）。 */
  onFocusLifecycle?: (lifecycleIndex: number | null) => void
  /** 宿主左侧预览区当前是否展开（驱动头部弧形把手的朝向与文案）。 */
  previewOpen?: boolean
  /** 传了才渲染头部弧形把手：切换宿主左侧预览区的展开/收起。 */
  onTogglePreview?: () => void
  onChange: (g: GameGraph) => void
  onPacksChange?: (packs: SubFlowPackDef[]) => void
  /**
   * 挂载预设方案前：若目录里还没有该 overlay，上层写入固化原型（缺失才补）。
   * 未传则仅能挂载当前 `overlays` 里已有的方案。
   */
  onEnsureOverlay?: (overlay: Overlay) => void
  /**
   * 卸载某挂载后，请上层用完整 scenario（主图 + 所有子蓝图包）判断该 overlay 是否已无人引用，
   * 无引用则清理孤儿副本。本组件只看得到 canvasGraph，无法自行判断跨图引用，故上抛。
   */
  onDropOverlayIfOrphan?: (overlayId: string) => void
  /**
   * 移除覆盖物挂载（优先走 scenario 级 `removeMountGraph`，级联清掉组件跳转边与结算）。
   * 未传则回落为只改 `overlayNodes`（旧行为，边会残留）。
   */
  onRemoveMount?: (mountId: string) => void
  /** 新血条绑定缺失 hp 时，经面板二次确认后补建到场景实体目录。 */
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  /** 新血条没有可选实体时，经面板二次确认后补建到场景实体目录。 */
  onCreateEntity?: EntityCreateHandler
  /** 新组件动态值缺少变量时，经级联确认后补建到场景变量目录。 */
  onCreateVariable?: VariableCreateHandler
  /** 新组件动态值缺少公式时，经级联确认后补建到场景公式目录。 */
  onCreateFormula?: FormulaCreateHandler
  onJump?: (id: string) => void
}): JSX.Element {
  // 「音乐动作」在还没选曲子时也得选得动：没有 ref 的 push / replace 落不了盘（volume-only
  // 配置只表达音量，不携带播放动作），所以空态下下拉会自己弹回「起播」。落不了盘的那一步先记在这儿，等作者选了
  // 曲子再随 ref 一起写进去。换节点 = 换一份草稿。
  const [draftBgmMode, setDraftBgmMode] = useState<'push' | 'replace'>('push')
  const [draftBgmModeNode, setDraftBgmModeNode] = useState(nodeId)
  /** 「嵌套=子蓝图」但尚未挂包：不落盘空指针/不自动建库，只撑住面板模式。 */
  const [packModeUnbound, setPackModeUnbound] = useState(false)
  if (nodeId !== draftBgmModeNode) {
    setDraftBgmModeNode(nodeId)
    setDraftBgmMode('push')
    setPackModeUnbound(false)
  }
  const mountCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (focusAnchorRevision == null || !focusedMountId) return
    mountCardRefs.current[focusedMountId]?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, [focusAnchorRevision])
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || !nodeId) return <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>点画布上的节点以编辑</div>
  const d = node.data
  const nodeIds = graph.nodes.map((n) => n.id)
  /** 下拉展示：中文名称只显示名称；没有中文名称时保留 id 兜底。 */
  const nodeLabel = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    return authoringOptionLabel(n?.data.name, id)
  }
  // 「默认样式 / ＋ 挂载」与界面 tab 保持同一份列表：自定义覆盖物 + 基础覆盖物（打平），
  // 直接从 live overlays 派生（见 builtin-schemes），不再用固化的 PRESET_SCHEME_OVERLAYS。
  const schemeOverlayIds = listSchemeAndBaseOverlayIds(overlays)
  const mediaRef = d.media?.ref ?? ''
  const selectedVideoValue = mediaRef && !videoOptions.some((option) => option.id === mediaRef)
    ? '__unavailable__'
    : mediaRef
  const bgmRef = d.bgm?.ref ?? ''
  const selectedAudioValue = bgmRef && !audioOptions.some((option) => option.id === bgmRef)
    ? '__unavailable__'
    : bgmRef

  const nestProcess = getSubProcess(d)
  const nestPack = getSubFlowPack(d)
  const nestMode: 'none' | 'process' | 'pack' = nestPack
    ? 'pack'
    : nestProcess
      ? 'process'
      : packModeUnbound
        ? 'pack'
        : 'none'
  /** 只有容器不是演出节点；入口仍是可完整配置的第一个业务节点。 */
  const canConfigurePerformance = nestMode === 'none'
  // 作用域 BGM：读原始值（不过 getNodeBgm），与面板下拉一致。
  const bgm = d.bgm
  // 手写/AI 生成的非法 mode 在下拉里显示成 push（validate 会把它判 error），别让 select 变成
  // 「什么都没选」的空框。还没有配置时读本地草稿——见组件顶部 `draftBgmMode`。
  const bgmMode: 'push' | 'replace' | 'stop' = bgm?.mode === 'replace' || bgm?.mode === 'stop'
    ? bgm.mode
    : bgm?.ref ? 'push' : draftBgmMode
  const packKey = nestPack
    ? (nestPack.version ? `${nestPack.id}@${nestPack.version}` : nestPack.id)
    : ''
  const packLabel = (p: SubFlowPackDef) => {
    const key = `${p.id}@${p.version}`
    return authoringOptionLabel(p.title, key)
  }
  /** 下拉候选：排除自引用 + 会成环的候选（`isRefAllowed`）；已挂载的当前包永远保留展示，避免选中项丢失。 */
  const eligiblePacks = packs.filter((p) => p.id === nestPack?.id || !isRefAllowed || isRefAllowed(p.id))

  // 结算选项（带组件中文名 label）：shown/hidden 的界面 = 本节点各挂载 overlay 的 children。
  const compLabel = (component: string) => getComponentManifest(component)?.label ?? component
  const componentOptions: OptItem[] = (d.overlayNodes ?? []).flatMap((m) => {
    const mountId = overlayMountId(m)
    const overlayTitle = overlays?.[m.overlay]?.title?.trim() || PRESET_SCHEME_BY_ID[m.overlay]?.title?.trim()
    return resolveMountChildren(overlays, m).map((c) => {
      const value = `${mountId}/${c.id}`
      const names = [overlayTitle, compLabel(c.component)].filter((part, index, all) => part && all.indexOf(part) === index)
      return { value, label: authoringOptionLabel(names.join(' · '), value) }
    })
  })
  const hideOverlayOptions: OptItem[] = (d.overlayNodes ?? []).map((mount) => {
    const mountId = overlayMountId(mount)
    return { value: mountId, label: authoringOptionLabel(overlayDisplayLabel(mount.overlay, overlays), mountId) }
  })
  // spawn 模板只列界面方案（排除 node:* 本地内容容器 / 历史 fork）。
  const spawnOptions: OptItem[] = Object.values(overlays ?? {})
    .filter((o) => !o.id.startsWith('node:'))
    .flatMap((o) =>
      o.children.map((c) => {
        const value = `${o.id}/${c.id}`
        const names = [o.title?.trim(), compLabel(c.component)].filter((part, index, all) => part && all.indexOf(part) === index)
        return { value, label: authoringOptionLabel(names.join(' · '), value) }
      }),
    )
  const fieldTree = buildFieldTree(entities, variables)
  const pickers: EditorPickerCtx = { entities, variables, formulas, nodeLabel }
  const flowHandleOptions = (() => {
    const extra = graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.sourceHandle ?? 'default')
    return mergeFlowHandles(deriveOutputs(node, overlays), extra)
  })()
  const edgeOptions: OptItem[] = graph.edges
    .filter((e) => e.source === node.id)
    .map((e) => ({
      value: e.id,
      label: `${flowHandleDisplay(e.sourceHandle ?? 'default')} → ${nodeLabel(e.target)}`,
    }))
  /** 每个交互出口 → 目标节点摘要（单边 `→ X`，多边 `→ A | B`）。 */
  const routeHints = (() => {
    const byHandle = new Map<string, string[]>()
    for (const e of graph.edges) {
      if (e.source !== node.id) continue
      const h = e.sourceHandle ?? 'default'
      const list = byHandle.get(h) ?? []
      list.push(nodeLabel(e.target))
      byHandle.set(h, list)
    }
    const out: Record<string, string> = {}
    for (const [h, labels] of byHandle) {
      if (h === 'default') continue
      out[h] = labels.length === 1 ? `→ ${labels[0]}` : `→ ${labels.join(' | ')}（边池）`
    }
    return out
  })()

  const patchData = (p: NodeDataPatch) => onChange(updateNodeData(graph, node.id, p))
  /** added 组件直接改自身；方案原型组件只保存相对方案的字段级差量。 */
  const setChildInputs = (mountIndex: number, childId: string, nextInputs: Record<string, unknown>) => {
    const mounts = [...(d.overlayNodes ?? [])]
    const mount = mounts[mountIndex]
    if (!mount) return
    const addedIndex = mount.added?.findIndex((child) => child.id === childId) ?? -1
    if (addedIndex >= 0) {
      const added = [...(mount.added ?? [])]
      added[addedIndex] = { ...added[addedIndex]!, inputs: nextInputs }
      mounts[mountIndex] = { ...mount, added }
      patchData({ overlayNodes: mounts })
      return
    }

    const base = overlays?.[mount.overlay]?.children.find((child) => child.id === childId)
    if (!base) return
    const sparseInputs = sparseOverlayInputOverride(base.inputs, nextInputs)
    const prev = mount.overrides?.[childId]
    const nextPatch: Partial<OverlayChild> = { ...prev }
    if (Object.keys(sparseInputs).length > 0) nextPatch.inputs = sparseInputs
    else delete nextPatch.inputs

    const overrides = { ...mount.overrides }
    if (Object.keys(nextPatch).length > 0) overrides[childId] = nextPatch
    else delete overrides[childId]
    mounts[mountIndex] = { ...mount, overrides: Object.keys(overrides).length ? overrides : undefined }
    patchData({ overlayNodes: mounts })
  }
  const targetNodeOptions: OptItem[] = nodeIds
    .filter((id) => id !== node.id)
    .map((id) => ({ value: id, label: nodeLabel(id) }))
  const setNestMode = (mode: 'none' | 'process' | 'pack') => {
    if (mode === 'none') {
      if (nestProcess && typeof confirm === 'function' && !confirm('取消内嵌子流程会删除其中的全部节点和连线，继续吗？')) return
      setPackModeUnbound(false)
      patchData({ subProcess: undefined, subFlowPack: undefined })
      return
    }
    if (mode === 'process') {
      setPackModeUnbound(false)
      onChange(attachSubProcess(graph, node.id))
      return
    }
    // 子蓝图：只切模式，不自动建库、不预挂第一个候选；挂包走下拉或「＋ 新建子蓝图」。
    if (nestPack) {
      setPackModeUnbound(false)
      patchData({ subProcess: undefined })
      return
    }
    setPackModeUnbound(true)
    patchData({ subProcess: undefined, subFlowPack: undefined })
  }
  const createAndAttachPack = () => {
    if (!onPacksChange) return
    const pack = makeEmptySubFlowPack({ title: `${d.name || node.id}·子蓝图` })
    setPackModeUnbound(false)
    onPacksChange([...packs, pack])
    patchData({ subProcess: undefined, subFlowPack: { id: pack.id, version: pack.version } })
  }
  return (
    // 根上刻意不设 overflow：一旦它成为滚动容器，下方吸顶头部条就只相对它定位——而它高度随内容、
    // 永不自己滚动，吸顶会失效。真正的滚动容器是宿主外层（GraphStudio：flex 1 0 400px + overflow:auto）。
    <div style={{ padding: 10, fontSize: 12 }}>
      {/* 头部条吸顶：配置项很长，滚到底部时仍要能点「从此试玩」/「删除节点」。
          负 margin 抵掉根 padding，让它吸顶时铺满面板宽度并盖住下方滚过的内容（故需不透明底色）。 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          margin: '-10px -10px 8px',
          padding: '10px 10px 8px',
          background: 'var(--work, #0e0c09)',
          borderBottom: '1px solid #2e2924',
        }}
      >
        {/* 预览区开关：对齐宿主侧栏折叠按钮（lucide panel-left-close / panel-left-open，本包无
            图标库，图标手写 inline SVG——与 GraphCanvas 的 Ico 同款做法）。 */}
        {onTogglePreview ? (
          <button
            type="button"
            className={ICON_BTN_CLASS}
            onClick={onTogglePreview}
            aria-expanded={!!previewOpen}
            aria-label={previewOpen ? '收起预览区' : '展开预览区'}
            title={previewOpen ? '收起左侧预览区' : '展开左侧预览区'}
            // 按钮无 padding（尺寸=图标），只需抵掉 svg viewBox 内缩（rect x=3 → 16px 下约 2px），
            // 让图标可见左缘落在表单内容列（节点标题 / 各区标题都从这一列起）上。
            style={{ marginLeft: -2 }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              {previewOpen ? <path d="m16 15-3-3 3-3" /> : <path d="m14 9 3 3-3 3" />}
            </svg>
          </button>
        ) : null}
        <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>节点 {node.id}</b>
        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onJump?.(node.id)}
            title="从此节点试玩；浮层重开回到该节点（不改图、不设为起点）"
          >
            ▶ 从此试玩
          </button>
          <button
            style={{ color: '#ff6b6b' }}
            onClick={() => {
              if (confirm(`删除节点「${node.data.name}」及其相关连线？`)) onChange(removeNode(graph, node.id))
            }}
          >
            🗑 删除节点
          </button>
        </span>
      </div>

      {row('名称', <input value={d.name} onChange={(e) => patchData({ name: e.target.value })} style={{ flex: 1 }} />)}
      {canConfigurePerformance && row('视频', (
        <select
          value={selectedVideoValue}
          onChange={(e) => patchData({ media: e.target.value ? { kind: 'VIDEO', ref: e.target.value } : undefined })}
          style={{ flex: 1 }}
          title="选择该演出节点播放的视频（与视频素材库一致，仅显示 Kino 接口资源）"
        >
          {selectedVideoValue === '__unavailable__' ? (
            <option value="__unavailable__" disabled>（当前视频不在素材库）</option>
          ) : null}
          <option value="">（无演出）</option>
          {videoOptions.map((option) => (
            <option key={option.id} value={option.id}>{authoringOptionLabel(option.label, option.id)}</option>
          ))}
        </select>
      ))}
      {canConfigurePerformance && row('播放', (
        <select value={d.mediaPlayMode ?? 'once'} onChange={(e) => patchData({ mediaPlayMode: e.target.value as 'once' | 'loop' })}>
          <option value="once">播放一次</option>
          <option value="loop">循环</option>
        </select>
      ))}
      {row('嵌套', (
        <select
          value={nestMode}
          onChange={(e) => setNestMode(e.target.value as 'none' | 'process' | 'pack')}
          style={{ flex: 1 }}
          title="无 / 私有内嵌子流程 / 外部子蓝图（互斥）"
        >
          <option value="none">无</option>
          <option value="process">内嵌子流程</option>
          <option value="pack">子蓝图</option>
        </select>
      ))}
      {nestMode === 'process' && row('子流程入口', (
        <span style={{ flex: 1, opacity: 0.85 }} title="入口属于容器私有子图，不可跨层连接">
          {nestProcess?.entry ?? '（未绑定）'}
        </span>
      ))}
      {nestMode === 'pack' && (
        <>
          {row('子蓝图包', (
            <select
              value={packKey}
              onChange={(e) => {
                const v = e.target.value
                if (!v) {
                  setPackModeUnbound(true)
                  patchData({ subFlowPack: undefined })
                  return
                }
                const pack = packs.find((p) => `${p.id}@${p.version}` === v || p.id === v)
                if (!pack) return
                if (isRefAllowed && pack.id !== nestPack?.id && !isRefAllowed(pack.id)) {
                  alert(`不能引用「${pack.title ?? pack.id}」：会造成蓝图引用环（自身或间接引用回本蓝图）。`)
                  return
                }
                setPackModeUnbound(false)
                patchData({ subProcess: undefined, subFlowPack: { id: pack.id, version: pack.version } })
              }}
              style={{ flex: 1 }}
              title="引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑"
            >
              <option value="">无</option>
              {eligiblePacks.map((p) => (
                <option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{packLabel(p)}</option>
              ))}
            </select>
          ))}
          {row('', (
            <button type="button" onClick={createAndAttachPack} disabled={!onPacksChange} title="新建空子蓝图并挂到本节点">
              ＋ 新建子蓝图
            </button>
          ))}
        </>
      )}

      {canConfigurePerformance ? (
        <>
      {/* 覆盖物挂载 + reactions（每挂载一份） */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <b>界面</b>
          <select
            value=""
            onChange={(e) => {
              const oid = e.target.value
              if (!oid) return
              const mounts = [...(d.overlayNodes ?? [])]
              // 目录缺失时先写入固化原型，再挂载（否则聚合事件/预览会空）。
              if (!overlays?.[oid]) {
                const preset = PRESET_SCHEME_BY_ID[oid]
                if (preset) onEnsureOverlay?.(structuredClone(preset))
              }
              const definition = overlays?.[oid] ?? PRESET_SCHEME_BY_ID[oid]
              const layout = resolveMountLayoutForChildren(
                undefined,
                definition?.children.map((child) => child.layout) ?? [],
              )
              const created = createOverlayMount(mounts, oid)
              mounts.push({ ...created, ...(layout ? { layout } : {}) })
              patchData({ overlayNodes: mounts })
            }}
            title="从目录追加一张 overlay 挂载（常驻：全部组件同时生效，适合 HUD）；含内置画廊与 nodia 界面方案"
            style={{ maxWidth: 140, fontSize: 11 }}
          >
            <option value="">＋ 添加界面</option>
            {schemeOverlayIds.map((id) => (
              <option key={id} value={id}>{overlayDisplayLabel(id, overlays)}</option>
            ))}
          </select>
        </div>
        {(d.overlayNodes ?? []).length > 0 ? (
          (d.overlayNodes ?? []).map((mount, i) => {
            const mid = overlayMountId(mount)
            const multi = (d.overlayNodes?.length ?? 0) > 1
            // 事件列表跟挂载展开（含 overrides / added），与运行时一致。
            const mountChildren = resolveMountChildren(overlays, mount)
            const labelWidth = overlayConfigLabelWidth(mountChildren)
            const events = aggregateOverlayEvents(
              { id: mount.overlay, title: overlays?.[mount.overlay]?.title, children: mountChildren },
              getComponentManifest,
              { mountId: mid, prefixMount: multi },
            )
            const titleText = overlayDisplayLabel(mount.overlay, overlays)
            // 聚焦联动：有聚焦时只展开该挂载，其余折叠为标题行；无聚焦 = 全展开（默认）。
            const focused = focusedMountId === mid
            const expanded = !focusedMountId || focused
            return (
              <HoverCard
                key={`${mid}-${i}`}
                accent={focused}
                anchorId={`mount:${mid}`}
                anchorRef={(element) => { mountCardRefs.current[mid] = element }}
                header={(
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, cursor: onFocusMount ? 'pointer' : undefined }}
                    onClick={onFocusMount ? () => onFocusMount(focused ? null : mid) : undefined}
                    title={onFocusMount ? (focused ? '点击取消聚焦（展开全部覆盖物）' : '点击聚焦此覆盖物（在预览区高亮联动）') : undefined}
                  >
                    <span style={{ fontSize: 11, opacity: 0.5, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{titleText}</span>
                      <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
                        {mount.id && mount.id !== mount.overlay ? `模板 ${mount.overlay} · ` : null}
                        {mountChildren.length} 组件 · {events.length} 事件
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ color: '#ff6b6b', fontSize: 11, flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        const addedCount = mount.added?.length ?? 0
                        // 「添加控件」二级栏拖入的组件落在这份挂载的 added[] 里；移除挂载连带删除它们，先提示。
                        if (addedCount > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                          const ok = window.confirm(`将同时删除 ${addedCount} 个由此方案添加到时间轴的组件，是否确认移除挂载？`)
                          if (!ok) return
                        }
                        const removed = mount.overlay
                        if (onRemoveMount) {
                          // scenario 级卸挂载：级联清掉應默等组件占用的跳转边与结算（含 node:* 孤儿清理）。
                          onRemoveMount(mid)
                        } else {
                          const next = (d.overlayNodes ?? []).filter((_, j) => j !== i)
                          patchData({ overlayNodes: next.length ? next : undefined })
                          // 卸载节点专属副本（node:*）→ 交上层用完整 scenario 判断并清理孤儿。
                          if (removed.startsWith('node:')) onDropOverlayIfOrphan?.(removed)
                        }
                        if (focused) onFocusMount?.(null)
                      }}
                    >
                      移除
                    </button>
                  </div>
                )}
              >
                {expanded ? (
                  <>
                {mountChildren.length ? (
                  <div style={{ marginBottom: 4 }}>
                    {sectionLabel('组件参数')}
                    {mountChildren.map((child) => {
                      const inputs = (child.inputs ?? {}) as Record<string, unknown>
                      return (
                        <ComponentInputsDisclosure
                          key={child.id}
                          childId={child.id}
                          componentId={child.component}
                          values={inputs}
                          onChange={(next) => setChildInputs(i, child.id, next)}
                          pickers={pickers}
                          labelWidth={labelWidth}
                          controlWidth={OVERLAY_CONFIG_CONTROL_WIDTH}
                          onCreateEntityAttribute={onCreateEntityAttribute}
                          onCreateEntity={onCreateEntity}
                          onCreateVariable={onCreateVariable}
                          onCreateFormula={onCreateFormula}
                        />
                      )
                    })}
                  </div>
                ) : null}
                <OverlayReactionsEditor
                  events={events}
                  catalogReactions={overlays?.[mount.overlay]?.reactions}
                  reactions={mount.reactions}
                  edgeOptions={edgeOptions}
                  routeHints={routeHints}
                  spawnOptions={spawnOptions}
                  overlays={overlays}
                  pickers={pickers}
                  labelWidth={labelWidth}
                  entities={entities}
                  variables={variables}
                  nodeOptions={targetNodeOptions}
                  graph={graph}
                  nodeId={node.id}
                  onChange={(reactions) => {
                    const next = (d.overlayNodes ?? []).map((m, j) => (j === i ? { ...m, reactions } : m))
                    patchData({ overlayNodes: next })
                  }}
                  onRouteTo={(ev, targetId) => onChange(routeMountEventToNode(graph, node.id, i, ev, targetId))}
                  routingSettlement={d.routingSettlement}
                  onCreateEntityAttribute={onCreateEntityAttribute}
                  onCreateEntity={onCreateEntity}
                  onCreateVariable={onCreateVariable}
                  onCreateFormula={onCreateFormula}
                  onSetRouteTiming={(ev, transition, settlement) => onChange(
                    updateEventRouteTiming(graph, node.id, ev.localEventId, transition, settlement),
                  )}
                />
                  </>
                ) : null}
              </HoverCard>
            )
          })
        ) : null}
      </div>

      {/* 定时 / 条件 / 界面显隐统一为结算；底层仍是同一组 node.data.reactions。 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <b>结算</b>
        <LifecycleReactionsEditor
          reactions={d.reactions}
          sourceLabel={nodeLabel(node.id)}
          nodeOptions={targetNodeOptions}
          durationMs={d.durationMs}
          insertMs={settlementInsertMs}
          focusedIndex={focusedLifecycleIndex}
          focusAnchorRevision={focusAnchorRevision}
          onFocusIndex={onFocusLifecycle}
          pickers={pickers}
          entities={entities}
          variables={variables}
          advanceEdgeFor={(edgeId) => graph.edges.find((edge) => edge.id === edgeId)}
          advanceTargetFor={(edgeId) => graph.edges.find((edge) => edge.id === edgeId)?.target ?? ''}
          onAdvanceTargetChange={(settlementIndex, actionIndex, targetId) => onChange(
            setSettlementAdvanceTarget(graph, node.id, settlementIndex, actionIndex, targetId),
          )}
          routingSettlement={d.routingSettlement}
          onSetAdvanceTiming={(edgeId, transition, settlement) => {
            const edge = graph.edges.find((candidate) => candidate.id === edgeId)
            if (!edge) return
            onChange(updateEventRouteTiming(
              graph,
              node.id,
              edge.sourceHandle ?? 'default',
              transition,
              settlement,
            ))
          }}
          componentOptions={componentOptions}
          spawnOptions={spawnOptions}
          hideOverlayOptions={hideOverlayOptions}
          overlays={overlays}
          fieldTree={fieldTree}
          onCreateEntityAttribute={onCreateEntityAttribute}
          onCreateEntity={onCreateEntity}
          onCreateVariable={onCreateVariable}
          onCreateFormula={onCreateFormula}
          onChange={(reactions) => patchData({ reactions })}
        />
      </div>
        </>
      ) : null}

      {/* 出边：先连目标；条件可选；交互出口仅选项/QTE 等需要时再改 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>出边（走向）</b>
          <button
            type="button"
            onClick={() =>
              onChange(
                connect(graph, {
                  source: node.id,
                  sourceHandle: 'default',
                  target: nodeIds.find((x) => x !== node.id) ?? node.id,
                }),
              )
            }
            title="新增一条默认推进边，之后再补条件或改交互出口"
          >
            + 边
          </button>
        </div>
        {graph.edges.filter((e) => e.source === node.id).map((e) => (
          <EdgeRouteEditor
            key={e.id}
            edge={e}
            nodeIds={nodeIds}
            nodeLabel={nodeLabel}
            flowHandleOptions={flowHandleOptions}
            pickers={pickers}
            entities={entities}
            variables={variables}
            onReconnect={(patch) => onChange(reconnect(graph, e.id, patch))}
            onPatchData={(data) => onChange(updateEdgeData(graph, e.id, data))}
            onDelete={() => onChange(disconnect(graph, e.id))}
          />
        ))}
      </div>

      {/* 作用域 BGM：本节点作为 owner 的床轨。不填 = 不动 BGM 栈（继续播上层那首），旧图零行为变化。 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <b>BGM</b>
        {/* 「播放动作」在空态也得在：`{ mode: 'stop' }` 是一条没有 ref 的配置，藏到「填了 ref 之后」
            作者就永远选不到它（v2 里 win / lose 全靠这条收尾）。 */}
        {row('播放动作', (
          <select
            value={bgmMode}
            onChange={(e) => {
              const mode = e.target.value as 'push' | 'replace' | 'stop'
              // stop 自己就是一条完整配置（不带曲子），落得了盘；push / replace 在空态落不了，
              // 记进草稿让下拉停在作者选的那一项上。
              if (mode !== 'stop') setDraftBgmMode(mode)
              patchData({ bgm: patchNodeBgm(bgm, { mode }) })
            }}
            style={{ flex: 1 }}
            title={BGM_MODE_TITLE}
          >
            <option value="push">起播并记住上一首</option>
            <option value="replace">换曲，不记住上一首</option>
            <option value="stop">结束当前音乐</option>
          </select>
        ))}
        {/* stop 那一条不引入曲子（SPEC §7）：资产输入收起，连带 restart 一起——
            它在 stop 上没有落点（patchNodeBgm 也会把它收掉）。 */}
        {bgmMode === 'stop' ? null : (
          <>
            {row('BGM曲目', (
              <select
                value={selectedAudioValue}
                onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { ref: e.target.value, mode: bgmMode }) })}
                style={{ flex: 1 }}
                title="选择该节点作用域 BGM（与资产库音频一致，仅显示 Kino 接口资源）；空 = 不换曲，沿用上层正在播的那首"
              >
                {selectedAudioValue === '__unavailable__' ? (
                  <option value="__unavailable__" disabled>（当前音乐不在素材库）</option>
                ) : null}
                <option value="">（空）</option>
                {audioOptions.map((option) => (
                  <option key={option.id} value={option.id}>{authoringOptionLabel(option.label, option.id)}</option>
                ))}
              </select>
            ))}
            {row('音量', (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', minWidth: 0 }}>
                <input
                  type="checkbox"
                  aria-label="设置 BGM 音量"
                  checked={bgm?.volume !== undefined}
                  onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { volume: e.target.checked ? 1 : undefined }) })}
                />
                <input
                  type="range"
                  className="ni-bgm-volume"
                  aria-label="BGM 音量"
                  min={0}
                  max={1}
                  step={0.01}
                  value={bgm?.volume ?? 1}
                  disabled={bgm?.volume === undefined}
                  onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { volume: Number(e.target.value) }) })}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
                    background: `linear-gradient(to right, #1683ff 0%, #1683ff ${(bgm?.volume ?? 1) * 100}%, rgba(255, 255, 255, 0.3) ${(bgm?.volume ?? 1) * 100}%, rgba(255, 255, 255, 0.3) 100%)`,
                  }}
                />
                <span style={{ width: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {bgm?.volume === undefined ? '未设置' : `${Math.round(bgm.volume * 100)}%`}
                </span>
              </span>
            ))}
            {bgm?.ref ? (
              <>
                {row('播放模式', (
                  <select
                    aria-label="BGM 播放模式"
                    value={bgm.loop === false ? 'once' : 'loop'}
                    onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { loop: e.target.value === 'loop' ? undefined : false }) })}
                    style={{ flex: 1 }}
                  >
                    <option value="loop">循环</option>
                    <option value="once">单次</option>
                  </select>
                ))}
                {row('重进时', (
                  <span
                    style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, opacity: 0.85 }}
                    title="不勾 = 同一首接着播（战斗多回合靠它不断曲）；勾上 = 每次重新进入本节点都从头播。"
                  >
                    <input
                      type="checkbox"
                      checked={bgm.restart === true}
                      onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { restart: e.target.checked }) })}
                    />
                    从头重播
                  </span>
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
