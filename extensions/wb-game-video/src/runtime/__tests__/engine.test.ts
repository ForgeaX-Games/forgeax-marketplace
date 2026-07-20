import { afterEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerComponent, unregisterComponent } from '../registry/component-registry'
import { isOpenInteraction, isRenderOverlay } from '../engine/directives'
import type { GameGraph, GameNode, GameScenario } from '../schema/graph-schema'
import { node, scnOf, rid } from './test-fixtures'

const COMPONENT_IDS = ['floatT', 'qteT']
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))

function registerCore() {
  registerComponent('floatT', { role: 'presentation' })
  registerComponent('qteT', {
    role: 'interaction',
    events: [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
  })
}


describe('GraphRuntime advance', () => {
  it('auto edge advance on performanceEnd', () => {
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
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
      nodes: [node('round'), node('init', { }), node('settle', { })],
      edges: [
        { id: 'r-next', source: 'round', target: 'init', sourceHandle: 'default', targetHandle: 'in', data: { condition: bothAlive } },
        { id: 'r-over', source: 'round', target: 'settle', sourceHandle: 'default', targetHandle: 'in' },
      ],
    })
    // both alive → init
    const g1 = mk()
    const scn1 = scnOf(g1)
    const rt1 = new GraphRuntime(scn1.graph, scn1)
    rt1.start()
    expect(rt1.state.currentNodeId).toBe('init')
    // boss dead → settle
    const g2 = mk()
    const scn2 = scnOf(g2, {
      entities: {
        'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
        'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 0 }, attrMeta: { hp: { max: 700 } } },
      },
    })
    const rt2 = new GraphRuntime(scn2.graph, scn2)
    rt2.start()
    expect(rt2.state.currentNodeId).toBe('settle')
  })

  it('tick fires at-reaction effect + at-element in time order', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 2000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
          ],
          timeline: [
            { id: 'f', role: 'presentation', kind: 'floatT', trigger: { when: 'at', ms: 1000 }, inputs: { text: '+1' } },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    const d1 = rt.tick(600)
    expect(rt.state.vars.qi).toBe(1) // at:500 reaction fired
    expect(d1.some(isRenderOverlay)).toBe(false) // float not yet
    const d2 = rt.tick(1100)
    expect(d2.some((d) => isRenderOverlay(d) && d.component === 'floatT')).toBe(true)
  })

  it('interaction resolve routes by outcome handle', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [
        node('a', { timeline: [{ id: 'q', role: 'interaction', kind: 'qteT', trigger: { when: 'enter' }, inputs: {} }] }),
        node('win', { }),
        node('lose', { }),
      ],
      edges: [
        { id: 'e-pass', source: 'a', target: 'win', sourceHandle: 'pass', targetHandle: 'in' },
        { id: 'e-fail', source: 'a', target: 'lose', sourceHandle: 'fail', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some(isOpenInteraction)).toBe(true)
    expect(rt.state.phase).toBe('awaitInteraction')
    rt.submitInteraction(rid('a', 'q'), 'pass') // 皮肤自判定后 emit 最终 event id
    expect(rt.state.currentNodeId).toBe('win')
  })

  it('jumpToNode seeks preserving globals by default', () => {
    registerCore()
    const graph: GameGraph = {
      nodes: [node('a', { durationMs: 100 }), node('b', { durationMs: 100 }), node('c', { durationMs: 100 })],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.state.vars.qi = 4
    rt.jumpToNode('c')
    expect(rt.state.currentNodeId).toBe('c')
    expect(rt.state.vars.qi).toBe(4) // preserved
  })
})
