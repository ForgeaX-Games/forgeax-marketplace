import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerKind, unregisterKind } from '../registry/kind-registry'
import { isRenderOverlay, isOpenInteraction } from '../engine/directives'
import type { GameGraph, GameNode, GameScenario, GraphEffect, ReactiveRule, TimelineElement } from '../schema/graph-schema'

// Minimal kinds: a logic "hit" that damages boss, a presentation "float", a choice-like.
const KINDS = ['hit', 'floatT', 'markT', 'choiceX']
beforeEach(() => {
  registerKind({
    kind: 'hit',
    role: 'logic',
    validate: () => [],
    outputs: () => [],
    run: (_c, p) => ({ effects: ((p as { effects?: GraphEffect[] }).effects ?? []) }),
  })
  registerKind({ kind: 'floatT', role: 'presentation', validate: () => [], outputs: () => [] })
  registerKind({
    kind: 'markT',
    role: 'logic',
    validate: () => [],
    outputs: () => [],
    run: () => ({ effects: [{ id: 'm', kind: 'var', varId: 'mark', op: 'add', value: 1 }] }),
  })
  registerKind({
    kind: 'choiceX',
    role: 'interaction',
    validate: () => [],
    outputs: (p) => ((p as { options?: { key: string }[] }).options ?? []).map((o) => ({ id: `opt:${o.key}` })),
    resolve: (_c, p, input) => {
      const pp = p as { options?: { key: string }[]; defaultKey?: string }
      const key = typeof input === 'string' ? input : pp.defaultKey ?? pp.options?.[0]?.key
      return { outcome: `opt:${key}` }
    },
  })
})
afterEach(() => KINDS.forEach(unregisterKind))

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
  variables: { mark: { id: 'mark', name: 'mark', kind: 'number', initial: 0, min: 0, max: 99 } },
  entities: {
    'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300, initial: 300 } } },
    'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 50 }, attrMeta: { hp: { max: 700, initial: 700 } } },
  },
  rng: { seed: 1 },
  graph,
  ...over,
})

describe('exit trigger', () => {
  it('runs exit elements before traversing to the next node', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          timeline: [
            { id: 'x', role: 'logic', kind: 'markT', trigger: { when: 'exit' }, params: {} },
          ] as TimelineElement[],
        }),
        node('b', { end: 'ending' }),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out' }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    expect(rt.state.vars.mark).toBe(0) // not yet — still on a
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.mark).toBe(1) // exit ran while leaving a
  })
})

describe('afterHit trigger', () => {
  it('fires an element bound to a just-run element id', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          timeline: [
            { id: 'dmg', role: 'logic', kind: 'hit', trigger: { when: 'enter' }, params: { effects: [] } },
            { id: 'fx', role: 'presentation', kind: 'floatT', trigger: { when: 'afterHit', ref: 'dmg' }, params: { text: 'hit!' } },
          ] as TimelineElement[],
        }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    const dirs = rt.start()
    // floatT rendered as a generic overlay right after dmg ran (afterHit)
    expect(dirs.some((d) => isRenderOverlay(d) && d.kind === 'floatT')).toBe(true)
  })
})

describe('element window (startMs/endMs)', () => {
  it('shows presentation at startMs and removes at endMs', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            { id: 'w', role: 'presentation', kind: 'floatT', trigger: { when: 'enter' }, window: { startMs: 2000, endMs: 4000 }, params: { text: 'x' } },
          ] as TimelineElement[],
        }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    expect(rt.tick(1000).some(isRenderOverlay)).toBe(false) // 未到 startMs
    expect(rt.tick(2500).some((d) => isRenderOverlay(d) && d.elementId === 'w')).toBe(true) // 进入窗口 → 显示
    expect(rt.tick(4500).some((d) => d.type === 'removeOverlay' && d.elementId === 'w')).toBe(true) // 过 endMs → 移除
  })
})

