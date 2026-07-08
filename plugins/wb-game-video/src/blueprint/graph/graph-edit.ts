/**
 * 图编辑操作（P3 数据层）—— 画布手势最终落到这些**纯函数**上（不可变返回新 graph），
 * 由编辑器的 onConnect/onEdgesDelete/onNodesDelete/onReconnect 调用，写回 GameGraph（SSOT）。
 *
 * handle 派生、语义在 handle：连边即写 { source, sourceHandle, target }，edge.data 承载条件/副作用/权重。
 */
import type { EdgeRouting, GameEdge, GameGraph, GameNode } from './graph-schema'

let _seq = 0
function newId(prefix: string): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq}`
}

export function addNode(graph: GameGraph, node: GameNode): GameGraph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

export function removeNode(graph: GameGraph, id: string): GameGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
  }
}

export function setNodePosition(graph: GameGraph, id: string, pos: { x: number; y: number }): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
  }
}

/** 局部更新某节点的 data（配置面板用；浅合并）。 */
export function updateNodeData(
  graph: GameGraph,
  id: string,
  patch: Partial<GameNode['data']>,
): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
  }
}

export interface ConnectSpec {
  source: string
  sourceHandle: string
  target: string
  data?: EdgeRouting
  id?: string
}

/** 连边：拒绝自环、拒绝完全重复（同 source+handle+target）。 */
export function connect(graph: GameGraph, spec: ConnectSpec): GameGraph {
  if (spec.source === spec.target) return graph
  const dup = graph.edges.some(
    (e) => e.source === spec.source && e.sourceHandle === spec.sourceHandle && e.target === spec.target,
  )
  if (dup) return graph
  const edge: GameEdge = {
    id: spec.id ?? newId('edge'),
    source: spec.source,
    target: spec.target,
    sourceHandle: spec.sourceHandle,
    data: spec.data,
  }
  return { ...graph, edges: [...graph.edges, edge] }
}

export function disconnect(graph: GameGraph, edgeId: string): GameGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) }
}

/** 重连：改一条边的 target（或 sourceHandle）。 */
export function reconnect(
  graph: GameGraph,
  edgeId: string,
  next: { target?: string; sourceHandle?: string },
): GameGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) =>
      e.id === edgeId
        ? { ...e, target: next.target ?? e.target, sourceHandle: next.sourceHandle ?? e.sourceHandle }
        : e,
    ),
  }
}

export function updateEdgeData(graph: GameGraph, edgeId: string, data: EdgeRouting): GameGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e)),
  }
}
