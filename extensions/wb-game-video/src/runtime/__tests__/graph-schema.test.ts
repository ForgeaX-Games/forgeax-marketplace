import { describe, expect, it } from 'vitest'
import { getSubFlow, isGameGraph, type GameGraph, type GameNode } from '../schema/graph-schema'

const minimal: GameGraph = {
  nodes: [
    {
      id: 'n1',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '开场' },
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

  it('rejects node without perf type', () => {
    expect(
      isGameGraph({
        nodes: [{ id: 'x', type: 'other', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a' } }],
        edges: [],
      }),
    ).toBe(false)
  })

  it('getSubFlow reads subFlow and legacy subFlowRef', () => {
    expect(getSubFlow({ name: 'a', subFlow: 'wait' } as GameNode['data'])).toBe('wait')
    expect(getSubFlow({ name: 'a', subFlowRef: 'tele' } as GameNode['data'])).toBe('tele')
    expect(getSubFlow({ name: 'a', subFlow: 'wait', subFlowRef: 'tele' } as GameNode['data'])).toBe('wait')
    expect(getSubFlow({ name: 'a' } as GameNode['data'])).toBeUndefined()
  })
})
