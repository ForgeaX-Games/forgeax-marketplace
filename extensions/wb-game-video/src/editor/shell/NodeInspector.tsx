/**
 * NodeInspector —— 节点配置面板。选中画布节点后编辑其 `node.data`、overlay reactions 与出边。
 * Overlay 事件作者 SSOT = 各挂载 `overlayNodes[].reactions`；边可由 goto 派生。
 */
import type { ReactNode } from 'react'
import type { GameGraph, GraphCondition, Overlay, SubFlowPackDef } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'
import type { NodeAction, Reaction } from '../../runtime/schema/node-config-schema'
import { overlayMountId } from '../../runtime/schema/node-config-schema'
import { aggregateOverlayEvents } from '../../runtime/schema/overlay-events'
import { getComponentManifest } from '../../runtime/registry/kind-registry'
import { connect, disconnect, reconnect, removeNode, updateEdgeData, updateNodeData, makeEmptySubFlowPack, type NodeDataPatch } from '../../graph/edit/graph-edit'
import { ConditionEditor, EffectsEditor } from './editors'

function row(label: string, node: ReactNode): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      {node}
    </label>
  )
}

type Effs = Extract<NodeAction, { kind: 'effect' }>['effects']

function eventEffects(reactions: Reaction[] | undefined, eventId: string): Effs | undefined {
  const acts = reactions?.find((r) => r.when.type === 'event' && r.when.id === eventId)?.do
  return acts?.find((a): a is Extract<NodeAction, { kind: 'effect' }> => a.kind === 'effect')?.effects
}

/** 事件 reaction 只承载效果（走向由边负责）。 */
function upsertEventEffects(
  reactions: Reaction[] | undefined,
  eventId: string,
  effects: Effs | undefined,
): Reaction[] | undefined {
  const rest = (reactions ?? []).filter((r) => !(r.when.type === 'event' && r.when.id === eventId))
  if (effects?.length) rest.push({ when: { type: 'event', id: eventId }, do: [{ kind: 'effect', effects }] })
  return rest.length ? rest : undefined
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
  onChange,
}: {
  reactions: Reaction[] | undefined
  nodeIds: string[]
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
                  onChange={(condition) =>
                    patchAt(i, { ...r, when: { type: 'complete', ...(condition ? { if: condition as GraphCondition } : {}) } })
                  }
                />
              </>
            ) : null}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0 2px' }}>effects</div>
            <EffectsEditor
              value={effects?.effects}
              onChange={(effs) => patchAt(i, { ...r, do: effs?.length ? [{ kind: 'effect', effects: effs }] : [] })}
            />
          </div>
        )
      })}
      <button type="button" onClick={() => commit([...life, { when: { type: 'enter' }, do: [] }])}>
        ＋ 生命周期效果
      </button>
    </div>
  )
}

function OverlayReactionsEditor({
  events,
  reactions,
  onChange,
}: {
  events: ReturnType<typeof aggregateOverlayEvents>
  reactions: Reaction[] | undefined
  onChange: (next: Reaction[] | undefined) => void
}): JSX.Element {
  if (!events.length) {
    return (
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
        无导出事件（交互组件需有 exits / manifest.events）
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.6 }}>事件触发时施加的效果；走向请在下方「出边」按事件出口连线。</div>
      {events.map((ev) => {
        const effects = eventEffects(reactions, ev.eventId)
        return (
          <div key={ev.eventId} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <b>{ev.label ?? ev.eventId}</b>
              <span style={{ opacity: 0.55, marginLeft: 6 }}>{ev.eventId}</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, margin: '2px 0' }}>effects</div>
            <EffectsEditor
              value={effects}
              onChange={(effs) => onChange(upsertEventEffects(reactions, ev.eventId, effs))}
            />
          </div>
        )
      })}
    </div>
  )
}

