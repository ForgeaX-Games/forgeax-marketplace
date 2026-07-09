/**
 * NodeInspector —— 节点配置面板（P4）。选中画布节点后编辑其 `node.data` 与出边。
 *
 * 常用字段走 typed 输入（name/durationMs/mediaPlayMode/end、元素 kind/role/trigger、边 handle/target/weight/label）；
 * 结构化参数走**可视化构造器**（editors.tsx）：effects / condition / 选项 都是类型化控件，替代裸 JSON；
 * 不认识的 kind/字段仍回退 JSON 框。一切改动经 graph-edit 纯函数不可变写回 SSOT。
 */
import type { ReactNode } from 'react'
import type { GameGraph, ElementRole, GraphCondition, GraphEffect, NodeHud, TimelineElement, TriggerSpec } from '../../runtime/schema/graph-schema'
import { connect, disconnect, reconnect, removeNode, updateEdgeData, updateNodeData } from '../../graph/edit/graph-edit'
import { ConditionEditor, EffectsEditor, OptionsEditor, type ChoiceOptionLike } from './editors'
import { INTERACTION_SKINS } from '../../runtime/skins/components'

/** 交互皮肤组件下拉：空=通用按钮，其余=注册的皮肤 id。 */
function ComponentSelect({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }): JSX.Element {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value || undefined)} style={{ flex: 1 }}>
      <option value="">通用（默认按钮）</option>
      {INTERACTION_SKINS.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  )
}

// 下拉中文标签（值保持英文枚举，仅展示对齐原做法）。
const ROLE_LABEL: Record<string, string> = { presentation: '表现', logic: '逻辑', interaction: '交互' }
const WHEN_LABEL: Record<string, string> = { enter: '进入时', at: '到时(ms)', performanceEnd: '演出结束', exit: '离开时', afterHit: '命中后', stateChange: '状态变化' }
const QTE_LABEL: Record<string, string> = { parry: '完美防反', timing: '打点', mash: '连打', sequence: '连招', sweep: '划动' }
const SHOW_LABEL: Record<string, string> = { always: '常驻', battle: '战斗中', qte: 'QTE时', never: '隐藏' }

const ROLES: ElementRole[] = ['presentation', 'logic', 'interaction']
const WHENS: TriggerSpec['when'][] = ['enter', 'at', 'performanceEnd', 'exit', 'afterHit', 'stateChange']
const QTE_KINDS = ['parry', 'timing', 'mash', 'sequence', 'sweep']

