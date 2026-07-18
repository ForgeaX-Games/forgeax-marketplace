import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerKind, unregisterKind } from '../registry/kind-registry'
import type { GameGraph, GameNode, GameScenario, GraphEffect } from '../schema/graph-schema'
import { node, scnOf as scnOfGraph, rid } from './test-fixtures'

const KIND = 'multiStep'
beforeEach(() => {
  registerKind({
    kind: KIND,
    role: 'interaction',
    validate: () => [],
    outputs: () => [{ id: 'done' }],
    resolve: (ctx, _p, input) => {
      const hits = Number(ctx.state.vars.hits ?? 0)
      if (input === 'hit') {
        const next = hits + 1
        const effects: GraphEffect[] = [{ kind: 'var', varId: 'hits', op: 'set', value: next }]
        if (next < 3) return { continue: true, effects }
        return { outcome: 'done', effects }
      }
      return { outcome: 'done' }
    },
  })
})
afterEach(() => {
  unregisterKind(KIND)
  unregisterKind('lethalStep')
})

function scnOf(graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario {
  return scnOfGraph(graph, {
    variables: { hits: { id: 'hits', initial: 0 }, ...(over.variables ?? {}) },
    entities: {
      'ent-boss': {
        id: 'ent-boss',
        attrs: { hp: 10 },
        attrMeta: { hp: { min: 0, max: 10, initial: 10 } },
      },
      ...(over.entities ?? {}),
    },
    ...over,
  })
}

describe('submitInteraction continue', () => {
  it('keeps awaitInteraction across continue:true submits until outcome', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            {
              id: 'ms',
              role: 'interaction',
              kind: KIND,
              trigger: { when: 'enter' },
              params: {},
            },
          ],
        }),
        node('b', { }),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'done', targetHandle: 'in' }],
    }
    const rt = ((s => new GraphRuntime(s.graph, s))(scnOf(graph)))
    rt.start()
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction(rid('a', 'ms'), 'hit')
    expect(rt.state.phase).toBe('awaitInteraction')
    expect(rt.state.vars.hits).toBe(1)

    rt.submitInteraction(rid('a', 'ms'), 'hit')
    expect(rt.state.phase).toBe('awaitInteraction')
    expect(rt.state.vars.hits).toBe(2)

    rt.submitInteraction(rid('a', 'ms'), 'hit')
    expect(rt.state.vars.hits).toBe(3)
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.phase).toBe('ended')
  })

  it('continue effects can rules-redirect and end the session', () => {
    registerKind({
      kind: 'lethalStep',
      role: 'interaction',
      validate: () => [],
      outputs: () => [{ id: 'done' }],
      resolve: () => ({
        continue: true,
        effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'set', value: 0 }],
      }),
    })
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            {
              id: 'ms',
              role: 'interaction',
              kind: 'lethalStep',
              trigger: { when: 'enter' },
              params: {},
            },
          ],
        }),
        node('win', { }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
        reactions: [
          {
            when: { type: 'state', condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] } },
            do: [{ kind: 'goto', targetNodeId: 'win' }],
          },
        ],
      })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.submitInteraction(rid('a', 'ms'), 'x')
    expect(rt.state.currentNodeId).toBe('win')
    expect(rt.state.phase).not.toBe('awaitInteraction')
  })
})
