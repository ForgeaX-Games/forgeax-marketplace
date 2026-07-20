import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerComponent, unregisterComponent } from '../registry/component-registry'
import { isRenderOverlay, isOpenInteraction } from '../engine/directives'
import type { GameGraph, GameNode, GameScenario, Reaction, SubFlowPackDef } from '../schema/graph-schema'
import { node, scnOf, rid } from './test-fixtures'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

// Minimal components: a presentation "float", a choice-like（副作用改由 node.data.reactions 承载）。
const COMPONENT_IDS = ['floatT', 'choiceX']
beforeEach(() => {
  registerComponent('floatT', { role: 'presentation' })
  registerComponent('choiceX', {
    role: 'interaction',
    // 出口由实例 inputs.events 派生（handlesOf）；无需声明 outputs。
  })
})
afterEach(() => COMPONENT_IDS.forEach(unregisterComponent))


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
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
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
            { id: 'w', role: 'presentation', kind: 'floatT', trigger: { when: 'enter' }, window: { startMs: 2000, endMs: 4000 }, inputs: { text: 'x' } },
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
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
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
      edges: [{ id: 'e', source: 'wrap', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
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

describe('transition component', () => {
  it('emits a transition overlay on enter (generic renderOverlay)', () => {
    registerComponent('transition', { role: 'presentation' })
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [{ id: 't', role: 'presentation', kind: 'transition', trigger: { when: 'enter' }, inputs: { durationMs: 500 } }],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some((d) => isRenderOverlay(d) && d.component === 'transition')).toBe(true)
    unregisterComponent('transition')
  })
})

describe('choice timeout', () => {
  it('openInteraction carries timeoutMs; submit(undefined) falls back to defaultEvent', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          timeline: [
            {
              id: 'c',
              role: 'interaction',
              kind: 'choiceX',
              trigger: { when: 'enter' },
              inputs: { events: [{ id: 'a' }, { id: 'b' }], timeoutMs: 3000, defaultEvent: 'b' },
            },
          ],
        }),
        node('win', { }),
        node('lose', { }),
      ],
      edges: [
        { id: 'e-a', source: 'a', target: 'win', sourceHandle: 'a', targetHandle: 'in' },
        { id: 'e-b', source: 'a', target: 'lose', sourceHandle: 'b', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    const open = dirs.find(isOpenInteraction)
    expect(open?.timeoutMs).toBe(3000)
    // 模拟到点未选：submit(undefined) → defaultEvent 'b' → lose
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
              inputs: { events: [{ id: 'pass' }, { id: 'fail' }], windowMs: 200, defaultEvent: 'fail' },
            },
          ],
        }),
        node('ok', {}),
        node('miss', {}),
      ],
      edges: [
        { id: 'e-p', source: 'a', target: 'ok', sourceHandle: 'pass', targetHandle: 'in' },
        { id: 'e-f', source: 'a', target: 'miss', sourceHandle: 'fail', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph)
    const rt = new GraphRuntime(scn.graph, scn)
    const open = rt.start().find(isOpenInteraction)
    expect(open?.timeoutMs).toBe(200)
  })
})

describe('submitInteraction · event 结算只读 mount.reactions（选项/通用组件结算修复的运行时证明）', () => {
  // 复现「素材属性编辑面板统一化」修复的真实运行时后果：2026-07-16 边路由统一重构曾把
  // 选项/通用组件结算误写进 node.data.reactions，但 submitInteraction 从头到尾只读
  // nodeOverlayMounts(node)[...].reactions（见 engine.ts:467-470），配了但从不生效。
  function seedChoiceNode(reactionsOn: 'mount' | 'legacyNode'): { graph: GameGraph; scn: GameScenario } {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          timeline: [
            { id: 'c', role: 'interaction', kind: 'choiceX', trigger: { when: 'enter' }, params: { events: [{ id: 'hit' }] } },
          ],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      entities: { 'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 700 }, attrMeta: { hp: { max: 700 } } } },
    })
    const a = scn.graph.nodes.find((n) => n.id === 'a')!
    const effects = [{ id: 'hit-fx', kind: 'attr' as const, entityId: 'ent-boss', attr: 'hp', op: 'add' as const, value: -100 }]
    if (reactionsOn === 'mount') {
      a.data.overlayNodes = [{
        overlay: 'ov-a',
        reactions: [{ when: { type: 'event', id: 'hit' }, do: [{ kind: 'effect', effects }] }],
      }]
    } else {
      a.data.reactions = [{ when: { type: 'event', id: 'hit' }, do: [{ kind: 'effect', effects }] }]
    }
    return { graph: scn.graph, scn }
  }

  it('写在 mount.reactions（新统一写入位置）：submitInteraction 后 effect 真的生效', () => {
    const { graph, scn } = seedChoiceNode('mount')
    const rt = new GraphRuntime(graph, scn)
    rt.start()
    rt.submitInteraction(rid('a', 'c'), 'hit')
    expect(rt.state.entities['ent-boss']?.attrs.hp).toBe(600)
  })

  it('写在 node.data.reactions（历史 bug 位置）：submitInteraction 不读它，effect 不生效', () => {
    const { graph, scn } = seedChoiceNode('legacyNode')
    const rt = new GraphRuntime(graph, scn)
    rt.start()
    rt.submitInteraction(rid('a', 'c'), 'hit')
    expect(rt.state.entities['ent-boss']?.attrs.hp).toBe(700)
  })
})

describe('graph-level reactive rules (instant defeat/victory)', () => {
  const bossDead: Reaction = {
    when: { type: 'state', condition: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] } },
    do: [{ kind: 'advance', edgeId: 'e-win' }],
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
      edges: [{ id: 'e-win', source: 'a', target: 'win', sourceHandle: 'win', targetHandle: 'in' }],
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
    rt.tick(600) // at:500 reaction fires → boss dead → instant jump to win
    expect(rt.state.currentNodeId).toBe('win')
    expect(rt.state.phase).toBe('ended') // win 无出边 & 栈空 → 本局结束（不强制结局文案）
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
      edges: [{ id: 'e-win', source: 'a', target: 'win', sourceHandle: 'win', targetHandle: 'in' }],
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
