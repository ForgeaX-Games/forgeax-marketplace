import type { GameGraph } from '../../runtime/schema/graph-schema'
import { getSubProcess } from '../../runtime/schema/graph-schema'

/** Container node ids from a blueprint root graph to the graph currently being edited. */
export type GraphScopePath = readonly string[]

/**
 * Keep an entry stable across graph edits. When the entry node was deleted, walk the
 * old graph's outgoing edges breadth-first and choose the first surviving successor.
 * Disconnected edits fall back to the first remaining node; an empty graph keeps the
 * previous id because the published contracts require `entry` to remain a string.
 */
export function resolveEntryAfterGraphChange(
  before: GameGraph,
  after: GameGraph,
  entry: string,
): string {
  const remaining = new Set(after.nodes.map((node) => node.id))
  if (remaining.has(entry) || after.nodes.length === 0) return entry

  const queued = new Set<string>([entry])
  const queue = [entry]
  while (queue.length > 0) {
    const source = queue.shift()!
    const outgoing = before.edges
      .filter((edge) => edge.source === source)
      .sort((a, b) => (
        Number((b.sourceHandle ?? 'default') === 'default')
        - Number((a.sourceHandle ?? 'default') === 'default')
      ))
    for (const edge of outgoing) {
      if (queued.has(edge.target)) continue
      if (remaining.has(edge.target)) return edge.target
      queued.add(edge.target)
      queue.push(edge.target)
    }
  }
  return after.nodes[0]!.id
}

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

/** Entry id of the graph addressed by `path` (blueprint root or nested subProcess). */
export function resolveGraphEntryAtPath(
  root: GameGraph,
  rootEntry: string | undefined,
  path: GraphScopePath,
): string | undefined {
  let graph = root
  let entry = rootEntry
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) return undefined
    graph = process.graph
    entry = process.entry
  }
  return entry && graph.nodes.some((node) => node.id === entry) ? entry : undefined
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
    const entry = rest.length === 0
      ? resolveEntryAfterGraphChange(process.graph, graph, process.entry)
      : process.entry
    return { ...node, data: { ...node.data, subProcess: { ...process, entry, graph } } }
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
