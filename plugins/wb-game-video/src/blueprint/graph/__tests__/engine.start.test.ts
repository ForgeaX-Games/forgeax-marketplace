import { afterEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine'
import { registerKind, unregisterKind } from '../kind-registry'
import { isPlayClip } from '../directives'
import type { GameScenario } from '../graph-schema'

afterEach(() => unregisterKind('settleT'))

function scn(): GameScenario {
  return {
    schemaVersion: 't',
    variables: { qi: { id: 'qi', name: '气力', kind: 'number', initial: 1, min: 0, max: 5 } },
    entities: { 'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } } },
    rng: { seed: 1 },
    graph: {
      nodes: [
        {
          id: 'open',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: '开场',
            durationMs: 1000,
            timeline: [
              { id: 'e1', role: 'logic', kind: 'settleT', trigger: { when: 'enter' }, params: {} },
            ],
          },
        },
      ],
      edges: [],
    },
  }
}

describe('GraphRuntime.start', () => {
  it('enters entry node, emits playClip, runs enter logic effect', () => {
    registerKind({
      kind: 'settleT',
      role: 'logic',
      validate: () => [],
      outputs: () => [],
      run: () => ({ effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }),
    })
    const rt = new GraphRuntime(scn().graph, scn())
    const dirs = rt.start()

    const play = dirs.find(isPlayClip)
    expect(play).toBeTruthy()
    expect(play!.nodeId).toBe('open')
    expect(play!.name).toBe('开场')
    expect(play!.loop).toBe(false)
    expect(play!.durationMs).toBe(1000)

    expect(rt.state.currentNodeId).toBe('open')
    expect(rt.state.phase).toBe('playing')
    expect(rt.state.visited.has('open')).toBe(true)
    expect(rt.state.vars.qi).toBe(2) // enter settle applied (1 + 1)
  })
})
