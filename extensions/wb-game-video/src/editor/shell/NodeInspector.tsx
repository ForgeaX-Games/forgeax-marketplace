/**
 * NodeInspector —— 节点配置面板。选中画布节点后编辑其 `node.data`、overlay reactions 与出边。
 * Overlay 事件作者 SSOT = 各挂载 `overlayNodes[].reactions`；走向经 do 内 advance + 边。
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Entity, GameGraph, GraphCondition, Overlay, SubFlowPackDef, Variable } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'
import type { NodeAction, Reaction, OverlayEventRef } from '../../runtime/schema/node-config-schema'
import { overlayMountId } from '../../runtime/schema/node-config-schema'
import { aggregateOverlayEvents, resolveEventReactionDo } from '../../runtime/schema/overlay-events'
import { resolveMountChildren } from '../../runtime/schema/expand-overlay'
import { deriveOutputs, getComponentManifest } from '../../runtime/registry/component-registry'
import { connect, disconnect, reconnect, removeNode, updateEdgeData, updateNodeData, makeEmptySubFlowPack, type NodeDataPatch } from '../../graph/edit/graph-edit'
import { mergeFlowHandles, flowHandleDisplay } from '../../graph/flow-handle-labels'
import { ConditionEditor, EffectsEditor, type EditorPickerCtx } from './editors'
import { SpawnInputsEditor } from './spawn-inputs-editor'
import { ComponentFormFields } from './component-form-fields'

function row(label: string, node: ReactNode): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      {node}
    </label>
  )
}

/** 与引擎 resolveEventReactions 同序查找挂载 event 反应的 do（兼容 A / panelA:A 等写法）。 */
function eventReactionDo(reactions: Reaction[] | undefined, ev: OverlayEventRef): NodeAction[] {
  return resolveEventReactionDo(reactions, ev.localEventId, ev.childId, ev.mountId) ?? []
}

