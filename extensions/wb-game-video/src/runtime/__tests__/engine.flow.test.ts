import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerKind, unregisterKind } from '../registry/kind-registry'
import { isRenderOverlay, isOpenInteraction } from '../engine/directives'
import type { GameGraph, GameNode, GameScenario, Reaction, SubFlowPackDef } from '../schema/graph-schema'
import { node, scnOf, rid } from './test-fixtures'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

// Minimal kinds: a presentation "float", a choice-like（副作用改由 node.data.reactions 承载）。
const KINDS = ['floatT', 'choiceX']
beforeEach(() => {
  registerKind({ kind: 'floatT', role: 'presentation', validate: () => [], outputs: () => [] })
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


describe('exit reaction', () => {
  it('applies exit-phase reaction effects before traversing to the next node', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 100,
          reactions: [
            { when: { type: 'exit' }, do: [{ kind: 'effect', effects: [{ id: 'm', kind: 'var', varId: 'mark', op: 'add', value: 1 }] }] },
          ],
        }),
        node('b', { }),
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }],
    }
    const scn = scnOf(graph, { variables: { mark: { id: 'mark', initial: 0 } } })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.vars.mark).toBe(0) // not yet — still on a
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.mark).toBe(1) // exit ran while leaving a
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
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.tick(1000).some(isRenderOverlay)).toBe(false) // 未到 startMs
    expect(rt.tick(2500).some((d) => isRenderOverlay(d) && d.elementId === rid('a', 'w'))).toBe(true) // 进入窗口 → 显示
    expect(rt.tick(4500).some((d) => d.type === 'removeOverlay' && d.elementId === rid('a', 'w'))).toBe(true) // 过 endMs → 移除
  })
})

describe('subflow (subFlow)', () => {
  it('descends into subflow on enter and returns to continue container out', () => {
    const graph: GameGraph = {
      nodes: [
        node('wrap', { subFlow: 'sub', durationMs: 100 }),
        node('sub', { durationMs: 100 }),
        node('after', { }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'out', targetHandle: 'in' }],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    // 首次进入容器 → 下钻到 sub（压栈 wrap）
    expect(rt.state.currentNodeId).toBe('sub')
    expect(callers(rt)).toEqual(['wrap'])
    // sub 演出结束 → 无出边自动弹回 wrap → 容器不重播、直接走 out → after
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
  })
})

describe('subflow pack (subFlowPack)', () => {
  it('switches to external pack graph and returns to continue container out', () => {
    const main: GameGraph = {
      nodes: [
        node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 }),
        node('after', { }),
      ],
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'out', targetHandle: 'in' }],
    }
    const packGraph: GameGraph = {
      nodes: [node('tele', { durationMs: 100 })],
      edges: [],
    }
    const pack: SubFlowPackDef = {
      schemaVersion: 'wb-game-video.pack.v1',
      id: 'enemy-turn',
      version: '1',
      entry: 'tele',
      graph: packGraph,
    }
    const rt = new GraphRuntime(main, scnOf(main), undefined, [pack])
    rt.start()
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['wrap'])
    expect(rt.state.callStack[0]?.returnGraph).toBe(main)
    // pack 图里没有 after；弹回主图后才能走到 after
    rt.onPerformanceEnd()
    expect(rt.state.currentNodeId).toBe('after')
    expect(rt.state.callStack).toEqual([])
  })

  it('throws when referenced pack is not loaded', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'missing' } })],
      edges: [],
    }
    const scn = scnOf(main)
    const rt = new GraphRuntime(scn.graph, scn)
    expect(() => rt.start()).toThrow(/subFlowPack 'missing' is not loaded/)
  })
})

describe('transition kind', () => {
  it('emits a transition overlay on enter (generic renderOverlay)', () => {
    registerKind({ kind: 'transition', role: 'presentation', validate: () => [], outputs: () => [] })
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [{ id: 't', role: 'presentation', kind: 'transition', trigger: { when: 'enter' }, params: { durationMs: 500 } }],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some((d) => isRenderOverlay(d) && d.component === 'transition')).toBe(true)
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
          ],
        }),
        node('win', { }),
        node('lose', { }),
      ],
      edges: [
        { id: 'e-a', source: 'a', target: 'win', sourceHandle: 'opt:a', targetHandle: 'in' },
        { id: 'e-b', source: 'a', target: 'lose', sourceHandle: 'opt:b', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    const open = dirs.find(isOpenInteraction)
    expect(open?.timeoutMs).toBe(3000)
    // 模拟到点未选：submit(undefined) → defaultKey 'b' → lose
    rt.submitInteraction(rid('a', 'c'), undefined)
    expect(rt.state.currentNodeId).toBe('lose')
  })

  it('openInteraction maps windowMs to timeoutMs when timeoutMs absent', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          timeline: [
            {
              id: 'q',
              role: 'interaction',
              kind: 'choiceX',
              trigger: { when: 'enter' },
              params: { options: [{ key: 'pass' }, { key: 'fail' }], windowMs: 200, defaultKey: 'fail' },
            },
          ],
        }),
        node('ok', {}),
        node('miss', {}),
      ],
      edges: [
        { id: 'e-p', source: 'a', target: 'ok', sourceHandle: 'opt:pass', targetHandle: 'in' },
        { id: 'e-f', source: 'a', target: 'miss', sourceHandle: 'opt:fail', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const open = rt.start().find(isOpenInteraction)
    expect(open?.timeoutMs).toBe(200)
  })
})

describe('graph-level reactive rules (instant defeat/victory)', () => {
  const bossDead: Reaction = {
    when: { type: 'state', condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] } },
    do: [{ kind: 'goto', targetNodeId: 'win' }],
  }

  it('jumps to goto immediately when a rule matches mid-performance (at trigger)', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          // boss hp 50 → -60 kills it (at:500 reaction effect)
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -60 }] }] },
          ],
        }),
        node('win', { }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      reactions: [bossDead],
      entities: {
        'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 50 }, attrMeta: { hp: { max: 50, initial: 50 } } },
      },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.currentNodeId).toBe('a')
    const dirs = rt.tick(600) // at:500 reaction fires → boss dead → instant jump to win
    expect(rt.state.currentNodeId).toBe('win')
    expect(dirs.some((d) => d.type === 'banner' && d.kind === 'ending')).toBe(true)
  })

  it('does not jump when the rule condition is not met', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 5000,
          reactions: [
            { when: { type: 'at', ms: 500 }, do: [{ kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }] }] },
          ],
        }),
        node('win', { }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      reactions: [bossDead],
      entities: {
        'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 50 }, attrMeta: { hp: { max: 50, initial: 50 } } },
      },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.tick(600) // boss 50 → 40, still alive
    expect(rt.state.currentNodeId).toBe('a')
  })
})
