import { describe, expect, it } from 'vitest'
import type { GameGraph, GameNode } from '../../runtime/schema/graph-schema'
import { addNode, disconnect } from '../edit/graph-edit'
import { resolveGraphAtPath, updateGraphAtPath } from '../edit/graph-scope'

const node = (id: string, child?: GameGraph): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: child ? { name: id, subProcess: { entry: child.nodes[0]!.id, graph: child } } : { name: id },
})

describe('nested graph scope', () => {
  const leaf: GameGraph = {
    nodes: [node('entry'), node('after')],
    edges: [{ id: 'inner-edge', source: 'entry', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
  }
  const middle: GameGraph = { nodes: [node('turn', leaf)], edges: [] }
  const root: GameGraph = { nodes: [node('combat', middle), node('outside')], edges: [] }

  it('resolves one and two nested levels', () => {
    expect(resolveGraphAtPath(root, ['combat'])).toBe(middle)
    expect(resolveGraphAtPath(root, ['combat', 'turn'])).toBe(leaf)
    expect(resolveGraphAtPath(root, ['missing'])).toBeUndefined()
  })

  it('adds a node only to the drilled graph', () => {
    const next = updateGraphAtPath(root, ['combat', 'turn'], (graph) => addNode(graph, node('created')))
    expect(next.nodes.map((item) => item.id)).toEqual(['combat', 'outside'])
    expect(resolveGraphAtPath(next, ['combat'])?.nodes.map((item) => item.id)).toEqual(['turn'])
    expect(resolveGraphAtPath(next, ['combat', 'turn'])?.nodes.map((item) => item.id)).toEqual(['entry', 'after', 'created'])
  })

  it('deleting an edge keeps both child nodes in the subProcess', () => {
    const next = updateGraphAtPath(root, ['combat', 'turn'], (graph) => disconnect(graph, 'inner-edge'))
    const child = resolveGraphAtPath(next, ['combat', 'turn'])!
    expect(child.edges).toEqual([])
    expect(child.nodes.map((item) => item.id)).toEqual(['entry', 'after'])
  })
})
