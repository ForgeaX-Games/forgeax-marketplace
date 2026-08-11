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
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
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
    /* Control Panel：上 12 / 左右 4 / 图标间距 8，无分隔线（覆盖 xyflow 默认 border-bottom）。 */
    .react-flow__controls{display:flex;flex-direction:column;gap:8px;padding:12px 4px;box-shadow:0 2px 12px rgba(0,0,0,.5);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.05)}
    .react-flow__controls-button{display:flex;align-items:center;justify-content:center;box-sizing:border-box;background:transparent;border:none!important;border-bottom:none!important;width:25px;height:25px;padding:0}
    .react-flow__controls-button:last-child{border-bottom:none!important}
    .react-flow__controls-button:hover{background:rgba(255,255,255,0.10);border-radius:4px}
    .react-flow__controls-button svg{fill:rgba(255,255,255,0.80);max-width:16px;max-height:16px}
    /* 蓝图地图 / Control Panel：同底对齐；间距 6px（地图宽 168 + 左 12 + 6 = 186）。 */
    .gv-graph-minimap.react-flow__panel.bottom.left{left:12px;bottom:0;margin:0;box-sizing:border-box;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);box-shadow:0 2px 12px rgba(0,0,0,.55);background:rgba(255,255,255,0.05);cursor:grab}
    .react-flow__controls.react-flow__panel.bottom.left{left:186px;bottom:0;margin:0;box-sizing:border-box}
    .gv-graph-minimap:active{cursor:grabbing}
    .gv-graph-minimap-svg{display:block;width:100%;height:100%;touch-action:none}
    .gv-graph-minimap-board{fill:#1a2030;stroke:#2a3344;stroke-width:1}
    .gv-graph-minimap-edge{stroke:rgba(148,163,184,.45);stroke-linecap:round}
    .gv-graph-minimap-node{stroke:rgba(11,13,16,.7);opacity:.95}
    .gv-graph-minimap-mask{fill:rgba(6,8,12,.48);stroke:none}
    .gv-graph-minimap-viewport{stroke:#FF9C2A}
    .react-flow__attribution{display:none}
    /* 节点内可溢出（右侧 hover 菜单）；外层 gv-canvas-host 用 contain:paint 裁命中区，防止渗到工具条 */
    .react-flow__node{overflow:visible!important}
    /*
     * 节点层必须压过边层。xyflow 的 .react-flow__nodes 默认无 position，z-index 不生效；
     * 而每条边 SVG 自带 position:absolute + 可达 1000 的 inline zIndex，会盖住节点右侧溢出菜单。
     */
    .react-flow__edges{position:absolute!important;z-index:2!important}
    .react-flow__edges svg{z-index:0!important}
    .react-flow__edgelabel-renderer{position:absolute!important;z-index:3!important}
    .react-flow__nodes{position:absolute!important;width:100%;height:100%;z-index:5!important}
    /* 展开 ⋮ 菜单 / 出口箭头 + 按钮时再抬一层，避免被相邻节点盖住 */
    .react-flow__node:has(.gv-bp-node-more:hover),.react-flow__node:has(.gv-bp-node-more:focus-within),
    .react-flow__node:has(.gv-handle-more:hover),.react-flow__node:has(.gv-handle-more:focus-within){z-index:10000!important}
    .gv-bp-node-actions,.gv-bp-menu{z-index:10001}
    .react-flow,.react-flow__renderer{overflow:hidden!important}
    /* 画布底色：#333。 */
    .react-flow__pane{background:#3d3d3d}
    /* Figma 13135_19511：边连线 stroke-width 1（防 xyflow 默认 .react-flow__edge-path 的 1px 覆盖）。
       试玩已走路径（animated）：品牌橙 #FF9C2A + 虚线流动动画（对齐改版前运行路径效果）。 */
    .react-flow__edge-path{stroke-width:1px}
    @keyframes gv-edge-dashdraw{from{stroke-dashoffset:10}to{stroke-dashoffset:0}}
    .react-flow__edge.animated .react-flow__edge-path,
    .react-flow__edge.gv-edge-traversed .react-flow__edge-path,
    .react-flow__edge-path.gv-edge-path-traversed{
      stroke:#FF9C2A!important;stroke-width:2px!important;
      stroke-dasharray:5!important;animation:gv-edge-dashdraw .5s linear infinite!important;
    }
    .react-flow__edge.animated path.react-flow__edge-interaction,
    .react-flow__edge.gv-edge-traversed path.react-flow__edge-interaction{stroke-dasharray:none!important;animation:none!important}
    /* Figma 15195_74435：三按钮横排，白 5% 底、无边框、8px 圆角、30px 高、14px 白字。 */
    /* Figma 15195_74423：三按钮定位到画布顶部 bar 右侧（bar 高 58，按钮高 30，top 14 垂直居中）。 */
    .gv-canvas-chrome{position:absolute;right:12px;top:14px;z-index:6;display:flex;gap:12px;pointer-events:none}
    /* flex:none + nowrap：预览抽屉展开后画布只剩两百多像素，按钮否则会被压扁、文案折行。 */
    .gv-canvas-chrome button{pointer-events:auto;flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;background:rgba(255,255,255,0.05);border:none;color:#FFFFFF;border-radius:8px;font-size:14px;font-weight:400;font-family:'PingFang SC',system-ui,sans-serif;cursor:pointer}
    .gv-canvas-chrome button:hover{background:rgba(255,255,255,0.10)}
    .gv-canvas-chrome .gv-chrome-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;color:rgba(255,255,255,0.80)}
    .gv-canvas-chrome .gv-chrome-ico svg{display:block}
    /* 画布变窄（预览抽屉展开）时按钮收成纯图标；文案进 aria-label / title，可读性不丢。 */
    .gv-canvas-host{container-type:inline-size}
    @container (max-width: 520px){
      .gv-canvas-chrome .gv-chrome-label{display:none}
      .gv-canvas-chrome button{gap:0;padding:0 8px}
    }
    .gv-bp-node{position:relative}
    /* 标题行右侧 ⋮：与文案同排垂直居中，无底色；hover ⋮ 才展开后插/复制/删除 */
    /* z-index 高于节点选中描边，避免蓝/橙框盖住右侧操作条 */
    .gv-bp-node-more{position:relative;flex:none;z-index:40;display:flex;align-items:center}
    .gv-bp-more-btn{display:flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0;padding:0;border:none;border-radius:4px;background:transparent;color:#9aa2b1;cursor:pointer;line-height:0}
    .gv-bp-more-btn:hover,.gv-bp-node-more:hover .gv-bp-more-btn{background:transparent;color:#e8eaed}
    .gv-bp-more-btn svg{width:14px;height:14px}
    /* Figma 竖条；padding-left 作 hover 桥并把菜单外推到节点面板右侧 */
    .gv-bp-node-actions{position:absolute;top:0;left:100%;z-index:50;padding-left:12px;opacity:0;pointer-events:none;transition:opacity .12s}
    .gv-bp-node-more:hover .gv-bp-node-actions,.gv-bp-node-more:focus-within .gv-bp-node-actions{opacity:1;pointer-events:auto}
    /* 底色先铺画布同色再叠白 10%，保证不透明，避免底下连线「透」出来像盖住菜单 */
    .gv-bp-menu{display:flex;flex-direction:column;align-items:center;box-sizing:border-box;width:19px;height:85px;gap:5px;padding:5px 2px;border-radius:4px;background:color-mix(in srgb, #fff 10%, #333);border:none;box-shadow:none;overflow:visible}
    .gv-bp-menu button{position:relative;display:flex;align-items:center;justify-content:center;width:15px;height:15px;margin:0;background:transparent;border:none;border-radius:0;color:rgba(255,255,255,0.80);padding:0;cursor:pointer;line-height:0;overflow:visible}
    .gv-bp-menu button:hover{background:transparent;color:#fff}
    .gv-bp-menu button.danger{color:rgba(255,180,180,0.90)}
    .gv-bp-menu button.danger:hover{background:transparent;color:#ffb4b4}
    .gv-bp-menu button svg{width:14px;height:14px;opacity:.92}
    .gv-bp-menu button[data-tip]::after{display:none}
    .gv-sel-bar{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(27,23,19,.94);border:1px solid #403830;color:#f6f1e9;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.45);white-space:nowrap}
    .gv-sel-bar button{background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer}
    .gv-sel-bar button:hover{border-color:#f08840}
    .gv-sel-bar button.danger:hover{border-color:#ef4444;color:#ffb4b4}
    .gv-sel-bar .hint{opacity:.55;font-size:11px}
    /* 可连线出口：保持布局尺寸不变，轻微放大并外扩约 4px 提示可拖拽。 */
    .gv-flow-handle{transition:transform .14s ease,box-shadow .14s ease,filter .14s ease;transform-origin:center;isolation:isolate}
    .gv-flow-handle.is-interactive{cursor:crosshair}
    .gv-flow-handle.is-interactive:hover,.gv-flow-handle.is-interactive:focus-visible{transform:scale(1.18)!important;filter:brightness(1.18);box-shadow:0 0 0 4px color-mix(in srgb,currentColor 24%,transparent);z-index:5}
    /* 试玩只读画布不选择节点/边：图面统一用平移手掌，边不参与命中，避免 pointer/grab 闪动。 */
    .gv-readonly-flow .react-flow__pane,.gv-readonly-flow .react-flow__node{cursor:grab}
    .gv-readonly-flow .react-flow__edge{pointer-events:none;cursor:grab}
    .gv-readonly-flow .react-flow__pane.dragging{cursor:grabbing}
    /* Figma 14597_22208：hover 出口/入口箭头才露「添加节点」+，交互与 gv-bp-node-more 同构（纯 CSS hover/focus-within）。
       箭头本体只有 10×12，过小不便 hover：用 padding 把命中区扩到 ~34×24，再用等量负 margin 抵消，保持行内布局不动；
       这圈 padding 同时充当箭头到外侧 + 之间的 hover 桥。出口 + 在右，入口 + 在左。 */
    .gv-handle-more{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;margin:-6px -12px;z-index:40}
    /* Figma 14597_22208 原样：20.82 圆 + 1.04 内偏移描边、底透明；left/top 把它摆到箭头右侧并垂直居中。 */
    .gv-handle-add-btn{position:absolute;left:100%;top:50%;transform:translateY(-50%);z-index:50;display:flex;align-items:center;justify-content:center;width:20.82px;height:20.82px;border-radius:50%;outline:1.04px solid rgba(255,255,255,0.60);outline-offset:-1.04px;background:transparent;cursor:pointer;line-height:0;opacity:0;pointer-events:none;transition:opacity .12s,transform .12s}
    .gv-handle-add-btn.is-before{left:auto;right:100%}
    .gv-handle-more:hover .gv-handle-add-btn,.gv-handle-more:focus-within .gv-handle-add-btn{opacity:1;pointer-events:auto}
    .gv-handle-add-btn:hover{outline-color:#fff;transform:translateY(-50%) scale(1.1)}
    .gv-handle-add-btn:hover svg path{fill-opacity:1}
    /* 边中点悬浮删除：扩大命中区后 hover 才露按钮；试玩 readOnly 不挂 onDelete */
    .gv-edge-delete{position:absolute;transform:translate(-50%,-50%);pointer-events:all;z-index:8}
    .gv-edge-delete button{position:relative;display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0;padding:0;border:1px solid #2a3a55;border-radius:999px;background:rgba(20,24,32,.96);color:#9DC0F5;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.45);line-height:0}
    .gv-edge-delete button:hover{background:rgba(70,124,201,.22);border-color:#467CC9;color:#FFFFFF}
    .gv-edge-delete button svg{width:12px;height:12px}
    .gv-edge-delete button[data-tip]::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;padding:5px 10px;font-size:11px;line-height:1.3;border-radius:6px;background:rgba(18,22,30,.96);border:1px solid #2a3a55;color:#FFFFFF;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .1s;z-index:40}
    .gv-edge-delete button[data-tip]:hover::after{opacity:1}
    /* 删除确认弹窗：居中浮层、毛玻璃底、与侧栏 ns-pop-confirm 视觉统一 */
    .gv-pop-confirm-backdrop{position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
    .gv-pop-confirm{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;min-width:200px;max-width:280px;padding:14px 16px;background:#3a3a3a;border:1px solid rgba(255,255,255,0.16);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.45);color:rgba(255,255,255,0.80)}
    .gv-pop-confirm-msg{font-size:13px;line-height:1.45;word-break:break-word}
    .gv-pop-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
    .gv-pop-confirm-actions button{height:28px;padding:0 12px;border:1px solid rgba(255,255,255,0.16);border-radius:4px;background:transparent;color:rgba(255,255,255,0.80);cursor:pointer;font-family:inherit;font-size:13px;line-height:1;transition:background .12s,border-color .12s,color .12s}
    .gv-pop-confirm-actions button:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.28);color:#fff}
    .gv-pop-confirm-actions button.is-danger{background:rgba(220,80,80,0.25);border-color:rgba(255,142,142,0.35);color:#ffb4b4}
    .gv-pop-confirm-actions button.is-danger:hover{background:rgba(220,80,80,0.4);border-color:rgba(255,142,142,0.55);color:#ffd4d4}
  `
}
import type {
  Entity,
  GameEdge,
  GameGraph,
  GameNode,
  GraphEffect,
  NumOrExpr,
  Variable,
} from '../../runtime/schema/graph-schema'
import {
  isSettlementReaction,
  type NodeAction,
  type Overlay,
  type Reaction,
} from '../../runtime/schema/node-config-schema'
import { getSubFlowPack, isSubflowContainerData } from '../../runtime/schema/graph-schema'
import type { FXNode } from '../../runtime/schema/react-flow-schema'
import { toFXView } from './fx-view'
import { GraphMiniMap } from './GraphMiniMap'
import { connect, disconnect, duplicateNodes, insertNodeAfter, insertNodeBefore, removeNode, setNodePosition } from '../edit/graph-edit'
import quoteIcon from './icons/quote.svg'

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
  details: CanvasNodeDetails
  active?: boolean
  /** 子流程/子蓝图容器（subProcess 或 subFlowPack）→ 显示可下钻徽标。 */
  isGroup?: boolean
  /** 子蓝图容器（与同图子流程区分徽标文案）。 */
  isPack?: boolean
  /** 当前图的入口业务节点。 */
  isEntry?: boolean
  onDrill?: (nodeId: string) => void
  /** 出口箭头 hover 出的「+」：在该出口（sourceHandle）后插入新节点；rowIndex 用于纵向错开。 */
  onInsertAfter?: (nodeId: string, sourceHandle: string, rowIndex: number) => void
  /** 入口箭头 hover 出的「+」：在该节点前方插入新节点，并改接所有入边。 */
  onInsertBefore?: (nodeId: string) => void
  onPlay?: (nodeId: string) => void
  onReference?: (nodeId: string) => void
  onDuplicate?: (nodeId: string) => void
  onDelete?: (nodeId: string) => void
  [key: string]: unknown
}

export interface CanvasNodeDetails {
  performance?: string
  interfaces: string[]
  settlements: string[]
}

interface CanvasVideoOption {
  id: string
  label: string
}

interface CanvasSettlementContext {
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  overlays?: Record<string, Overlay>
  graph?: GameGraph
  node?: GameNode
}

function settlementTriggerLabel(reaction: Reaction): string {
  const when = reaction.when
  if (when.type === 'at') return `${Math.max(0, Math.round(when.ms))} ms`
  if (when.type === 'enter') return '进入时'
  if (when.type === 'exit') return '离开前'
  if (when.type === 'complete') return when.if ? '结束条件' : '演出结束'
  if (when.type === 'shown') return '界面出现'
  if (when.type === 'hidden') return '界面消失'
  return '条件'
}

function entityFor(entities: Record<string, Entity> | undefined, id: string): Entity | undefined {
  return entities?.[id] ?? Object.values(entities ?? {}).find((entity) => entity.id === id)
}

function entityLabel(entities: Record<string, Entity> | undefined, id: string): string {
  const entity = entityFor(entities, id)
  return entity?.name?.trim() || (entity?.kind === 'player' ? '玩家' : entity?.kind === 'boss' ? 'Boss' : id)
}

function variableLabel(variables: Record<string, Variable> | undefined, id: string): string {
  const variable = variables?.[id] ?? Object.values(variables ?? {}).find((item) => item.id === id)
  return variable?.name?.trim() || id
}

function numericEffectValue(op: 'add' | 'mul' | 'set', value: NumOrExpr): string {
  const raw = typeof value === 'number' ? String(value) : value.expr.trim() || '?'
  if (op === 'set') return `=${raw}`
  if (op === 'mul') return `×${raw}`
  if (typeof value === 'number') return value > 0 ? `+${raw}` : raw
  return raw.startsWith('-') ? raw : `+(${raw})`
}

function effectDescription(
  effect: GraphEffect,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  if (effect.kind === 'attr') {
    const entity = entityFor(entities, effect.entityId)
    const attr = entity?.attrMeta?.[effect.attr]?.label?.trim() || effect.attr
    return `${entityLabel(entities, effect.entityId)}.${attr} ${numericEffectValue(effect.op, effect.value)}`
  }
  if (effect.kind === 'var') {
    return `${variableLabel(variables, effect.varId)} ${numericEffectValue(effect.op, effect.value)}`
  }
  if (effect.kind === 'flag') return `${variableLabel(variables, effect.varId)}=${effect.value ? '是' : '否'}`
  return `${effect.op === 'give' ? '获得' : '失去'} ${effect.itemId || '道具'} ×${effect.count}`
}

function actionDescriptions(action: NodeAction, context: CanvasSettlementContext): string[] {
  if (action.kind === 'effect') {
    return action.effects.map((effect) => effectDescription(effect, context.entities, context.variables))
  }
  if (action.kind === 'advance') {
    const targetId = context.graph?.edges.find((edge) => edge.id === action.edgeId)?.target
    const target = context.graph?.nodes.find((node) => node.id === targetId)
    return [target ? `推进 ${target.data.name}` : '推进']
  }
  if (action.kind === 'spawn') {
    const overlayId = action.from.split('/')[0] ?? action.from
    return [`绑定 ${context.overlays?.[overlayId]?.title?.trim() || overlayId}`]
  }
  const mount = context.node?.data.overlayNodes?.find((item) => (item.id ?? item.overlay) === action.mountId)
  return [`隐藏 ${context.overlays?.[mount?.overlay ?? '']?.title?.trim() || mount?.overlay || action.mountId}`]
}

/** 结算卡片直接说明 reaction 内的真实效果与目标，不用泛化的动作类型代替。 */
export function canvasSettlementLabel(
  reaction: Reaction,
  context: CanvasSettlementContext = {},
): string {
  const trigger = settlementTriggerLabel(reaction)
  const descriptions = reaction.do.flatMap((action) => actionDescriptions(action, context))
  return descriptions.length > 0 ? `${trigger} · ${descriptions.join('；')}` : trigger
}

/** 画布摘要只投影既有引用；名称随素材库/界面目录实时更新，不重复写入节点契约。 */
export function canvasNodeDetails(
  node: GameNode,
  overlays?: Record<string, Overlay>,
  videoOptions: readonly CanvasVideoOption[] = [],
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
  graph?: GameGraph,
): CanvasNodeDetails {
  const mediaRef = node.data.media?.ref?.trim()
  const performance = mediaRef
    ? videoOptions.find((option) => option.id === mediaRef)?.label.trim() || mediaRef
    : undefined
  const interfaces = (node.data.overlayNodes ?? []).map((mount) => {
    const title = overlays?.[mount.overlay]?.title?.trim()
    return title || mount.overlay
  })
  const settlements = (node.data.reactions ?? [])
    .filter(isSettlementReaction)
    .map((reaction) => canvasSettlementLabel(reaction, { entities, variables, overlays, graph, node }))
  return { performance, interfaces, settlements }
}

const BADGE_COLOR: Record<string, string> = {
  qte: '#8b5cf6',
  choice: '#3b82f6',
  overlay: '#8b5cf6',
  pack: '#3b82f6',
  subflow: '#eab308',
}

/** MiniMap 节点填色：读 RF node.data.fx.data.badge → BADGE_COLOR。 */
export function minimapNodeColor(node: { data: unknown }): string {
  const badge = (node.data as { fx?: { data?: { badge?: string } } } | null | undefined)?.fx?.data?.badge
  if (typeof badge === 'string' && BADGE_COLOR[badge]) return BADGE_COLOR[badge]!
  return '#4b5563'
}

const HANDLE_COLOR: Record<string, string> = {
  // 默认推进：与左侧「输入」同色（白 60%）
  default: 'rgba(255,255,255,0.60)',
  pass: '#22c55e',
  good: '#84cc16',
  fail: '#ef4444',
  win: '#22c55e',
  lose: '#ef4444',
}
function handleColor(id: string): string {
  if (HANDLE_COLOR[id]) return HANDLE_COLOR[id]!
  if (id === 'default') return 'rgba(255,255,255,0.60)'
  return '#3b82f6' // 交互出口（pass/fail/选项/热点…）
}

/**
 * InputIcon —— Figma 12414_5350 I/O 中段左侧「输入」图标。
 * 与节点外侧 handle、行末出口三角同款 10×12 实心填充 ▶（右指三角），保持视觉一致。
 */
const InputIcon = (): JSX.Element => (
  <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
    <path d="M0 0L10 6L0 12V0Z" fill="rgba(255,255,255,0.60)" />
  </svg>
)

const Ico = {
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  ),
  /** 删除节点 —— Figma 15229_79461 */
  trash: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.16667} strokeLinecap="square" aria-hidden>
      <path d="M12.25 2.91724H1.75M2.91667 2.91724H11.0833L10.7917 12.8339H3.20833L2.91667 2.91724ZM4.95833 1.16724H9.04167V2.91724H4.95833V1.16724Z" />
      <path d="M7 5.25061V10.5006" />
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
  /** Figma 14597_22208 handle 添加节点：实心 + 号（设计稿导出原样） */
  add: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M6.87219 1.56177H5.57069L5.59713 5.67062H1.5625V6.97212H5.59713L5.59713 10.9325H6.89862L6.89862 6.97212L10.9333 6.97212V5.67062L6.89862 5.67062L6.87219 1.56177Z" fill="white" fillOpacity="0.6" />
    </svg>
  ),
  /** 引用（节点信息引用到 AI Chat）—— Figma 14687_174900 */
  quote: (
    <img src={quoteIcon} alt="引用" style={{ width: 14, height: 14, display: 'block' }} />
  ),
  /** 从此试玩（以该节点为起点预览） */
  play: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  ),
}

/**
 * 出口箭头 ▶ + 连线用的 source Handle + hover 才露的「添加节点」+。
 * 顶部行的第一个出口与下方每行出口共用这一份实现，保证箭头列与 hover 交互不会分叉。
 * Handle 绝对定位盖在箭头上（不占 flex 宽度），确保箭头右边缘贴着节点边、各行对齐同一列。
 */
function FlowOutlet({
  nodeId,
  handle,
  rowIndex,
  color,
  canEdit,
  onInsertAfter,
}: {
  nodeId: string
  handle: FXNode['outputs'][number]
  rowIndex: number
  color: string
  canEdit: boolean
  onInsertAfter?: (nodeId: string, sourceHandle: string, rowIndex: number) => void
}): JSX.Element {
  const flowId = handle.data?.flowId ?? handle.id.replace(/^source:/, '')
  return (
    <span className="gv-handle-more" style={{ color }}>
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><path d="M0 0L10 6L0 12V0Z" fill="currentColor" /></svg>
      </span>
      <Handle
        id={handle.id}
        type="source"
        position={Position.Right}
        className={`gv-flow-handle${canEdit ? ' is-interactive' : ' is-static'}`}
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 10,
          height: 12,
          minWidth: 10,
          minHeight: 12,
          background: 'transparent',
          border: 'none',
          opacity: 0,
          pointerEvents: canEdit ? undefined : 'none',
        }}
      />
      {onInsertAfter && (
        <div
          className="gv-handle-add-btn nodrag nopan"
          role="button"
          tabIndex={0}
          aria-label={`在「${handle.data?.displayLabel ?? flowId}」出口后添加节点`}
          title="添加节点"
          onClick={(e) => {
            e.stopPropagation()
            onInsertAfter(nodeId, flowId, rowIndex)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            onInsertAfter(nodeId, flowId, rowIndex)
          }}
        >
          {Ico.add}
        </div>
      )}
    </span>
  )
}

/**
 * 入口箭头 ▶ + target Handle + hover 才露在左侧的「添加节点」+。
 * 点击后在该节点前方插入新节点，并把所有入边改接到新节点。
 */
function FlowInlet({
  nodeId,
  handles,
  onInsertBefore,
}: {
  nodeId: string
  handles: FXNode['inputs']
  onInsertBefore?: (nodeId: string) => void
}): JSX.Element {
  return (
    <span className="gv-handle-more" style={{ color: 'rgba(255,255,255,0.60)' }}>
      {onInsertBefore && (
        <div
          className="gv-handle-add-btn is-before nodrag nopan"
          role="button"
          tabIndex={0}
          aria-label="在输入前添加节点"
          title="添加节点"
          onClick={(e) => {
            e.stopPropagation()
            onInsertBefore(nodeId)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            onInsertBefore(nodeId)
          }}
        >
          {Ico.add}
        </div>
      )}
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <InputIcon />
      </span>
      {handles.map((h) => (
        // 输入端 1×1 透明 Handle 作为边的连接点，定位到「输入」三角左侧节点边缘。
        <Handle
          key={h.id}
          id={h.id}
          type="target"
          position={Position.Left}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 1,
            height: 1,
            minWidth: 1,
            minHeight: 1,
            background: 'transparent',
            border: 'none',
            opacity: 0,
          }}
        />
      ))}
    </span>
  )
}

function PerfNode({ id, data, selected }: NodeProps): JSX.Element {
  const { fx, details, active, isGroup, isPack, isEntry, onDrill, onInsertAfter, onInsertBefore, onPlay, onReference, onDuplicate, onDelete } = data as CanvasNodeViewData
  const canEdit = !!(onInsertAfter || onInsertBefore || onPlay || onReference || onDuplicate || onDelete)
  const [hovered, setHovered] = useState(false)
  // 常态阴影对齐设计稿。选中/试玩描边用 inset box-shadow（不用 outline），
  // 避免描边画在溢出的右侧操作条上面。运行中/选中边框统一为 #7DACED。
  const baseShadow = '0 0 15.618px 10.412px rgba(0, 0, 0, 0.08)'
  // Figma 14947_83822：预览中节点外发光
  const playShadow = '0 0 15.62px 10.41px rgba(70, 124, 201, 0.65)'
  // Figma 14947_83814：非选中 hover 边框 = #7DACED 40% 透明度
  const hoverBorder = 'inset 0 0 0 2px rgba(125, 172, 237, 0.40)'
  const normalBorder = 'inset 0 0 0 2px #7DACED'
  const edgeShadow = active ? playShadow : baseShadow
  const edgeBorder = (active || selected) ? normalBorder : undefined
  const boxShadow = edgeBorder
    ? `${edgeShadow}, ${edgeBorder}`
    : hovered
      ? `${baseShadow}, ${hoverBorder}`
      : baseShadow

  // Figma 14947_83595：子蓝图/子流程节点标题栏颜色。
  // 子蓝图 = 绿色 rgba(69.66,200.65,69.66,0.20)；子流程 = 黄色 rgba(234,179,8,0.20)（沿用 subflow badge 色）。
  const groupTitleBg = isGroup
    ? isPack
      ? 'rgba(69.66, 200.65, 69.66, 0.20)'
      : 'rgba(234, 179, 8, 0.20)'
    : 'rgba(69.66, 124.40, 200.65, 0.20)' // 普通节点：蓝色
  const groupTypeLabel = isGroup ? (isPack ? '子蓝图' : '子流程') : null

  const nodeCard = (
    <div
      className={`gv-bp-node${selected ? ' is-selected' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        minWidth: 173,
        borderRadius: 12,
        border: 'none',
        background: '#232323',
        color: '#FFFFFF',
        fontSize: 14,
        overflow: 'visible',
        boxShadow,
      }}
    >
      {/* 标题栏：子蓝图/子流程使用对应颜色背景 + 类型标签 + 「进入」按钮；
          普通节点保持蓝色背景 + 名称 + badge + 操作菜单。 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 8px 12px 8px',
        background: groupTitleBg,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px 12px 0 0',
      }}>
        {isGroup ? (
          <>
            {/* 节点名称（如「我方回合」） */}
            <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{fx.data.label}</span>
            {/* Figma 14947_83595：「进入」按钮 pill —— 紧跟节点名称后面 */}
            <button
              type="button"
              className="nodrag nopan"
              aria-label={`进入${groupTypeLabel}`}
              title={`进入${groupTypeLabel}`}
              onClick={(e) => {
                e.stopPropagation()
                onDrill?.(id)
              }}
              style={{
                height: 19,
                padding: '0 6px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.20)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.60)',
                fontSize: 11,
                fontWeight: 400,
                cursor: 'pointer',
                lineHeight: '19px',
              }}
            >
              进入
            </button>
            {/* 「...」操作菜单（引用/从此试玩/复制/删除） */}
            {canEdit && (
              <div className="gv-bp-node-more" style={{ marginLeft: 'auto' }}>
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
                      aria-label="引用"
                      title="引用到聊天"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReference?.(id)
                      }}
                    >
                      {Ico.quote}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="从此试玩"
                      title="从此试玩"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlay?.(id)
                      }}
                    >
                      {Ico.play}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="复制"
                      title={`复制此节点（${MOD_HINT}D）`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDuplicate?.(id)
                      }}
                    >
                      {Ico.copy}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="删除"
                      title="删除此节点"
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
          </>
        ) : (
          <>
            {isEntry && (
              <span
                aria-label="入口节点"
                title="入口节点"
                style={{ width: 8, height: 8, borderRadius: '50%', background: '#55b98a', flexShrink: 0 }}
              />
            )}
            <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{fx.data.label}</span>
            {canEdit && (
              <div className="gv-bp-node-more" style={{ marginLeft: 'auto' }}>
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
                      aria-label="引用"
                      title="引用到聊天"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReference?.(id)
                      }}
                    >
                      {Ico.quote}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="从此试玩"
                      title="从此试玩"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlay?.(id)
                      }}
                    >
                      {Ico.play}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="复制"
                      title={`复制此节点（${MOD_HINT}D）`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDuplicate?.(id)
                      }}
                    >
                      {Ico.copy}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan"
                      role="menuitem"
                      aria-label="删除"
                      title="删除此节点"
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
          </>
        )}
      </div>
      {/* Figma 12414_5350 I/O 中段：白 5% 背景。
          左侧固定「→输入」标签（44×17，12px 白 60%，12×12 输入图标），
          右侧每个 output 一行（12px 文字 + 12×12 输出图标 handle）。
          当没有演出摘要时加上底部圆角，防止卡片 #232323 背景在角落漏出。 */}
      <div data-testid="node-edge-info" style={{ padding: '12px 1px 12px 4px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.05)', borderBottomLeftRadius: (details.performance || details.interfaces.length > 0 || details.settlements.length > 0) ? 0 : 12, borderBottomRightRadius: (details.performance || details.interfaces.length > 0 || details.settlements.length > 0) ? 0 : 12 }}>
        {(() => {
          // 顶部行：左「输入」+ 图标，右「第一个出口名称」+ 三角（替代固定「输出」）。
          // 第一个出口（默认推进）显示在顶部行右侧，下方行从第二个出口开始渲染。
          const first = fx.outputs[0]
          const firstFid = first?.data?.flowId ?? first?.id
          const firstDisplay = first?.data?.displayLabel ?? first?.label ?? firstFid
          const firstColor = firstFid ? handleColor(firstFid) : 'rgba(255,255,255,0.60)'
          return (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.60)', height: 17 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <FlowInlet nodeId={id} handles={fx.inputs} onInsertBefore={onInsertBefore} />
                <span>输入</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: firstColor }}>
                <span title={firstFid}>{firstDisplay}</span>
                {/* 第一个出口的箭头 + Handle 也在此行（替代原「输出」位置）。 */}
                {first && (
                  <FlowOutlet
                    nodeId={id}
                    handle={first}
                    rowIndex={0}
                    color={firstColor}
                    canEdit={canEdit}
                    onInsertAfter={onInsertAfter}
                  />
                )}
              </span>
            </div>
          )
        })()}
        {/* 其余 output（从第二个开始）每个一行：右对齐文字 + 右侧 handle。 */}
        {fx.outputs.slice(1).map((h, i) => {
          const fid = h.data?.flowId ?? h.id
          const display = h.data?.displayLabel ?? h.label ?? fid
          const c = handleColor(fid)
          const hi = i + 1 // handle 索引：0 = 第一个出口，1+ = 后续
          return (
            <div key={h.id} style={{ fontSize: 12, color: c, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <span title={fid}>{display}</span>
              {/* 行末右指三角箭头与文字间距 8px（对齐 Figma 输入组间距）；
                  三角是行末最后一个占位元素，右边缘与顶部第一出口三角对齐同一垂直列（贴节点边缘）。 */}
              <FlowOutlet
                nodeId={id}
                handle={h}
                rowIndex={hi}
                color={c}
                canEdit={canEdit}
                onInsertAfter={onInsertAfter}
              />
            </div>
          )
        })}
      </div>
      {/* Figma 12414_5350 演出摘要行：左 "演出" 标签 12px 白 40%，右 "视频名称" 12px 白 80%，左右边距 8px。
          背景必须透明：选中描边是父级 inset box-shadow，不透明底会盖住底部描边。
          底色由 .gv-bp-node 的 #232323 透出；底部圆角对齐卡片裁切。 */}
      {(details.performance || details.interfaces.length > 0 || details.settlements.length > 0) && (
        <div data-testid="node-content-info" style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', columnGap: 8, rowGap: 4, padding: '0 8px 4px 8px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'transparent', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
          {details.performance && (
            <>
              <span style={{ padding: '4px 0', color: 'rgba(255,255,255,0.40)', fontSize: 12 }}>演出</span>
              <span title={details.performance} style={{ padding: '4px 0', minWidth: 0, color: 'rgba(255,255,255,0.80)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {details.performance}
              </span>
            </>
          )}
          {details.interfaces.length > 0 && (
            <>
              <span style={{ padding: '4px 0', color: 'rgba(255,255,255,0.40)', fontSize: 12 }}>界面</span>
              <span style={{ padding: '4px 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                {details.interfaces.map((label, index) => (
                  <span key={`${label}:${index}`} title={label} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.80)', fontSize: 12 }}>
                    {label}
                  </span>
                ))}
              </span>
            </>
          )}
          {details.settlements.length > 0 && (
            <>
              <span style={{ padding: '4px 0', color: 'rgba(255,255,255,0.40)', fontSize: 12 }}>结算</span>
              <span style={{ padding: '4px 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                {details.settlements.map((label, index) => (
                  <span key={`${label}:${index}`} title={label} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.80)', fontSize: 12 }}>
                    {label}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )

  // Figma 14947_83595：子蓝图/子流程节点不再外裹 #344761 容器，「进入」按钮已内嵌到标题栏。
  return nodeCard
}

const nodeTypes = { perf: PerfNode }

type FlowEdgeData = {
  onDelete?: (edgeId: string) => void
  /** 试玩已走路径；写在 data 里比只靠 RF `animated` 更稳（自定义边必读到）。 */
  traversed?: boolean
  [key: string]: unknown
}

const TRAVERSED_EDGE_STROKE = '#FF9C2A'

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
  style,
  animated,
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
    // 回环/回退边（目标在源左侧）：
    //  1) 先从「源出口」水平向右引出一段 stub，让出边在出口处清晰可见（能看出是哪个出口引出）；
    //2) 再向下绕到行下方（dip），避免直线盖在中间节点上；
    //  3) 到达目标前，从「目标输入口」左侧水平引入一段 stub，让入边在输入口处清晰可见。
    const stub = 24
    const dip = Math.max(sourceY, targetY) + 120
    // 出口右侧引出点 / 输入口左侧引入点
    const sx = sourceX + stub
    const tx = targetX - stub
    path = [
      `M ${sourceX},${sourceY}`,
      `L ${sx},${sourceY}`,
      `C ${sx + 80},${dip} ${tx - 80},${dip} ${tx},${targetY}`,
      `L ${targetX},${targetY}`,
    ].join(' ')
    // 三次贝塞尔 t=0.5 近似中点（用引出/引入后的控制点），把删除钮落在绕行弧上。
    labelX = 0.125 * sx + 0.375 * (sx + 80) + 0.375 * (tx - 80) + 0.125 * tx
    labelY = 0.125 * sourceY + 0.75 * dip + 0.125 * targetY
  } else {
    ;[path, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12,
    })
  }
  // 试玩已走路径：橙色虚线流动。优先读 data.traversed（rfEdges 显式写入），兼读 RF animated。
  const traversed = Boolean((data as FlowEdgeData | undefined)?.traversed) || Boolean(animated)
  const edgeStyle = traversed
    ? {
      ...style,
      stroke: TRAVERSED_EDGE_STROKE,
      strokeWidth: 2,
      strokeDasharray: '5',
      animation: 'gv-edge-dashdraw 0.5s linear infinite',
    }
    : {
      ...style,
      // Figma 13135_19419：回环边兜底色与主流一致 #467CC9。
      stroke: (style?.stroke as string | undefined) ?? '#467CC9',
    }
  return (
    <>
      <g onMouseEnter={showDelete} onMouseLeave={hideDelete}>
        <BaseEdge
          // key 强制在 idle↔traversed 切换时重挂 path，避免 xyflow 缓存旧 stroke。
          key={traversed ? 'traversed' : 'idle'}
          id={id}
          path={path}
          className={traversed ? 'gv-edge-path-traversed' : undefined}
          // Figma 13135_19511：边为纯线条，不渲染任何末端 marker（无箭头）。
          markerEnd={undefined}
          interactionWidth={24}
          style={edgeStyle}
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
  /** 当前作用域入口节点；只影响画布标识，不改变运行时。 */
  entryNodeId?: string
  /** ui.overlays —— 派生节点出口引脚中文标签（与节点配置「何时走」一致）。 */
  overlays?: Record<string, Overlay>
  /** 视频素材候选；仅用于把 node.data.media.ref 投影为节点卡片展示名。 */
  videoOptions?: readonly CanvasVideoOption[]
  /** 场景规则目录；仅用于把 reaction 内的实体、属性和变量引用投影为可读说明。 */
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  activeNodeId?: string | null
  traversedEdgeIds?: Set<string>
  /**
   * 只读模式（试玩蓝图浮层）：不出节点 hover 编辑菜单（后插/复制/删除），禁用拖拽/连线/删除键/
   * 复制粘贴快捷键。仍可点节点 jump、下钻子流程、居中查看。
   */
  readOnly?: boolean
  /** 是否响应 Delete/Backspace 删除选中元素；节点配置面板打开时由宿主关闭，避免误删。 */
  keyboardDeleteEnabled?: boolean
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
  /**
   * 变化时对 revealFollowNodeId 重新定位。给「画布可视宽度变了但选中没变」的场景用
   * （宿主预览列展开/收起会把画布挤窄，选中节点可能落到视口外）。
   */
  revealSignal?: number
  /**
   * revealSignal 跟随定位的目标；不传则退回 revealNodeId。
   * 与 revealNodeId 分开是因为「选中就自动居中」和「画布变窄后把选中捞回可视区」
   * 是两回事：宿主外置形态下选节点不改画布尺寸，不该平移整张图。
   */
  revealFollowNodeId?: string | null
  onJump?: (nodeId: string) => void
  /** 双击内嵌子流程容器节点（有 subProcess）时下钻。 */
  onDrill?: (containerId: string) => void
  /** 节点菜单「从此试玩」：以该节点为起始预览播放。 */
  onPlay?: (nodeId: string) => void
  /** 节点菜单「引用」：将节点信息引用到 AI Chat。 */
  onReference?: (nodeId: string) => void
  /** 点击画布空白处（取消选中 → 隐藏节点配置面板）。 */
  onPaneClick?: () => void
  /** 画布右下角：添加节点（属于蓝图编辑手势，不进顶栏）。position = 当前视口中心（flow 坐标）。 */
  onAddNode?: (position: { x: number; y: number }) => void
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
  entryNodeId,
  overlays,
  videoOptions = [],
  entities,
  variables,
  activeNodeId,
  traversedEdgeIds,
  readOnly = false,
  keyboardDeleteEnabled = true,
  visibleNodeIds,
  fitSignal,
  drillFitKey,
  revealNodeId,
  revealSignal,
  revealFollowNodeId,
  revealPanelRatio,
  onJump,
  onDrill,
  onPlay,
  onReference,
  onPaneClick,
  onAddNode,
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

  /**
   * 出口箭头旁的「+」：在该出口后插入新节点（原有下游边改从新节点默认出口继续）。
   * 多出口分叉时按出口行号纵向错开，避免几个新节点叠在同一处。
   */
  const onInsertAfter = useCallback(
    (nodeId: string, sourceHandle: string, rowIndex: number) => {
      const { graph: next, nodeId: created } = insertNodeAfter(graph, nodeId, {
        sourceHandle,
        gapY: rowIndex * 120,
      })
      if (next === graph) return
      onChange(next)
      setSelectedIds([created])
      onJump?.(created)
    },
    [graph, onChange, onJump],
  )

  /** 入口箭头旁的「+」：在该节点前方插入新节点，并改接所有入边。 */
  const onInsertBefore = useCallback(
    (nodeId: string) => {
      const { graph: next, nodeId: created } = insertNodeBefore(graph, nodeId)
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

  const [pendingDelete, setPendingDelete] = useState<{ type: 'single'; nodeId: string; name: string } | { type: 'bulk'; ids: string[]; count: number } | null>(null)

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      const name = graph.nodes.find((n) => n.id === nodeId)?.data.name ?? nodeId
      setPendingDelete({ type: 'single', nodeId, name })
    },
    [graph],
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
    setPendingDelete({ type: 'bulk', ids: [...selectedIds], count: selectedIds.length })
  }, [selectedIds])

  const execPendingDelete = useCallback(() => {
    if (!pendingDelete) return
    let g = graph
    if (pendingDelete.type === 'single') {
      g = removeNode(g, pendingDelete.nodeId)
      setSelectedIds((ids) => ids.filter((id) => id !== pendingDelete.nodeId))
    } else {
      for (const id of pendingDelete.ids) g = removeNode(g, id)
    }
    onChange(g)
    setPendingDelete(null)
    onPaneClick?.()
  }, [pendingDelete, graph, onChange, onPaneClick])

  const cancelPendingDelete = useCallback(() => {
    setPendingDelete(null)
    // 如果是批量删除的取消，需要恢复空选中（因为 selectedIds 可能会在取消后继续被 ES 重置）
    if (pendingDelete?.type === 'bulk') setSelectedIds([])
  }, [pendingDelete])

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
            details: canvasNodeDetails(graph.nodes.find((node) => node.id === n.id)!, overlays, videoOptions, entities, variables, graph),
            active: n.id === activeNodeId,
            isEntry: n.id === entryNodeId,
            isGroup: containerIds.has(n.id),
            isPack: packIds.has(n.id),
            onDrill,
            onInsertAfter: readOnly ? undefined : onInsertAfter,
            onInsertBefore: readOnly ? undefined : onInsertBefore,
            onPlay: readOnly ? undefined : onPlay,
            onReference: readOnly ? undefined : onReference,
            onDuplicate: readOnly ? undefined : onDuplicateNode,
            onDelete: readOnly ? undefined : onDeleteNode,
          } as CanvasNodeViewData,
        })),
    [fx, graph, overlays, videoOptions, entities, variables, activeNodeId, entryNodeId, visibleNodeIds, containerIds, packIds, selectedIds, readOnly, onDrill, onInsertAfter, onInsertBefore, onPlay, onReference, onDuplicateNode, onDeleteNode],
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
          // 锁死边 z，避免选中节点时 xyflow 把相连边抬到与节点同级、盖住右侧操作条。
          zIndex: 0,
          // Figma 13135_19511：边连线为纯线条（无箭头），stroke #467CC9、stroke-width 1。
          // 试玩已走路径：#FF9C2A 虚线流动；data.traversed + animated + className 三路同开。
          animated: traversedEdgeIds?.has(e.id) ?? false,
          className: traversedEdgeIds?.has(e.id) ? 'gv-edge-traversed' : undefined,
          style: traversedEdgeIds?.has(e.id)
            ? { stroke: TRAVERSED_EDGE_STROKE, strokeWidth: 2, strokeDasharray: '5' }
            : { stroke: '#467CC9', strokeWidth: 1 },
          data: {
            onDelete: readOnly ? undefined : onDeleteEdge,
            traversed: traversedEdgeIds?.has(e.id) ?? false,
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
   * 切图后 RF 节点偶发尚未就绪 → 短延迟重试一次。
   */
  const revealNodeInView = useCallback((nodeId: string, duration: number): boolean => {
    const node = getNodes().find((n) => n.id === nodeId)
    if (!node) return false
    const el = rootRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
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
    void setViewport(
      { x: targetScreenX - cx * zoom, y: targetScreenY - cy * zoom, zoom },
      duration > 0 ? { duration } : undefined,
    )
    return true
  }, [getNodes, getViewport, revealPanelRatio, setViewport])

  useEffect(() => {
    if (!revealNodeId) return
    let cancelled = false
    const reveal = (attempt: number) => {
      if (cancelled) return
      if (!revealNodeInView(revealNodeId, 220) && attempt < 1) {
        window.setTimeout(() => reveal(attempt + 1), 40)
      }
    }
    const t = window.setTimeout(() => reveal(0), 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNodeId, revealPanelRatio])

  /**
   * 画布可视宽度自己在动（宿主预览列开合），这里贴着每一帧即时重定位，让图和抽屉
   * 一起平滑滑动。等动画结束再补一次的话会变成「先杵着、末尾跳一下」。
   * 只在 revealSignal 变化后开一个短窗口，平时不抢用户手动平移。
   */
  useEffect(() => {
    const followId = revealFollowNodeId ?? revealNodeId
    if (!revealSignal || !followId) return
    const el = rootRef.current
    if (!el) return
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => revealNodeInView(followId, 0))
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(el)
    const stop = window.setTimeout(() => observer.disconnect(), 600)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.clearTimeout(stop)
    }
    // 只跟 revealSignal 走：选中变化不该触发跟随（画布尺寸没变）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSignal])

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
        className={readOnly ? 'gv-readonly-flow' : undefined}
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
        onNodeDoubleClick={(_e, n) => {
          // Figma 14947_83595：子流程/子蓝图的下钻通过标题栏「进入」按钮触发，
          // 双击不再下钻，避免与节点选中/打开配置面板的交互冲突。
          void n
        }}
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
        elementsSelectable={!readOnly}
        edgesFocusable={!readOnly}
        edgesReconnectable={false}
        elevateEdgesOnSelect={false}
        selectionKeyCode={readOnly ? null : 'Shift'}
        multiSelectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={readOnly || !keyboardDeleteEnabled ? null : ['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        {/* Figma 14597_19658：Control Panel 只保留 3 个操作（放大/缩小/复位），隐藏 interactive 锁按钮。 */}
        <Controls position="bottom-left" showInteractive={false} />
        <GraphMiniMap nodeColor={minimapNodeColor} />
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
      {/* Figma 15195_74435：右下角三按钮。白 5% 底、无边框、8px 圆角、14px 白字 + 20 图标。 */}
      <div className="gv-canvas-chrome">
        {onAddNode && (
          <button
            type="button"
            onClick={() => {
              const c = viewportCenter()
              // 轻微抖动，连续添加时不完全重叠。
              onAddNode({ x: c.x - 90 + Math.random() * 40, y: c.y - 40 + Math.random() * 40 })
            }}
            title="新建演出节点"
            aria-label="新建节点"
          >
            <span className="gv-chrome-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 11 11" fill="none"><path d="M0 4.55046L0 6.00879L4.604 5.97917V10.5H6.06234V5.97917H10.5V4.52083H6.06234V0H4.604V4.52083L0 4.55046Z" fill="currentColor" /></svg>
            </span>
            <span className="gv-chrome-label">新建节点</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => { void fitGraphInView({ duration: 200 }) }}
          title="把整张图框进视口正中（不改动节点位置）"
          aria-label="定位当前节点"
        >
          <span className="gv-chrome-ico" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.0832 6.99935C11.0832 9.25452 9.255 11.0827 6.99984 11.0827M11.0832 6.99935C11.0832 4.74419 9.255 2.91602 6.99984 2.91602M11.0832 6.99935H12.8332M6.99984 11.0827C4.74468 11.0827 2.9165 9.25452 2.9165 6.99935M6.99984 11.0827V12.8327M6.99984 2.91602C4.74468 2.91602 2.9165 4.74419 2.9165 6.99935M6.99984 2.91602V1.16602M2.9165 6.99935H1.1665" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" /><path d="M7.58317 6.99935C7.58317 7.32152 7.32201 7.58268 6.99984 7.58268C6.67766 7.58268 6.4165 7.32152 6.4165 6.99935C6.4165 6.67717 6.67766 6.41602 6.99984 6.41602C7.32201 6.41602 7.58317 6.67717 7.58317 6.99935Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" /></svg>
          </span>
          <span className="gv-chrome-label">定位当前节点</span>
        </button>
        {onFitLayout && (
          <button type="button" onClick={onFitLayout} title="dagre 自动重排节点位置并框选" aria-label="重排节点位置">
            <span className="gv-chrome-ico" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.2085 6.41732V3.20898H6.41683M10.7918 7.58398V10.7923H7.5835M5.25016 5.25065L3.70033 3.70082M10.3 10.3005L8.75016 8.75065M7.87516 6.12565L6.12516 7.87437" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" /></svg>
            </span>
            <span className="gv-chrome-label">重排节点位置</span>
          </button>
        )}
      </div>
      {pendingDelete && typeof document !== 'undefined'
        ? createPortal(
          <div className="gv-pop-confirm-backdrop" onClick={cancelPendingDelete}>
            <div className="gv-pop-confirm" role="dialog" aria-label="确认删除" onClick={(e) => e.stopPropagation()}>
              <div className="gv-pop-confirm-msg">
                {pendingDelete.type === 'single'
                  ? `确定删除「${pendingDelete.name}」及其相关连线？`
                  : `确定删除选中的 ${pendingDelete.count} 个节点及其相关连线？`}
              </div>
              <div className="gv-pop-confirm-actions">
                <button type="button" onClick={cancelPendingDelete}>取消</button>
                <button type="button" className="is-danger" onClick={execPendingDelete}>确认删除</button>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
