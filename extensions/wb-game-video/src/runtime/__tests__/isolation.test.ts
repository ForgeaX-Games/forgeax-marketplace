import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { GraphSession } from '../engine/session'
import { createCoreComponentRegistry } from '../registry/core-components'
import { ComponentRegistry } from '../registry/component-registry'
import type { GameGraph } from '../schema/graph-schema'
import { node, scnOf } from './test-fixtures'
import {
  claimPlayerFocus,
  isPlayerFocused,
  releasePlayerFocus,
} from '../input/playerFocus'

describe('multi-runtime isolation (B)', () => {
  it('two sessions each get their own ComponentRegistry instance', () => {
    const a = new GraphSession(scnOf({ nodes: [node('a')], edges: [] }))
    const b = new GraphSession(scnOf({ nodes: [node('b')], edges: [] }))
    expect(a.runtime.components).not.toBe(b.runtime.components)
    expect(a.skins).not.toBe(b.skins)
    expect(a.runtime.components.getComponent('qte')?.role).toBe('interaction')
    expect(b.runtime.components.getComponent('qte')?.role).toBe('interaction')
  })

  it('custom component on one registry is invisible to another registry', () => {
    const onlyA = createCoreComponentRegistry()
    onlyA.registerComponent('secretView', {
      role: 'presentation',
    })
    expect(onlyA.getComponent('secretView')?.role).toBe('presentation')
    expect(new ComponentRegistry().getComponent('secretView')).toBeUndefined()
    // core components present on A, absent on a bare registry
    expect(onlyA.getComponent('qte')?.role).toBe('interaction')
    expect(new ComponentRegistry().getComponent('qte')).toBeUndefined()
  })

  it('requiredPlugins checked against the injected registry, not the global default', () => {
    const local = new ComponentRegistry()
    local.registerPlugin('pack-a', { version: '1' })
    const graph: GameGraph = { nodes: [node('n')], edges: [] }
    expect(() => {
      const s = scnOf(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] })
      return new GraphRuntime(s.graph, s, local)
    }).not.toThrow()
    expect(() => {
      const s = scnOf(graph, { requiredPlugins: [{ id: 'pack-a', version: '1' }] })
      return new GraphRuntime(s.graph, s, new ComponentRegistry())
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
