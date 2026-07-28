/**
 * NodeInspector —— 节点配置面板。选中画布节点后编辑其 `node.data`、overlay reactions 与出边。
 * Overlay 事件作者 SSOT = 各挂载 `overlayNodes[].reactions`；走向经 do 内 advance + 边。
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Entity, GameGraph, GraphCondition, Overlay, SubFlowPackDef, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'
import { patchNodeBgm, type AudioOption } from './bgm-authoring'
import type { Layout, NodeAction, Reaction, OverlayEventRef } from '../../runtime/schema/node-config-schema'
import { overlayMountId } from '../../runtime/schema/node-config-schema'
import { aggregateOverlayEvents, resolveEventReactionDo } from '../../runtime/schema/overlay-events'
import { resolveMountChildren } from '../../runtime/schema/expand-overlay'
import { deriveOutputs, getComponentManifest } from '../../runtime/registry/component-registry'
import {
  connect,
  disconnect,
  reconnect,
  removeNode,
  updateEdgeData,
  updateNodeData,
  upsertBranchEdge,
  makeEmptySubFlowPack,
  attachSameGraphSubflow,
  type NodeDataPatch,
} from '../../graph/edit/graph-edit'
import { mergeFlowHandles, flowHandleDisplay } from '../../graph/flow-handle-labels'
import { ConditionEditor, EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import { SpawnInputsEditor } from './spawn-inputs-editor'
import { ComponentFormFields, summarizeComponentInputs } from './component-form-fields'
import { PRESET_SCHEME_BY_ID } from './schemeOverlays'
import { listSchemeAndBaseOverlayIds } from '../demo/builtin-schemes'

/**
 * 「音乐动作」下拉的 hover 说明 —— 面板上不再铺开这些解释（只留表单本身），所以三条动作的
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

/** 悬停 / 模块内聚焦时边框微亮；`nested` 仅略缩进，底色与父级一致。 */
const HOVER_CARD_CLASS = 'ni-hover-card'
const HOVER_CARD_NESTED = 'ni-hover-card--nested'
const HOVER_CARD_STYLE_ID = 'ni-hover-card-style-v6'

function ensureHoverCardStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(HOVER_CARD_STYLE_ID)) return
  for (const id of [
    'ni-hover-card-style',
    'ni-hover-card-style-v2',
    'ni-hover-card-style-v3',
    'ni-hover-card-style-v4',
    'ni-hover-card-style-v5',
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
`
  document.head.appendChild(el)
}

function HoverCard({
  header,
  children,
  nested,
  accent,
}: {
  header: ReactNode
  children: ReactNode
  /** 子模块（如覆盖物下的事件）：略缩进；悬停青绿边，底色与父级同。 */
  nested?: boolean
  /** 聚焦态：橙色描边 + 微高亮底（预览台选中该挂载时）。 */
  accent?: boolean
}): JSX.Element {
  ensureHoverCardStyle()
  return (
    <div
      className={nested ? `${HOVER_CARD_CLASS} ${HOVER_CARD_NESTED}` : HOVER_CARD_CLASS}
      style={accent ? { outline: '1px solid #f08840', outlineOffset: 1, background: 'rgba(240,136,64,.08)' } : undefined}
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

/** eventKeys 全集：替换某事件反应时移除所有别名，写入规范 id（= 组件 emit 的 localEventId，对齐边 sourceHandle）。 */
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
  // 落盘用 localEventId：与引擎 outcome / 边 sourceHandle 一致（勿写 mount:child:… 展示用 eventId）。
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

type LifecyclePhase = 'enter' | 'at' | 'exit' | 'complete'
const LIFECYCLE_PHASES: LifecyclePhase[] = ['enter', 'at', 'exit', 'complete']
const PHASE_LABEL: Record<LifecyclePhase, string> = {
  enter: '进入时',
  at: '播到 ms',
  exit: '离开前',
  complete: '收尾/推进',
}

function isLifecycle(r: Reaction): boolean {
  return r.when.type === 'enter' || r.when.type === 'at' || r.when.type === 'exit' || r.when.type === 'complete'
}

/**
 * node.data.reactions 的**生命周期效果**编辑：按相位（enter/at/exit/complete）施加 effects。
 * 只改状态，不决定走向（走向由「出边」负责）。complete 可带 if 条件（首个成立者施加）。
 */
function LifecycleReactionsEditor({
  reactions,
  nodeIds,
  pickers,
  entities,
  variables,
  onChange,
}: {
  reactions: Reaction[] | undefined
  nodeIds: string[]
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onChange: (next: Reaction[] | undefined) => void
}): JSX.Element {
  const life = (reactions ?? []).filter(isLifecycle)
  const rest = (reactions ?? []).filter((r) => !isLifecycle(r))
  const commit = (next: Reaction[]) => {
    const merged = [...next, ...rest]
    onChange(merged.length ? merged : undefined)
  }
  const patchAt = (i: number, r: Reaction) => commit(life.map((c, j) => (j === i ? r : c)))
  const setPhase = (i: number, phase: LifecyclePhase) => {
    const when: Reaction['when'] =
      phase === 'at' ? { type: 'at', ms: 0 } : phase === 'complete' ? { type: 'complete' } : { type: phase }
    patchAt(i, { ...life[i]!, when })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {life.length === 0 ? <div style={{ fontSize: 11, opacity: 0.6 }}>无生命周期效果</div> : null}
      {life.map((r, i) => {
        const effects = r.do.find((a): a is Extract<NodeAction, { kind: 'effect' }> => a.kind === 'effect')
        const phase = r.when.type as LifecyclePhase
        return (
          <div key={i} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
              <select value={phase} onChange={(e) => setPhase(i, e.target.value as LifecyclePhase)} style={{ fontSize: 12 }}>
                {LIFECYCLE_PHASES.map((ph) => <option key={ph} value={ph}>{PHASE_LABEL[ph]}</option>)}
              </select>
              <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => commit(life.filter((_, j) => j !== i))}>
                移除
              </button>
            </div>
            {r.when.type === 'at' ? row('ms', (
              <input
                type="number"
                value={r.when.ms}
                onChange={(e) => patchAt(i, { ...r, when: { type: 'at', ms: Number(e.target.value) || 0 } })}
                style={{ flex: 1 }}
              />
            )) : null}
            {r.when.type === 'complete' ? (
              <>
                <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>if 条件（留空 = 无条件）</div>
                <ConditionEditor
                  value={r.when.if}
                  nodeIds={nodeIds}
                  pickers={pickers}
                  entities={entities}
                  variables={variables}
                  onChange={(condition) =>
                    patchAt(i, { ...r, when: { type: 'complete', ...(condition ? { if: condition as GraphCondition } : {}) } })
                  }
                />
              </>
            ) : null}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0 2px' }}>effects</div>
            <EffectsEditor
              value={effects?.effects}
              pickers={pickers}
              entities={entities}
              variables={variables}
              onChange={(effs) => patchAt(i, { ...r, do: effs?.length ? [{ kind: 'effect', effects: effs }] : [] })}
            />
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => commit([...life, {
          when: { type: 'enter' },
          do: [{ kind: 'effect', effects: [createDefaultEffect('attr', entities ?? pickers?.entities, variables ?? pickers?.variables)] }],
        }])}
      >
        ＋ 生命周期效果
      </button>
    </div>
  )
}

/** 事件展示：中文名优先，括号里保留机器 id（对齐「出边 › 目标」的 `名称 (id)`）。 */
function overlayEventLabel(ev: {
  eventId: string
  localEventId: string
  label?: string
  componentId: string
  childId: string
}): string {
  const comp = getComponentManifest(ev.componentId)?.label?.trim()
  const local = ev.label?.trim()
  const head = [comp, local].filter(Boolean).join(' · ')
  if (head && head !== ev.eventId) return `${head} (${ev.eventId})`
  return ev.eventId
}

function OverlayReactionsEditor({
  events,
  reactions,
  edgeOptions,
  routeHints,
  spawnOptions,
  overlays,
  pickers,
  entities,
  variables,
  nodeOptions,
  graph,
  nodeId,
  onChange,
  onRouteTo,
}: {
  events: OverlayEventRef[]
  reactions: Reaction[] | undefined
  edgeOptions: OptItem[]
  /** eventId → 出边目标摘要（有 advance 或默认推进时都能看见去哪）。 */
  routeHints?: Record<string, string>
  spawnOptions: OptItem[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 目标节点下拉（不含当前节点）。 */
  nodeOptions: OptItem[]
  graph: GameGraph
  nodeId: string
  onChange: (next: Reaction[] | undefined) => void
  /** 选目标节点：upsert 边 + 本挂载 advance；空串 = 清除该出口边。 */
  onRouteTo: (ev: OverlayEventRef, targetId: string) => void
}): JSX.Element {
  const catalog = pickers ?? { entities, variables }
  if (!events.length) {
    return (
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
        无导出事件（交互组件需有 inputs.events / manifest.events）
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
      {sectionLabel('事件响应')}
      <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2, lineHeight: 1.4 }}>
        选目标节点会同步写出边；多目标加权见「出边」。
      </div>
      {events.map((ev) => {
        const actions = eventReactionDo(reactions, ev)
        const pool = handleEdges(graph, nodeId, ev.localEventId)
        const advance = actions.find((a): a is Extract<NodeAction, { kind: 'advance' }> => a.kind === 'advance')
        const advanceEdge = advance ? graph.edges.find((e) => e.id === advance.edgeId) : undefined
        const multiPool = pool.length > 1
        const currentTarget = multiPool
          ? ''
          : (advanceEdge?.target ?? (pool.length === 1 ? pool[0]!.target : ''))
        const hint = routeHints?.[ev.localEventId] ?? routeHints?.[ev.eventId]
        const actionBrief =
          actions.length === 0
            ? '无动作'
            : actions.map((a) => (a.kind === 'effect' ? '效果' : a.kind === 'spawn' ? '生成' : '推进')).join(' · ')
        return (
          <HoverCard
            key={ev.eventId}
            nested
            header={(
              <div style={{ minWidth: 0, flex: 1 }} title={`child=${ev.childId} · local=${ev.localEventId}`}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {overlayEventLabel(ev)}
                </div>
                <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
                  {currentTarget
                    ? `→ ${nodeOptions.find((o) => o.value === currentTarget)?.label ?? currentTarget}`
                    : multiPool
                      ? `多目标边池 (${pool.length})`
                      : '仅副作用'}
                  {' · '}
                  {actionBrief}
                </div>
              </div>
            )}
          >
            {sectionLabel('走向')}
            {row('目标节点', (
              multiPool ? (
                <span style={{ fontSize: 11, color: '#ce9178' }}>
                  多目标边池（{pool.length}）· 请在「出边」调整 {hint ?? ''}
                </span>
              ) : (
                <select
                  value={currentTarget}
                  onChange={(e) => onRouteTo(ev, e.target.value)}
                  style={{ flex: 1 }}
                  title="写入出边 sourceHandle=事件 id，并在本挂载 reactions 里挂 advance"
                >
                  <option value="">（无 · 只做副作用）</option>
                  {nodeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )
            ))}
            {sectionLabel('触发时动作')}
            <NodeActionsEditor
              actions={actions}
              edgeOptions={edgeOptions}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={catalog}
              onChange={(doActions) => onChange(upsertEventReaction(reactions, ev, doActions))}
            />
          </HoverCard>
        )
      })}
    </div>
  )
}

type MountLayoutKey = keyof Layout

const MOUNT_LAYOUT_HINT =
  '挂载盒在视频视口上的位置与尺寸（对齐 CSS absolute）。只影响血条、飘字等表现层；應默 / QTE / 技能条请改下方组件参数里的 x、y。'

const MOUNT_LAYOUT_PRESETS: Array<{
  id: string
  label: string
  layout: Layout | undefined
  title: string
}> = [
  {
    id: 'tl',
    label: '左上',
    layout: undefined,
    title: '快捷：清掉 layout，挂载盒贴视频左上角并随内容自适应',
  },
  {
    id: 'br',
    label: '右下',
    layout: { right: 0, bottom: 0 },
    title: '快捷：right=0、bottom=0，把挂载盒贴到视频右下角',
  },
  {
    id: 'c',
    label: '居中',
    layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 },
    title: '快捷：left/top=0.5 且 translate=-0.5，挂载盒中心对齐视频中心',
  },
]

const MOUNT_LAYOUT_FIELDS: Array<{ key: MountLayoutKey; label: string; title: string }> = [
  {
    key: 'left',
    label: 'L',
    title: 'left（左边距）：挂载盒左边缘距视频左边的距离。数字 0~1 为比例，也可写 40% / 12px。与 right 一般二选一。',
  },
  {
    key: 'right',
    label: 'R',
    title: 'right（右边距）：挂载盒右边缘距视频右边的距离。贴右下角时填 0，并配合 bottom=0；勿再写 left。',
  },
  {
    key: 'top',
    label: 'T',
    title: 'top（上边距）：挂载盒上边缘距视频上边的距离。数字 0~1 为比例，也可写 40% / 12px。',
  },
  {
    key: 'bottom',
    label: 'B',
    title: 'bottom（下边距）：挂载盒下边缘距视频下边的距离。贴右下角时填 0，并配合 right=0；勿再写 top。',
  },
  {
    key: 'width',
    label: 'W',
    title: 'width（宽度）：挂载盒宽度。空=随内容自适应；可写 0.5 / 50% / 120px。',
  },
  {
    key: 'height',
    label: 'H',
    title: 'height（高度）：挂载盒高度。空=随内容自适应；可写 0.5 / 50% / 120px。',
  },
  {
    key: 'translateX',
    label: 'tx',
    title: 'translateX（水平自偏移）：相对挂载盒自身再平移。居中时常与 left=0.5 合用，填 -0.5（左移自身半宽）。',
  },
  {
    key: 'translateY',
    label: 'ty',
    title: 'translateY（垂直自偏移）：相对挂载盒自身再平移。居中时常与 top=0.5 合用，填 -0.5。',
  },
  {
    key: 'zIndex',
    label: 'z',
    title: 'zIndex（叠层顺序）：数字越大越靠上，用于多挂载重叠时控制谁盖住谁。',
  },
]

function summarizeMountLayout(layout: Layout | undefined): string {
  if (!layout) return '默认·左上'
  const parts: string[] = []
  for (const { key, label } of MOUNT_LAYOUT_FIELDS) {
    const v = layout[key]
    if (v !== undefined) parts.push(`${label}${v}`)
  }
  return parts.length ? parts.join(' ') : '默认·左上'
}

/**
 * 挂载盒相对视频视口的 layout —— 默认一行摘要+快捷预设，展开再编全字段。
 */
function MountLayoutEditor({
  layout,
  onChange,
}: {
  layout: Layout | undefined
  onChange: (next: Layout | undefined) => void
}): JSX.Element {
  const display = (key: MountLayoutKey): string => {
    const v = layout?.[key]
    if (v === undefined) return ''
    return String(v)
  }
  const set = (key: MountLayoutKey, raw: string) => {
    const trimmed = raw.trim()
    const next: Layout = { ...layout }
    if (!trimmed) delete next[key]
    else if (key === 'zIndex') {
      const n = Number(trimmed)
      if (Number.isFinite(n)) next.zIndex = n
      else delete next.zIndex
    } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      next[key] = Number(trimmed)
    } else {
      next[key] = trimmed as Layout[Exclude<MountLayoutKey, 'zIndex'>]
    }
    onChange(Object.keys(next).length ? next : undefined)
  }
  return (
    <details style={{ marginBottom: 6, fontSize: 11 }} title={MOUNT_LAYOUT_HINT}>
      <summary
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          listStyle: 'none',
          opacity: 0.9,
        }}
      >
        <span style={{ opacity: 0.65 }} title={MOUNT_LAYOUT_HINT}>位置</span>
        <span
          style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.85 }}
          title={`当前 layout：${summarizeMountLayout(layout)}。${MOUNT_LAYOUT_HINT}`}
        >
          {summarizeMountLayout(layout)}
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {MOUNT_LAYOUT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                onChange(p.layout ? { ...p.layout } : undefined)
              }}
              style={{
                fontSize: 10,
                padding: '1px 6px',
                border: '1px solid #444',
                borderRadius: 4,
                background: '#1a1a1a',
                color: '#ccc',
                cursor: 'pointer',
              }}
              title={p.title}
            >
              {p.label}
            </button>
          ))}
        </span>
        <span
          style={{ opacity: 0.45, marginLeft: 'auto' }}
          title="展开后可分别编辑 left/right/top/bottom/width/height/translate/zIndex"
        >
          ▾ 细调
        </span>
      </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', marginTop: 6, paddingLeft: 2 }}>
        {MOUNT_LAYOUT_FIELDS.map(({ key, label, title }) => (
          <label
            key={key}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11 }}
            title={title}
          >
            <span style={{ opacity: 0.55, width: 14, textAlign: 'right', flexShrink: 0 }}>{label}</span>
            <input
              value={display(key)}
              onChange={(e) => set(key, e.target.value)}
              style={{ width: 44, fontSize: 11 }}
              title={title}
              aria-label={title}
            />
          </label>
        ))}
      </div>
    </details>
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
    label: e.name && e.name !== e.id ? `${e.name} (${e.id})` : e.id,
    children: [
      {
        seg: 'attr',
        label: '属性',
        children: Object.keys(e.attrs ?? {}).map((a) => ({
          seg: a,
          label: e.attrMeta?.[a]?.label ? `${e.attrMeta[a]!.label} (${a})` : a,
        })),
      },
    ],
  }))
  const vars: FieldNode[] = Object.values(variables ?? {}).map((v) => ({
    seg: v.id,
    label: v.name && v.name !== v.id ? `${v.name} (${v.id})` : v.id,
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

// ── 响应规则（数值变化 / 组件生命周期）——node.data.reactions 的 watch/shown/hidden 子集 ──
/** 下拉项：value 落盘、label 展示（组件中文名等）。 */
interface OptItem {
  value: string
  label: string
}
type ReactiveType = 'watch' | 'shown' | 'hidden'
const REACTIVE_LABEL: Record<ReactiveType, string> = {
  watch: '数值变化',
  shown: '组件出现',
  hidden: '组件消失',
}
function isReactive(r: Reaction): boolean {
  return r.when.type === 'watch' || r.when.type === 'shown' || r.when.type === 'hidden'
}

/** node.data.reactions 内 do 动作编辑：effect / spawn / advance（沿边推进）。 */
function NodeActionsEditor({
  actions,
  edgeOptions,
  spawnOptions,
  overlays,
  pickers,
  onChange,
}: {
  actions: NodeAction[]
  edgeOptions: OptItem[]
  spawnOptions: OptItem[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  onChange: (next: NodeAction[]) => void
}): JSX.Element {
  const patchAt = (i: number, a: NodeAction) => onChange(actions.map((c, j) => (j === i ? a : c)))
  const removeAt = (i: number) => onChange(actions.filter((_, j) => j !== i))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {actions.map((a, i) => (
        <div
          key={i}
          style={{
            border: '1px solid #2a2a2a',
            borderRadius: 5,
            padding: '6px 8px',
            background: 'rgba(0,0,0,0.22)',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
              {a.kind === 'effect' ? '施加效果' : a.kind === 'spawn' ? '生成组件' : '沿边推进'}
            </span>
            <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => removeAt(i)}>移除</button>
          </div>
          {a.kind === 'effect' ? (
            <EffectsEditor value={a.effects} pickers={pickers} onChange={(effs) => patchAt(i, { kind: 'effect', effects: effs ?? [] })} />
          ) : null}
          {a.kind === 'spawn' ? (
            <>
              {row('模板', (
                <select
                  value={a.from}
                  onChange={(e) => patchAt(i, { ...a, from: e.target.value })}
                  style={{ flex: 1, minWidth: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                >
                  <option value="">（选组件模板）</option>
                  {spawnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))}
              {row('存活ms', (
                <input
                  type="number"
                  value={a.ttlMs ?? 0}
                  onChange={(e) => patchAt(i, { ...a, ttlMs: Number(e.target.value) || undefined })}
                  style={{ flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box' }}
                  title="0=常驻直到离场"
                />
              ))}
              <SpawnInputsEditor
                from={a.from}
                inputs={a.inputs}
                overlays={overlays}
                pickers={pickers}
                onChange={(inputs) => patchAt(i, { ...a, inputs })}
              />
            </>
          ) : null}
          {a.kind === 'advance' ? (
            <>
              {row('走边', (
                <select
                  value={a.edgeId}
                  onChange={(e) => patchAt(i, { kind: 'advance', edgeId: e.target.value })}
                  style={{ flex: 1, minWidth: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                >
                  <option value="">（选出边）</option>
                  {edgeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))}
              {a.edgeId ? (
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                  {edgeOptions.find((o) => o.value === a.edgeId)?.label ?? `边 ${a.edgeId}（未找到）`}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => onChange([...actions, {
            kind: 'effect',
            // 与「生成组件」一样一次带好初值，避免先出空壳再点一次「+ 效果」
            effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)],
          }])}
        >
          ＋ 效果
        </button>
        <button type="button" onClick={() => onChange([...actions, { kind: 'spawn', from: spawnOptions[0]?.value ?? '' }])}>＋ 生成组件</button>
        <button type="button" onClick={() => onChange([...actions, { kind: 'advance', edgeId: edgeOptions[0]?.value ?? '' }])}>＋ 沿边推进</button>
      </div>
    </div>
  )
}

/**
 * 响应规则编辑：node.data.reactions 中 watch/shown/hidden 子集（保留其它类型不动）。
 * - watch：观察表达式 of（如 entity.ent-player.attr.hp）+ 方向 on → do
 * - shown/hidden：组件 of（childId）出现/消失 → do
 */
function reactiveRuleSummary(r: Reaction, componentOptions: OptItem[]): string {
  const w = r.when
  if (w.type === 'watch') {
    const dir = w.on === 'inc' ? '增加' : w.on === 'dec' ? '减少' : '变化'
    return `${w.of?.trim() || '（未选字段）'} · ${dir}`
  }
  if (w.type === 'shown' || w.type === 'hidden') {
    const label = componentOptions.find((o) => o.value === w.of)?.label ?? w.of
    return label?.trim() || '（未选组件）'
  }
  return ''
}

function ReactiveRulesEditor({
  reactions,
  edgeOptions,
  componentOptions,
  spawnOptions,
  overlays,
  fieldTree,
  pickers,
  onChange,
}: {
  reactions: Reaction[] | undefined
  edgeOptions: OptItem[]
  componentOptions: OptItem[]
  spawnOptions: OptItem[]
  overlays?: Record<string, Overlay>
  fieldTree: FieldNode[]
  pickers?: EditorPickerCtx
  onChange: (next: Reaction[] | undefined) => void
}): JSX.Element {
  const rules = (reactions ?? []).filter(isReactive)
  const rest = (reactions ?? []).filter((r) => !isReactive(r))
  const commit = (next: Reaction[]) => {
    const merged = [...rest, ...next]
    onChange(merged.length ? merged : undefined)
  }
  const patchAt = (i: number, r: Reaction) => commit(rules.map((c, j) => (j === i ? r : c)))
  const setType = (i: number, type: ReactiveType) => {
    const when: Reaction['when'] =
      type === 'watch'
        ? { type: 'watch', of: '', on: 'change' }
        : { type, of: componentOptions[0]?.value ?? '' }
    patchAt(i, { ...rules[i]!, when })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
      {rules.length === 0 ? <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>无响应规则</div> : null}
      {rules.map((r, i) => {
        const w = r.when as Extract<Reaction['when'], { type: 'watch' } | { type: 'shown' } | { type: 'hidden' }>
        const doBrief =
          r.do.length === 0
            ? '无动作'
            : r.do.map((a) => (a.kind === 'effect' ? '效果' : a.kind === 'spawn' ? '生成' : '推进')).join(' · ')
        return (
          <HoverCard
            key={i}
            header={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <select
                    value={w.type}
                    onChange={(e) => setType(i, e.target.value as ReactiveType)}
                    style={{ fontSize: 12, fontWeight: 600 }}
                    title="规则类型"
                  >
                    {(['watch', 'shown', 'hidden'] as ReactiveType[]).map((t) => (
                      <option key={t} value={t}>{REACTIVE_LABEL[t]}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {reactiveRuleSummary(r, componentOptions)}
                    {' · '}
                    {doBrief}
                  </div>
                </div>
                <button
                  type="button"
                  style={{ color: '#ff6b6b', fontSize: 11, flexShrink: 0 }}
                  onClick={() => commit(rules.filter((_, j) => j !== i))}
                >
                  移除
                </button>
              </div>
            )}
          >
            {sectionLabel('触发条件')}
            {w.type === 'watch' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <WatchFieldEditor
                  tree={fieldTree}
                  value={w.of}
                  onChange={(of) => patchAt(i, { ...r, when: { ...w, of } })}
                />
                {row('方向', (
                  <select
                    value={w.on ?? 'change'}
                    onChange={(e) => patchAt(i, { ...r, when: { ...w, on: e.target.value as 'change' | 'inc' | 'dec' } })}
                    style={{ flex: 1 }}
                  >
                    <option value="change">变化</option>
                    <option value="inc">增加</option>
                    <option value="dec">减少</option>
                  </select>
                ))}
              </div>
            ) : (
              row('组件', (
                <select
                  value={w.of}
                  onChange={(e) => patchAt(i, { ...r, when: { type: w.type, of: e.target.value } })}
                  style={{ flex: 1 }}
                >
                  <option value="">（选组件）</option>
                  {componentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))
            )}
            {sectionLabel('动作')}
            <NodeActionsEditor
              actions={r.do}
              edgeOptions={edgeOptions}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={pickers}
              onChange={(acts) => patchAt(i, { ...r, do: acts })}
            />
          </HoverCard>
        )
      })}
      <button
        type="button"
        style={{ marginTop: 6, alignSelf: 'flex-start' }}
        onClick={() => commit([...rules, { when: { type: 'watch', of: '', on: 'change' }, do: [] }])}
      >
        ＋ 响应规则
      </button>
    </div>
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
          value={edge.data?.weight ?? 0}
          onChange={(ev) => onPatchData({ weight: Number(ev.target.value) || undefined })}
          style={{ flex: 1 }}
          title="多条无条件默认推进边时按权重随机；0=未设"
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
  onFocusMount,
  onChange,
  onPacksChange,
  onEnsureOverlay,
  onDropOverlayIfOrphan,
  onRemoveMount,
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
  /** 点击某挂载卡片标题时上抛（与预览台双向联动）；再次点同一张 = 取消聚焦（回到全展开）。 */
  onFocusMount?: (mountId: string | null) => void
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
  onJump?: (id: string) => void
}): JSX.Element {
  // 「音乐动作」在还没选曲子时也得选得动：`patchNodeBgm` 对「没有 ref 且不是 stop」的配置一律
  // 删键（不留 `{ ref: '' }` 这种 validate 判 error、runtime 静默丢弃的残留），所以空态下
  // push / replace 落不了盘，下拉会自己弹回「起播」。落不了盘的那一步先记在这儿，等作者选了
  // 曲子再随 ref 一起写进去。换节点 = 换一份草稿。
  const [draftBgmMode, setDraftBgmMode] = useState<'push' | 'replace'>('push')
  const [draftBgmModeNode, setDraftBgmModeNode] = useState(nodeId)
  if (nodeId !== draftBgmModeNode) {
    setDraftBgmModeNode(nodeId)
    setDraftBgmMode('push')
  }
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || !nodeId) return <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>点画布上的节点以编辑</div>
  const d = node.data
  const nodeIds = graph.nodes.map((n) => n.id)
  /** 下拉展示：名称优先，id 作后缀（名称与 id 相同时只显示一份）。 */
  const nodeLabel = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    const name = n?.data.name?.trim()
    if (!name || name === id) return id
    return `${name} (${id})`
  }
  const overlayLabel = (id: string) => {
    const title = overlays?.[id]?.title?.trim() || PRESET_SCHEME_BY_ID[id]?.title?.trim()
    if (!title || title === id) return id
    return `${title} (${id})`
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

  const nestRef = getSubFlow(d)
  const nestPack = getSubFlowPack(d)
  const nestMode: 'none' | 'subflow' | 'pack' = nestPack ? 'pack' : nestRef ? 'subflow' : 'none'
  // 作用域 BGM：读原始值（不过 getNodeBgm），与面板下拉一致。
  const bgm = d.bgm
  // 手写/AI 生成的非法 mode 在下拉里显示成 push（validate 会把它判 error），别让 select 变成
  // 「什么都没选」的空框。还没有配置时读本地草稿——见组件顶部 `draftBgmMode`。
  const bgmMode: 'push' | 'replace' | 'stop' = bgm?.mode === 'replace' || bgm?.mode === 'stop'
    ? bgm.mode
    : bgm ? 'push' : draftBgmMode
  const packKey = nestPack
    ? (nestPack.version ? `${nestPack.id}@${nestPack.version}` : nestPack.id)
    : ''
  const packLabel = (p: SubFlowPackDef) => {
    const title = p.title?.trim()
    const key = `${p.id}@${p.version}`
    return title && title !== p.id ? `${title} (${key})` : key
  }
  /** 下拉候选：排除自引用 + 会成环的候选（`isRefAllowed`）；已挂载的当前包永远保留展示，避免选中项丢失。 */
  const eligiblePacks = packs.filter((p) => p.id === nestPack?.id || !isRefAllowed || isRefAllowed(p.id))

  // 响应规则选项（带组件中文名 label）：shown/hidden 的组件 = 本节点各挂载 overlay 的 children；spawn 模板 = 全目录。
  const compLabel = (component: string) => getComponentManifest(component)?.label ?? component
  const componentOptions: OptItem[] = (d.overlayNodes ?? []).flatMap((m) =>
    resolveMountChildren(overlays, m).map((c) => ({ value: c.id, label: `${compLabel(c.component)}（${c.id}）` })),
  )
  // spawn 模板只列界面方案（排除 node:* 本地内容容器 / 历史 fork）。
  const spawnOptions: OptItem[] = Object.values(overlays ?? {})
    .filter((o) => !o.id.startsWith('node:'))
    .flatMap((o) =>
      o.children.map((c) => ({ value: `${o.id}/${c.id}`, label: `${compLabel(c.component)} · ${o.id}/${c.id}` })),
    )
  const fieldTree = buildFieldTree(entities, variables)
  const pickers: EditorPickerCtx = { entities, variables, formulas, nodeLabel }
  const flowHandleOptions = useMemo(() => {
    const extra = graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.sourceHandle ?? 'default')
    return mergeFlowHandles(deriveOutputs(node, overlays), extra)
  }, [node, overlays, graph.edges])
  const edgeOptions = useMemo<OptItem[]>(
    () =>
      graph.edges
        .filter((e) => e.source === node.id)
        .map((e) => ({
          value: e.id,
          label: `${flowHandleDisplay(e.sourceHandle ?? 'default')} → ${nodeLabel(e.target)}`,
        })),
    [graph.edges, node.id, nodeLabel],
  )
  /** 每个交互出口 → 目标节点摘要（单边 `→ X`，多边 `→ A | B`）。 */
  const routeHints = useMemo(() => {
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
  }, [graph.edges, node.id, nodeLabel])

  const patchData = (p: NodeDataPatch) => onChange(updateNodeData(graph, node.id, p))
  /**
   * 编辑挂载组件的 inputs（NodeInspector 为准）：写成本挂载的稀疏 override（overrides[childId].inputs）。
   * 值来自 ComponentFormFields（按 manifest.inputs 出控件），full-bag 覆盖——共享方案未改组件仍跟随原型。
   */
  const setChildInputs = (mountIndex: number, childId: string, nextInputs: Record<string, unknown>) => {
    const mounts = [...(d.overlayNodes ?? [])]
    const mount = mounts[mountIndex]
    if (!mount) return
    const prev = mount.overrides?.[childId]
    mounts[mountIndex] = {
      ...mount,
      overrides: { ...mount.overrides, [childId]: { ...prev, inputs: nextInputs } },
    }
    patchData({ overlayNodes: mounts })
  }
  const setMountLayout = (mountIndex: number, layout: Layout | undefined) => {
    const mounts = [...(d.overlayNodes ?? [])]
    const mount = mounts[mountIndex]
    if (!mount) return
    mounts[mountIndex] = { ...mount, layout }
    patchData({ overlayNodes: mounts })
  }
  const targetNodeOptions: OptItem[] = nodeIds
    .filter((id) => id !== node.id)
    .map((id) => ({ value: id, label: nodeLabel(id) }))
  const setNestMode = (mode: 'none' | 'subflow' | 'pack') => {
    if (mode === 'none') {
      patchData({ subFlow: undefined, subFlowPack: undefined })
      return
    }
    if (mode === 'subflow') {
      // 只改嵌套属性；入口用新建专用节点（见 attachSameGraphSubflow），不自动下钻。
      onChange(attachSameGraphSubflow(graph, node.id))
      return
    }
    if (nestPack) {
      patchData({ subFlow: undefined })
      return
    }
    const existing = eligiblePacks[0]
    if (existing) {
      patchData({ subFlow: undefined, subFlowPack: { id: existing.id, version: existing.version } })
      return
    }
    if (!onPacksChange) {
      patchData({ subFlow: undefined, subFlowPack: { id: 'pack', version: '1' } })
      return
    }
    const pack = makeEmptySubFlowPack({ title: `${d.name || node.id}·子蓝图` })
    onPacksChange([...packs, pack])
    patchData({ subFlow: undefined, subFlowPack: { id: pack.id, version: pack.version } })
  }
  const createAndAttachPack = () => {
    if (!onPacksChange) return
    const pack = makeEmptySubFlowPack({ title: `${d.name || node.id}·子蓝图` })
    onPacksChange([...packs, pack])
    patchData({ subFlow: undefined, subFlowPack: { id: pack.id, version: pack.version } })
  }
  return (
    <div style={{ padding: 10, overflow: 'auto', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
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
      {row('视频', (
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
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      ))}
      {row('播放', (
        <select value={d.mediaPlayMode ?? 'once'} onChange={(e) => patchData({ mediaPlayMode: e.target.value as 'once' | 'loop' })}>
          <option value="once">播放一次</option>
          <option value="loop">循环</option>
        </select>
      ))}
      {row('嵌套', (
        <select
          value={nestMode}
          onChange={(e) => setNestMode(e.target.value as 'none' | 'subflow' | 'pack')}
          style={{ flex: 1 }}
          title="无 / 同图子流程 / 外部子蓝图（互斥）"
        >
          <option value="none">无</option>
          <option value="subflow">同图子流程</option>
          <option value="pack">子蓝图</option>
        </select>
      ))}
      {nestMode === 'subflow' && row('子流程入口', (
        <span style={{ flex: 1, opacity: 0.85 }} title="由同图子流程自动创建/绑定，不可手改">
          {nestRef ? nodeLabel(nestRef) : '（未绑定）'}
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
                  patchData({ subFlowPack: undefined })
                  return
                }
                const pack = packs.find((p) => `${p.id}@${p.version}` === v || p.id === v)
                if (!pack) return
                if (isRefAllowed && pack.id !== nestPack?.id && !isRefAllowed(pack.id)) {
                  alert(`不能引用「${pack.title ?? pack.id}」：会造成蓝图引用环（自身或间接引用回本蓝图）。`)
                  return
                }
                patchData({ subFlow: undefined, subFlowPack: { id: pack.id, version: pack.version } })
              }}
              style={{ flex: 1 }}
              title="引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑"
            >
              <option value="">（选包）</option>
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
          {nestPack && row('入口覆盖', (
            <input
              value={nestPack.entry ?? ''}
              onChange={(e) => patchData({
                subFlowPack: {
                  ...nestPack,
                  entry: e.target.value.trim() || undefined,
                },
              })}
              placeholder="默认用包内 entry"
              style={{ flex: 1 }}
              title="可选：覆盖包默认入口节点 id"
            />
          ))}
        </>
      )}

      {/* 覆盖物挂载 + reactions（每挂载一份） */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <b>覆盖物事件</b>
          <select
            value=""
            onChange={(e) => {
              const oid = e.target.value
              if (!oid) return
              const mounts = [...(d.overlayNodes ?? [])]
              if (mounts.some((m) => overlayMountId(m) === oid || m.overlay === oid)) return
              // 目录缺失时先写入固化原型，再挂载（否则聚合事件/预览会空）。
              if (!overlays?.[oid]) {
                const preset = PRESET_SCHEME_BY_ID[oid]
                if (preset) onEnsureOverlay?.(structuredClone(preset))
              }
              mounts.push({ overlay: oid })
              patchData({ overlayNodes: mounts })
            }}
            title="从目录追加一张 overlay 挂载（常驻：全部组件同时生效，适合 HUD）；含内置画廊与 nodia 界面方案"
            style={{ maxWidth: 140, fontSize: 11 }}
          >
            <option value="">＋ 挂载…</option>
            {schemeOverlayIds.map((id) => (
              <option key={id} value={id}>{overlayLabel(id)}</option>
            ))}
          </select>
        </div>
        {(d.overlayNodes ?? []).length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>尚未挂载；可上拉选择或在视频/界面编辑器添加</div>
        ) : (
          (d.overlayNodes ?? []).map((mount, i) => {
            const mid = overlayMountId(mount)
            const multi = (d.overlayNodes?.length ?? 0) > 1
            // 事件列表跟挂载展开（含 overrides / added），与运行时一致。
            const mountChildren = resolveMountChildren(overlays, mount)
            const events = aggregateOverlayEvents(
              { id: mount.overlay, title: overlays?.[mount.overlay]?.title, children: mountChildren },
              getComponentManifest,
              { mountId: mid, prefixMount: multi },
            )
            const mountTitle = overlays?.[mount.overlay]?.title?.trim() || PRESET_SCHEME_BY_ID[mount.overlay]?.title?.trim()
            const titleText = mountTitle && mountTitle !== mid ? `${mountTitle} (${mid})` : mid
            // 聚焦联动：有聚焦时只展开该挂载，其余折叠为标题行；无聚焦 = 全展开（默认）。
            const focused = focusedMountId === mid
            const expanded = !focusedMountId || focused
            return (
              <HoverCard
                key={`${mid}-${i}`}
                accent={focused}
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
                <MountLayoutEditor layout={mount.layout} onChange={(layout) => setMountLayout(i, layout)} />
                {mountChildren.length ? (
                  <div style={{ marginBottom: 4 }}>
                    {sectionLabel('组件参数')}
                    {mountChildren.map((child) => {
                      const compName = getComponentManifest(child.component)?.label ?? child.component
                      const inputs = (child.inputs ?? {}) as Record<string, unknown>
                      const summary = summarizeComponentInputs(inputs)
                      return (
                        <details
                          key={child.id}
                          style={{ marginBottom: 4, border: '1px solid #262626', borderRadius: 6, padding: '2px 6px', fontSize: 11 }}
                        >
                          <summary
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: 6,
                              cursor: 'pointer',
                              listStyle: 'none',
                              padding: '2px 0',
                            }}
                            title={`组件 ${child.id}（${compName}）的 inputs。展开后编辑；悬停各字段可看说明。`}
                          >
                            <span style={{ opacity: 0.65 }}>组件</span>
                            <b>{child.id}</b>
                            <span style={{ opacity: 0.55 }}>· {compName}</span>
                            {summary ? (
                              <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.75 }}>{summary}</span>
                            ) : null}
                            <span style={{ opacity: 0.4, marginLeft: 'auto' }}>▾</span>
                          </summary>
                          <div style={{ padding: '4px 0 6px' }}>
                            <ComponentFormFields
                              componentId={child.component}
                              values={inputs}
                              onChange={(next) => setChildInputs(i, child.id, next)}
                              pickers={pickers}
                              density="compact"
                            />
                          </div>
                        </details>
                      )
                    })}
                  </div>
                ) : null}
                <OverlayReactionsEditor
                  events={events}
                  reactions={mount.reactions}
                  edgeOptions={edgeOptions}
                  routeHints={routeHints}
                  spawnOptions={spawnOptions}
                  overlays={overlays}
                  pickers={pickers}
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
                />
                  </>
                ) : null}
              </HoverCard>
            )
          })
        )}
      </div>

      {/* 生命周期效果：node.data.reactions（enter/at/exit/complete，只改状态；走向见出边） */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <b>生命周期效果</b>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
          进入 / 播到某 ms / 离开 / 收尾时施加副作用；去向由下方「出边」决定。
        </div>
        <LifecycleReactionsEditor
          reactions={d.reactions}
          nodeIds={nodeIds}
          pickers={pickers}
          entities={entities}
          variables={variables}
          onChange={(reactions) => patchData({ reactions })}
        />
      </div>

      {/* 响应规则：数值变化(watch) / 组件出现·消失(shown/hidden) → effect/spawn/advance */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <b>响应规则</b>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
          数值变化 / 组件出现·消失时触发；可施加效果、生成瞬态组件（如伤害飘字）或跳转。
        </div>
        <ReactiveRulesEditor
          reactions={d.reactions}
          edgeOptions={edgeOptions}
          componentOptions={componentOptions}
          spawnOptions={spawnOptions}
          overlays={overlays}
          fieldTree={fieldTree}
          pickers={pickers}
          onChange={(reactions) => patchData({ reactions })}
        />
      </div>

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
        <b>音乐（作用域 BGM）</b>
        {/* 「音乐动作」在空态也得在：`{ mode: 'stop' }` 是一条没有 ref 的配置，藏到「填了 ref 之后」
            作者就永远选不到它（v2 里 win / lose 全靠这条收尾）。 */}
        {row('音乐动作', (
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
            {row('音乐', (
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
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            ))}
            {bgm ? (
              <>
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
