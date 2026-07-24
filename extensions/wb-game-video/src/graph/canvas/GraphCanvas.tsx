/**
 * GraphCanvas —— 可编辑蓝图画布（P3）+ 运行时状态机可视化（P5）。
 *
 * SSOT = 传入的 GameGraph；画布用 `toFXView` 派生渲染（含 handle 派生），编辑手势经 `graph-edit`
 * 纯函数写回 graph（受控模式，避免 RF 内部状态与 SSOT 分叉）。
 *  - 连边 onConnect → connect()；删边/删点 onEdgesChange/onNodesChange('remove') / 边 hover 删除钮；拖拽 → setNodePosition()。
 *  - 删边走 disconnect：清 graph.edges，并 unbind 指向该边的 advance（空 event reaction 一并删）。
 *  - 运行时可视化：传 activeNodeId / traversedEdgeIds → 高亮当前执行节点 + 点亮已走边；点节点回调 onJump。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  SelectionMode,
  getSmoothStepPath,
  useReactFlow,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// 暗色主题下修正 reactflow 控制条按钮（默认白底白图标看不清）+ 隐藏官方水印。
function ensureCanvasStyle(): void {
  if (typeof document === 'undefined') return
  let s = document.getElementById('gv-rf-style') as HTMLStyleElement | null
  if (!s) {
    s = document.createElement('style')
    s.id = 'gv-rf-style'
    document.head.appendChild(s)
  }
  // 每次调用写回，避免 HMR 后旧 CSS（含错误间距）残留。
  s.textContent = `
    .react-flow__controls{box-shadow:0 2px 12px rgba(0,0,0,.5);border-radius:8px;overflow:hidden;border:1px solid #33373f}
    .react-flow__controls-button{background:#20242c;border-bottom:1px solid #33373f;width:26px;height:26px}
    .react-flow__controls-button:hover{background:#2b3038}
    .react-flow__controls-button svg{fill:#c9d1e0;max-width:14px;max-height:14px}
    .react-flow__attribution{display:none}
    /* 节点内可溢出（右侧 hover 菜单）；外层 gv-canvas-host 用 contain:paint 裁命中区，防止渗到工具条 */
    .react-flow__node{overflow:visible!important}
    /* 展开 ⋮ 菜单时把整个 RF 节点抬到最上，避免「添加节点」等 tip 被右侧节点盖住 */
    .react-flow__node:has(.gv-bp-node-more:hover),.react-flow__node:has(.gv-bp-node-more:focus-within){z-index:1000!important}
    .react-flow,.react-flow__renderer{overflow:hidden!important}
    .gv-canvas-chrome{position:absolute;right:12px;bottom:12px;z-index:5;display:flex;gap:6px;pointer-events:none}
    .gv-canvas-chrome button{pointer-events:auto;background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.45)}
    .gv-canvas-chrome button:hover{background:#2f2923;border-color:#f08840}
    .gv-bp-node{position:relative}
    /* 标题行右侧 ⋮：与文案同排垂直居中，无底色；hover ⋮ 才展开后插/复制/删除 */
    .gv-bp-node-more{position:relative;flex:none;z-index:20;display:flex;align-items:center}
    .gv-bp-more-btn{display:flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0;padding:0;border:none;border-radius:4px;background:transparent;color:#9aa2b1;cursor:pointer;line-height:0}
    .gv-bp-more-btn:hover,.gv-bp-node-more:hover .gv-bp-more-btn{background:transparent;color:#e8eaed}
    .gv-bp-more-btn svg{width:14px;height:14px}
    .gv-bp-node-actions{position:absolute;top:0;left:100%;z-index:30;padding-left:4px;opacity:0;pointer-events:none;transform:translateX(-4px);transition:opacity .12s,transform .12s}
    .gv-bp-node-more:hover .gv-bp-node-actions,.gv-bp-node-more:focus-within .gv-bp-node-actions{opacity:1;pointer-events:auto;transform:translateX(0)}
    .gv-bp-menu{display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;border-radius:10px;background:rgba(27,23,19,.96);border:1px solid #4a4036;box-shadow:0 8px 24px rgba(0,0,0,.55),0 0 0 1px rgba(240,136,64,.12);overflow:visible}
    .gv-bp-menu button{position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0;background:transparent;border:none;border-radius:7px;color:#e8eaed;padding:0;cursor:pointer;line-height:0;overflow:visible}
    .gv-bp-menu button:hover{background:rgba(240,136,64,.16);color:#fff}
    .gv-bp-menu button.danger{color:#f0a8a8}
    .gv-bp-menu button.danger:hover{background:rgba(239,68,68,.18);color:#ffb4b4}
    .gv-bp-menu button svg{width:16px;height:16px;opacity:.92}
    .gv-bp-menu button[data-tip]::after{content:attr(data-tip);position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);white-space:nowrap;padding:5px 10px;font-size:11px;line-height:1.3;border-radius:6px;background:rgba(20,18,16,.96);border:1px solid #4a4036;color:#e8eaed;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .1s;z-index:40}
    .gv-bp-menu button[data-tip]:hover::after{opacity:1}
    .gv-bp-menu .sep{width:20px;height:1px;margin:2px 0;background:#3a342c}
    .gv-sel-bar{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(27,23,19,.94);border:1px solid #403830;color:#f6f1e9;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.45);white-space:nowrap}
    .gv-sel-bar button{background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer}
    .gv-sel-bar button:hover{border-color:#f08840}
    .gv-sel-bar button.danger:hover{border-color:#ef4444;color:#ffb4b4}
    .gv-sel-bar .hint{opacity:.55;font-size:11px}
    /* 边中点悬浮删除：扩大命中区后 hover 才露按钮；试玩 readOnly 不挂 onDelete */
    .gv-edge-delete{position:absolute;transform:translate(-50%,-50%);pointer-events:all;z-index:8}
    .gv-edge-delete button{position:relative;display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0;padding:0;border:1px solid #5a4038;border-radius:999px;background:rgba(27,23,19,.96);color:#f0a8a8;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.45);line-height:0}
    .gv-edge-delete button:hover{background:rgba(239,68,68,.22);border-color:#ef4444;color:#ffb4b4}
    .gv-edge-delete button svg{width:12px;height:12px}
    .gv-edge-delete button[data-tip]::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;padding:5px 10px;font-size:11px;line-height:1.3;border-radius:6px;background:rgba(20,18,16,.96);border:1px solid #4a4036;color:#e8eaed;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .1s;z-index:40}
    .gv-edge-delete button[data-tip]:hover::after{opacity:1}
  `
}
import type { GameEdge, GameGraph, GameNode } from '../../runtime/schema/graph-schema'
import type { Overlay } from '../../runtime/schema/node-config-schema'
import { getSubFlowPack, isSubflowContainerData } from '../../runtime/schema/graph-schema'
import type { FXNode } from '../../runtime/schema/react-flow-schema'
import { toFXView } from './fx-view'
import { connect, disconnect, duplicateNodes, insertNodeAfter, removeNode, setNodePosition } from '../edit/graph-edit'

const MOD_HINT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  ? '⌘'
  : 'Ctrl'

/**
 * 模块级剪贴板：GraphStudio 用 `key={activeBlueprintId}` remount 画布以清本地 selectedIds，
 * useRef 会跟着丢；跨主/子蓝图粘贴必须活过 remount。
 */
let graphClipboard: { nodes: GameNode[]; edges: GameEdge[] } | null = null

interface CanvasNodeViewData {
  fx: FXNode
  active?: boolean
  /** 子流程/子蓝图容器（subFlow 或 subFlowPack）→ 显示可下钻徽标。 */
  isGroup?: boolean
  /** 子蓝图容器（与同图子流程区分徽标文案）。 */
  isPack?: boolean
  onDrill?: (nodeId: string) => void
  onInsertAfter?: (nodeId: string) => void
  onDuplicate?: (nodeId: string) => void
  onDelete?: (nodeId: string) => void
  [key: string]: unknown
}

const BADGE_COLOR: Record<string, string> = {
  qte: '#8b5cf6',
  choice: '#3b82f6',
  overlay: '#8b5cf6',
  pack: '#3b82f6',
  subflow: '#eab308',
}
const HANDLE_COLOR: Record<string, string> = {
  default: '#6b7280',
  pass: '#22c55e',
  good: '#84cc16',
  fail: '#ef4444',
  win: '#22c55e',
  lose: '#ef4444',
}
function handleColor(id: string): string {
  if (HANDLE_COLOR[id]) return HANDLE_COLOR[id]!
  if (id === 'default') return '#6b7280'
  return '#3b82f6' // 交互出口（pass/fail/选项/热点…）
}

const Ico = {
  insert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  ),
}

function PerfNode({ id, data, selected }: NodeProps): JSX.Element {
  const { fx, active, isGroup, isPack, onDrill, onInsertAfter, onDuplicate, onDelete } = data as CanvasNodeViewData
  const accent = BADGE_COLOR[fx.data.badge] ?? '#4b5563'
  const canEdit = !!(onInsertAfter || onDuplicate || onDelete)
  return (
    <div
      className={`gv-bp-node${selected ? ' is-selected' : ''}`}
      style={{
        position: 'relative',
        minWidth: 148,
        borderRadius: 10,
        border: isGroup ? '2px dashed #f08840' : `2px solid ${active || selected ? '#f5a623' : '#33373f'}`,
        background: '#1b1e24',
        color: '#e8eaed',
        fontSize: 12,
        overflow: 'visible',
        boxShadow: active || selected ? '0 0 0 3px rgba(245,166,35,0.35), 0 6px 18px rgba(0,0,0,0.5)' : '0 3px 10px rgba(0,0,0,0.4)',
      }}
    >
      {isGroup && (
        <button
          type="button"
          title={isPack ? '双击或点此进入子蓝图' : '双击或点此下钻子流程'}
          onClick={(e) => { e.stopPropagation(); onDrill?.(id) }}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: -10, left: 8, zIndex: 2, fontSize: 9, lineHeight: '16px', padding: '0 6px', borderRadius: 8, background: '#f08840', color: '#0b0d10', fontWeight: 700, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer' }}
        >
          {isPack ? '子蓝图 · 进入' : '⤵ 下钻'}
        </button>
      )}
      {fx.inputs.map((h) => (
        <Handle key={h.id} id={h.id} type="target" position={Position.Left} style={{ width: 9, height: 9, background: '#9ca3af', border: 'none' }} />
      ))}
      {/* 标题条（按玩法/结局着色）；⋮ 与文案同排垂直居中 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 10px', background: `${accent}22`, borderBottom: `1px solid ${accent}55`, borderRadius: '8px 8px 0 0' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fx.data.label}</span>
        {fx.data.badge && (
          <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 6px', borderRadius: 8, background: accent, color: '#0b0d10', fontWeight: 700 }}>{fx.data.badge}</span>
        )}
        {canEdit && (
          <div className="gv-bp-node-more" style={{ marginLeft: fx.data.badge ? 0 : 'auto' }}>
            <button
              type="button"
              className="gv-bp-more-btn nodrag nopan"
              aria-label="节点操作"
              title="节点操作"
              onClick={(e) => e.stopPropagation()}
            >
              {Ico.more}
            </button>
            <div className="gv-bp-node-actions">
              <div className="gv-bp-menu" role="menu">
                <button
                  type="button"
                  className="nodrag nopan"
                  role="menuitem"
                  aria-label="后插"
                  data-tip="添加节点"
                  onClick={(e) => {
                    e.stopPropagation()
                    onInsertAfter?.(id)
                  }}
                >
                  {Ico.insert}
                </button>
                <button
                  type="button"
                  className="nodrag nopan"
                  role="menuitem"
                  aria-label="复制"
                  data-tip={`复制此节点（${MOD_HINT}D）`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDuplicate?.(id)
                  }}
                >
                  {Ico.copy}
                </button>
                <div className="sep" aria-hidden />
                <button
                  type="button"
                  className="nodrag nopan danger"
                  role="menuitem"
                  aria-label="删除"
                  data-tip="删除此节点"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete?.(id)
                  }}
                >
                  {Ico.trash}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 出口引脚 */}
      <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
        {fx.outputs.map((h) => {
          const fid = h.data?.flowId ?? h.id
          const display = h.data?.displayLabel ?? h.label ?? fid
          const c = handleColor(fid)
          return (
            <div key={h.id} style={{ position: 'relative', fontSize: 10, color: c, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <span title={fid}>{display}</span>
              <Handle id={h.id} type="source" position={Position.Right} style={{ position: 'relative', transform: 'none', right: -4, width: 9, height: 9, background: c, border: 'none' }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = { perf: PerfNode }

type FlowEdgeData = {
  onDelete?: (edgeId: string) => void
  [key: string]: unknown
}

/**
 * 流程边：正向用 smoothstep（正交折线）；**回环/回退边**（目标在源左侧，LR 布局里即"往回连"）
 * 走一条向下绕行的贝塞尔，避免直线盖在中间节点上（对齐旧蓝图 loopback lane 的意图）。
 * 可编辑时 hover 中点出「删除边」——走 disconnect（清 edges + 指向该边的 advance）。
 */
function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const onDelete = (data as FlowEdgeData | undefined)?.onDelete
  const showDelete = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setHovered(true)
  }
  const hideDelete = () => {
    // 边 path 与 EdgeLabelRenderer 按钮不在同一 DOM 树，留一点间隙避免闪灭。
    hideTimer.current = window.setTimeout(() => setHovered(false), 140)
  }
  useEffect(() => () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current)
  }, [])
  const backward = targetX < sourceX - 24
  let path: string
  let labelX: number
  let labelY: number
  if (backward) {
    // 从源右侧出发，向下绕到行下方，再回到目标左侧 —— 明显低于节点行，不遮挡。
    const dip = Math.max(sourceY, targetY) + 120
    path = `M ${sourceX},${sourceY} C ${sourceX + 80},${dip} ${targetX - 80},${dip} ${targetX},${targetY}`
    // 三次贝塞尔 t=0.5 近似中点，把删除钮落在绕行弧上。
    labelX = 0.125 * sourceX + 0.375 * (sourceX + 80) + 0.375 * (targetX - 80) + 0.125 * targetX
    labelY = 0.125 * sourceY + 0.75 * dip + 0.125 * targetY
  } else {
    ;[path, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12,
    })
  }
  return (
    <>
      <g onMouseEnter={showDelete} onMouseLeave={hideDelete}>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          interactionWidth={24}
          style={{ ...style, stroke: backward ? (style?.stroke ?? '#8a6d3b') : style?.stroke }}
        />
      </g>
      {onDelete && hovered && (
        <EdgeLabelRenderer>
          <div
            className="gv-edge-delete nodrag nopan"
            style={{ left: labelX, top: labelY }}
            onMouseEnter={showDelete}
            onMouseLeave={hideDelete}
          >
            <button
              type="button"
              data-tip="删除边"
              aria-label="删除边"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(id)
              }}
            >
              {Ico.minus}
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { flow: FlowEdge }

export interface GraphCanvasProps {
  graph: GameGraph
  onChange: (next: GameGraph) => void
  /** ui.overlays —— 派生节点出口引脚中文标签（与节点配置「何时走」一致）。 */
  overlays?: Record<string, Overlay>
  activeNodeId?: string | null
  traversedEdgeIds?: Set<string>
  /**
   * 只读模式（试玩蓝图浮层）：不出节点 hover 编辑菜单（后插/复制/删除），禁用拖拽/连线/删除键/
   * 复制粘贴快捷键。仍可点节点 jump、下钻子流程、居中查看。
   */
  readOnly?: boolean
  /** 只渲染这些节点（子流程下钻视图）；undefined = 全部。编辑仍作用于完整 graph。 */
  visibleNodeIds?: Set<string>
  /** 变化时重新 fitView（自适应布局 / 重置 demo 后由 store bump）。 */
  fitSignal?: number
  /** 下钻层级签名变化时 fitView（与增删节点无关，避免画布漂移）。 */
  drillFitKey?: string
  /**
   * 选中节点 id 变化时把该节点平移到画布「未被面板盖住的可见区」中心（不缩放）。
   * 与 fitSignal 互斥：fitSignal 框全图，revealNodeId 仅平移视口让节点可见。
   * 空串/同值不触发；关闭面板（null）也不触发（不抢用户手动平移）。
   */
  revealNodeId?: string | null
  /** 面板占画布右侧的宽度比例（0~1）；revealNodeId 据此算可见区中心偏移。默认 0（不偏移）。 */
  revealPanelRatio?: number
  onJump?: (nodeId: string) => void
  /** 双击子流程容器节点（有 subFlow）时下钻。 */
  onDrill?: (containerId: string) => void
  /** 点击画布空白处（取消选中 → 隐藏节点配置面板）。 */
  onPaneClick?: () => void
  /** 画布右下角：添加节点（属于蓝图编辑手势，不进顶栏）。position = 当前视口中心（flow 坐标）。 */
  onAddNode?: (position: { x: number; y: number }) => void
  /** 画布右下角：引用一张既有蓝图，插入 subFlowPack 引用容器节点。 */
  onAddPackNode?: (position: { x: number; y: number }) => void
  /** 画布右下角：自适应布局（dagre 重排 + fitView）。 */
  onFitLayout?: () => void
  /**
   * 居中时额外给右侧留白的像素（试玩浮层宽）。必须是稳定原始值——若每帧传新
   * object 当 padding，会反复 fitView，拖动画布/节点时视口被拽回去。
   */
  fitReserveRightPx?: number
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
  overlays,
  activeNodeId,
  traversedEdgeIds,
  readOnly = false,
  visibleNodeIds,
  fitSignal,
  drillFitKey,
  revealNodeId,
  revealPanelRatio,
  onJump,
  onDrill,
  onPaneClick,
  onAddNode,
  onAddPackNode,
  onFitLayout,
  fitReserveRightPx = 0,
}: GraphCanvasProps): JSX.Element {
  ensureCanvasStyle()
  const { fitView, screenToFlowPosition, setViewport, getViewport, getNodes } = useReactFlow()
  const store = useStoreApi()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fitReserveRightPxRef = useRef(fitReserveRightPx)
  fitReserveRightPxRef.current = fitReserveRightPx
  /**
   * 居中 / 自适应：先用画布 DOM 真实宽高写回 RF store，再 fitView。
   * 节点配置开合、蓝图库左右分栏后，store 里的 width/height 偶发滞后——偏小会把图画到视口右侧。
   * padding 读 ref：手动点「居中」/排版时用当前浮层留白；自动 fit 只跟 fitSignal / 下钻走。
   */
  const fitGraphInView = useCallback((opts?: { duration?: number }) => {
    const el = rootRef.current
    const width = el?.clientWidth ?? 0
    const height = el?.clientHeight ?? 0
    if (width > 0 && height > 0) {
      const cur = store.getState()
      if (cur.width !== width || cur.height !== height) store.setState({ width, height })
    }
    const rightPx = fitReserveRightPxRef.current
    const padding = rightPx > 0
      ? { top: 0.18, left: 0.18, bottom: 0.18, right: `${rightPx}px` as const }
      : 0.18
    return fitView({ padding, duration: opts?.duration, maxZoom: 1 })
  }, [fitView, store])
  /** 当前视口中心（flow 坐标）；空图/平移后添加节点时落在可见区，避免落在原点外看不见。 */
  const viewportCenter = useCallback((): { x: number; y: number } => {
    const el = rootRef.current
    if (!el) return { x: 80, y: 80 }
    const rect = el.getBoundingClientRect()
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [screenToFlowPosition])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [clipTip, setClipTip] = useState<string>('')
  /** Shift 按下（点选多选）；与框选（boxSelecting）区分，避免 RF 的 selectionChange 冲掉 Shift+点。 */
  const shiftHeld = useRef(false)
  const boxSelecting = useRef(false)
  /** 框选结束时一次性提交的选中集（框选过程中不 setState，避免受控 nodes 重渲染触发 xyflow 误选全图）。 */
  const pendingBoxSelection = useRef<string[] | null>(null)
  /** 跳过 mount 时的 effect：首帧 fit 交给 onInit（节点已度量）；effect 只响应后续下钻/自适应。 */
  const skipFitEffectOnce = useRef(true)
  const fx = useMemo(() => toFXView(graph, overlays), [graph, overlays])
  const containerIds = useMemo(
    () => new Set(graph.nodes.filter((n) => isSubflowContainerData(n.data)).map((n) => n.id)),
    [graph],
  )
  const packIds = useMemo(
    () => new Set(graph.nodes.filter((n) => getSubFlowPack(n.data)).map((n) => n.id)),
    [graph],
  )

  const flashTip = useCallback((msg: string) => {
    setClipTip(msg)
    window.setTimeout(() => setClipTip(''), 1800)
  }, [])

  const applyDuplicate = useCallback(
    (ids: readonly string[]) => {
      const { graph: next, nodeIds } = duplicateNodes(graph, ids)
      if (nodeIds.length === 0) return
      onChange(next)
      setSelectedIds(nodeIds)
      // 批量生成副本：只高亮，不打开节点配置（由用户再单击打开）。
      flashTip(`已生成 ${nodeIds.length} 个副本`)
    },
    [graph, onChange, flashTip],
  )

  const onInsertAfter = useCallback(
    (nodeId: string) => {
      const { graph: next, nodeId: created } = insertNodeAfter(graph, nodeId)
      if (next === graph) return
      onChange(next)
      setSelectedIds([created])
      onJump?.(created)
    },
    [graph, onChange, onJump],
  )

  const onDuplicateNode = useCallback(
    (nodeId: string) => applyDuplicate([nodeId]),
    [applyDuplicate],
  )

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      const name = graph.nodes.find((n) => n.id === nodeId)?.data.name ?? nodeId
      if (typeof confirm === 'function' && !confirm(`删除节点「${name}」及其相关连线？`)) return
      onChange(removeNode(graph, nodeId))
      setSelectedIds((ids) => ids.filter((id) => id !== nodeId))
      onPaneClick?.()
    },
    [graph, onChange, onPaneClick],
  )

  /** hover 删边 / Delete 键删边同源：disconnect 清 edges + 指向该边的 advance。 */
  const onDeleteEdge = useCallback(
    (edgeId: string) => {
      onChange(disconnect(graph, edgeId))
    },
    [graph, onChange],
  )

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    if (typeof confirm === 'function' && !confirm(`删除选中的 ${selectedIds.length} 个节点及其相关连线？`)) return
    let g = graph
    for (const id of selectedIds) g = removeNode(g, id)
    onChange(g)
    setSelectedIds([])
    onPaneClick?.()
  }, [graph, onChange, onPaneClick, selectedIds])

  const copySelectedToClipboard = useCallback(() => {
    const ids = new Set(selectedIds)
    if (ids.size === 0) return
    const nodes = graph.nodes.filter((n) => ids.has(n.id)).map((n) => structuredClone(n))
    const edges = graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => structuredClone(e))
    graphClipboard = { nodes, edges }
    flashTip(`已复制 ${nodes.length} 个节点 · ${MOD_HINT}V 粘贴（可跨蓝图）`)
  }, [graph, selectedIds, flashTip])

  const pasteClipboard = useCallback(() => {
    const clip = graphClipboard
    if (!clip?.nodes.length) {
      flashTip('剪贴板为空 · 先选中后点「复制」或按快捷键')
      return
    }
    const temp: GameGraph = { nodes: clip.nodes, edges: clip.edges }
    const { graph: pasted, nodeIds } = duplicateNodes(
      temp,
      clip.nodes.map((n) => n.id),
      { offset: { x: 48, y: 48 } },
    )
    const idSet = new Set(nodeIds)
    onChange({
      nodes: [...graph.nodes, ...pasted.nodes.filter((n) => idSet.has(n.id))],
      edges: [...graph.edges, ...pasted.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))],
    })
    setSelectedIds(nodeIds)
    // 粘贴只落图+高亮，不打开节点配置。
    flashTip(`已粘贴 ${nodeIds.length} 个节点`)
  }, [graph, onChange, flashTip])

  const rfNodes = useMemo(
    () =>
      fx.nodes
        .filter((n) => !visibleNodeIds || visibleNodeIds.has(n.id))
        .map((n) => ({
          id: n.id,
          type: 'perf',
          position: n.position,
          selected: selectedIds.includes(n.id),
          data: {
            fx: n,
            active: n.id === activeNodeId,
            isGroup: containerIds.has(n.id),
            isPack: packIds.has(n.id),
            onDrill,
            onInsertAfter: readOnly ? undefined : onInsertAfter,
            onDuplicate: readOnly ? undefined : onDuplicateNode,
            onDelete: readOnly ? undefined : onDeleteNode,
          } as CanvasNodeViewData,
        })),
    [fx, activeNodeId, visibleNodeIds, containerIds, packIds, selectedIds, readOnly, onDrill, onInsertAfter, onDuplicateNode, onDeleteNode],
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
          data: {
            onDelete: readOnly ? undefined : onDeleteEdge,
          } as FlowEdgeData,
        })),
    [fx, traversedEdgeIds, visibleNodeIds, readOnly, onDeleteEdge],
  )

  // 跟踪 Shift，供 onSelectionChange 判断是否该忽略 RF 的点选（Shift+点由 onNodeClick 负责）。
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld.current = true }
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 仅在下钻切换 / 显式自适应（fitSignal）时 fitView。
  // 「从此试玩」开合浮层只改 fitReserveRightPx——留给手动居中/排版用，绝不因此自动 fit，
  // 否则视口会被拽走。增删节点、拖位置、试玩 tick 同理不重框。
  // 首帧交给 onInit，避免 mount 时节点尚未度量导致 fit 空跑、图落在视口外。
  useEffect(() => {
    if (skipFitEffectOnce.current) {
      skipFitEffectOnce.current = false
      return
    }
    const t = window.setTimeout(() => { void fitGraphInView({ duration: 200 }) }, 40)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal, drillFitKey])

  const onInit = useCallback((_inst: ReactFlowInstance) => {
    void fitGraphInView()
  }, [fitGraphInView])

  /**
   * 选中节点变化时，把视口平移让该节点落在画布「未被面板盖住的左侧可见区」中心（不缩放）。
   * 与 fitSignal 互不干扰：fitSignal 框全图、revealNodeId 仅平移；关闭面板（null）不抢用户手动平移。
   */
  useEffect(() => {
    if (!revealNodeId) return
    const node = getNodes().find((n) => n.id === revealNodeId)
    if (!node) return
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const ratio = typeof revealPanelRatio === 'number' && revealPanelRatio > 0 ? Math.min(0.85, revealPanelRatio) : 0
    // 节点中心（flow 坐标）：未度量时退回 position（左上角）。
    const cx = node.position.x + (node.measured?.width ?? node.width ?? 100) / 2
    const cy = node.position.y + (node.measured?.height ?? node.height ?? 60) / 2
    const vp = getViewport()
    const zoom = vp.zoom || 1
    // 左侧可见区中心（screen 坐标，相对画布容器）：画布宽 × (1 - ratio) / 2。
    const targetScreenX = rect.width * (1 - ratio) / 2
    const targetScreenY = rect.height / 2
    // viewport.x = screenX - flowX * zoom
    const nextX = targetScreenX - cx * zoom
    const nextY = targetScreenY - cy * zoom
    void setViewport({ x: nextX, y: nextY, zoom }, { duration: 220 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNodeId, revealPanelRatio])

  useEffect(() => {
    const el = rootRef.current
    if (!el || readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (selectedIds.length) applyDuplicate(selectedIds)
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copySelectedToClipboard()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteClipboard()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [readOnly, selectedIds, applyDuplicate, copySelectedToClipboard, pasteClipboard])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let next = graph
      const removed = new Set<string>()
      for (const c of changes) {
        if (c.type === 'position' && c.position) next = setNodePosition(next, c.id, c.position)
        else if (c.type === 'remove') {
          next = removeNode(next, c.id)
          removed.add(c.id)
        }
        // select：框选过程不在这里 setState（见 onSelectionStart/End）；普通点选走 onSelectionChange / onNodeClick。
      }
      if (next !== graph) onChange(next)
      // Delete/Backspace 删节点：清本地多选，并关掉右侧节点配置（与按钮删除同源 onPaneClick）。
      if (removed.size > 0) {
        setSelectedIds((prev) => prev.filter((id) => !removed.has(id)))
        onPaneClick?.()
      }
    },
    [graph, onChange, onPaneClick],
  )

  /**
   * 同步选中集。框选拖拽中绝不 setState：受控 `nodes[].selected` 重渲染会使 xyflow
   * 短暂丢掉 handleBounds，`getNodesInside` 把无 bounds 的节点一律算进框 → 闪「全选」。
   * Shift+点选由 onNodeClick 负责。
   */
  const onSelectionChange = useCallback(({ nodes }: { nodes: { id: string }[] }) => {
    if (boxSelecting.current) {
      pendingBoxSelection.current = nodes.map((n) => n.id)
      return
    }
    if (shiftHeld.current) return
    setSelectedIds(nodes.map((n) => n.id))
  }, [])

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
      const sourceHandle = (conn.sourceHandle ?? 'source:default').replace(/^source:/, '')
      onChange(connect(graph, { source: conn.source, sourceHandle, target: conn.target }))
    },
    [graph, onChange],
  )

  const onNodeClick = useCallback(
    (e: React.MouseEvent, n: { id: string }) => {
      // Shift+点：只做多选加减，不打开节点配置（不 onJump）。
      if (e.shiftKey) {
        setSelectedIds((prev) => (prev.includes(n.id) ? prev.filter((id) => id !== n.id) : [...prev, n.id]))
        return
      }
      setSelectedIds([n.id])
      onJump?.(n.id)
    },
    [onJump],
  )

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      style={{ width: '100%', height: '100%', position: 'relative', outline: 'none', overflow: 'hidden' }}
      onMouseDown={() => rootRef.current?.focus()}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit as never}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={(_e, n) => { if (containerIds.has(n.id)) onDrill?.(n.id) }}
        onPaneClick={() => {
          setSelectedIds([])
          onPaneClick?.()
        }}
        onSelectionStart={() => {
          boxSelecting.current = true
          pendingBoxSelection.current = []
        }}
        onSelectionEnd={() => {
          boxSelecting.current = false
          const ids = pendingBoxSelection.current
            ?? getNodes().filter((n) => n.selected).map((n) => n.id)
          pendingBoxSelection.current = null
          setSelectedIds(ids)
        }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        edgesReconnectable={false}
        selectionKeyCode={readOnly ? null : 'Shift'}
        multiSelectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls position="bottom-left" />
      </ReactFlow>
      {!readOnly && selectedIds.length > 1 && (
        <div className="gv-sel-bar">
          <span>已选 {selectedIds.length} 个节点</span>
          <button type="button" onClick={() => applyDuplicate(selectedIds)} title={`${MOD_HINT}D · 立刻在画布生成副本`}>生成副本</button>
          <button type="button" onClick={copySelectedToClipboard} title={`${MOD_HINT}C · 复制到剪贴板，再 ${MOD_HINT}V 粘贴`}>复制</button>
          <button type="button" className="danger" onClick={deleteSelected}>删除</button>
          <span className="hint">{MOD_HINT}V 粘贴 · Shift+点多选 · Shift+拖框选</span>
        </div>
      )}
      {clipTip && (
        <div className="gv-sel-bar" style={{ top: selectedIds.length > 1 ? 52 : 12, pointerEvents: 'none', opacity: 0.95 }}>
          {clipTip}
        </div>
      )}
      <div className="gv-canvas-chrome">
        {onAddNode && (
          <button
            type="button"
            onClick={() => {
              const c = viewportCenter()
              // 轻微抖动，连续添加时不完全重叠。
              onAddNode({ x: c.x - 90 + Math.random() * 40, y: c.y - 40 + Math.random() * 40 })
            }}
            title="添加演出节点"
          >
            ＋ 添加节点
          </button>
        )}
        {onAddPackNode && (
          <button
            type="button"
            onClick={() => {
              const c = viewportCenter()
              onAddPackNode({ x: c.x - 90 + Math.random() * 40, y: c.y - 40 + Math.random() * 40 })
            }}
            title="引用一张既有蓝图（从蓝图库选一个，插入引用容器节点）"
          >
            ＋ 引用蓝图
          </button>
        )}
        <button
          type="button"
          onClick={() => { void fitGraphInView({ duration: 200 }) }}
          title="把整张图框进视口正中（不改动节点位置）"
        >
          ◎ 居中
        </button>
        {onFitLayout && (
          <button type="button" onClick={onFitLayout} title="dagre 自动重排节点位置并框选">
            ⤢ 自适应
          </button>
        )}
      </div>
    </div>
  )
}
