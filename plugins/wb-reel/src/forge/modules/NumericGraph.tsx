import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useScenarioStore } from '../../scenario/scenarioStore'
import { computeStoryGraphLayout } from '../../scenario/layout'
import { describeCondition } from '../../player/conditionEval'
import {
  VarDefRow,
  EffectListEditor,
  ItemEffectListEditor,
  BranchGateEditor,
  ConditionRow,
  makeDefaultClause,
} from '../../editor/numeric/NumericEditors'
import type {
  ConditionClause,
  EntryGate,
  GameVariable,
  InventoryItem,
  Scenario,
  Scene,
} from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * NumericGraph —— 「模块 · 数值系统」的专用紧凑节点图。
 *
 * 设计（作者反馈「要一个紧凑的节点图编辑器，节点增减/门槛、连线决定分支/隐→显」）：
 *   - 左侧画布：复用 storytree 的 dagre 布局，把每个 scene 画成小节点；节点上用徽标
 *     一眼标出「Δ本节点数值变化」「⛓ 进入门槛」。连线 = 分支；带解锁条件的连线
 *     画成高亮虚线并标出条件（= 隐藏/锁定的「隐→显」关系）。
 *   - 右侧 inspector：选中节点后内联编辑 进入效果 / 进入门槛 / 各分支条件&效果，
 *     全部复用 src/editor/numeric 的共享行编辑器，和时间轴侧栏改一处两处生效。
 *   - 顶部：全局变量 CRUD。
 *
 * 只读取/写入 scenario，不持久化画布坐标（坐标来自 dagre + scene.pos），拖动是
 * 临时的，刷新按布局复位 —— 数值图重在「看清门槛/分支关系」，不是又一张要维护
 * 坐标的剧情树。
 */

const NODE_W = 210
const NODE_H = 92

interface NumNodeData {
  label: string
  /** 进入本节点的数值变化条数。 */
  effects: number
  /** 进入本节点的获得/消耗物品条数。 */
  itemEffects: number
  gate: 'none' | 'redirect' | 'block'
  /** 出向分支总数 / 其中带解锁条件的条数。 */
  branches: number
  conditional: number
  isEnding: boolean
  selected: boolean
  [key: string]: unknown
}

