/**
 * GraphCanvas —— 可编辑蓝图画布（P3）+ 运行时状态机可视化（P5）。
 *
 * SSOT = 传入的 GameGraph；画布用 `toFXView` 派生渲染（含 handle 派生），编辑手势经 `graph-edit`
 * 纯函数写回 graph（受控模式，避免 RF 内部状态与 SSOT 分叉）。
 *  - 连边 onConnect → connect()；删边/删点 onEdgesChange/onNodesChange('remove')；拖拽 → setNodePosition()。
 *  - 运行时可视化：传 activeNodeId / traversedEdgeIds → 高亮当前执行节点 + 点亮已走边；点节点回调 onJump。
 */
import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// 暗色主题下修正 reactflow 控制条按钮（默认白底白图标看不清）+ 隐藏官方水印。
function ensureCanvasStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-rf-style')) return
  const s = document.createElement('style')
  s.id = 'gv-rf-style'
  s.textContent = `
    .react-flow__controls{box-shadow:0 2px 12px rgba(0,0,0,.5);border-radius:8px;overflow:hidden;border:1px solid #33373f}
    .react-flow__controls-button{background:#20242c;border-bottom:1px solid #33373f;width:26px;height:26px}
    .react-flow__controls-button:hover{background:#2b3038}
    .react-flow__controls-button svg{fill:#c9d1e0;max-width:14px;max-height:14px}
    .react-flow__attribution{display:none}
    .gv-canvas-chrome{position:absolute;right:12px;bottom:12px;z-index:5;display:flex;gap:6px;pointer-events:none}
    .gv-canvas-chrome button{pointer-events:auto;background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.45)}
    .gv-canvas-chrome button:hover{background:#2f2923;border-color:#f08840}
  `
  document.head.appendChild(s)
}
import type { GameGraph } from '../../runtime/schema/graph-schema'
import type { FXNode } from '../../runtime/schema/react-flow-schema'
import { toFXView } from './fx-view'
import { connect, disconnect, removeNode, setNodePosition } from '../edit/graph-edit'

interface PerfNodeData {
  fx: FXNode
  active?: boolean
  /** 子流程容器（node.data.subFlowRef 非空）→ 显示可下钻徽标。 */
  isGroup?: boolean
  [key: string]: unknown
}

const BADGE_COLOR: Record<string, string> = {
  qte: '#8b5cf6',
  choice: '#3b82f6',
  victory: '#22c55e',
  defeat: '#ef4444',
  ending: '#a3a3a3',
}
const HANDLE_COLOR: Record<string, string> = {
  pass: '#22c55e',
  good: '#84cc16',
  fail: '#ef4444',
  win: '#22c55e',
  lose: '#ef4444',
  else: '#a3a3a3',
}
function handleColor(id: string): string {
  if (HANDLE_COLOR[id]) return HANDLE_COLOR[id]!
  if (id.startsWith('cond:')) return '#eab308'
  if (id.startsWith('opt:')) return '#3b82f6'
  return '#6b7280'
}

