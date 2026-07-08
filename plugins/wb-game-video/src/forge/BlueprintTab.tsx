import { memo, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useScenarioStore } from '../scenario/scenarioStore'
import { getNodiaBlueprintDemoScenario } from '../scenario/demoScenario'
import { useShellStore } from '../shell/shellStore'
import { BlueprintGameplayPanel } from './BlueprintGameplayPanel'
import { resolveBranchEdgeStyle } from '../editor/storygraph/BranchEdge'
import {
  BPG_CANVAS_GRID_CSS,
  BPG_LEGEND,
  BPG_NODE_W,
  BPG_TYPE_ACCENTS,
  type BpgTypeClass,
} from '../editor/storygraph/blueprintGraphStyle'
import { handleSceneNodeDragStop } from '../editor/storygraph/sceneNodeHandlers'
import { computeStoryGraphLayout, type NodeRect } from '../scenario/layout'
import { injectStyleOnce } from '../styles/injectStyle'
import type { BranchKind, Scenario } from '../scenario/types'
import { scenarioToBlueprint } from '../blueprint/scenarioToBlueprint'
import type {
  GameVideoBlueprintEdge,
  GameVideoBlueprintNode,
} from '../blueprint/blueprint-schema'

/**
 * BlueprintTab —— 「蓝图」视图(玩法结构总览)。
 *
 * 与「剧情树」并列、**同一个 Scenario**(SSOT)，只是渲染侧重不同:剧情树重叙事节点编辑，
 * 蓝图重玩法骨架——按 Scene.kind 上色、把 Boss/QTE/限时选择/门槛/热点 以角标标出，
 * 连线叠加条件/数值效果标记。横向(LR)流程图式布局，全画布只读导航。
 *
 * 复用:computeStoryGraphLayout(同一布局引擎) + 统一分支连线样式。
 * 作者拖过的节点坐标落在 scene.pos, 持久化进 Scenario; 再次进入 / AI 改剧本时以 pos 为准。
 */
export function BlueprintTab() {
  return (
    <ReactFlowProvider>
      <BlueprintInner />
    </ReactFlowProvider>
  )
}

const NODE_W = BPG_NODE_W
const NODE_H = 96

