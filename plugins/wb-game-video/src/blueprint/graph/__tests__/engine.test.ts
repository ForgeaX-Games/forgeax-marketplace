import { afterEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine'
import { registerKind, unregisterKind } from '../kind-registry'
import { isOpenInteraction, isRenderOverlay } from '../directives'
import type { GameGraph, GameNode, GameScenario, TimelineElement } from '../graph-schema'

const KINDS = ['settleT', 'floatT', 'qteT']
afterEach(() => KINDS.forEach(unregisterKind))

function registerCore() {
  registerKind({
    kind: 'settleT',
    role: 'logic',
    validate: () => [],
    outputs: () => [],
    run: () => ({ effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }),
  })
  registerKind({ kind: 'floatT', role: 'presentation', validate: () => [], outputs: () => [] })
  registerKind({
    kind: 'qteT',
    role: 'interaction',
    validate: () => [],
    outputs: () => [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
    resolve: (_c, _p, input) => ({ outcome: input === 'hit' ? 'pass' : 'fail' }),
  })
}

const node = (id: string, extra: Partial<GameNode['data']> = {}): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, timeline: [], ...extra },
})

const scnOf = (graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario => ({
  schemaVersion: 't',
  variables: { qi: { id: 'qi', name: '气', kind: 'number', initial: 0, min: 0, max: 9 } },
  entities: {
    'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
    'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 700 }, attrMeta: { hp: { max: 700 } } },
  },
  rng: { seed: 1 },
  graph,
  ...over,
})

describe('GraphRuntime advance', () => {
  it('auto edge advance on performanceEnd', () => {
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { end: 'ending' })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    expect(rt.state.currentNodeId).toBe('a')
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.traversedEdgeIds.has('e')).toBe(true)
  })

  it('conditional gateway routes by hp (instant node)', () => {
    const bothAlive = { all: [
      { type: 'attrRatio' as const, entityId: 'ent-player', attr: 'hp', op: 'gt' as const, value: 0 },
      { type: 'attrRatio' as const, entityId: 'ent-boss', attr: 'hp', op: 'gt' as const, value: 0 },
    ] }
    const mk = (): GameGraph => ({
      nodes: [node('round'), node('init', { end: 'ending' }), node('settle', { end: 'victory' })],
      edges: [
        { id: 'r-next', source: 'round', target: 'init', sourceHandle: 'cond:0', data: { condition: bothAlive } },
        { id: 'r-over', source: 'round', target: 'settle', sourceHandle: 'else' },
      ],
    })
    // both alive → init
    const g1 = mk()
    const rt1 = new GraphRuntime(g1, scnOf(g1))
    rt1.start()
    expect(rt1.state.currentNodeId).toBe('init')
    // boss dead → settle
    const g2 = mk()
    const rt2 = new GraphRuntime(g2, scnOf(g2, {
      entities: {
        'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
        'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 0 }, attrMeta: { hp: { max: 700 } } },
      },
    }))
    rt2.start()
    expect(rt2.state.currentNodeId).toBe('settle')
  })

  it('tick fires at-elements in time order', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          timeline: [
            { id: 's', role: 'logic', kind: 'settleT', trigger: { when: 'at', ms: 500 }, params: {} },
            { id: 'f', role: 'presentation', kind: 'floatT', trigger: { when: 'at', ms: 1000 }, params: { text: '+1' } },
          ] as TimelineElement[],
        }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    const d1 = rt.tick(600)
    expect(rt.state.vars.qi).toBe(1) // settle fired
    expect(d1.some(isRenderOverlay)).toBe(false) // float not yet
    const d2 = rt.tick(1100)
    expect(d2.some((d) => isRenderOverlay(d) && d.kind === 'floatT')).toBe(true)
  })

  it('interaction resolve routes by outcome handle', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', { timeline: [{ id: 'q', role: 'interaction', kind: 'qteT', trigger: { when: 'enter' }, params: {} }] }),
        node('win', { end: 'victory' }),
        node('lose', { end: 'defeat' }),
      ],
      edges: [
        { id: 'e-pass', source: 'a', target: 'win', sourceHandle: 'pass' },
        { id: 'e-fail', source: 'a', target: 'lose', sourceHandle: 'fail' },
      ],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    const dirs = rt.start()
    expect(dirs.some(isOpenInteraction)).toBe(true)
    expect(rt.state.phase).toBe('awaitInteraction')
    rt.submitInteraction('q', 'hit')
    expect(rt.state.currentNodeId).toBe('win')
  })

  it('jumpToNode seeks preserving globals by default', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { durationMs: 100 }), node('c', { durationMs: 100 })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    rt.state.vars.qi = 4
    rt.jumpToNode('c')
    expect(rt.state.currentNodeId).toBe('c')
    expect(rt.state.vars.qi).toBe(4) // preserved
  })
})