function PerfNode({ data }: NodeProps): JSX.Element {
  const { fx, active, isGroup } = data as PerfNodeData
  const accent = BADGE_COLOR[fx.data.badge] ?? '#4b5563'
  return (
    <div
      className="gv-bp-node"
      style={{
        position: 'relative',
        minWidth: 148,
        borderRadius: 10,
        border: isGroup ? '2px dashed #f08840' : `2px solid ${active ? '#f5a623' : '#33373f'}`,
        background: '#1b1e24',
        color: '#e8eaed',
        fontSize: 12,
        overflow: isGroup ? 'visible' : 'hidden',
        boxShadow: active ? '0 0 0 3px rgba(245,166,35,0.35), 0 6px 18px rgba(0,0,0,0.5)' : '0 3px 10px rgba(0,0,0,0.4)',
      }}
    >
      {isGroup && (
        <div style={{ position: 'absolute', top: -10, right: 8, zIndex: 2, fontSize: 9, lineHeight: '16px', padding: '0 6px', borderRadius: 8, background: '#f08840', color: '#0b0d10', fontWeight: 700, whiteSpace: 'nowrap' }}>
          ⤵ 双击下钻
        </div>
      )}
      {fx.inputs.map((h) => (
        <Handle key={h.id} id={h.id} type="target" position={Position.Left} style={{ width: 9, height: 9, background: '#9ca3af', border: 'none' }} />
      ))}
      {/* 标题条（按玩法/结局着色） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: `${accent}22`, borderBottom: `1px solid ${accent}55` }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fx.data.label}</span>
        {fx.data.badge && (
          <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 6px', borderRadius: 8, background: accent, color: '#0b0d10', fontWeight: 700 }}>{fx.data.badge}</span>
        )}
      </div>
      {/* 出口引脚 */}
      <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
        {fx.outputs.map((h) => {
          const fid = h.data?.flowId ?? h.id
          const c = handleColor(fid)
          return (
            <div key={h.id} style={{ position: 'relative', fontSize: 10, color: c, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <span>{fid}</span>
              <Handle id={h.id} type="source" position={Position.Right} style={{ position: 'relative', transform: 'none', right: -4, width: 9, height: 9, background: c, border: 'none' }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = { perf: PerfNode }

/**
 * 流程边：正向用 smoothstep（正交折线）；**回环/回退边**（目标在源左侧，LR 布局里即"往回连"）
 * 走一条向下绕行的贝塞尔，避免直线盖在中间节点上（对齐旧蓝图 loopback lane 的意图）。
 */
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style }: EdgeProps): JSX.Element {
  const backward = targetX < sourceX - 24
  let path: string
  if (backward) {
    // 从源右侧出发，向下绕到行下方，再回到目标左侧 —— 明显低于节点行，不遮挡。
    const dip = Math.max(sourceY, targetY) + 120
    path = `M ${sourceX},${sourceY} C ${sourceX + 80},${dip} ${targetX - 80},${dip} ${targetX},${targetY}`
  } else {
    ;[path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })
  }
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, stroke: backward ? (style?.stroke ?? '#8a6d3b') : style?.stroke }} />
}

const edgeTypes = { flow: FlowEdge }

export interface GraphCanvasProps {
  graph: GameGraph
  onChange: (next: GameGraph) => void
  activeNodeId?: string | null
  traversedEdgeIds?: Set<string>
  /** 只渲染这些节点（子流程下钻视图）；undefined = 全部。编辑仍作用于完整 graph。 */
  visibleNodeIds?: Set<string>
  /** 变化时重新 fitView（自适应布局后 / 下钻切换后由上层 bump）。 */
  fitSignal?: number
  onJump?: (nodeId: string) => void
  /** 双击子流程容器节点（有 subFlowRef）时下钻。 */
  onDrill?: (containerId: string) => void
  /** 点击画布空白处（取消选中 → 隐藏节点配置面板）。 */
  onPaneClick?: () => void
  /** 画布右下角：添加节点（属于蓝图编辑手势，不进顶栏）。 */
  onAddNode?: () => void
  /** 画布右下角：自适应布局（dagre 重排 + fitView）。 */
  onFitLayout?: () => void
}

export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  // Provider 提供 useReactFlow（fitView 自适应）。
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function GraphCanvasInner({
  graph,
  onChange,
  activeNodeId,
  traversedEdgeIds,
  visibleNodeIds,
  fitSignal,
  onJump,
  onDrill,
  onPaneClick,
  onAddNode,
  onFitLayout,
}: GraphCanvasProps): JSX.Element {
  ensureCanvasStyle()
  const { fitView } = useReactFlow()
  const fx = useMemo(() => toFXView(graph), [graph])
  const containerIds = useMemo(() => new Set(graph.nodes.filter((n) => n.data.subFlowRef).map((n) => n.id)), [graph])
  // 用成员签名而不是 Set 引用：拖节点会改 graph → 上层常新建 Set，若依赖引用会误触发 fitView 导致整板漂移。
  const visibleKey = useMemo(
    () => (visibleNodeIds ? [...visibleNodeIds].sort().join('\0') : '*'),
    [visibleNodeIds],
  )

  const rfNodes = useMemo(
    () =>
      fx.nodes
        .filter((n) => !visibleNodeIds || visibleNodeIds.has(n.id))
        .map((n) => ({
          id: n.id,
          type: 'perf',
          position: n.position,
          data: { fx: n, active: n.id === activeNodeId, isGroup: containerIds.has(n.id) } as PerfNodeData,
        })),
    [fx, activeNodeId, visibleNodeIds, containerIds],
  )
  const rfEdges = useMemo(
    () =>
      fx.edges
        .filter((e) => !visibleNodeIds || (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          label: e.label,
          type: 'flow',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: traversedEdgeIds?.has(e.id) ? '#f5a623' : '#6b7280' },
          animated: traversedEdgeIds?.has(e.id) ?? false,
          style: traversedEdgeIds?.has(e.id) ? { stroke: '#f5a623', strokeWidth: 2 } : { stroke: '#6b7280' },
        })),
    [fx, traversedEdgeIds, visibleNodeIds],
  )

  // 仅在下钻切换 / 显式自适应（fitSignal）时 fitView；拖节点改位置绝不重框选。
  useEffect(() => {
    const raf = requestAnimationFrame(() => fitView({ padding: 0.18, duration: 200, maxZoom: 1 }))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, fitSignal])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let next = graph
      for (const c of changes) {
        if (c.type === 'position' && c.position) next = setNodePosition(next, c.id, c.position)
        else if (c.type === 'remove') next = removeNode(next, c.id)
      }
      if (next !== graph) onChange(next)
    },
    [graph, onChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      let next = graph
      for (const c of changes) if (c.type === 'remove') next = disconnect(next, c.id)
      if (next !== graph) onChange(next)
    },
    [graph, onChange],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      const sourceHandle = (conn.sourceHandle ?? 'source:out').replace(/^source:/, '')
      onChange(connect(graph, { source: conn.source, sourceHandle, target: conn.target }))
    },
    [graph, onChange],
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_e, n) => onJump?.(n.id)}
        onNodeDoubleClick={(_e, n) => { if (containerIds.has(n.id)) onDrill?.(n.id) }}
        onPaneClick={() => onPaneClick?.()}
        deleteKeyCode={['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background />
        <Controls position="bottom-left" />
      </ReactFlow>
      {(onAddNode || onFitLayout) && (
        <div className="gv-canvas-chrome">
          {onAddNode && <button type="button" onClick={onAddNode} title="添加演出节点">＋ 添加节点</button>}
          {onFitLayout && <button type="button" onClick={onFitLayout} title="dagre 自动重排节点位置并框选">⤢ 自适应</button>}
        </div>
      )}
    </div>
  )
}