function BlueprintInner() {
  const scenario = useScenarioStore((s) => s.scenario)
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const selectScene = useScenarioStore((s) => s.selectScene)
  const setScenePos = useScenarioStore((s) => s.setScenePos)
  const pinAllScenePositions = useScenarioStore((s) => s.pinAllScenePositions)
  const resetLayout = useScenarioStore((s) => s.resetLayout)
  const loadScenario = useScenarioStore((s) => s.loadScenario)
  const stageSceneId = useShellStore((s) => s.stageSceneId)
  const forgeView = useShellStore((s) => s.forgeView)
  const { fitView } = useReactFlow()

  // 蓝图是「视频脉络编辑图」：点击节点 = 就地选中并编辑其玩法配置，
  // 选中态以 selectedSceneId 为准（点击即更新），不被外部 stageSceneId 抢占。
  const activeId = selectedSceneId ?? stageSceneId
  const [panelOpen, setPanelOpen] = useState(false)
  const [graphStack, setGraphStack] = useState<string[]>([])
  const currentGraphId = graphStack[graphStack.length - 1]

  // 进入蓝图不自动展开「配置」面板 —— 只有用户点击节点（onNodeClick /
  // onNodeDoubleClick 里显式 setPanelOpen(true)）才打开，避免一进来就被面板挡住画布。
  useEffect(() => {
    setGraphStack([])
  }, [scenario.id])

  // 蓝图图（新 schema）是节点/连线的 SSOT —— 编辑器与试玩运行时走同一张图，
  // 不再各自从 Scenario.branches 派生（消除「所见 ≠ 所跑」）。
  const graph = useMemo(() => scenarioToBlueprint(scenario, currentGraphId), [scenario, currentGraphId])

  // 把「每个节点按内容估算的真实高度」喂给 dagre —— 否则用固定 NODE_H(96) 会低估
  // 分支/角标多的节点（实测可达 ~150px），同列相邻节点竖向叠在一起（作者反馈的
  // 「初始化就堆叠遮挡」）。宽度恒为 NODE_W；高度宁可略高（只多留白，绝不重叠）。
  const nodeSizes = useMemo(() => {
    const outCount = new Map<string, number>()
    for (const e of graph.edges) {
      outCount.set(e.sourceRef, (outCount.get(e.sourceRef) ?? 0) + 1)
    }
    const sizes: Record<string, { width: number; height: number }> = {}
    for (const node of graph.nodes) {
      sizes[node.id] = {
        width: NODE_W,
        height: estimateNodeHeight(node, outCount.get(node.id) ?? 0),
      }
    }
    return sizes
  }, [graph])

  const layout = useMemo(
    () =>
      computeStoryGraphLayout(scenario, {
        direction: 'LR',
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        nodeSep: 26,
        rankSep: 64,
        marginX: 24,
        marginY: 24,
        nodeSizes,
      }),
    [scenario, nodeSizes],
  )

  const crumbs = useMemo(
    () => [
      { id: undefined as string | undefined, label: scenario.title || '顶层蓝图' },
      ...graphStack.map((id) => ({
        id,
        label: graph.subflows?.[id]?.title ?? id,
      })),
    ],
    [graph.subflows, graphStack, scenario.title],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    const outgoingByNode = new Map<string, GameVideoBlueprintEdge[]>()
    for (const e of graph.edges) {
      const list = outgoingByNode.get(e.sourceRef) ?? []
      list.push(e)
      outgoingByNode.set(e.sourceRef, list)
    }

    const nextNodes: Node[] = []
    for (const node of graph.nodes) {
      const rect = layout[node.id]
      if (!rect) continue
      nextNodes.push({
        id: node.id,
        type: 'bp',
        position: { x: rect.x, y: rect.y },
        data: deriveNodeData(node, outgoingByNode.get(node.id) ?? [], scenario, node.id === activeId),
        draggable: true,
        selectable: true,
      })
    }

    // 收集「当前画布可见」的节点矩形 —— 只用 graph.nodes（当前图/子图渲染的节点），
    // 不能用 Object.values(layout)（含未渲染的子蓝图场景，会把车道无谓地抬到半空）。
    const visibleRects: NodeRect[] = []
    for (const node of graph.nodes) {
      const rect = layout[node.id]
      if (rect) visibleRects.push(rect)
    }

    const nextEdges: Edge[] = []
    for (const e of graph.edges) {
      if (!layout[e.sourceRef] || !layout[e.targetRef]) continue
      const loopback = isLoopbackEdge(e, layout)
      // 回环边返程车道**按本条边自己算**：只抬到「水平方向真正与这条边跨度相交」的
      // 可见节点顶缘之上，而不是全图最高节点。这样拖动线跨度之外的节点不会改变车道
      // （线保持不动，符合「拖了不相关节点、线不该动」的直觉）；只有真正会被这条线
      // 经过/遮挡的节点才影响它。源/目标自身必在跨度内，故也一定被清到。
      const loopbackLaneY = loopback
        ? loopbackLaneFor(layout[e.sourceRef]!, layout[e.targetRef]!, visibleRects)
        : undefined
      nextEdges.push({
        id: e.id,
        source: e.sourceRef,
        target: e.targetRef,
        sourceHandle: e.id,
        type: 'bpBranch',
        animated: false,
        // 所有连线都落在节点「之下」（z 0 = react-flow 默认 edge 在 node 之下），
        // 与原型 `.bpg-wires{z-index:0}` vs `.bpg-node{z-index:1}` 对齐——线永不覆盖节点。
        zIndex: 0,
        data: {
          kind: e.extension?.kind ?? 'auto',
          label: e.name,
          hasCondition: !!e.extension?.condition,
          effectCount: e.extension?.effects?.length ?? 0,
          loopback,
          loopbackLaneY,
        },
      })
    }
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [graph, layout, activeId, scenario, setNodes, setEdges])

  // 首批节点就绪 / 换剧本 / 切到蓝图视图 → 适配全景。
  //
  // 必须把 forgeView 纳入触发：ForgeTab 用 `hidden`(display:none) 切视图，蓝图面板
  // 在隐藏期间容器尺寸为 0，此时 fitView 会按 0×0 计算、节点全挤到左上角。等用户
  // 切到「蓝图」(forgeView==='blueprint') 面板才有真实尺寸——这一刻重跑 fitView 才框得对。
  useEffect(() => {
    if (nodes.length === 0) return
    if (forgeView !== 'blueprint') return
    const t = requestAnimationFrame(() => fitView({ padding: 0.18, duration: 0, maxZoom: 1 }))
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, scenario.id, forgeView])

  return (
    <div className="ks-bp">
      <div className="ks-bp-crumbs" aria-label="蓝图面包屑">
        {crumbs.map((c, i) => {
          const active = i === crumbs.length - 1
          return (
            <button
              key={c.id ?? '__top'}
              type="button"
              className={active ? 'is-active' : ''}
              onClick={() => {
                if (!active) setGraphStack((prev) => prev.slice(0, i))
              }}
            >
              {c.label}
            </button>
          )
        })}
        {currentGraphId && <span className="ks-bp-crumb-hint">双击子蓝图节点继续下钻</span>}
        <button
          type="button"
          className="ks-bp-demo-btn"
          onClick={() => loadScenario(getNodiaBlueprintDemoScenario())}
        >
          载入战斗蓝图 Demo
        </button>
      </div>
      <div className="ks-bp-legend" aria-label="蓝图图例">
        {BPG_LEGEND.map((l) => (
          <span key={l.typeClass} className="ks-bp-legend-item">
            <span
              className="ks-bp-legend-swatch"
              style={{ background: BPG_TYPE_ACCENTS[l.typeClass] }}
              aria-hidden
            />
            {l.label}
          </span>
        ))}
        <span className="ks-bp-legend-sep" aria-hidden />
        <span className="ks-bp-legend-item">🔒 门槛/条件</span>
      </div>

      <div className="ks-bp-canvas">
        {nodes.length === 0 ? (
          <div className="ks-bp-empty">
            <span className="ks-bp-empty-glyph" aria-hidden>◇</span>
            <span className="ks-bp-empty-text">还没有可展示的玩法结构</span>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={BP_NODE_TYPES}
            edgeTypes={BP_EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_e, node) => {
              selectScene(node.id)
              setPanelOpen(true)
            }}
            onNodeDoubleClick={(_e, node) => {
              const subFlowRef = (node.data as BPNodeData).subFlowRef
              if (!subFlowRef || !graph.subflows?.[subFlowRef]) return
              selectScene(node.id)
              setPanelOpen(true)
              setGraphStack((prev) => [...prev, subFlowRef])
            }}
            onNodeDragStop={(_e, node) => {
              // 「拖谁只动谁」：把当前画布上所有节点的位置一次性 pin 进 scene.pos，
              // dagre 从此不再碰任何人 —— 否则只 pin 被拖节点，其余仍是 dynamic，
              // 下一次重算布局会被 dagre 重新摆放（作者看到的「拖一个、其它全跳」，
              // 以及刷新后「只剩这一个记住、其余重排」）。pinAllScenePositions 只写
              // 尚未 pin 的节点，所以第二次起不会产生多余历史。
              const positions: Record<string, { x: number; y: number }> = {}
              for (const n of nodes) {
                positions[n.id] = { x: n.position.x, y: n.position.y }
              }
              positions[node.id] = { x: node.position.x, y: node.position.y }
              pinAllScenePositions(positions)
              // 被拖节点若已 pin（demo / 第二次拖），pinAll 会跳过它，必须单独写落点。
              handleSceneNodeDragStop(node.id, node.position, {
                selectScene,
                setScenePos,
                dispatchFocusStage: () => {},
              })
            }}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            zoomOnScroll
            panOnScroll={false}
            panOnDrag
          >
          </ReactFlow>
        )}
        {nodes.length > 0 && (
          <button
            type="button"
            className="ks-bp-autolayout"
            title="自适应排版：清除手动拖动的位置，用默认算法重新排布并框选全景"
            onClick={() => {
              // 清掉所有 scene.pos → 布局完全交回 dagre（默认排版），覆盖手动拖动。
              resetLayout()
              // 等 setNodes 提交 + react-flow 重新测量后再框全景（双 rAF 保证时序）。
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  fitView({ padding: 0.18, duration: 300, maxZoom: 1 }),
                ),
              )
            }}
          >
            <span aria-hidden>⤢</span>
            自适应
          </button>
        )}
        {nodes.length > 0 && activeId && panelOpen && (
          <BlueprintGameplayPanel onCollapse={() => setPanelOpen(false)} />
        )}
      </div>
    </div>
  )
}

