import { describe, expect, it } from 'vitest'
import { pipelineHashOnly, summarizePipeline } from '../src/pipeline-summary.js'

const snap = {
  id: 'p_test',
  hash: 'abc',
  createdAt: '',
  updatedAt: '',
  nodes: {
    g1: { id: 'g1', opId: 'tree_merge', name: 'merge', position: { x: 0, y: 0 }, params: { portCount: 3, huge: 'x'.repeat(500) } },
    n1: { id: 'n1', opId: 'text_panel', name: '望江客栈', position: { x: 0, y: 0 }, params: { text: '望江客栈' } },
    o1: { id: 'o1', opId: 'scene_output', name: 'out', position: { x: 0, y: 0 }, params: {} },
  },
  edges: {
    e1: { id: 'e1', source: { nodeId: 'g1', port: 'out_0' }, target: { nodeId: 'o1', port: 'in_0' } },
    e2: { id: 'e2', source: { nodeId: 'n1', port: 'out_0' }, target: { nodeId: 'g1', port: 'in_0' } },
  },
}

describe('pipeline-summary', () => {
  it('strips params and marks summarized', () => {
    const s = summarizePipeline(snap)!
    expect(s.summarized).toBe(true)
    expect(s.nodeCount).toBe(3)
    expect(JSON.stringify(s)).not.toContain('portCount')
    expect(s.nodes.find((n) => n.id === 'n1')?.name).toBe('望江客栈')
    expect(s.exportChain?.treeMerge).toBe('g1')
    expect(s.exportChain?.sceneOutput).toBe('o1')
  })

  it('scopes to groupId neighborhood', () => {
    const s = summarizePipeline(snap, { groupId: 'g1' })!
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n1', 'o1'])
    expect(s.edges).toHaveLength(2)
  })

  it('hashOnly mode is tiny', () => {
    const h = pipelineHashOnly(snap)!
    expect(h.hashOnly).toBe(true)
    expect(h.nodeCount).toBe(3)
    expect(Object.keys(h)).not.toContain('nodes')
  })
})