function NumNode({ data }: NodeProps) {
  const d = data as NumNodeData
  const hasMeta = d.effects > 0 || d.itemEffects > 0 || d.gate !== 'none' || d.conditional > 0
  return (
    <div className={`ks-ng-node${d.selected ? ' is-sel' : ''}${d.isEnding ? ' is-ending' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="ks-ng-node-head">
        {d.isEnding && <span className="ks-ng-node-flag" title="结局节点">◆ 结局</span>}
        <div className="ks-ng-node-title" title={d.label}>
          {d.label}
        </div>
      </div>
      <div className="ks-ng-node-chips">
        {d.effects > 0 && (
          <span className="ks-ng-chip ks-ng-chip-eff" title="进入本节点时的数值变化">
            数值 ×{d.effects}
          </span>
        )}
        {d.itemEffects > 0 && (
          <span className="ks-ng-chip ks-ng-chip-item" title="进入本节点时获得/消耗物品">
            物品 ×{d.itemEffects}
          </span>
        )}
        {d.gate !== 'none' && (
          <span
            className={`ks-ng-chip ks-ng-chip-gate${d.gate === 'block' ? ' is-block' : ''}`}
            title={d.gate === 'redirect' ? '有进入门槛 · 不满足改道' : '有进入门槛 · 不满足阻断'}
          >
            {d.gate === 'redirect' ? '门槛·改道' : '门槛·阻断'}
          </span>
        )}
        {d.conditional > 0 && (
          <span className="ks-ng-chip ks-ng-chip-cond" title="带解锁条件的分支数">
            条件分支 ×{d.conditional}
          </span>
        )}
        {!hasMeta && <span className="ks-ng-chip ks-ng-chip-plain">无数值规则</span>}
      </div>
      <div className="ks-ng-node-foot">{d.branches} 条出向分支</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const NODE_TYPES: NodeTypes = { num: NumNode }

function gateKind(scene: Scene): 'none' | 'redirect' | 'block' {
  if (!scene.entryGate) return 'none'
  return scene.entryGate.onFail === 'redirect' ? 'redirect' : 'block'
}

function NumericGraphInner() {
  const scenario = useScenarioStore((s) => s.scenario)
  const upsertVariable = useScenarioStore((s) => s.upsertVariable)
  const removeVariable = useScenarioStore((s) => s.removeVariable)

  const variables = useMemo(
    () => Object.values(scenario.variables ?? {}),
    [scenario.variables],
  )
  const items = useMemo(() => Object.values(scenario.items ?? {}), [scenario.items])

  const [selectedId, setSelectedId] = useState<string | null>(scenario.rootSceneId ?? null)

  // 用 dagre 布局算坐标；scene 增删/连线变化时重算。
  const layout = useMemo(
    () =>
      computeStoryGraphLayout(scenario, {
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        nodeSep: 26,
        rankSep: 120,
      }),
    [scenario],
  )

  const initialNodes = useMemo<Node[]>(() => {
    return Object.values(scenario.scenes).map((sc) => {
      const rect = layout[sc.id]
      const branchList = sc.branches ?? []
      const conditional = branchList.filter((b) => (b.condition?.all?.length ?? 0) > 0).length
      return {
        id: sc.id,
        type: 'num',
        position: { x: rect?.x ?? 0, y: rect?.y ?? 0 },
        data: {
          label: sc.title || sc.id,
          effects: sc.onEnterEffects?.length ?? 0,
          itemEffects: sc.onEnterItemEffects?.length ?? 0,
          gate: gateKind(sc),
          branches: branchList.length,
          conditional,
          isEnding: sc.isEnding === true,
          selected: sc.id === selectedId,
        } satisfies NumNodeData,
      }
    })
    // selectedId 单独在下方 effect 同步，避免每次选中都重算坐标
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.scenes, layout])

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    for (const sc of Object.values(scenario.scenes)) {
      for (const b of sc.branches ?? []) {
        if (!b.targetSceneId || !scenario.scenes[b.targetSceneId]) continue
        const cond = describeCondition(b, scenario)
        out.push({
          id: `${sc.id}__${b.id}`,
          source: sc.id,
          target: b.targetSceneId,
          label: cond || undefined,
          animated: !!cond,
          className: cond ? 'ks-ng-edge-cond' : 'ks-ng-edge',
          style: cond
            ? { stroke: 'var(--color-brand-primary)', strokeDasharray: '5 4' }
            : { stroke: 'var(--color-border-strong, #555)' },
        })
      }
    }
    return out
  }, [scenario])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(edges)

  // scenario 结构变化（重算布局/徽标）时刷新节点；edges 同理。
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])
  useEffect(() => {
    setRfEdges(edges)
  }, [edges, setRfEdges])

  // 选中态变化时只更新 data.selected，不动坐标（拖过的位置保留）。
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...(n.data as NumNodeData), selected: n.id === selectedId },
      })),
    )
  }, [selectedId, setNodes])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedId(node.id)
  }, [])

  function addVariable(): void {
    const n = variables.length + 1
    const id = `var_${Date.now().toString(36)}`
    upsertVariable({ id, name: `数值${n}`, kind: 'number', initial: 0 })
  }

  const selectedScene = selectedId ? scenario.scenes[selectedId] : undefined

  return (
    <div className="ks-ng-root">
      {/* 顶部：全局变量 */}
      <div className="ks-ng-vars">
        <div className="ks-ng-vars-head">
          <span className="ks-ng-vars-title">全局变量</span>
          <button type="button" className="ks-ne-addbtn ks-ng-addvar" onClick={addVariable}>
            ＋ 变量
          </button>
        </div>
        <div className="ks-ng-vars-list">
          {variables.length === 0 ? (
            <div className="ks-ne-empty">还没有变量 · 例如「好感度」「线索数」</div>
          ) : (
            variables.map((v) => (
              <VarDefRow
                key={v.id}
                variable={v}
                onChange={(patch) => upsertVariable({ ...v, ...patch })}
                onRemove={() => removeVariable(v.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="ks-ng-body">
        {/* 画布 */}
        <div className="ks-ng-canvas">
          <ReactFlow
            nodes={nodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
          <div className="ks-ng-legend">
            <span><i className="ks-ng-leg-cond" /> 带解锁条件（隐/锁）</span>
            <span><i className="ks-ng-leg-plain" /> 普通分支</span>
          </div>
        </div>

        {/* Inspector */}
        <aside className="ks-ng-inspector">
          {selectedScene ? (
            <SceneNumericInspector
              key={selectedScene.id}
              scene={selectedScene}
              scenario={scenario}
              variables={variables}
              items={items}
            />
          ) : (
            <div className="ks-ne-empty">点选左侧节点编辑其数值/门槛/分支</div>
          )}
        </aside>
      </div>
    </div>
  )
}

function SceneNumericInspector({
  scene,
  scenario,
  variables,
  items,
}: {
  scene: Scene
  scenario: Scenario
  variables: GameVariable[]
  items: InventoryItem[]
}) {
  const updateScene = useScenarioStore((s) => s.updateScene)
  const updateBranch = useScenarioStore((s) => s.updateBranch)
  const branches = scene.branches ?? []

  const isRoot = scenario.rootSceneId === scene.id
  const noVars = variables.length === 0

  return (
    <div className="ks-ng-insp-scroll">
      <header className="ks-ng-insp-head">
        <div className="ks-ng-insp-title" title={scene.title}>
          {scene.title || scene.id}
        </div>
        <div className="ks-ng-insp-roles">
          {isRoot && <span className="ks-ng-role is-root">起点</span>}
          {scene.isEnding && <span className="ks-ng-role is-ending">结局</span>}
          <span className="ks-ng-role">{branches.length} 条分支</span>
        </div>
      </header>

      {noVars && (
        <div className="ks-ng-tip">
          还没有<b>全局变量</b>。先在最上方「全局变量」加一个（如「好感度」「线索数」），
          才能在这里设置数值变化与门槛。
        </div>
      )}

      {/* 进入即触发 */}
      <section className="ks-ng-card">
        <div className="ks-ng-card-head">
          <span className="ks-ng-card-ico ico-enter">➕</span>
          <div className="ks-ng-card-headtext">
            <div className="ks-ng-card-title">进入这个节点时</div>
            <div className="ks-ng-card-hint">玩家一走到这里就立即生效（每轮只触发一次）</div>
          </div>
        </div>
        <div className="ks-ng-card-body">
          <div className="ks-ne-sublabel">
            <span className="ks-ne-sublabel-txt">数值变化</span>
            <span className="ks-ne-sublabel-hint">如 好感度 +5</span>
          </div>
          <EffectListEditor
            variables={variables}
            effects={scene.onEnterEffects ?? []}
            onChange={(effects) =>
              updateScene(scene.id, { onEnterEffects: effects.length ? effects : undefined })
            }
          />
          {items.length > 0 && (
            <>
              <div className="ks-ne-sublabel">
                <span className="ks-ne-sublabel-txt">物品变化</span>
                <span className="ks-ne-sublabel-hint">如 获得 钥匙</span>
              </div>
              <ItemEffectListEditor
                items={items}
                effects={scene.onEnterItemEffects ?? []}
                onChange={(itemEffects) =>
                  updateScene(scene.id, {
                    onEnterItemEffects: itemEffects.length ? itemEffects : undefined,
                  })
                }
              />
            </>
          )}
        </div>
      </section>

      {/* 进入门槛 */}
      <section className="ks-ng-card">
        <div className="ks-ng-card-head">
          <span className="ks-ng-card-ico ico-gate">🔒</span>
          <div className="ks-ng-card-headtext">
            <div className="ks-ng-card-title">进入门槛</div>
            <div className="ks-ng-card-hint">不满足条件就无法进入 —— 可改道别处，或直接挡住</div>
          </div>
        </div>
        <div className="ks-ng-card-body">
          <EntryGateEditor scene={scene} scenario={scenario} variables={variables} items={items} />
        </div>
      </section>

      {/* 出向分支 */}
      <section className="ks-ng-card">
        <div className="ks-ng-card-head">
          <span className="ks-ng-card-ico ico-branch">🌿</span>
          <div className="ks-ng-card-headtext">
            <div className="ks-ng-card-title">从这里出发的分支</div>
            <div className="ks-ng-card-hint">给分支加解锁条件，玩家选中后还能改数值/物品</div>
          </div>
        </div>
        <div className="ks-ng-card-body">
          {branches.length === 0 ? (
            <div className="ks-ne-empty">本节点还没有分支 · 去剧情树连线</div>
          ) : (
            branches.map((b) => (
              <BranchGateEditor
                key={b.id}
                branch={b}
                scenario={scenario}
                variables={variables}
                items={items}
                onPatch={(patch) => updateBranch(scene.id, b.id, patch)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

/** 进入门槛编辑器：条件(AND) + 不满足处理(改道/阻断) + 改道目标 + 提示。 */
function EntryGateEditor({
  scene,
  scenario,
  variables,
  items,
}: {
  scene: Scene
  scenario: Scenario
  variables: GameVariable[]
  items: InventoryItem[]
}) {
  const updateScene = useScenarioStore((s) => s.updateScene)
  const gate = scene.entryGate
  const clauses = gate?.condition.all ?? []
  const sceneOptions = useMemo(
    () =>
      Object.values(scenario.scenes)
        .filter((s) => s.id !== scene.id)
        .map((s) => ({ id: s.id, title: s.title ?? s.id })),
    [scenario.scenes, scene.id],
  )

  function patchGate(next: Partial<EntryGate> | null): void {
    if (next === null) {
      updateScene(scene.id, { entryGate: undefined })
      return
    }
    const base: EntryGate = gate ?? { condition: { all: [] }, onFail: 'redirect' }
    updateScene(scene.id, { entryGate: { ...base, ...next } })
  }

  function setClauses(nextClauses: ConditionClause[]): void {
    if (nextClauses.length === 0 && !gate) return
    patchGate({ condition: { all: nextClauses } })
  }

  if (!gate) {
    return (
      <button
        type="button"
        className="ks-ne-addbtn"
        onClick={() =>
          patchGate({ condition: { all: [makeDefaultClause(variables, sceneOptions)] } })
        }
      >
        ＋ 设置进入门槛
      </button>
    )
  }

  return (
    <div className="ks-ng-gate">
      <div className="ks-ng-gate-head">
        <span className="ks-ne-sublabel-txt">需全部满足才能进入</span>
        <button type="button" className="ks-ne-del" title="移除门槛" onClick={() => patchGate(null)}>
          ✕
        </button>
      </div>

      {clauses.map((c, i) => (
        <ConditionRow
          key={i}
          clause={c}
          variables={variables}
          sceneOptions={Object.values(scenario.scenes).map((s) => ({
            id: s.id,
            title: s.title ?? s.id,
          }))}
          items={items}
          onChange={(nc) => setClauses(clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => setClauses(clauses.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        className="ks-ne-addbtn"
        onClick={() => setClauses([...clauses, makeDefaultClause(variables, sceneOptions)])}
      >
        ＋ 条件
      </button>

      <div className="ks-ng-gate-row">
        <label className="ks-ng-gate-field">
          <span>不满足时</span>
          <select
            value={gate.onFail}
            onChange={(e) => patchGate({ onFail: e.target.value as 'redirect' | 'block' })}
          >
            <option value="redirect">改道到</option>
            <option value="block">阻断进入</option>
          </select>
        </label>
        {gate.onFail === 'redirect' && (
          <label className="ks-ng-gate-field">
            <span>目标</span>
            <select
              value={gate.redirectSceneId ?? ''}
              onChange={(e) => patchGate({ redirectSceneId: e.target.value || undefined })}
            >
              <option value="">—— 选择改道目标 ——</option>
              {sceneOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <input
        className="ks-ng-gate-hint"
        value={gate.hint ?? ''}
        onChange={(e) => patchGate({ hint: e.target.value || undefined })}
        placeholder="提示文案（可选，如：线索不足，先去现场调查）"
      />
    </div>
  )
}

export function NumericGraph() {
  return (
    <ReactFlowProvider>
      <NumericGraphInner />
    </ReactFlowProvider>
  )
}

const css = `
.ks-ng-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.ks-ng-vars {
  flex-shrink: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-default);
}
.ks-ng-vars-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ks-ng-vars-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
}
.ks-ng-addvar { padding: 3px 10px; }
.ks-ng-vars-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow: auto;
}
.ks-ng-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
}
.ks-ng-canvas {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background: var(--color-background-base);
}
.ks-ng-canvas .react-flow__attribution { display: none; }
.ks-ng-legend {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 5;
  display: flex;
  gap: 14px;
  padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--color-background-elevated) 86%, transparent);
  border: 1px solid var(--color-border-subtle);
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}
.ks-ng-legend span { display: inline-flex; align-items: center; gap: 5px; }
.ks-ng-legend i { width: 16px; height: 0; border-top-width: 2px; border-top-style: solid; }
.ks-ng-leg-cond { border-top-style: dashed !important; border-top-color: var(--color-brand-primary); }
.ks-ng-leg-plain { border-top-color: var(--color-border-strong, #666); }

.ks-ng-node {
  width: ${NODE_W}px;
  min-height: ${NODE_H}px;
  box-sizing: border-box;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--color-background-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  display: flex;
  flex-direction: column;
  gap: 7px;
  cursor: pointer;
  transition: border-color .12s, box-shadow .12s, transform .12s;
}
.ks-ng-node:hover { transform: translateY(-1px); border-color: var(--color-border-strong, #777); }
.ks-ng-node.is-sel {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px var(--color-brand-primary), 0 6px 18px rgba(0,0,0,0.34);
}
.ks-ng-node.is-ending {
  border-color: color-mix(in srgb, #f5a3c0 55%, var(--color-border-default));
  background: linear-gradient(180deg, color-mix(in srgb, #f5a3c0 8%, var(--color-background-elevated)), var(--color-background-elevated));
}
.ks-ng-node-head { display: flex; flex-direction: column; gap: 3px; }
.ks-ng-node-flag {
  align-self: flex-start;
  font-size: 9px; font-weight: 800; letter-spacing: 0.05em;
  color: #f5a3c0; background: color-mix(in srgb, #f5a3c0 16%, transparent);
  padding: 1px 6px; border-radius: 999px;
}
.ks-ng-node-title {
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ks-ng-node-chips { display: flex; gap: 5px; flex-wrap: wrap; }
.ks-ng-chip {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  line-height: 1.5;
  white-space: nowrap;
}
.ks-ng-chip-eff {
  color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent);
}
.ks-ng-chip-item {
  color: #67d4a6;
  background: color-mix(in srgb, #67d4a6 16%, transparent);
}
.ks-ng-chip-gate {
  color: #fbbf24;
  background: color-mix(in srgb, #fbbf24 18%, transparent);
}
.ks-ng-chip-gate.is-block {
  color: #f87171;
  background: color-mix(in srgb, #f87171 18%, transparent);
}
.ks-ng-chip-cond {
  color: #c4a6ff;
  background: color-mix(in srgb, #c4a6ff 18%, transparent);
}
.ks-ng-chip-plain {
  color: var(--color-text-tertiary);
  background: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);
}
.ks-ng-node-foot {
  font-size: 10px;
  color: var(--color-text-tertiary);
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 5px;
}
.ks-ng-node .react-flow__handle {
  width: 8px;
  height: 8px;
  background: var(--color-border-strong, #777);
  border: 2px solid var(--color-background-elevated);
}

.ks-ng-inspector {
  flex: 0 0 360px;
  width: 360px;
  min-height: 0;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-background-base);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ks-ng-insp-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ks-ng-insp-head { display: flex; flex-direction: column; gap: 6px; }
.ks-ng-insp-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1.3;
}
.ks-ng-insp-roles { display: flex; gap: 6px; flex-wrap: wrap; }
.ks-ng-role {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--color-text-tertiary);
  background: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);
}
.ks-ng-role.is-root { color: #8fb3ff; background: color-mix(in srgb, #8fb3ff 16%, transparent); }
.ks-ng-role.is-ending { color: #f5a3c0; background: color-mix(in srgb, #f5a3c0 16%, transparent); }
.ks-ng-tip {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #fbbf24 35%, var(--color-border-subtle));
  background: color-mix(in srgb, #fbbf24 7%, transparent);
}
.ks-ng-tip b { color: var(--color-text-primary); }
.ks-ng-card {
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-background-elevated);
  overflow: hidden;
}
.ks-ng-card-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.ks-ng-card-ico {
  flex: 0 0 auto;
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px;
  font-size: 13px;
  background: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);
}
.ks-ng-card-ico.ico-enter { background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent); }
.ks-ng-card-ico.ico-gate { background: color-mix(in srgb, #fbbf24 18%, transparent); }
.ks-ng-card-ico.ico-branch { background: color-mix(in srgb, #67d4a6 16%, transparent); }
.ks-ng-card-headtext { flex: 1 1 auto; min-width: 0; }
.ks-ng-card-title { font-size: 12.5px; font-weight: 700; color: var(--color-text-primary); }
.ks-ng-card-hint { font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.4; }
.ks-ng-card-body {
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ks-ng-gate {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid color-mix(in srgb, #fbbf24 35%, var(--color-border-subtle));
  border-radius: var(--radius-md, 8px);
  padding: 8px;
  background: color-mix(in srgb, #fbbf24 5%, transparent);
}
.ks-ng-gate-head { display: flex; align-items: center; justify-content: space-between; }
.ks-ng-gate-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ks-ng-gate-field { display: flex; flex-direction: column; gap: 3px; flex: 1 1 auto; }
.ks-ng-gate-field > span { font-size: 9.5px; color: var(--color-text-tertiary); }
.ks-ng-gate-field select {
  height: 26px;
  font-size: 11px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  font-family: inherit;
}
.ks-ng-gate-hint {
  height: 26px;
  padding: 0 7px;
  font-size: 11px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  font-family: inherit;
}
`
injectStyleOnce('numeric-graph', css)