describe('subflow (subFlowRef)', () => {
  it('descends into subflow on enter and returns to continue container out', () => {
    const graph: GameGraph = {
      nodes: [
        node('wrap', { subFlowRef: 'sub', durationMs: 100 }),
        node('sub', { durationMs: 100, returnsToCaller: true }),
        node('after', { end: 'ending' }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'out' }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    // 首次进入容器 → 下钻到 sub（压栈 wrap）
    expect(rt.state.currentNodeId).toBe('sub')
    expect(rt.state.callStack).toEqual(['wrap'])
    // sub 演出结束 → returnsToCaller 弹回 wrap → 容器不重播、直接走 out → after
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
  })
})

describe('transition kind', () => {
  it('emits a transition overlay on enter (generic renderOverlay)', () => {
    registerKind({ kind: 'transition', role: 'presentation', validate: () => [], outputs: () => [] })
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [{ id: 't', role: 'presentation', kind: 'transition', trigger: { when: 'enter' }, params: { durationMs: 500 } }] as TimelineElement[],
        }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    const dirs = rt.start()
    expect(dirs.some((d) => isRenderOverlay(d) && d.kind === 'transition')).toBe(true)
    unregisterKind('transition')
  })
})

describe('choice timeout', () => {
  it('openInteraction carries timeoutMs; submit(undefined) falls back to defaultKey', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          timeline: [
            {
              id: 'c',
              role: 'interaction',
              kind: 'choiceX',
              trigger: { when: 'enter' },
              params: { options: [{ key: 'a' }, { key: 'b' }], timeoutMs: 3000, defaultKey: 'b' },
            },
          ] as TimelineElement[],
        }),
        node('win', { end: 'victory' }),
        node('lose', { end: 'defeat' }),
      ],
      edges: [
        { id: 'e-a', source: 'a', target: 'win', sourceHandle: 'opt:a' },
        { id: 'e-b', source: 'a', target: 'lose', sourceHandle: 'opt:b' },
      ],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    const dirs = rt.start()
    const open = dirs.find(isOpenInteraction)
    expect(open?.timeoutMs).toBe(3000)
    // 模拟到点未选：submit(undefined) → defaultKey 'b' → lose
    rt.submitInteraction('c', undefined)
    expect(rt.state.currentNodeId).toBe('lose')
  })
})

describe('graph-level reactive rules (instant defeat/victory)', () => {
  const bossDead: ReactiveRule = {
    id: 'boss-dead',
    when: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] },
    goto: 'win',
  }

  it('jumps to goto immediately when a rule matches mid-performance (at trigger)', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            {
              id: 'dmg',
              role: 'logic',
              kind: 'hit',
              trigger: { when: 'at', ms: 500 },
              // boss hp 50 → -60 kills it
              params: { effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -60 }] },
            },
          ] as TimelineElement[],
        }),
        node('win', { end: 'victory' }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, { rules: [bossDead] }))
    rt.start()
    expect(rt.state.currentNodeId).toBe('a')
    const dirs = rt.tick(600) // dmg fires → boss dead → instant jump to win
    expect(rt.state.currentNodeId).toBe('win')
    expect(dirs.some((d) => d.type === 'banner' && d.kind === 'victory')).toBe(true)
  })

  it('call edge pushes caller; returnsToCaller pops back', () => {
    const graph: GameGraph = {
      nodes: [
        node('hub', { durationMs: 100 }),
        node('sub', { durationMs: 100, returnsToCaller: true }),
      ],
      edges: [{ id: 'e', source: 'hub', target: 'sub', sourceHandle: 'out', data: { call: true } }],
    }
    const rt = new GraphRuntime(graph, scnOf(graph))
    rt.start()
    expect(rt.state.currentNodeId).toBe('hub')
    rt.onPerformanceEnd() // call edge → push hub → enter sub
    expect(rt.state.currentNodeId).toBe('sub')
    expect(rt.state.callStack).toEqual(['hub'])
    rt.onPerformanceEnd() // sub ends, no out edge, returnsToCaller → pop → hub
    expect(rt.state.currentNodeId).toBe('hub')
    expect(rt.state.callStack).toEqual([])
  })

  it('does not jump when the rule condition is not met', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          timeline: [
            {
              id: 'dmg',
              role: 'logic',
              kind: 'hit',
              trigger: { when: 'at', ms: 500 },
              params: { effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }] },
            },
          ] as TimelineElement[],
        }),
        node('win', { end: 'victory' }),
      ],
      edges: [],
    }
    const rt = new GraphRuntime(graph, scnOf(graph, { rules: [bossDead] }))
    rt.start()
    rt.tick(600) // boss 50 → 40, still alive
    expect(rt.state.currentNodeId).toBe('a')
  })
})
