import { describe, expect, it } from 'vitest'
import { validateGraph } from '../validate'
import type { GameGraph, GameNode } from '../graph-schema'

const perf = (id: string, kinds: string[] = []): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: {
    name: id,
    timeline: kinds.map((k, i) => ({
      id: `${id}-e${i}`,
      role: 'logic' as const,
      kind: k,
      trigger: { when: 'enter' as const },
      params: {},
    })),
  },
})

describe('validateGraph', () => {
  it('valid graph → no issues', () => {
    const g: GameGraph = {
      nodes: [perf('a'), perf('b')],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    expect(validateGraph(g)).toEqual([])
  })

  it('dangling edge target → error', () => {
    const g: GameGraph = {
      nodes: [perf('a')],
      edges: [{ id: 'e1', source: 'a', target: 'ghost' }],
    }
    const issues = validateGraph(g)
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(1)
    expect(issues[0]!.code).toBe('edge.target.missing')
  })

  it('unregistered kind → error', () => {
    const g: GameGraph = { nodes: [perf('a', ['nopeKind'])], edges: [] }
    const errs = validateGraph(g).filter((i) => i.level === 'error')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.code).toBe('kind.unknown')
  })

  it('unreachable node → warn', () => {
    const g: GameGraph = {
      nodes: [perf('a'), perf('b'), perf('c')],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    const warns = validateGraph(g).filter((i) => i.level === 'warn' && i.code === 'node.unreachable')
    expect(warns).toHaveLength(1)
    expect(warns[0]!.at).toBe('c')
  })

  it('sourceHandle not in derived outputs → error', () => {
    const g: GameGraph = {
      nodes: [perf('a'), perf('b')],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'pass' }],
    }
    const errs = validateGraph(g).filter((i) => i.code === 'edge.handle.missing')
    expect(errs).toHaveLength(1)
  })
})