/* ── 节点数据派生 ─────────────────────────────────────────── */

interface BadgeSpec {
  glyph: string
  text: string
  tone: 'boss' | 'qte' | 'timed' | 'gate' | 'hotspot' | 'subflow'
}

interface BranchPin {
  id: string
  label: string
  hasCondition: boolean
}

interface BPNodeData extends Record<string, unknown> {
  title: string
  kindLabel: string
  typeClass: BpgTypeClass
  accent: string
  isRoot: boolean
  isEnding: boolean
  isSelected: boolean
  badges: BadgeSpec[]
  branches: BranchPin[]
  hasInput: boolean
  subFlowRef?: string
}

function branchPinLabel(label: string | undefined, kind: BranchKind, index: number): string {
  const t = label?.trim()
  if (t) return t
  if (kind === 'auto') return '自动'
  if (kind === 'choice') return `选项 ${index + 1}`
  if (kind === 'qte_pass') return 'QTE 成功'
  if (kind === 'qte_fail') return 'QTE 失败'
  return '输出'
}

/** 从蓝图节点派生画布视觉类别（对齐 resolveBpgType，但只读新 schema 字段）。 */
function bpgTypeOfNode(
  node: GameVideoBlueprintNode,
): { typeClass: BpgTypeClass; accent: string; kindLabel: string } {
  const ext = node.extensionElements
  if (node.elementType === 'start') {
    return { typeClass: 'root', accent: BPG_TYPE_ACCENTS.root, kindLabel: '起点' }
  }
  if (node.elementType === 'subflow') {
    return { typeClass: 'open', accent: BPG_TYPE_ACCENTS.open, kindLabel: '子蓝图' }
  }
  if (node.elementType === 'end' || ext.hud === 'ending') {
    return { typeClass: 'end', accent: BPG_TYPE_ACCENTS.end, kindLabel: '结局' }
  }
  if (ext.clipId || ext.mediaId) {
    return { typeClass: 'perf', accent: BPG_TYPE_ACCENTS.perf, kindLabel: '演出' }
  }
  return { typeClass: 'loop', accent: BPG_TYPE_ACCENTS.loop, kindLabel: '逻辑' }
}

