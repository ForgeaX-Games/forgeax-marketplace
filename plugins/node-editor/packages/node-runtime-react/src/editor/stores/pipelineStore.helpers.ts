// Pure helpers for the pipeline store — kept out of the store body so the
// store file reads as state + actions only.

import type { Battery, Pipeline, PipelineEdge } from '../types.js'

type DynamicPort = { name: string; type: string; label: string; access?: string }

/** Distinct output ports the editor hydrates for probes / tooltips. */
export function collectVisibleOutputPorts(
  pipeline: Pipeline,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
  scope: 'edges' | 'all',
): Array<{ nodeId: string; port: string }> {
  const seen = new Set<string>()
  const ports: Array<{ nodeId: string; port: string }> = []
  const addPort = (nodeId: string, port: string) => {
    const key = `${nodeId}\u0000${port}`
    if (seen.has(key)) return
    seen.add(key)
    ports.push({ nodeId, port })
  }
  for (const edge of pipeline.edges) {
    addPort(edge.source.nodeId, edge.source.port)
  }
  if (scope !== 'all') return ports

  const groupsById = new Map((pipeline.groups ?? []).map((g) => [g.id, g] as const))
  for (const node of pipeline.nodes) {
    if (node.batteryId === '__group__') {
      const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
      const group = groupsById.get(groupId)
      if (group) {
        for (const ep of group.exposedOutputs) {
          if (!ep.hidden) addPort(node.id, ep.portName)
        }
      }
    } else {
      const battery = batteries.find((b) => b.id === node.batteryId)
      if (battery && !battery.hideOutputs) {
        for (const port of battery.outputs) {
          if (!port.hidden) addPort(node.id, port.name)
        }
      }
    }
    for (const port of dynamicOutputPorts[node.id] ?? []) {
      addPort(node.id, port.name)
    }
  }
  return ports
}

/** Visible output ports with no hydrated value in the editor cache. */
export function listMissingVisibleOutputPorts(
  pipeline: Pipeline,
  batteries: readonly Battery[],
  dynamicOutputPorts: Readonly<Record<string, readonly DynamicPort[]>>,
  nodeOutputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Array<{ nodeId: string; port: string }> {
  return collectVisibleOutputPorts(pipeline, batteries, dynamicOutputPorts, 'all').filter(
    ({ nodeId, port }) => nodeOutputs[nodeId]?.[port] === undefined,
  )
}

/**
 * BFS the set of downstream node ids reachable from startId (inclusive).
 * Used to scope incremental execution to the affected sub-graph.
 */
export function getDownstreamIds(startId: string, edges: PipelineEdge[]): string[] {
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source.nodeId === current && !visited.has(edge.target.nodeId)) {
        visited.add(edge.target.nodeId)
        queue.push(edge.target.nodeId)
      }
    }
  }
  return Array.from(visited)
}

/** A fresh, empty working pipeline created when the first node is added. */
export function createEmptyPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: `pipeline-${Date.now()}`,
    name: 'untitled-pipeline',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}
