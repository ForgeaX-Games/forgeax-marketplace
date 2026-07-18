import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { GraphSession } from '../engine/session'
import { createCoreKindRegistry } from '../registry/core-kinds'
import { KindRegistry } from '../registry/kind-registry'
import type { GameGraph } from '../schema/graph-schema'
import { node, scnOf } from './test-fixtures'
import {
  claimPlayerFocus,
  isPlayerFocused,
  releasePlayerFocus,
} from '../input/playerFocus'

describe('multi-runtime isolation (B)', () => {
  it('two sessions each get their own KindRegistry instance', () => {
    const a = new GraphSession(scnOf({ nodes: [node('a')], edges: [] }))
    const b = new GraphSession(scnOf({ nodes: [node('b')], edges: [] }))
    expect(a.runtime.kinds).not.toBe(b.runtime.kinds)
    expect(a.skins).not.toBe(b.skins)
    expect(a.runtime.kinds.getKind('qte')?.kind).toBe('qte')
    expect(b.runtime.kinds.getKind('qte')?.kind).toBe('qte')
  })

  it('custom kind on one registry is invisible to another registry', () => {
    const onlyA = createCoreKindRegistry()
    onlyA.registerKind({
      kind: 'secretView',
      role: 'presentation',
      validate: () => [],
      outputs: () => [],
    })
    expect(onlyA.getKind('secretView')?.kind).toBe('secretView')
    expect(new KindRegistry().getKind('secretView')).toBeUndefined()
    // core kinds present on A, absent on a bare registry
    expect(onlyA.getKind('qte')?.kind).toBe('qte')
    expect(new KindRegistry().getKind('qte')).toBeUndefined()
  })

  it('requiredPlugins checked against the injected registry, not the global default', () => {
    const local = new KindRegistry()
    local.registerPlugin('pack-a', { version: '1' })
    const graph: GameGraph = { nodes: [node('n')], edges: [] }
    expect(() => {
      const s = scnOf(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] })
      return new GraphRuntime(s.graph, s, local)
    }).not.toThrow()
    expect(() => {
      const s = scnOf(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] })
      return new GraphRuntime(s.graph, s, new KindRegistry())
    }).toThrow(/pack-a/)
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
    expect(isPlayerFocused(a)).toBe(true)
    expect(isPlayerFocused(b)).toBe(true)
  })
})
