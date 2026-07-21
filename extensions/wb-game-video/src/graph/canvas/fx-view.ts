/**
 * 渲染派生层：GameGraph（域 SSOT） → react-flow(FX) 渲染视图。
 *
 * spec §2.1.1：SSOT 与渲染视图**分离但同源**。此处只读地把域图投影成 reactflow 能画的形状：
 *  - inputs = 画布约定的单一入口 'in'（与边上 targetHandle 对齐）；outputs = deriveOutputs ∪ 该节点出边用到的路由 handle。
 *  - position 来自 node.position（域里存了布局）。
 *  - data 只放渲染需要的少量字段（标题/角标）；不把整块 node.data 塞进去。
 * 不回写域图。
 */
import type { FXEdge, FXGraph, FXNode, Handle } from '../../runtime/schema/react-flow-schema'
import type { GameGraph, GameNode } from '../../runtime/schema/graph-schema'
import type { Overlay } from '../../runtime/schema/node-config-schema'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'
import { deriveOutputs } from '../../runtime/registry/component-registry'
import { flowHandleDisplay, mergeFlowHandles } from '../flow-handle-labels'

function nodeOutputHandles(
  graph: GameGraph,
  node: GameNode,
  overlays?: Record<string, Overlay>,
): Array<{ value: string; label: string }> {
  const extra = graph.edges
    .filter((e) => e.source === node.id && e.sourceHandle)
    .map((e) => e.sourceHandle!)
  return mergeFlowHandles(deriveOutputs(node, overlays), extra)
}

function toHandle(id: string, label: string, type: 'source' | 'target'): Handle<{ flowId: string; displayLabel: string }> {
  return {
    id: `${type}:${id}`,
    type,
    position: type === 'source' ? 'right' : 'left',
    label,
    data: { flowId: id, displayLabel: label },
  }
}

/** 当所有节点坐标都在原点（未布局，如 AI 生成/新建）时，按拓扑分层自动布局。 */
function autoLayout(graph: GameGraph): Record<string, { x: number; y: number }> {
  const COL_W = 240
  const ROW_H = 96
  const targets = new Set(graph.edges.map((e) => e.target))
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target)
  const depth = new Map<string, number>()
  const roots = graph.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
  const queue = roots.length > 0 ? [...roots] : graph.nodes.slice(0, 1).map((n) => n.id)
  for (const r of queue) depth.set(r, 0)
  while (queue.length) {
    const id = queue.shift()!
    const d = depth.get(id) ?? 0
    for (const nx of adj.get(id) ?? []) {
      if (depth.has(nx)) continue
      depth.set(nx, d + 1)
      queue.push(nx)
    }
  }
  const rowCursor = new Map<number, number>()
  const out: Record<string, { x: number; y: number }> = {}
  for (const n of graph.nodes) {
    const col = depth.get(n.id) ?? 0
    const row = rowCursor.get(col) ?? 0
    rowCursor.set(col, row + 1)
    out[n.id] = { x: col * COL_W, y: row * ROW_H }
  }
  return out
}

export function toFXView(graph: GameGraph, overlays?: Record<string, Overlay>): FXGraph {
  const degenerate = graph.nodes.length > 1 && graph.nodes.every((n) => n.position.x === 0 && n.position.y === 0)
  const layout = degenerate ? autoLayout(graph) : undefined
  return {
    nodes: graph.nodes.map((node): FXNode => ({
      id: node.id,
      type: 'default',
      position: layout?.[node.id] ?? node.position,
      inputs: [toHandle('in', '入口', 'target')],
      outputs: nodeOutputHandles(graph, node, overlays).map((h) => toHandle(h.value, h.label, 'source')),
      data: {
        label: node.data.name,
        badge: badgeOf(node),
      },
    })),
    edges: graph.edges.map((e): FXEdge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: `source:${e.sourceHandle ?? 'default'}`,
      targetHandle: 'target:in',
      label: e.data?.label ?? flowHandleDisplay(e.sourceHandle ?? 'default'),
    })),
  }
}

function badgeOf(node: GameNode): string {
  if (getSubFlowPack(node.data)) return 'pack'
  if (getSubFlow(node.data)) return 'subflow'
  if (node.data.overlayNodes?.length) return 'overlay'
  return ''
}
