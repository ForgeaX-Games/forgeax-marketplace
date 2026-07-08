/**
 * 图编辑操作（P3 数据层）—— 画布手势最终落到这些**纯函数**上（不可变返回新 graph），
 * 由编辑器的 onConnect/onEdgesDelete/onNodesDelete/onReconnect 调用，写回 GameGraph（SSOT）。
 *
 * handle 派生、语义在 handle：连边即写 { source, sourceHandle, target }，edge.data 承载条件/副作用/权重。
 */
import type { EdgeRouting, GameEdge, GameGraph, GameNode, TimelineElement } from './graph-schema'

let _seq = 0
function newId(prefix: string): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq}`
}

/** 生成一个新的时间线元素 id（供编辑器新建元素用）。 */
export function newElementId(): string {
  return newId('el')
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

// ── 时间线元素编辑（node.data.timeline[]）─────────────────────────────────────
function mapNodeTimeline(
  graph: GameGraph,
  nodeId: string,
  fn: (timeline: TimelineElement[]) => TimelineElement[],
): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, timeline: fn(n.data.timeline) } } : n)),
  }
}

export function addTimelineElement(graph: GameGraph, nodeId: string, el: TimelineElement): GameGraph {
  return mapNodeTimeline(graph, nodeId, (tl) => [...tl, el])
}

export function removeTimelineElement(graph: GameGraph, nodeId: string, elId: string): GameGraph {
  return mapNodeTimeline(graph, nodeId, (tl) => tl.filter((e) => e.id !== elId))
}

export function patchTimelineElement(
  graph: GameGraph,
  nodeId: string,
  elId: string,
  patch: Partial<TimelineElement>,
): GameGraph {
  return mapNodeTimeline(graph, nodeId, (tl) => tl.map((e) => (e.id === elId ? { ...e, ...patch } : e)))
}

/** 移动时间线元素次序（from → to，越界裁剪）。 */
export function reorderTimeline(graph: GameGraph, nodeId: string, from: number, to: number): GameGraph {
  return mapNodeTimeline(graph, nodeId, (tl) => {
    if (from < 0 || from >= tl.length) return tl
    const next = [...tl]
    const [moved] = next.splice(from, 1)
    if (!moved) return tl
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
    return next
  })
}

// ── 分支即边（choice 选项 / qte pass·fail / auto → 出边）──────────────────────
/**
 * 按 (source, sourceHandle) 唯一性 upsert 一条出边：已存在则改 target/data，否则新建。
 * 语义等价 legacy 的「一个分支 handle 只连一个目标」。
 */
export function upsertBranchEdge(graph: GameGraph, spec: ConnectSpec): GameGraph {
  const existing = graph.edges.find(
    (e) => e.source === spec.source && e.sourceHandle === spec.sourceHandle,
  )
  if (existing) {
    let g = reconnect(graph, existing.id, { target: spec.target })
    if (spec.data) g = updateEdgeData(g, existing.id, spec.data)
    return g
  }
  return connect(graph, spec)
}

/**
 * 拆掉一段交互（对齐 legacy `qteTeardownPatch` / 选项删除自动续连语义）：
 *  1. 从节点 timeline 移除该 kind 的元素；
 *  2. 删掉该交互占用的全部出边（sourceHandle 命中 handlePrefixes）；
 *  3. 挑一个「续连目标」（优先 continueHandle 对应边，否则任一交互出边的 target），
 *     若尚无 'out' 边指向它，则自动补一条 out 续连边——节点回退为线性叙事。
 */
export function teardownInteraction(
  graph: GameGraph,
  nodeId: string,
  opts: { kind: string; handlePrefixes: string[]; continueHandle?: string },
): GameGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return graph
  const isHandle = (h: string | undefined): boolean =>
    !!h && opts.handlePrefixes.some((p) => h === p || h.startsWith(p))
  const outEdges = graph.edges.filter((e) => e.source === nodeId)
  const contEdge =
    (opts.continueHandle ? outEdges.find((e) => e.sourceHandle === opts.continueHandle) : undefined) ??
    outEdges.find((e) => isHandle(e.sourceHandle))
  const continueTarget = contEdge?.target

  let g: GameGraph = mapNodeTimeline(graph, nodeId, (tl) => tl.filter((el) => el.kind !== opts.kind))
  g = { ...g, edges: g.edges.filter((e) => !(e.source === nodeId && isHandle(e.sourceHandle))) }

  if (
    continueTarget &&
    !g.edges.some((e) => e.source === nodeId && (e.sourceHandle ?? 'out') === 'out' && e.target === continueTarget)
  ) {
    g = connect(g, { source: nodeId, sourceHandle: 'out', target: continueTarget })
  }
  return g
}