/**
 * 估算蓝图节点渲染高度（px），喂给 dagre 让布局按真实占位排布、彼此不重叠。
 *
 * 结构与 BlueprintNode 渲染一致：标题条 + 输入/输出引脚区 + 底部信息区（类型行 +
 * 最多 2 个角标）。行数越多越高。刻意略微高估（宁多留白不重叠）。
 */
function estimateNodeHeight(node: GameVideoBlueprintNode, outCount: number): number {
  const TITLE_H = 34
  const hasInput = node.incoming.length > 0
  const bodyRows = Math.max(hasInput ? 1 : 0, outCount)
  const bodyH = 22 + bodyRows * 20
  // 底部信息区恒有「类型」行；再加最多 2 个角标行。
  const badgeCount = countBadges(node)
  const subH = 16 + (1 + Math.min(2, badgeCount)) * 15
  return Math.max(NODE_H, TITLE_H + bodyH + subH)
}

/** 统计节点会渲染出多少个角标（与 deriveNodeData 的 badge 逻辑保持一致）。 */
function countBadges(node: GameVideoBlueprintNode): number {
  const ext = node.extensionElements
  let n = 0
  if (ext.boss) n++
  if (ext.qte) n++
  if (ext.options && ext.options.length > 0) n++
  if (ext.dmgPoints && ext.dmgPoints.length > 0) n++
  if (ext.decision && ext.decision.optType === 'timed') n++
  if (ext.entryGate) n++
  if (ext.hotspots && ext.hotspots.length > 0) n++
  if (ext.subFlowRef) n++
  return n
}