/** 常见 kind 的 params 用类型化控件；其余回退 JSON。 */
function ElementParamsEditor({
  kind,
  params,
  nodeIds,
  onChange,
  jsonKey,
}: {
  kind: string
  params: Record<string, unknown>
  nodeIds: string[]
  onChange: (params: Record<string, unknown>) => void
  jsonKey: string
}): JSX.Element {
  const merge = (p: Record<string, unknown>) => onChange({ ...params, ...p })
  const num = (k: string): number | undefined => (typeof params[k] === 'number' ? (params[k] as number) : undefined)
  const str = (k: string): string => (typeof params[k] === 'string' ? (params[k] as string) : '')

  if (kind === 'settle') {
    return <EffectsEditor value={params.effects as GraphEffect[] | undefined} onChange={(effects) => merge({ effects })} />
  }
  if (kind === 'choice' || kind === 'skill') {
    return (
      <div>
        {row('提示', <input value={str('prompt')} onChange={(e) => merge({ prompt: e.target.value })} style={{ flex: 1 }} />)}
        {row('限时ms', <input type="number" value={num('timeoutMs') ?? 0} onChange={(e) => merge({ timeoutMs: Number(e.target.value) || undefined })} style={{ flex: 1 }} />)}
        {row('超时key', <input value={str('defaultKey')} onChange={(e) => merge({ defaultKey: e.target.value || undefined })} style={{ flex: 1 }} />)}
        {row('组件', <ComponentSelect value={str('component')} onChange={(c) => merge({ component: c })} />)}
        <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>选项</div>
        <OptionsEditor value={params.options as ChoiceOptionLike[] | undefined} onChange={(options) => merge({ options })} />
      </div>
    )
  }
  if (kind === 'qte') {
    const cues = (Array.isArray(params.cues) ? params.cues : []) as Array<{ atMs?: number; label?: string }>
    const setCues = (c: Array<{ atMs?: number; label?: string }>) => merge({ cues: c })
    return (
      <div>
        {row('QTE型', (
          <select value={str('qteKind') || 'parry'} onChange={(e) => merge({ qteKind: e.target.value })}>
            {QTE_KINDS.map((q) => <option key={q} value={q}>{QTE_LABEL[q] ?? q}</option>)}
          </select>
        ))}
        {row('组件', <ComponentSelect value={str('component')} onChange={(c) => merge({ component: c })} />)}
        {row('窗口ms', <input type="number" value={num('windowMs') ?? 0} onChange={(e) => merge({ windowMs: Number(e.target.value) || undefined })} style={{ flex: 1 }} />)}
        {row('过关次', <input type="number" value={num('passingHits') ?? 0} onChange={(e) => merge({ passingHits: Number(e.target.value) || undefined })} style={{ flex: 1 }} />)}
        <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>cue 时间点（相对演出 ms）</div>
        {cues.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
            <input type="number" value={c.atMs ?? 0} onChange={(e) => setCues(cues.map((x, idx) => (idx === i ? { ...x, atMs: Number(e.target.value) || 0 } : x)))} placeholder="ms" style={{ width: 90 }} />
            <input value={c.label ?? ''} onChange={(e) => setCues(cues.map((x, idx) => (idx === i ? { ...x, label: e.target.value || undefined } : x)))} placeholder="标签" style={{ flex: 1 }} />
            <button style={{ color: '#ff6b6b' }} onClick={() => setCues(cues.filter((_, idx) => idx !== i))}>×</button>
          </div>
        ))}
        <button onClick={() => setCues([...cues, { atMs: 0 }])}>+ cue</button>
      </div>
    )
  }
  if (kind === 'dialogue') {
    return (
      <div>
        {row('说话人', <input value={str('speaker')} onChange={(e) => merge({ speaker: e.target.value || undefined })} style={{ flex: 1 }} />)}
        {row('台词', <input value={str('text')} onChange={(e) => merge({ text: e.target.value })} style={{ flex: 1 }} />)}
        {row('颜色', <input value={str('color')} onChange={(e) => merge({ color: e.target.value || undefined })} placeholder="#ffd54a" style={{ flex: 1 }} />)}
      </div>
    )
  }
  if (kind === 'transition') {
    return (
      <div>
        {row('时长ms', <input type="number" value={num('durationMs') ?? 600} onChange={(e) => merge({ durationMs: Number(e.target.value) || undefined })} style={{ flex: 1 }} />)}
        {row('样式', (
          <select value={str('style') || 'fade'} onChange={(e) => merge({ style: e.target.value })}>
            <option value="fade">淡入淡出</option>
            <option value="wipe">擦除</option>
          </select>
        ))}
        {row('颜色', <input value={str('color')} onChange={(e) => merge({ color: e.target.value || undefined })} placeholder="#000000" style={{ flex: 1 }} />)}
      </div>
    )
  }
  if (kind === 'floatText') {
    return (
      <div>
        {row('文案', <input value={str('text')} onChange={(e) => merge({ text: e.target.value || undefined })} placeholder="含 {v} 用 expr 替换" style={{ flex: 1 }} />)}
        {row('表达式', <input value={str('expr')} onChange={(e) => merge({ expr: e.target.value || undefined })} placeholder="entity.x.attr.hp" style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }} />)}
        {row('x', <input type="number" step="0.05" value={num('x') ?? 0.5} onChange={(e) => merge({ x: Number(e.target.value) })} style={{ width: 90 }} />)}
        {row('y', <input type="number" step="0.05" value={num('y') ?? 0.45} onChange={(e) => merge({ y: Number(e.target.value) })} style={{ width: 90 }} />)}
        {row('颜色', <input value={str('color')} onChange={(e) => merge({ color: e.target.value || undefined })} placeholder="#ffd54a" style={{ flex: 1 }} />)}
      </div>
    )
  }
  // 未知 kind → JSON 回退（含 hotspot 等）
  return jsonArea(params, (v) => onChange(v as Record<string, unknown>), jsonKey)
}

function row(label: string, node: ReactNode): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      {node}
    </label>
  )
}