/** eventKeys 全集：替换某事件反应时移除所有别名，写入规范 eventId。 */
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
  if (doActions.length) rest.push({ when: { type: 'event', id: ev.eventId }, do: doActions })
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
      <button type="button" onClick={() => commit([...life, { when: { type: 'enter' }, do: [] }])}>
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
  onChange,
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
  onChange: (next: Reaction[] | undefined) => void
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.6 }}>
        组件点击/交互时在此配置响应（效果 / 生成组件 / 沿边推进）；走向必须能看出目标节点。
      </div>
      {events.map((ev) => {
        const actions = eventReactionDo(reactions, ev)
        const hint = routeHints?.[ev.eventId] ?? routeHints?.[ev.localEventId]
        const hasAdvance = actions.some((a) => a.kind === 'advance')
        return (
          <div key={ev.eventId} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }} title={`child=${ev.childId} · local=${ev.localEventId}`}>
              <b>{overlayEventLabel(ev)}</b>
            </div>
            {hint ? (
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4, color: hasAdvance ? '#9cdcfe' : '#ce9178' }}>
                {hasAdvance ? '沿边推进' : '默认推进'} {hint}
              </div>
            ) : (
              <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>无出边 · 只做副作用、不换节点</div>
            )}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '2px 0' }}>触发时 do</div>
            <NodeActionsEditor
              actions={actions}
              edgeOptions={edgeOptions}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={catalog}
              onChange={(doActions) => onChange(upsertEventReaction(reactions, ev, doActions))}
            />
          </div>
        )
      })}
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
        <div key={i} style={{ border: '1px solid #242424', borderRadius: 6, padding: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, opacity: 0.7 }}>
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
                <select value={a.from} onChange={(e) => patchAt(i, { ...a, from: e.target.value })} style={{ flex: 1 }}>
                  <option value="">（选组件模板）</option>
                  {spawnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))}
              {row('存活ms', (
                <input type="number" value={a.ttlMs ?? 0} onChange={(e) => patchAt(i, { ...a, ttlMs: Number(e.target.value) || undefined })} style={{ flex: 1 }} title="0=常驻直到离场" />
              ))}
              <SpawnInputsEditor
                from={a.from}
                inputs={a.inputs}
                overlays={overlays}
                onChange={(inputs) => patchAt(i, { ...a, inputs })}
              />
            </>
          ) : null}
          {a.kind === 'advance' ? (
            <>
              {row('走边', (
                <select value={a.edgeId} onChange={(e) => patchAt(i, { kind: 'advance', edgeId: e.target.value })} style={{ flex: 1 }}>
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
        <button type="button" onClick={() => onChange([...actions, { kind: 'effect', effects: [] }])}>＋ 效果</button>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {rules.length === 0 ? <div style={{ fontSize: 11, opacity: 0.6 }}>无响应规则</div> : null}
      {rules.map((r, i) => {
        const w = r.when as Extract<Reaction['when'], { type: 'watch' } | { type: 'shown' } | { type: 'hidden' }>
        return (
          <div key={i} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
              <select value={w.type} onChange={(e) => setType(i, e.target.value as ReactiveType)} style={{ fontSize: 12 }}>
                {(['watch', 'shown', 'hidden'] as ReactiveType[]).map((t) => <option key={t} value={t}>{REACTIVE_LABEL[t]}</option>)}
              </select>
              <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={() => commit(rules.filter((_, j) => j !== i))}>移除</button>
            </div>
            {w.type === 'watch' ? (
              <>
                <WatchFieldEditor
                  tree={fieldTree}
                  value={w.of}
                  onChange={(of) => patchAt(i, { ...r, when: { ...w, of } })}
                />
                {row('方向', (
                  <select value={w.on ?? 'change'} onChange={(e) => patchAt(i, { ...r, when: { ...w, on: e.target.value as 'change' | 'inc' | 'dec' } })} style={{ flex: 1 }}>
                    <option value="change">变化</option>
                    <option value="inc">增加</option>
                    <option value="dec">减少</option>
                  </select>
                ))}
              </>
            ) : (
              row('组件', (
                <select value={w.of} onChange={(e) => patchAt(i, { ...r, when: { type: w.type, of: e.target.value } })} style={{ flex: 1 }}>
                  <option value="">（选组件）</option>
                  {componentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))
            )}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0 2px' }}>动作 do</div>
            <NodeActionsEditor
              actions={r.do}
              edgeOptions={edgeOptions}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={pickers}
              onChange={(acts) => patchAt(i, { ...r, do: acts })}
            />
          </div>
        )
      })}
      <button type="button" onClick={() => commit([...rules, { when: { type: 'watch', of: '', on: 'change' }, do: [] }])}>
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
      {row('备注', (
        <input
          value={edge.data?.label ?? ''}
          onChange={(ev) => onPatchData({ label: ev.target.value })}
          style={{ flex: 1 }}
          placeholder="画布连线上的说明（可选）"
        />
      ))}
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
  packs = [],
  overlays,
  entities,
  variables,
  onChange,
  onPacksChange,
  onDropOverlayIfOrphan,
  onJump,
}: {
  graph: GameGraph
  nodeId: string | null
  videoOptions?: VideoOption[]
  /** 本局子蓝图包（随 scenario 保存）。 */
  packs?: readonly SubFlowPackDef[]
  overlays?: Record<string, Overlay>
  /** 场景实体 / 变量目录（供 effects / condition 下拉、选取式公式与 watch 字段级联下拉）。 */
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onChange: (g: GameGraph) => void
  onPacksChange?: (packs: SubFlowPackDef[]) => void
  /**
   * 卸载某挂载后，请上层用完整 scenario（主图 + 所有子蓝图包）判断该 overlay 是否已无人引用，
   * 无引用则清理孤儿副本。本组件只看得到 canvasGraph，无法自行判断跨图引用，故上抛。
   */
  onDropOverlayIfOrphan?: (overlayId: string) => void
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
  const overlayLabel = (id: string) => {
    const title = overlays?.[id]?.title?.trim()
    if (!title || title === id) return id
    return `${title} (${id})`
  }
  // 「默认样式 / ＋ 挂载」只列界面方案；node:* 是时间轴内容容器，不当整体方案选。
  const schemeOverlayIds = Object.keys(overlays ?? {}).filter((id) => !id.startsWith('node:'))
  const mediaRef = d.media?.ref ?? ''
  // 当前引用若不在资产清单里也要能显示（避免选中项丢失）。
  const videoChoices: VideoOption[] = (() => {
    if (!mediaRef) return videoOptions
    if (videoOptions.some((v) => v.id === mediaRef)) return videoOptions
    return [{ id: mediaRef, label: mediaRef }, ...videoOptions]
  })()

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
  const pickers: EditorPickerCtx = { entities, variables, nodeLabel }
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
          label: `${flowHandleDisplay(e.sourceHandle ?? 'default', e.data?.label)} → ${nodeLabel(e.target)}`,
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
          <button
            onClick={() => onJump?.(node.id)}
            title="调试：从这个节点开始试玩（沿用当前血量/变量等状态，不改图、不设为起点）"
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
          value={mediaRef}
          onChange={(e) => patchData({ media: e.target.value ? { kind: 'VIDEO', ref: e.target.value } : undefined })}
          style={{ flex: 1 }}
          title="选择该演出节点播放的视频（内置战斗/叙事包 + 共享素材层，对齐视频 tab）"
        >
          <option value="">（无演出）</option>
          {videoChoices.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      ))}
      {row('播放', (
        <select value={d.mediaPlayMode ?? 'once'} onChange={(e) => patchData({ mediaPlayMode: e.target.value as 'once' | 'loop' })}>
          <option value="once">播放一次</option>
          <option value="loop">循环</option>
        </select>
      ))}
      {row('播放时长', (
        <input
          type="number"
          min={0}
          value={d.durationMs ?? ''}
          onChange={(e) => {
            const v = e.target.value.trim()
            patchData({ durationMs: v === '' ? undefined : Math.max(0, Math.floor(Number(v)) || 0) })
          }}
          placeholder="留空 = 视频完整长度"
          style={{ flex: 1 }}
          title="毫秒。留空 / 0 / 超过视频本身长度 → 以视频完整长度为准；填 >0 且 ≤ 视频长度 → 到点提前收演出。无视频的逻辑节点用它作停留节拍。"
        />
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

      {/* 默认样式方案：不挂载、不常驻渲染——只给本节点将来新增的字幕/飘字/滤镜/特效提供默认样式（同类型组件取方案里第一个，
          多个同类型样式时在素材检视器「方案样式」下拉里切）。 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        {row('默认样式', (
          <select
            value={d.styleScheme ?? ''}
            onChange={(e) => patchData({ styleScheme: e.target.value || undefined })}
            style={{ flex: 1 }}
            title="选一套方案作本节点默认样式：新增字幕/飘字/滤镜/特效时自动套用方案里同类型组件的参数（同类型有多个时取第一个，可在素材检视器里切换）；方案本身不挂载、不出现在时间轴/预览里"
          >
            <option value="">（无）</option>
            {schemeOverlayIds.map((id) => (
              <option key={id} value={id}>{overlayLabel(id)}</option>
            ))}
          </select>
        ))}
      </div>

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
              mounts.push({ overlay: oid })
              patchData({ overlayNodes: mounts })
            }}
            title="从目录追加一张 overlay 挂载（常驻：全部组件同时生效，适合 HUD）"
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
            const events = aggregateOverlayEvents(overlays?.[mount.overlay], getComponentManifest, {
              mountId: mid,
              prefixMount: multi,
            })
            const mountTitle = overlays?.[mount.overlay]?.title?.trim()
            return (
              <div key={`${mid}-${i}`} style={{ marginTop: 8, border: '1px solid #333', borderRadius: 6, padding: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12 }}>
                    <b>{mountTitle && mountTitle !== mid ? `${mountTitle} (${mid})` : mid}</b>
                    {mount.id && mount.id !== mount.overlay ? (
                      <span style={{ opacity: 0.55, marginLeft: 6 }}>→ {mount.overlay}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    style={{ color: '#ff6b6b', fontSize: 11 }}
                    onClick={() => {
                      const addedCount = mount.added?.length ?? 0
                      // 「添加控件」二级栏拖入的组件落在这份挂载的 added[] 里；移除挂载连带删除它们，先提示。
                      if (addedCount > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                        const ok = window.confirm(`将同时删除 ${addedCount} 个由此方案添加到时间轴的组件，是否确认移除挂载？`)
                        if (!ok) return
                      }
                      const removed = mount.overlay
                      const next = (d.overlayNodes ?? []).filter((_, j) => j !== i)
                      patchData({ overlayNodes: next.length ? next : undefined })
                      // 卸载节点专属副本（node:*）→ 交上层用完整 scenario 判断并清理孤儿。
                      if (removed.startsWith('node:')) onDropOverlayIfOrphan?.(removed)
                    }}
                  >
                    移除
                  </button>
                </div>
                {(() => {
                  const mountChildren = resolveMountChildren(overlays, mount)
                  if (!mountChildren.length) return null
                  return (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, opacity: 0.7, margin: '2px 0' }}>组件参数（inputs）</div>
                      {mountChildren.map((child) => {
                        const compName = getComponentManifest(child.component)?.label ?? child.component
                        return (
                          <div key={child.id} style={{ border: '1px solid #262626', borderRadius: 6, padding: 6, marginBottom: 4 }}>
                            <div style={{ fontSize: 11, marginBottom: 2 }}>
                              <b>{child.id}</b> <span style={{ opacity: 0.6 }}>· {compName}</span>
                            </div>
                            <ComponentFormFields
                              componentId={child.component}
                              values={(child.inputs ?? {}) as Record<string, unknown>}
                              onChange={(next) => setChildInputs(i, child.id, next)}
                              pickers={pickers}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
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
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, lineHeight: 1.45 }}>
          先连到目标即可跑通：不设条件时，播完会走<strong>第一条</strong>「默认推进」边（多条无条件时可调权重）。
          「交互出口」只在选项 / QTE 结果分支时再改；画布拖线默认也是默认推进。
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
    </div>
  )
}
