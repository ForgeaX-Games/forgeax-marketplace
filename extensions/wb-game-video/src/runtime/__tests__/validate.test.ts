import { describe, expect, it } from 'vitest'
import { validateGraph } from '../validate/validate'
import type { GameGraph, GameNode, Overlay } from '../schema/graph-schema'

function perf(id: string, componentIds: string[] = []): { node: GameNode; overlays: Record<string, Overlay> } {
  const oid = `ov-${id}`
  const overlays: Record<string, Overlay> = {
    [oid]: {
      id: oid,
      children: componentIds.map((c, i) => ({
        id: `${id}-e${i}`,
        component: c,
        trigger: { when: 'enter' as const },
        inputs: {},
      })),
    },
  }
  const node: GameNode = {
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id, ...(componentIds.length ? { overlayNodes: [{ overlay: oid }] } : {}) },
  }
  return { node, overlays }
}

describe('validateGraph', () => {
  it('valid graph → no issues', () => {
    const a = perf('a')
    const b = perf('b')
    const g: GameGraph = {
      nodes: [a.node, b.node],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    expect(validateGraph(g, { overlays: { ...a.overlays, ...b.overlays } })).toEqual([])
  })

  it('dangling edge target → error', () => {
    const a = perf('a')
    const g: GameGraph = {
      nodes: [a.node],
      edges: [{ id: 'e1', source: 'a', target: 'ghost', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const issues = validateGraph(g, { overlays: a.overlays })
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(1)
    expect(issues[0]!.code).toBe('edge.target.missing')
  })
})
