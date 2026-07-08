import { describe, expect, it } from 'vitest'
import { isGameGraph, type GameGraph } from '../graph-schema'

const minimal: GameGraph = {
  nodes: [
    {
      id: 'n1',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '开场', timeline: [] },
    },
  ],
  edges: [],
}

describe('graph-schema', () => {
  it('accepts a minimal valid GameGraph', () => {
    expect(isGameGraph(minimal)).toBe(true)
  })

  it('rejects non-graph shapes', () => {
    expect(isGameGraph(null)).toBe(false)
    expect(isGameGraph({})).toBe(false)
    expect(isGameGraph({ nodes: [], edges: {} })).toBe(false)
  })

  it('rejects node without perf type or timeline array', () => {
    expect(
      isGameGraph({
        nodes: [{ id: 'x', type: 'other', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a', timeline: [] } }],
        edges: [],
      }),
    ).toBe(false)
    expect(
      isGameGraph({
        nodes: [{ id: 'x', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a' } }],
        edges: [],
      }),
    ).toBe(false)
  })
})