function deriveNodeData(
  node: GameVideoBlueprintNode,
  outgoing: GameVideoBlueprintEdge[],
  scenario: Scenario,
  isSelected: boolean,
): BPNodeData {
  const ext = node.extensionElements
  const badges: BadgeSpec[] = []
  const { typeClass, accent, kindLabel } = bpgTypeOfNode(node)

  if (ext.boss) {
    const bossName = scenario.entities?.[ext.boss.entityId]?.name ?? 'Boss'
    const rounds = ext.boss.rounds?.length ?? 0
    badges.push({
      glyph: '☠',
      text: rounds > 0 ? `${bossName}·${rounds}回合` : bossName,
      tone: 'boss',
    })
  }
  if (ext.qte) {
    const n = ext.qte.cueMs?.length ?? 0
    const extra = [ext.qte.sequence ? '连段' : '', ext.qte.timeoutMs ? '限时' : '']
      .filter(Boolean)
      .join('·')
    badges.push({ glyph: '⏱', text: `QTE×${n}${extra ? `·${extra}` : ''}`, tone: 'qte' })
  }
  if (ext.options && ext.options.length > 0) {
    badges.push({ glyph: '◇', text: `选项×${ext.options.length}`, tone: 'timed' })
  }
  if (ext.dmgPoints && ext.dmgPoints.length > 0) {
    badges.push({ glyph: '✦', text: `判定×${ext.dmgPoints.length}`, tone: 'boss' })
  }
  if (ext.decision && ext.decision.optType === 'timed') {
    const sec = ext.decision.timeoutMs ? Math.round(ext.decision.timeoutMs / 1000) : null
    badges.push({ glyph: '⏳', text: sec ? `限时${sec}s` : '限时选择', tone: 'timed' })
  }
  if (ext.entryGate) {
    badges.push({ glyph: '🔒', text: '门槛', tone: 'gate' })
  }
  if (ext.hotspots && ext.hotspots.length > 0) {
    badges.push({ glyph: '⊕', text: `热点×${ext.hotspots.length}`, tone: 'hotspot' })
  }
  if (ext.subFlowRef) {
    const title = scenario.blueprintGraphs?.[ext.subFlowRef]?.title ?? '子蓝图'
    badges.push({ glyph: '▣', text: title, tone: 'subflow' })
  }

  const branches: BranchPin[] = outgoing.map((e, i) => ({
    id: e.id,
    label: branchPinLabel(e.name, e.extension?.kind ?? 'auto', i),
    hasCondition: !!e.extension?.condition,
  }))

  return {
    title: node.name,
    kindLabel,
    typeClass,
    accent,
    isRoot: node.elementType === 'start',
    isEnding: node.elementType === 'end' || ext.hud === 'ending',
    isSelected,
    badges,
    branches,
    hasInput: node.incoming.length > 0,
    subFlowRef: ext.subFlowRef,
  }
}

function pinTop(index: number, total: number): string {
  if (total <= 1) return '50%'
  return `${((index + 1) / (total + 1)) * 100}%`
}

