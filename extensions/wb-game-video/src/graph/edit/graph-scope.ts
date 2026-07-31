import type { GameGraph } from '../../runtime/schema/graph-schema'
import { getSubProcess } from '../../runtime/schema/graph-schema'

/** Container node ids from a blueprint root graph to the graph currently being edited. */
export type GraphScopePath = readonly string[]

export function resolveGraphAtPath(root: GameGraph, path: GraphScopePath): GameGraph | undefined {
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) return undefined
    graph = process.graph
  }
  return graph
}

export function updateGraphAtPath(
  root: GameGraph,
  path: GraphScopePath,
  update: GameGraph | ((graph: GameGraph) => GameGraph),
): GameGraph {
  if (path.length === 0) return typeof update === 'function' ? update(root) : update
  const [containerId, ...rest] = path
  let changed = false
  const nodes = root.nodes.map((node) => {
    if (node.id !== containerId) return node
    const process = getSubProcess(node.data)
    if (!process) return node
    const graph = updateGraphAtPath(process.graph, rest, update)
    if (graph === process.graph) return node
    changed = true
    return { ...node, data: { ...node.data, subProcess: { ...process, graph } } }
  })
  return changed ? { ...root, nodes } : root
}

/** Keep the longest valid prefix after undo, reset, or deleting an ancestor container. */
export function validGraphPath(root: GameGraph, path: GraphScopePath): string[] {
  const valid: string[] = []
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) break
    valid.push(containerId)
    graph = process.graph
  }
  return valid
}

export function graphPathLabels(root: GameGraph, path: GraphScopePath): Array<{ id: string; name: string }> {
  const labels: Array<{ id: string; name: string }> = []
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!container || !process) break
    labels.push({ id: containerId, name: container.data.name || containerId })
    graph = process.graph
  }
  return labels
}
