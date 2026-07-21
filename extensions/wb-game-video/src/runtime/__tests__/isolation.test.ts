import { describe, expect, it } from 'vitest'
import { GraphSession } from '../engine/session'
import { createDefaultComponentRegistry } from '../skins/components'
import { ComponentRegistry } from '../registry/component-registry'
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
    expect(a.runtime.components.getComponent('qte')?.events?.length).toBeGreaterThan(0)
    expect(b.runtime.components.getComponent('qte')?.events?.length).toBeGreaterThan(0)
  })

  it('custom component on one registry is invisible to another registry', () => {
    const onlyA = createDefaultComponentRegistry()
    onlyA.registerComponent('secretView', {})
    expect(onlyA.getComponent('secretView')).toBeDefined()
    expect(new ComponentRegistry().getComponent('secretView')).toBeUndefined()
    // 默认组件包在 A，裸表没有
    expect(onlyA.getComponent('qte')?.events?.length).toBeGreaterThan(0)
    expect(new ComponentRegistry().getComponent('qte')).toBeUndefined()
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
