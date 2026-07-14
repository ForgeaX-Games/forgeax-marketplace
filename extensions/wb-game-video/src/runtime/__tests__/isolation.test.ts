import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { GraphSession } from '../engine/session'
import { createCoreKindRegistry } from '../registry/core-kinds'
import { KindRegistry } from '../registry/kind-registry'
import type { GameGraph, GameNode, GameScenario } from '../schema/graph-schema'
import {
  claimPlayerFocus,
  isPlayerFocused,
  releasePlayerFocus,
} from '../input/playerFocus'

const node = (id: string, extra: Partial<GameNode['data']> = {}): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, timeline: [], durationMs: 100, ...extra },
})

function scn(graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario {
  return { schemaVersion: 't', graph, ...over }
}

describe('multi-runtime isolation (B)', () => {
  it('two sessions each get their own KindRegistry instance', () => {
    const a = new GraphSession(scn({ nodes: [node('a')], edges: [] }))
    const b = new GraphSession(scn({ nodes: [node('b')], edges: [] }))
    expect(a.runtime.kinds).not.toBe(b.runtime.kinds)
    expect(a.skins).not.toBe(b.skins)
    expect(a.runtime.kinds.getKind('qte')?.kind).toBe('qte')
    expect(b.runtime.kinds.getKind('qte')?.kind).toBe('qte')
  })

  it('custom kind on one registry is invisible to another runtime', () => {
    const onlyA = createCoreKindRegistry()
    onlyA.registerKind({
      kind: 'secretPack',
      role: 'logic',
      validate: () => [],
      outputs: () => [],
      run: () => ({ effects: [{ kind: 'var', varId: 'x', op: 'set', value: 1 }] }),
    })
    const emptyish = new KindRegistry() // no core, no secret
    const graph: GameGraph = {
      nodes: [
        node('n', {
          durationMs: undefined,
          timeline: [
            {
              id: 's',
              role: 'logic',
              kind: 'secretPack',
              trigger: { when: 'enter' },
              params: {},
            },
          ],
        }),
      ],
      edges: [],
    }
    const rtA = new GraphRuntime(graph, scn(graph, { variables: { x: { id: 'x', name: 'x', kind: 'number', initial: 0 } } }), onlyA)
    rtA.start()
    expect(rtA.state.vars.x).toBe(1)

    const rtB = new GraphRuntime(graph, scn(graph, { variables: { x: { id: 'x', name: 'x', kind: 'number', initial: 0 } } }), emptyish)
    rtB.start()
    // secretPack 未注册 → runElement 空操作，var 不变
    expect(rtB.state.vars.x).toBe(0)
  })

  it('requiredPlugins checked against the injected registry, not the global default', () => {
    const local = new KindRegistry()
    local.registerPlugin('pack-a', { version: '1' })
    const graph: GameGraph = { nodes: [node('n')], edges: [] }
    expect(
      () =>
        new GraphRuntime(graph, scn(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] }), local),
    ).not.toThrow()
    expect(
      () =>
        new GraphRuntime(graph, scn(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] }), new KindRegistry()),
    ).toThrow(/pack-a/)
  })
})

describe('player focus gate (A)', () => {
  it('with no claimed focus, any root is allowed', () => {
    const a = { id: 'a' } as unknown as HTMLElement
    const b = { id: 'b' } as unknown as HTMLElement
    releasePlayerFocus(a)
    releasePlayerFocus(b)
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(true)
  })

  it('after claim, only the focused root passes', () => {
    const a = { id: 'a', contains: () => false } as unknown as HTMLElement
    const b = { id: 'b', contains: () => false } as unknown as HTMLElement
    claimPlayerFocus(a)
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(false)
    claimPlayerFocus(b)
    expect(isPlayerFocused(a)).toBe(false)
    expect(isPlayerFocused(b)).toBe(true)
    releasePlayerFocus(b)
    // 无焦点声明 → 单局兼容：全部放行
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(true)
  })
})