export function NodeInspector({
  graph,
  nodeId,
  videoOptions = [],
  packs = [],
  overlays,
  onChange,
  onPacksChange,
  onJump,
}: {
  graph: GameGraph
  nodeId: string | null
  videoOptions?: string[]
  /** 本局子蓝图包（随 scenario 保存）。 */
  packs?: readonly SubFlowPackDef[]
  overlays?: Record<string, Overlay>
  onChange: (g: GameGraph) => void
  onPacksChange?: (packs: SubFlowPackDef[]) => void
  onJump?: (id: string) => void
}): JSX.Element {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>点画布上的节点以编辑</div>
  const d = node.data
  const nodeIds = graph.nodes.map((n) => n.id)
  /** 下拉展示：名称优先，id 作后缀（名称与 id 相同时只显示一份）。 */
  const nodeLabel = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    const name = n?.data.name?.trim()
    if (!name || name === id) return id
    return `${name} (${id})`
  }
  const mediaRef = d.media?.ref ?? ''
  // 当前引用若不在资产清单里也要能显示（避免选中项丢失）。
  const videoChoices = mediaRef && !videoOptions.includes(mediaRef) ? [mediaRef, ...videoOptions] : videoOptions

  const nestRef = getSubFlow(d)
  const nestPack = getSubFlowPack(d)
  const nestMode: 'none' | 'subflow' | 'pack' = nestPack ? 'pack' : nestRef ? 'subflow' : 'none'
  const packKey = nestPack
    ? (nestPack.version ? `${nestPack.id}@${nestPack.version}` : nestPack.id)
    : ''
  const packLabel = (p: SubFlowPackDef) => {
    const title = p.title?.trim()
    const key = `${p.id}@${p.version}`
    return title && title !== p.id ? `${title} (${key})` : key
  }

  const patchData = (p: NodeDataPatch) => onChange(updateNodeData(graph, node.id, p))
  const setNestMode = (mode: 'none' | 'subflow' | 'pack') => {
    if (mode === 'none') {
      patchData({ subFlow: undefined, subFlowPack: undefined })
      return
    }
    if (mode === 'subflow') {
      const entry = nodeIds.find((id) => id !== node.id)
      patchData({ subFlow: nestRef ?? entry, subFlowPack: undefined })
      return
    }
    if (nestPack) {
      patchData({ subFlow: undefined })
      return
    }
    const existing = packs[0]
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
          <button onClick={() => onJump?.(node.id)}>▶ 从此跑</button>
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
          value={mediaRef}
          onChange={(e) => patchData({ media: e.target.value ? { kind: 'VIDEO', ref: e.target.value } : undefined })}
          style={{ flex: 1 }}
          title="选择该演出节点播放的视频（来自现有资产）"
        >
          <option value="">（无演出）</option>
          {videoChoices.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      ))}
      {row('时长ms', <input type="number" value={d.durationMs ?? 0} onChange={(e) => patchData({ durationMs: Number(e.target.value) || undefined })} style={{ flex: 1 }} />)}
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
        <select
          value={nestRef ?? ''}
          onChange={(e) => patchData({ subFlow: e.target.value || undefined, subFlowPack: undefined })}
          style={{ flex: 1 }}
          title="进入本容器后下钻到所选本图入口；子流程叶子无出边时弹回续 out"
        >
          <option value="">（选入口）</option>
          {nodeIds.filter((id) => id !== node.id).map((id) => (
            <option key={id} value={id}>{nodeLabel(id)}</option>
          ))}
        </select>
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
                patchData({ subFlow: undefined, subFlowPack: { id: pack.id, version: pack.version } })
              }}
              style={{ flex: 1 }}
              title="引用 scenario.packs 中的包；双击容器下钻编辑包内图"
            >
              <option value="">（选包）</option>
              {packs.map((p) => (
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>覆盖物事件</b>
          <select
            value=""
            onChange={(e) => {
              const oid = e.target.value
              if (!oid) return
              const mounts = [...(d.overlayNodes ?? [])]
              if (mounts.some((m) => overlayMountId(m) === oid || m.overlay === oid)) return
              mounts.push({ overlay: oid })
              patchData({ overlayNodes: mounts })
            }}
            title="从目录追加一张 overlay 挂载"
            style={{ maxWidth: 140, fontSize: 11 }}
          >
            <option value="">＋ 挂载…</option>
            {Object.keys(overlays ?? {}).map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        {(d.overlayNodes ?? []).length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>尚未挂载；可上拉选择或在视频/界面编辑器添加</div>
        ) : (
          (d.overlayNodes ?? []).map((mount, i) => {
            const mid = overlayMountId(mount)
            const multi = (d.overlayNodes?.length ?? 0) > 1
            const events = aggregateOverlayEvents(overlays?.[mount.overlay], getComponentManifest, {
              mountId: mid,
              prefixMount: multi,
            })
            return (
              <div key={`${mid}-${i}`} style={{ marginTop: 8, border: '1px solid #333', borderRadius: 6, padding: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12 }}>
                    <b>{mid}</b>
                    {mount.id && mount.id !== mount.overlay ? (
                      <span style={{ opacity: 0.55, marginLeft: 6 }}>→ {mount.overlay}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    style={{ color: '#ff6b6b', fontSize: 11 }}
                    onClick={() => {
                      const next = (d.overlayNodes ?? []).filter((_, j) => j !== i)
                      patchData({ overlayNodes: next.length ? next : undefined })
                    }}
                  >
                    移除
                  </button>
                </div>
                <OverlayReactionsEditor
                  events={events}
                  reactions={mount.reactions}
                  onChange={(reactions) => {
                    const next = (d.overlayNodes ?? []).map((m, j) => (j === i ? { ...m, reactions } : m))
                    patchData({ overlayNodes: next })
                  }}
                />
              </div>
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
          onChange={(reactions) => patchData({ reactions })}
        />
      </div>

      {/* 出边（走向 SSOT）：target + condition + weight；副作用请用上方 reactions */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>出边（走向）</b>
          <button onClick={() => onChange(connect(graph, { source: node.id, sourceHandle: 'out', target: nodeIds.find((x) => x !== node.id) ?? node.id }))}>+ 边</button>
        </div>
        {graph.edges.filter((e) => e.source === node.id).map((e) => (
          <div key={e.id} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }}>
            {row('出口', <input value={e.sourceHandle ?? 'out'} onChange={(ev) => onChange(reconnect(graph, e.id, { sourceHandle: ev.target.value }))} style={{ flex: 1 }} />)}
            {row('目标', (
              <select value={e.target} onChange={(ev) => onChange(reconnect(graph, e.id, { target: ev.target.value }))}>
                {nodeIds.map((id) => <option key={id} value={id}>{nodeLabel(id)}</option>)}
              </select>
            ))}
            {row('label', <input value={e.data?.label ?? ''} onChange={(ev) => onChange(updateEdgeData(graph, e.id, { label: ev.target.value }))} style={{ flex: 1 }} />)}
            {row('weight', <input type="number" value={e.data?.weight ?? 0} onChange={(ev) => onChange(updateEdgeData(graph, e.id, { weight: Number(ev.target.value) || undefined }))} style={{ flex: 1 }} />)}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>condition（AND 全部成立）</div>
            <ConditionEditor
              value={e.data?.condition}
              nodeIds={nodeIds}
              onChange={(condition) => onChange(updateEdgeData(graph, e.id, { condition: condition as GraphCondition }))}
            />
            <button style={{ color: '#ff6b6b', marginTop: 4 }} onClick={() => onChange(disconnect(graph, e.id))}>🗑 删除边</button>
          </div>
        ))}
      </div>
    </div>
  )
}
