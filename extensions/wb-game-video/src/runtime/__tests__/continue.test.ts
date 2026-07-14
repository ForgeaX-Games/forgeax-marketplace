import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerKind, unregisterKind } from '../registry/kind-registry'
import type { GameGraph, GameNode, GameScenario, GraphEffect } from '../schema/graph-schema'

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

const node = (id: string, extra: Partial<GameNode['data']> = {}): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, timeline: [], ...extra },
})

function scn(graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario {
  return {
    schemaVersion: 't',
    variables: { hits: { id: 'hits', kind: 'number', initial: 0 } },
    entities: {
      'ent-boss': {
        attrs: { hp: 10 },
        attrMeta: { hp: { min: 0, max: 10, initial: 10 } },
      },
    },
    graph,
    ...over,
  }
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
        node('b', { end: 'victory' }),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'done' }],
    }
    const rt = new GraphRuntime(graph, scn(graph))
    rt.start()
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('ms', 'hit')
    expect(rt.state.phase).toBe('awaitInteraction')
    expect(rt.state.vars.hits).toBe(1)

    rt.submitInteraction('ms', 'hit')
    expect(rt.state.phase).toBe('awaitInteraction')
    expect(rt.state.vars.hits).toBe(2)

    rt.submitInteraction('ms', 'hit')
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
        node('win', { end: 'victory' }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(
      graph,
      scn(graph, {
        rules: [
          {
            id: 'win',
            when: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] },
            goto: 'win',
            once: true,
          },
        ],
      }),
    )
    rt.start()
    rt.submitInteraction('ms', 'x')
    expect(rt.state.currentNodeId).toBe('win')
    expect(rt.state.phase).not.toBe('awaitInteraction')
  })
})
