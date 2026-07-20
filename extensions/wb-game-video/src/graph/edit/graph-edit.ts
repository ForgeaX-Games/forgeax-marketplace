/**
 * 图编辑操作 —— 画布手势落到这些纯函数（不可变返回新 graph）。
 * Overlay 目录在 scenario.ui.overlays；节点挂 overlayNodes[]。
 *
 * 连/删边会同步 event reactions 里的 `advance.edgeId`（显式走向）；
 * 未写 advance 时运行时仍可「有边则默认推进」。
 */
import type { EdgeRouting, GameEdge, GameGraph, GameNode, NodeData, OverlayNode, SubFlowPack, SubFlowPackDef } from '../../runtime/schema/graph-schema'
import type { NodeAction, Reaction } from '../../runtime/schema/node-config-schema'

let _seq = 0
function newId(prefix: string): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq}`
}

/** 生成新的 overlay child id（供编辑器新建用）。 */
export function newElementId(): string {
  return newId('el')
}

/** 空子蓝图包：单入口叶子（无出边时运行时自动弹回主图容器）。 */
export function makeEmptySubFlowPack(opts: { id?: string; title?: string; version?: string } = {}): SubFlowPackDef {
  const id = opts.id ?? newId('pack')
  const entry = 'entry'
  return {
    schemaVersion: 'wb-game-video.pack.v1',
    id,
    version: opts.version ?? '1',
    title: opts.title ?? '子蓝图',
    entry,
    graph: {
      nodes: [
        {
          id: entry,
          type: 'perf',
          position: { x: 80, y: 80 },
          inputs: [],
          outputs: [],
          data: { name: '入口', durationMs: 100 },
        },
      ],
      edges: [],
    },
  }
}

/** 主图上的子蓝图容器节点（引用 pack，自身不播演出）。 */
export function makeSubFlowPackContainer(
  pack: SubFlowPackDef,
  opts: { id?: string; name?: string; position?: { x: number; y: number } } = {},
): GameNode {
  return {
    id: opts.id ?? newId('n'),
    type: 'perf',
    position: opts.position ?? { x: 40 + Math.random() * 80, y: 40 + Math.random() * 80 },
    inputs: [],
    outputs: [],
    data: {
      name: opts.name ?? pack.title ?? pack.id,
      subFlowPack: { id: pack.id, version: pack.version },
    },
  }
}

export function addNode(graph: GameGraph, node: GameNode): GameGraph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

/**
 * 在指定节点后方插入新演出节点并自动接线。
 */
export function insertNodeAfter(
  graph: GameGraph,
  afterId: string,
  opts: { name?: string; gapX?: number; node?: GameNode } = {},
): { graph: GameGraph; nodeId: string } {
  const after = graph.nodes.find((n) => n.id === afterId)
  if (!after) return { graph, nodeId: afterId }
  const gapX = opts.gapX ?? 220
  const node: GameNode = opts.node ?? {
    id: newId('n'),
    type: 'perf',
    position: { x: after.position.x + gapX, y: after.position.y },
    inputs: [],
    outputs: [],
    data: { name: opts.name ?? '新演出节点' },
  }
  const id = node.id
  let g = addNode(graph, node)
  const outEdges = g.edges.filter((e) => e.source === afterId && (e.sourceHandle ?? 'default') === 'default')
  if (outEdges.length === 0) {
    g = connect(g, { source: afterId, sourceHandle: 'default', target: id })
  } else {
    for (const e of outEdges) {
      g = disconnect(g, e.id)
      g = connect(g, { source: id, sourceHandle: 'default', target: e.target, data: e.data })
    }
    g = connect(g, { source: afterId, sourceHandle: 'default', target: id })
  }
  return { graph: g, nodeId: id }
}

/** 在指定节点后方插入子蓝图容器并自动接线。 */
export function insertSubFlowPackAfter(
  graph: GameGraph,
  afterId: string,
  opts: { title?: string; gapX?: number } = {},
): { graph: GameGraph; nodeId: string; pack: SubFlowPackDef } {
  const after = graph.nodes.find((n) => n.id === afterId)
  if (!after) {
    const pack = makeEmptySubFlowPack({ title: opts.title })
    return { graph, nodeId: afterId, pack }
  }
  const pack = makeEmptySubFlowPack({ title: opts.title ?? '子蓝图' })
  const gapX = opts.gapX ?? 220
  const container = makeSubFlowPackContainer(pack, {
    name: pack.title,
    position: { x: after.position.x + gapX, y: after.position.y },
  })
  const { graph: next, nodeId } = insertNodeAfter(graph, afterId, { node: container, gapX })
  return { graph: next, nodeId, pack }
}

export function removeNode(graph: GameGraph, id: string): GameGraph {
  const removed = graph.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
  let g = graph
  for (const edgeId of removed) g = unbindAdvanceFromEdge(g, edgeId)
  return {
    nodes: g.nodes.filter((n) => n.id !== id),
    edges: g.edges.filter((e) => e.source !== id && e.target !== id),
  }
}

/** 深拷贝节点 data（overlayNodes 引用同一 overlay 目录项；child id 在目录侧）。 */
function cloneNodePayload(src: GameNode, nodeId: string, offset: { x: number; y: number }): GameNode {
  const data = structuredClone(src.data)
  const name = data.name?.trim() ?? ''
  if (name && !name.endsWith(' 副本')) data.name = `${name} 副本`
  return {
    ...src,
    id: nodeId,
    position: { x: src.position.x + offset.x, y: src.position.y + offset.y },
    data,
  }
}

/**
 * 复制一组节点（及它们之间的内部边）。
 */
export function duplicateNodes(
  graph: GameGraph,
  sourceIds: readonly string[],
  opts: { offset?: { x: number; y: number } } = {},
): { graph: GameGraph; nodeIds: string[] } {
  const idSet = new Set(sourceIds)
  const sources = graph.nodes.filter((n) => idSet.has(n.id))
  if (sources.length === 0) return { graph, nodeIds: [] }
  const offset = opts.offset ?? { x: 48, y: 48 }
  const idMap = new Map<string, string>()
  const created: GameNode[] = []
  for (const src of sources) {
    const nid = newId('n')
    idMap.set(src.id, nid)
    created.push(cloneNodePayload(src, nid, offset))
  }
  const newEdges: GameEdge[] = []
  for (const e of graph.edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue
    const ns = idMap.get(e.source)!
    const nt = idMap.get(e.target)!
    newEdges.push({
      ...structuredClone(e),
      id: newId('edge'),
      source: ns,
      target: nt,
    })
  }
  return {
    graph: {
      nodes: [...graph.nodes, ...created],
      edges: [...graph.edges, ...newEdges],
    },
    nodeIds: created.map((n) => n.id),
  }
}

export function setNodePosition(graph: GameGraph, id: string, position: { x: number; y: number }): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
  }
}

/** 节点 data 补丁：`undefined` 表示删除该键（用于清掉 subFlow*）。 */
export type NodeDataPatch = Partial<NodeData> & {
  subFlow?: string | undefined
  subFlowPack?: SubFlowPack | undefined
}

/** 把遗留 `subFlowRef` 归一成 `subFlow`（旧草稿/落盘兼容）。 */
export function normalizeSubFlowFields(graph: GameGraph): GameGraph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    const d = n.data as NodeData & { subFlow?: string; subFlowRef?: string }
    if (typeof d.subFlowRef !== 'string' || !d.subFlowRef) return n
    changed = true
    const { subFlowRef, ...rest } = d
    return { ...n, data: { ...rest, subFlow: d.subFlow ?? subFlowRef } as GameNode['data'] }
  })
  return changed ? { ...graph, nodes } : graph
}

export function patchNodeData(graph: GameGraph, nodeId: string, patch: NodeDataPatch): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n
      const next: Record<string, unknown> = { ...n.data }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k]
        else next[k] = v
      }
      // 写 subFlow 时清掉遗留 subFlowRef，避免双字段分叉。
      if ('subFlow' in patch) delete next.subFlowRef
      return { ...n, data: next as unknown as GameNode['data'] }
    }),
  }
}

/** @deprecated 使用 patchNodeData */
export const updateNodeData = patchNodeData

export function setOverlayNodes(graph: GameGraph, nodeId: string, overlayNodes: OverlayNode[] | undefined): GameGraph {
  return patchNodeData(graph, nodeId, { overlayNodes })
}

/** @deprecated 用 setOverlayNodes；保留为「设为单挂载」。 */
export function setOverlayNode(graph: GameGraph, nodeId: string, overlayNode: OverlayNode | undefined): GameGraph {
  return setOverlayNodes(graph, nodeId, overlayNode ? [overlayNode] : undefined)
}

export interface ConnectSpec {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: EdgeRouting
  id?: string
}

// ── advance.edgeId ↔ 边 同步 ──────────────────────────────────────────────────

/** 映射节点上全部 reactions（node.data + 各挂载）；`null` = 删除该条。 */
function mapNodeReactions(node: GameNode, map: (r: Reaction) => Reaction | null): GameNode {
  const mapList = (list: Reaction[] | undefined): Reaction[] | undefined => {
    if (!list?.length) return list
    const next: Reaction[] = []
    for (const r of list) {
      const m = map(r)
      if (m) next.push(m)
    }
    return next.length ? next : undefined
  }
  const dataReactions = mapList(node.data.reactions)
  const dataChanged = dataReactions !== node.data.reactions
  let mountsChanged = false
  const overlayNodes = node.data.overlayNodes?.map((m) => {
    const reactions = mapList(m.reactions)
    if (reactions === m.reactions) return m
    mountsChanged = true
    return { ...m, reactions }
  })
  if (!dataChanged && !mountsChanged) return node
  return {
    ...node,
    data: {
      ...node.data,
      ...(dataChanged ? { reactions: dataReactions } : {}),
      ...(mountsChanged ? { overlayNodes } : {}),
    },
  }
}

/** 源节点上 `sourceHandle === handle` 的出边数（含刚连上的边）。 */
function countHandleEdges(graph: GameGraph, source: string, handle: string): number {
  return graph.edges.filter((e) => e.source === source && (e.sourceHandle ?? 'default') === handle).length
}

/**
 * 在源节点写入一条 `when.event.id === handle` 的 advance reaction。
 * 挂载选择：已有同名 event reaction 的挂载 > 已有任意 event reaction 的挂载 > 首个挂载；
 * 无挂载则挂 `node.data.reactions`（避免写到 HUD 这类无交互事件的挂载上）。
 */
function ensureEventAdvanceReaction(node: GameNode, handle: string, edgeId: string): GameNode {
  const action: NodeAction = { kind: 'advance', edgeId }
  const reaction: Reaction = { when: { type: 'event', id: handle }, do: [action] }
  const mounts = node.data.overlayNodes
  if (mounts?.length) {
    let best = 0
    let bestScore = -1
    for (let i = 0; i < mounts.length; i++) {
      const rs = mounts[i]!.reactions ?? []
      const same = rs.some((r) => r.when.type === 'event' && r.when.id === handle)
      const anyEv = rs.some((r) => r.when.type === 'event')
      const score = (same ? 2 : 0) + (anyEv ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    const overlayNodes = mounts.map((m, i) =>
      i === best ? { ...m, reactions: [...(m.reactions ?? []), reaction] } : m,
    )
    return { ...node, data: { ...node.data, overlayNodes } }
  }
  return {
    ...node,
    data: { ...node.data, reactions: [...(node.data.reactions ?? []), reaction] },
  }
}

/**
 * 连边后同步显式走向（让作者在 reactions 里能看见「去哪」）：
 * - 非 `default` 且该 handle **仅一条边**：回填/补上 `{ kind:'advance', edgeId }`；
 *   若尚无同名 event reaction，则自动建一条只含 advance 的 reaction。
 * - 同 handle **多条边**（权重/条件池）：去掉独占 `advance`，运行时走边池。
 * - `default` 口不注入（播完走 selectAutoEdge）。
 */
export function bindAdvanceToEdge(graph: GameGraph, edge: GameEdge): GameGraph {
  const handle = edge.sourceHandle ?? 'default'
  if (handle === 'default') return graph
  const multi = countHandleEdges(graph, edge.source, handle) > 1
  let changed = false
  const nodes = graph.nodes.map((n) => {
    if (n.id !== edge.source) return n
    let foundMatch = false
    let next = mapNodeReactions(n, (r) => {
      if (r.when.type !== 'event' || r.when.id !== handle) return r
      foundMatch = true
      if (multi) {
        // 多边同 handle：独占 advance 会锁死边池，去掉后靠默认推进选边。
        const filtered = r.do.filter((a) => a.kind !== 'advance')
        if (filtered.length === r.do.length) return r
        changed = true
        return filtered.length ? { ...r, do: filtered } : null
      }
      const existing = r.do.find((a): a is Extract<NodeAction, { kind: 'advance' }> => a.kind === 'advance')
      if (!existing) {
        changed = true
        return { ...r, do: [...r.do, { kind: 'advance', edgeId: edge.id }] }
      }
      if (existing.edgeId === edge.id) return r
      // 原 edgeId 已失效 → 改挂到新边；仍有效则不覆盖（作者手选）
      const prevAlive = graph.edges.some((e) => e.id === existing.edgeId)
      if (prevAlive) return r
      changed = true
      return {
        ...r,
        do: r.do.map((a) => (a.kind === 'advance' ? { kind: 'advance' as const, edgeId: edge.id } : a)),
      }
    })
    if (!foundMatch && !multi) {
      changed = true
      next = ensureEventAdvanceReaction(next, handle, edge.id)
    }
    return next
  })
  return changed ? { ...graph, nodes } : graph
}

/** 删边后：清除全图 reactions 中指向该 edgeId 的 advance；若 event reaction 的 do 因此变空则删掉该 reaction。 */
export function unbindAdvanceFromEdge(graph: GameGraph, edgeId: string): GameGraph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    const next = mapNodeReactions(n, (r) => {
      const filtered = r.do.filter((a) => !(a.kind === 'advance' && a.edgeId === edgeId))
      if (filtered.length === r.do.length) return r
      changed = true
      if (filtered.length === 0 && r.when.type === 'event') return null
      return { ...r, do: filtered }
    })
    return next
  })
  return changed ? { ...graph, nodes } : graph
}

export function connect(graph: GameGraph, spec: ConnectSpec): GameGraph {
  // 自环拒绝（回环请画多节点环）；同 source+handle+target 去重。
  if (spec.source === spec.target) return graph
  const sourceHandle = spec.sourceHandle ?? 'default'
  const targetHandle = spec.targetHandle ?? 'in'
  if (
    graph.edges.some(
      (e) =>
        e.source === spec.source &&
        e.target === spec.target &&
        (e.sourceHandle ?? 'default') === sourceHandle &&
        (e.targetHandle ?? 'in') === targetHandle,
    )
  ) {
    return graph
  }
  const edge: GameEdge = {
    id: spec.id ?? newId('edge'),
    source: spec.source,
    target: spec.target,
    sourceHandle,
    targetHandle,
    data: spec.data,
  }
  return bindAdvanceToEdge({ ...graph, edges: [...graph.edges, edge] }, edge)
}

export function disconnect(graph: GameGraph, edgeId: string): GameGraph {
  const next = { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) }
  return unbindAdvanceFromEdge(next, edgeId)
}

export function reconnect(
  graph: GameGraph,
  edgeId: string,
  patch: { source?: string; target?: string; sourceHandle?: string; targetHandle?: string },
): GameGraph {
  const before = graph.edges.find((e) => e.id === edgeId)
  const next: GameGraph = {
    ...graph,
    edges: graph.edges.map((e) =>
      e.id === edgeId
        ? {
            ...e,
            source: patch.source ?? e.source,
            target: patch.target ?? e.target,
            sourceHandle: patch.sourceHandle ?? e.sourceHandle,
            targetHandle: patch.targetHandle ?? e.targetHandle,
          }
        : e,
    ),
  }
  const after = next.edges.find((e) => e.id === edgeId)
  if (!before || !after) return next
  const handleChanged =
    (patch.sourceHandle !== undefined && (patch.sourceHandle ?? 'default') !== (before.sourceHandle ?? 'default')) ||
    (patch.source !== undefined && patch.source !== before.source)
  if (!handleChanged) return next
  // handle/源变了：先清旧绑定，再按新 handle 回填
  return bindAdvanceToEdge(unbindAdvanceFromEdge(next, edgeId), after)
}

export function updateEdgeData(graph: GameGraph, edgeId: string, data: EdgeRouting): GameGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e)),
  }
}

/**
 * 按 (source, sourceHandle) upsert 出边。
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
 * 拆掉一段交互出边（不再改 overlay children —— 目录侧另编）：
 * 删交互 handle 出边，必要时补 out 续连。
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

  let g: GameGraph = {
    ...graph,
    edges: graph.edges.filter((e) => !(e.source === nodeId && isHandle(e.sourceHandle))),
  }

  if (
    continueTarget &&
    !g.edges.some((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === 'default' && e.target === continueTarget)
  ) {
    g = connect(g, { source: nodeId, sourceHandle: 'default', target: continueTarget })
  }
  return g
}
