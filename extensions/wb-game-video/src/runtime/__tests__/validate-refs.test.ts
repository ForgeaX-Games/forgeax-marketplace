import { beforeAll, describe, expect, it } from 'vitest'
import { validateGraph } from '../validate/validate'
import { registerCoreKinds } from '../registry/core-kinds'
import type { GameGraph, Overlay } from '../schema/graph-schema'

beforeAll(() => registerCoreKinds())

const optsBase = { entities: ['ent-player', 'ent-boss'], vars: ['qi'] }

function withOverlay(
  id: string,
  children: Overlay['children'],
): { graph: GameGraph; overlays: Record<string, Overlay> } {
  const oid = `ov-${id}`
  return {
    overlays: { [oid]: { id: oid, children } },
    graph: {
      nodes: [
        {
          id,
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: id, overlayNodes: [{ overlay: oid }] },
        },
      ],
      edges: [],
    },
  }
}

describe('validateGraph reference checks', () => {
  it('flags unknown entity in effect and unknown var in expr', () => {
    const { graph, overlays } = withOverlay('a', [
      {
        id: 's',
        component: 'settle',
        trigger: { when: 'enter' },
        params: {
          effects: [
            {
              id: 'd',
              kind: 'attr',
              entityId: 'ent-ghost',
              attr: 'hp',
              op: 'add',
              value: { expr: 'var.missingVar + 1' },
            },
          ],
        },
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.entity.missing' && i.msg.includes('ent-ghost'))).toBe(true)
    expect(issues.some((i) => i.code === 'ref.var.missing' && i.msg.includes('missingVar'))).toBe(true)
  })

  it('flags unknown entity in condition and unknown rule goto', () => {
    const graph: GameGraph = {
      nodes: [
        {
          id: 'a',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: 'a' },
        },
      ],
      edges: [
        {
          id: 'e',
          source: 'a',
          target: 'a',
          sourceHandle: 'out',
          targetHandle: 'in',
          data: {
            condition: { all: [{ type: 'attrRatio', entityId: 'ent-ghost', attr: 'hp', op: 'lte', value: 0 }] },
          },
        },
      ],
    }
    const issues = validateGraph(graph, {
      ...optsBase,
      reactions: [{ when: { type: 'state', condition: { all: [] } }, do: [{ kind: 'goto', targetNodeId: 'missing-node' }] }],
    })
    expect(issues.some((i) => i.code === 'ref.entity.missing')).toBe(true)
    expect(issues.some((i) => i.code === 'ref.node.missing' && i.msg.includes('missing-node'))).toBe(true)
  })
})
