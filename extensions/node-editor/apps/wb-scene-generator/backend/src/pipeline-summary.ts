/**
 * Lightweight pipeline projection for AI agents — avoids pouring full graph +
 * params into context on every `pipeline.get`.
 */
import type { GraphEdge, GraphNode, PipelineSnapshot } from '@forgeax/node-runtime'

export interface PipelineSummaryNode {
  id: string
  opId: string
  name?: string
  batteryId?: string
}

export interface PipelineSummaryEdge {
  id?: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

export interface PipelineSummary {
  id: string
  hash: string
  summarized: true
  nodeCount: number
  edgeCount: number
  nodes: PipelineSummaryNode[]
  edges: PipelineSummaryEdge[]
  /** Stable ids for M0 export chain when present. */
  exportChain?: {
    treeMerge?: string
    treeFlatten?: string
    sceneMerge?: string
    sceneOutput?: string
  }
}

function normalizeNodes(raw: PipelineSnapshot['nodes']): GraphNode[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, GraphNode>)
  return []
}

function normalizeEdges(raw: PipelineSnapshot['edges']): GraphEdge[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, GraphEdge>)
  return []
}

function detectExportChain(nodes: GraphNode[]): PipelineSummary['exportChain'] {
  const byOp = new Map<string, string>()
  for (const n of nodes) {
    if (n.opId) byOp.set(n.opId, n.id)
  }
  const chain: NonNullable<PipelineSummary['exportChain']> = {}
  if (byOp.has('tree_merge')) chain.treeMerge = byOp.get('tree_merge')
  if (byOp.has('tree_flatten')) chain.treeFlatten = byOp.get('tree_flatten')
  if (byOp.has('scene_merge_subtrees')) chain.sceneMerge = byOp.get('scene_merge_subtrees')
  if (byOp.has('scene_output')) chain.sceneOutput = byOp.get('scene_output')
  return Object.keys(chain).length > 0 ? chain : undefined
}

function nodeTouchesSet(nodeId: string, ids: ReadonlySet<string>, edges: GraphEdge[]): boolean {
  if (ids.has(nodeId)) return true
  return edges.some(
    (e) =>
      (e.source.nodeId === nodeId && ids.has(e.target.nodeId))
      || (e.target.nodeId === nodeId && ids.has(e.source.nodeId)),
  )
}

export function summarizePipeline(
  snap: PipelineSnapshot | null,
  opts?: { nodeIds?: readonly string[]; groupId?: string },
): PipelineSummary | null {
  if (!snap) return null
  const allNodes = normalizeNodes(snap.nodes)
  const allEdges = normalizeEdges(snap.edges)

  let focusIds: Set<string> | null = null
  if (opts?.groupId) {
    focusIds = new Set([opts.groupId])
    for (const e of allEdges) {
      if (e.source.nodeId === opts.groupId) focusIds.add(e.target.nodeId)
      if (e.target.nodeId === opts.groupId) focusIds.add(e.source.nodeId)
    }
  } else if (opts?.nodeIds?.length) {
    focusIds = new Set(opts.nodeIds)
    for (const id of opts.nodeIds) {
      for (const e of allEdges) {
        if (e.source.nodeId === id) focusIds.add(e.target.nodeId)
        if (e.target.nodeId === id) focusIds.add(e.source.nodeId)
      }
    }
  }

  const nodes = focusIds
    ? allNodes.filter((n) => nodeTouchesSet(n.id, focusIds!, allEdges))
    : allNodes
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const edges = focusIds
    ? allEdges.filter((e) => nodeIdSet.has(e.source.nodeId) && nodeIdSet.has(e.target.nodeId))
    : allEdges

  return {
    id: snap.id,
    hash: snap.hash,
    summarized: true,
    nodeCount: allNodes.length,
    edgeCount: allEdges.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      opId: n.opId,
      ...(n.name ? { name: n.name } : {}),
      ...((n as { batteryId?: string }).batteryId
        ? { batteryId: (n as { batteryId?: string }).batteryId }
        : {}),
    })),
    edges: edges.map((e) => ({
      ...(e.id ? { id: e.id } : {}),
      source: { nodeId: e.source.nodeId, port: e.source.port },
      target: { nodeId: e.target.nodeId, port: e.target.port },
    })),
    exportChain: detectExportChain(allNodes),
  }
}

export function pipelineHashOnly(snap: PipelineSnapshot | null): { id: string; hash: string; nodeCount: number; edgeCount: number; hashOnly: true } | null {
  if (!snap) return null
  const nodes = normalizeNodes(snap.nodes)
  const edges = normalizeEdges(snap.edges)
  return {
    id: snap.id,
    hash: snap.hash,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    hashOnly: true,
  }
}