function jsonArea(defaultValue: unknown, onCommit: (v: unknown) => void, key: string): JSX.Element {
  return (
    <textarea
      key={key}
      defaultValue={JSON.stringify(defaultValue ?? {}, null, 0)}
      onBlur={(e) => {
        try {
          onCommit(JSON.parse(e.target.value || '{}'))
        } catch {
          e.target.style.borderColor = '#e54d4d'
        }
      }}
      style={{ width: '100%', minHeight: 42, fontFamily: 'monospace', fontSize: 11, background: '#111', color: '#ddd', border: '1px solid #333' }}
    />
  )
}

export function NodeInspector({
  graph,
  nodeId,
  videoOptions = [],
  onChange,
  onJump,
}: {
  graph: GameGraph
  nodeId: string | null
  videoOptions?: string[]
  onChange: (g: GameGraph) => void
  onJump?: (id: string) => void
}): JSX.Element {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>点画布上的节点以编辑</div>
  const d = node.data
  const outEdges = graph.edges.filter((e) => e.source === node.id)
  const nodeIds = graph.nodes.map((n) => n.id)
  const mediaRef = d.media?.ref ?? ''
  // 当前引用若不在资产清单里也要能显示（避免选中项丢失）。
  const videoChoices = mediaRef && !videoOptions.includes(mediaRef) ? [mediaRef, ...videoOptions] : videoOptions

  const patchData = (p: Partial<typeof d>) => onChange(updateNodeData(graph, node.id, p))
  const patchEl = (i: number, p: Partial<TimelineElement>) =>
    patchData({ timeline: d.timeline.map((e, idx) => (idx === i ? { ...e, ...p } : e)) })
  const patchHud = (p: Partial<NodeHud>) => patchData({ hud: { ...d.hud, ...p } })
  const hudEls = d.hud?.elements ?? []

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
      {row('结局', (
        <select value={d.end ?? ''} onChange={(e) => patchData({ end: (e.target.value || undefined) as typeof d.end })}>
          <option value="">（非结局）</option>
          <option value="victory">胜利</option>
          <option value="defeat">失败</option>
          <option value="ending">结局</option>
        </select>
      ))}
      {row('回调者', (
        <input
          type="checkbox"
          checked={!!d.returnsToCaller}
          onChange={(e) => patchData({ returnsToCaller: e.target.checked || undefined })}
          title="本节点结束且无自动出边时，弹调用栈回到 caller（配合出边 call）"
        />
      ))}
      {row('子流程', (
        <select
          value={d.subFlowRef ?? ''}
          onChange={(e) => patchData({ subFlowRef: e.target.value || undefined })}
          style={{ flex: 1 }}
          title="本节点作为子流程容器：进入即下钻到所选入口节点，子流程 returnsToCaller 结束后弹回续 out"
        >
          <option value="">（非子流程）</option>
          {nodeIds.filter((id) => id !== node.id).map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      ))}

      {/* 时间线元素 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>时间线元素</b>
          <button
            onClick={() =>
              patchData({
                timeline: [
                  ...d.timeline,
                  { id: `el-${Date.now().toString(36)}`, role: 'logic', kind: 'settle', trigger: { when: 'enter' }, params: {} },
                ],
              })
            }
          >
            + 元素
          </button>
        </div>
        {d.timeline.map((el, i) => (
          <div key={el.id} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }}>
            {row('kind', <input value={el.kind} onChange={(e) => patchEl(i, { kind: e.target.value })} style={{ flex: 1 }} />)}
            {row('职责', (
              <select value={el.role} onChange={(e) => patchEl(i, { role: e.target.value as ElementRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
              </select>
            ))}
            {row('触发', (
              <select value={el.trigger.when} onChange={(e) => patchEl(i, { trigger: { when: e.target.value as 'enter' } as TriggerSpec })}>
                {WHENS.map((w) => <option key={w} value={w}>{WHEN_LABEL[w] ?? w}</option>)}
              </select>
            ))}
            {el.trigger.when === 'at' && row('ms', <input type="number" value={el.trigger.ms} onChange={(e) => patchEl(i, { trigger: { when: 'at', ms: Number(e.target.value) } })} style={{ flex: 1 }} />)}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>params</div>
            <ElementParamsEditor
              kind={el.kind}
              params={el.params}
              nodeIds={nodeIds}
              onChange={(params) => patchEl(i, { params })}
              jsonKey={`${node.id}-${el.id}-p`}
            />
            <button style={{ marginTop: 4 }} onClick={() => patchData({ timeline: d.timeline.filter((_, idx) => idx !== i) })}>删除元素</button>
          </div>
        ))}
      </div>

      {/* 界面（节点级 HUD 覆盖，配合场景全局 ui.hud） */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>界面（HUD）</b>
          <button onClick={() => patchHud({ elements: [...hudEls, { element: '', showDuring: 'always' }] })}>+ 元素</button>
        </div>
        <div style={{ opacity: 0.55, fontSize: 11, margin: '2px 0' }}>元素键=实体 id / 变量 id / score；覆盖场景全局显示规则。</div>
        {row('预设', <input value={d.hud?.preset ?? ''} onChange={(e) => patchHud({ preset: e.target.value || undefined })} placeholder="battle / narrative…" style={{ flex: 1 }} />)}
        {hudEls.map((h, i) => {
          const setEls = (next: typeof hudEls) => patchHud({ elements: next })
          return (
            <div key={i} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }}>
              {row('元素', <input value={h.element} onChange={(e) => setEls(hudEls.map((x, idx) => (idx === i ? { ...x, element: e.target.value } : x)))} placeholder="ent-boss" style={{ flex: 1 }} />)}
              {row('显示', (
                <select value={h.showDuring ?? 'always'} onChange={(e) => setEls(hudEls.map((x, idx) => (idx === i ? { ...x, showDuring: e.target.value as 'always' | 'battle' | 'qte' } : x)))}>
                  {['always', 'battle', 'qte'].map((s) => <option key={s} value={s}>{SHOW_LABEL[s] ?? s}</option>)}
                </select>
              ))}
              {row('可见', <input type="checkbox" checked={h.visible !== false} onChange={(e) => setEls(hudEls.map((x, idx) => (idx === i ? { ...x, visible: e.target.checked } : x)))} />)}
              <button style={{ color: '#ff6b6b' }} onClick={() => setEls(hudEls.filter((_, idx) => idx !== i))}>删除</button>
            </div>
          )
        })}
      </div>

      {/* 出边 */}
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>出边（走向）</b>
          <button onClick={() => onChange(connect(graph, { source: node.id, sourceHandle: 'out', target: nodeIds.find((x) => x !== node.id) ?? node.id }))}>+ 边</button>
        </div>
        {outEdges.map((e) => (
          <div key={e.id} style={{ border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }}>
            {row('出口', <input value={e.sourceHandle ?? 'out'} onChange={(ev) => onChange(reconnect(graph, e.id, { sourceHandle: ev.target.value }))} style={{ flex: 1 }} />)}
            {row('目标', (
              <select value={e.target} onChange={(ev) => onChange(reconnect(graph, e.id, { target: ev.target.value }))}>
                {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            ))}
            {row('label', <input value={e.data?.label ?? ''} onChange={(ev) => onChange(updateEdgeData(graph, e.id, { label: ev.target.value }))} style={{ flex: 1 }} />)}
            {row('weight', <input type="number" value={e.data?.weight ?? 0} onChange={(ev) => onChange(updateEdgeData(graph, e.id, { weight: Number(ev.target.value) || undefined }))} style={{ flex: 1 }} />)}
            {row('call', (
              <input
                type="checkbox"
                checked={!!e.data?.call}
                onChange={(ev) => onChange(updateEdgeData(graph, e.id, { call: ev.target.checked || undefined }))}
                title="走这条边时压入调用栈（子流程结束后可 returnsToCaller 弹回）"
              />
            ))}
            <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>condition（AND 全部成立）</div>
            <ConditionEditor
              value={e.data?.condition}
              nodeIds={nodeIds}
              onChange={(condition) => onChange(updateEdgeData(graph, e.id, { condition: condition as GraphCondition }))}
            />
            <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0 2px' }}>effects</div>
            <EffectsEditor value={e.data?.effects} onChange={(effects) => onChange(updateEdgeData(graph, e.id, { effects }))} />
            <button style={{ color: '#ff6b6b', marginTop: 4 }} onClick={() => onChange(disconnect(graph, e.id))}>🗑 删除边</button>
          </div>
        ))}
      </div>
    </div>
  )
}