function BlueprintNode({ data }: NodeProps<Node<BPNodeData, 'bp'>>) {
  const d = data
  const cls = [
    'ks-bpg-node',
    `ks-bpg-type-${d.typeClass}`,
    d.isSelected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const outs = d.branches
  return (
    <div className={cls} style={{ ['--bpc' as string]: d.accent }}>
      {d.hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="ks-bpg-handle ks-bpg-handle-in"
          style={{ top: '50%' }}
        />
      )}
      {outs.map((b, i) => (
        <Handle
          key={b.id}
          type="source"
          position={Position.Right}
          id={b.id}
          className="ks-bpg-handle ks-bpg-handle-out"
          style={{ top: pinTop(i, outs.length) }}
        />
      ))}
      <div className="ks-bpg-title" title={d.title}>
        {d.title}
      </div>
      <div className="ks-bpg-body">
        <div className="ks-bpg-col ks-bpg-in">
          {d.hasInput && (
            <div className="ks-bpg-pin">
              <span className="ks-bpg-pindot ks-bpg-pindot-in" aria-hidden />
              <span>输入</span>
            </div>
          )}
        </div>
        <div className="ks-bpg-col ks-bpg-out">
          {outs.map((b) => (
            <div key={b.id} className="ks-bpg-pin">
              {b.hasCondition && (
                <span className="ks-bpg-cond" title="有条件">
                  🔒
                </span>
              )}
              <span>{b.label}</span>
              <span className="ks-bpg-pindot" aria-hidden />
            </div>
          ))}
        </div>
      </div>
      {(d.badges.length > 0 || d.kindLabel) && (
        <div className="ks-bpg-sub">
          <div className="ks-bpg-srow">
            <span className="ks-bpg-sk">类型</span>
            <span className="ks-bpg-sv">{d.kindLabel}</span>
          </div>
          {d.badges.slice(0, 2).map((b, i) => (
            <div key={i} className="ks-bpg-srow" title={b.text}>
              <span className="ks-bpg-sk">{b.glyph}</span>
              <span className="ks-bpg-sv">{b.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── 连线（统一中性色；可选显示分支 label / 条件标记） ─────────── */

interface BPEdgeData extends Record<string, unknown> {
  kind: BranchKind
  label?: string
  hasCondition: boolean
  effectCount: number
  loopback?: boolean
  /** 回环边的「返程车道」Y（全图节点顶缘之上），使弧线整段绕开节点。 */
  loopbackLaneY?: number
}

/**
 * 回环边返程车道相对「可见最高节点顶缘」再上抬的间距（px）。
 *
 * 取值要点：当回环边的源/目标本身就是最高节点时（如「回合结束判定」回到「出手判断」），
 * 车道离顶缘太近会被该节点自身遮住。所以留够一档间距（约一个节点标题条高度以上），
 * 让弧线一出节点就抬到其上方空白处，既不遮挡也不至于飘到半空。
 */
const LOOPBACK_LANE_MARGIN = 120

const BlueprintEdge = memo(function BlueprintEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const d = (data ?? {}) as BPEdgeData
  const style = resolveBranchEdgeStyle(d.kind)
  const [path, labelX, labelY] = d.loopback
    ? getLoopbackPath(sourceX, sourceY, targetX, targetY, d.loopbackLaneY)
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })
  const marks: string[] = []
  if (d.hasCondition) marks.push('🔒')
  if (d.effectCount > 0) marks.push(`±${d.effectCount}`)
  const labelText = d.label?.trim() ?? ''
  const showLabel = labelText.length > 0 || marks.length > 0
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? '#e0795f' : style.stroke,
          strokeWidth: selected ? 3.6 : style.strokeWidth,
          fill: 'none',
          opacity: selected ? 1 : 0.92,
          strokeDasharray: style.strokeDasharray,
          filter: selected
            ? 'drop-shadow(0 0 5px rgba(224,121,95,.75))'
            : 'drop-shadow(0 1px 2px rgba(0,0,0,.55))',
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="ks-bp-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={labelText || undefined}
          >
            {labelText && <span>{labelText}</span>}
            {marks.length > 0 && <span className="ks-bp-edge-marks">{marks.join(' ')}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

function isLoopbackEdge(
  edge: GameVideoBlueprintEdge,
  layout: Record<string, { x: number; y: number; width: number; height: number }>,
): boolean {
  const source = layout[edge.sourceRef]
  const target = layout[edge.targetRef]
  if (!source || !target) return false
  return target.x + target.width < source.x
}

/**
 * 为一条回环边计算返程车道 Y（world 坐标）。
 *
 * 只考虑「水平方向与本条边跨度 [left, right] 相交」的可见节点顶缘，抬到其上
 * LOOPBACK_LANE_MARGIN。跨度外的节点（拖到别处、根本不在这条线下面的）不参与，
 * 所以拖动它们不会让这条线移动。源/目标自身一定在跨度内，故车道必在它们之上。
 */
function loopbackLaneFor(src: NodeRect, tgt: NodeRect, rects: NodeRect[]): number {
  const left = Math.min(src.x, tgt.x)
  const right = Math.max(src.x + src.width, tgt.x + tgt.width)
  let top = Math.min(src.y, tgt.y)
  for (const r of rects) {
    // x 区间相交（含源/目标自身）→ 这条线会横穿它上方，需要清到它顶缘之上
    if (r.x < right && r.x + r.width > left && r.y < top) {
      top = r.y
    }
  }
  return top - LOOPBACK_LANE_MARGIN
}

/**
 * 回环边走线：从源右侧引出 → 抬到全图节点之上的「返程车道」→ 平移回目标左侧落下。
 * 车道 Y(`laneY`) 取自全图最高节点顶缘之上，保证整段弧线都在节点外的空白处，
 * 不穿过任何节点；缺省时退回「源/目标上方 150px」的旧行为。
 */
function getLoopbackPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneY?: number,
): [string, number, number] {
  const topY = Math.min(laneY ?? Math.min(sourceY, targetY) - 150, sourceY - 40, targetY - 40)
  const sourceBendX = sourceX + 110
  const targetBendX = targetX - 110
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceBendX},${topY} ${targetBendX},${topY} ${targetX},${targetY}`,
  ].join(' ')
  // 文案落在弧线自身的中点（三次贝塞尔 t=0.5：系数 1/8·3/8·3/8·1/8），
  // 而非控制点车道高度 topY——否则车道被抬高后 label 会飘在线的上方。
  const labelX = 0.125 * sourceX + 0.375 * sourceBendX + 0.375 * targetBendX + 0.125 * targetX
  const labelY = 0.125 * (sourceY + targetY) + 0.75 * topY
  return [path, labelX, labelY]
}

const BP_NODE_TYPES: NodeTypes = { bp: BlueprintNode }
const BP_EDGE_TYPES: EdgeTypes = { bpBranch: BlueprintEdge }

injectStyleOnce('blueprint-tab', BP_CSS())

function BP_CSS(): string {
  return `
.ks-bp {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--color-background-elevated, #242424);
  color: var(--color-text-primary, #fff);
}
.ks-bp-crumbs {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px 0;
  background: var(--color-background-base, #191919);
}
.ks-bp-crumbs button {
  border: 0; background: transparent; color: var(--color-text-secondary, rgba(255,255,255,0.62));
  font-size: 12px; font-weight: 700; cursor: pointer; padding: 3px 0;
}
.ks-bp-crumbs button:not(:last-of-type)::after {
  content: '›'; margin-left: 6px; color: var(--color-text-tertiary, rgba(255,255,255,0.35));
}
.ks-bp-crumbs button.is-active { color: var(--color-text-primary, #fff); cursor: default; }
.ks-bp-crumb-hint { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary, rgba(255,255,255,0.42)); }
.ks-bp-demo-btn {
  margin-left: 10px; padding: 4px 10px !important; border-radius: 8px !important;
  border: 1px solid rgba(255,224,160,.24) !important; background: rgba(255,224,160,.08) !important;
  color: #ffe6b5 !important;
}
.ks-bp-demo-btn::after { content: '' !important; margin: 0 !important; }
.ks-bp-legend {
  flex-shrink: 0;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  padding: 8px 14px;
  font-size: 11px;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  border-bottom: 1px solid var(--color-border-default, #404040);
  background: var(--color-background-base, #191919);
}
.ks-bp-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.ks-bp-legend-sep { width: 1px; height: 12px; background: var(--color-border-default, #404040); }
.ks-bp-legend-swatch { width: 10px; height: 10px; border-radius: 3px; }

.ks-bp-canvas {
  flex: 1; min-height: 0; position: relative;
  ${BPG_CANVAS_GRID_CSS}
}
.ks-bp-canvas .react-flow {
  background: transparent;
  --xy-background-color: transparent;
  --xy-attribution-background-color-default: transparent;
}
.ks-bp-canvas .react-flow__pane,
.ks-bp-canvas .react-flow__renderer,
.ks-bp-canvas .react-flow__viewport { background: transparent; }
.ks-bp-canvas .react-flow__attribution { display: none; }

.ks-bp-empty {
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; text-align: center;
}
.ks-bp-empty-glyph { font-size: 40px; color: var(--color-text-tertiary, rgba(255,255,255,0.3)); }
.ks-bp-empty-text { font-size: 13px; color: var(--color-text-secondary, rgba(255,255,255,0.6)); }

/* 右下角「自适应」浮动按钮 —— 重排为默认布局并框选全景 */
.ks-bp-autolayout {
  position: absolute;
  right: 16px; bottom: 16px;
  z-index: 5;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px;
  font-size: 12px; font-weight: 700;
  color: #e7ecf3;
  background: rgba(28, 32, 40, 0.86);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 9px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.4);
  transition: background .15s, border-color .15s, transform .1s;
}
.ks-bp-autolayout:hover {
  background: rgba(40, 46, 58, 0.94);
  border-color: rgba(255,255,255,0.28);
}
.ks-bp-autolayout:active { transform: translateY(1px); }
.ks-bp-autolayout span { font-size: 14px; line-height: 1; }

/* ── UE4 蓝图节点（对齐原型 .bpg-node） ───────────────── */
.ks-bpg-node {
  width: ${NODE_W}px;
  min-height: ${NODE_H}px;
  box-sizing: border-box;
  border-radius: 10px;
  background: linear-gradient(180deg, #313640, #23262d);
  border: 1px solid rgba(0,0,0,.5);
  box-shadow: 0 8px 20px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.05) inset, 0 1px 0 rgba(255,255,255,.07) inset;
  cursor: grab;
  transition: box-shadow .15s, transform .12s;
  --bpc: #4a90d8;
}
.ks-bpg-node:active { cursor: grabbing; }
.ks-bpg-node:hover {
  box-shadow: 0 12px 26px rgba(0,0,0,.55), 0 0 0 1.5px var(--bpc) inset;
}
.ks-bpg-node.is-selected {
  box-shadow: 0 0 0 2px var(--bpc), 0 0 18px color-mix(in srgb, var(--bpc) 35%, transparent), 0 10px 24px rgba(0,0,0,.6);
}

.ks-bpg-title {
  font-size: 12px; font-weight: 700; color: #fff;
  padding: 8px 11px; border-radius: 9px 9px 0 0;
  background: linear-gradient(180deg, var(--bpc), color-mix(in srgb, var(--bpc) 50%, #000));
  letter-spacing: .01em; text-shadow: 0 1px 2px rgba(0,0,0,.5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-bottom: 1px solid rgba(0,0,0,.4);
  box-shadow: 0 1px 0 rgba(255,255,255,.13) inset;
}

.ks-bpg-body {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 11px 11px 10px;
}
.ks-bpg-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ks-bpg-in { align-items: flex-start; margin-left: -11px; flex: 0 0 auto; }
.ks-bpg-out { align-items: flex-end; margin-right: -11px; flex: 1 1 auto; }

.ks-bpg-pin {
  position: relative;
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; color: #aeb6c2; white-space: nowrap; font-weight: 500;
}
.ks-bpg-pindot {
  width: 11px; height: 11px; flex: none;
  background: #cfd6dd;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  filter: drop-shadow(0 0 1px rgba(0,0,0,.5));
}
.ks-bpg-pindot-in { transform: rotate(180deg); }
.ks-bpg-cond {
  font-size: 9px; padding: 0 3px; border-radius: 4px;
  color: #e0a83a; background: rgba(224,168,58,.12); border: 1px solid rgba(224,168,58,.4);
}

.ks-bpg-sub {
  font-size: 10px; color: #8b94a2;
  padding: 6px 11px 8px;
  border-top: 1px solid rgba(255,255,255,.06);
  background: rgba(0,0,0,.16);
  border-radius: 0 0 10px 10px;
  display: flex; flex-direction: column; gap: 3px;
}
.ks-bpg-srow { display: flex; align-items: baseline; gap: 7px; }
.ks-bpg-sk { flex: none; color: #6f7886; }
.ks-bpg-sv {
  flex: 1; min-width: 0; color: #c2cad4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-align: right; font-variant-numeric: tabular-nums;
}

.ks-bpg-handle {
  width: 11px !important; height: 11px !important;
  min-width: 0 !important; min-height: 0 !important;
  background: #cfd6dd !important;
  border: none !important;
  border-radius: 0 !important;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  opacity: 0 !important;
  pointer-events: none !important;
  transform: none;
}
.ks-bpg-handle-in { transform: translate(-50%, -50%) rotate(180deg) !important; }
.ks-bpg-handle-out { transform: translate(50%, -50%) !important; }

.ks-bp-edge-label {
  position: absolute;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px; max-width: 120px;
  font-size: 9px; font-weight: 600; line-height: 1.2;
  color: rgba(255,255,255,0.82);
  background: rgba(15, 17, 24, 0.72);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-bp-edge-marks { font-weight: 800; }
`
}
