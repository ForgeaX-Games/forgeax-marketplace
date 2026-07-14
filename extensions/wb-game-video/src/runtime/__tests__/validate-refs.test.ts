import { beforeAll, describe, expect, it } from 'vitest'
import { validateGraph } from '../validate/validate'
import { registerCoreKinds } from '../registry/core-kinds'
import type { GameGraph } from '../schema/graph-schema'

beforeAll(() => registerCoreKinds())

const opts = { entities: ['ent-player', 'ent-boss'], vars: ['qi'] }

function baseNode(id: string, timeline: GameGraph['nodes'][number]['data']['timeline'] = []) {
  return { id, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: id, timeline } }
}

describe('validateGraph reference checks', () => {
  it('flags unknown entity in effect and unknown var in expr', () => {
    const graph: GameGraph = {
      nodes: [
        baseNode('a', [
          {
            id: 's',
            role: 'logic',
            kind: 'settle',
            trigger: { when: 'enter' },
            params: {
              effects: [
                { id: 'd', kind: 'attr', entityId: 'ent-ghost', attr: 'hp', op: 'add', value: { expr: 'var.missingVar + 1' } },
              ],
            },
          },
        ]),
      ],
      edges: [],
    }
    const issues = validateGraph(graph, opts)
    expect(issues.some((i) => i.code === 'ref.entity.missing' && i.msg.includes('ent-ghost'))).toBe(true)
    expect(issues.some((i) => i.code === 'ref.var.missing' && i.msg.includes('missingVar'))).toBe(true)
  })

  it('flags unknown entity in condition and unknown rule goto', () => {
    const graph: GameGraph = {
      nodes: [baseNode('a'), baseNode('b')],
      edges: [
        { id: 'e', source: 'a', target: 'b', sourceHandle: 'cond:0', data: { condition: { all: [{ type: 'attrRatio', entityId: 'ent-nope', attr: 'hp', op: 'lte', value: 0 }] } } },
        { id: 'e2', source: 'a', target: 'b', sourceHandle: 'else' },
      ],
    }
    const issues = validateGraph(graph, {
      ...opts,
      rules: [{ when: { all: [] }, goto: 'ghost-node' }],
    })
    expect(issues.some((i) => i.code === 'ref.entity.missing' && i.msg.includes('ent-nope'))).toBe(true)
    expect(issues.some((i) => i.code === 'ref.node.missing' && i.msg.includes('ghost-node'))).toBe(true)
  })

  it('clean graph with declared refs yields no ref errors', () => {
    const graph: GameGraph = {
      nodes: [
        baseNode('a', [
          { id: 's', role: 'logic', kind: 'settle', trigger: { when: 'enter' }, params: { effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: { expr: '-(entity.ent-player.attr.attack) + var.qi' } }] } },
        ]),
        baseNode('b'),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    const issues = validateGraph(graph, opts).filter((i) => i.code.startsWith('ref.'))
    expect(issues).toEqual([])
  })

  it('warns on a pure-instant cycle', () => {
    const graph: GameGraph = {
      nodes: [baseNode('a'), baseNode('b')],
      edges: [
        { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out' },
        { id: 'e2', source: 'b', target: 'a', sourceHandle: 'out' },
      ],
    }
    const issues = validateGraph(graph)
    expect(issues.some((i) => i.code === 'cycle.instant')).toBe(true)
  })
})
