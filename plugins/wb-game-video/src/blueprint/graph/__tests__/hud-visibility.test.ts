import { describe, expect, it } from 'vitest'
import { hiddenHudKeys } from '../hud-visibility'
import type { NodeHud } from '../graph-schema'

describe('hiddenHudKeys', () => {
  const ui = [
    { element: 'ent-player', show: 'always' },
    { element: 'ent-boss', show: 'battle' },
    { element: 'timer', show: 'qte' },
    { element: 'secret', show: 'never' },
  ]

  it('always → visible; never → hidden', () => {
    const h = hiddenHudKeys(ui, undefined, { phase: 'playing' })
    expect(h.has('ent-player')).toBe(false)
    expect(h.has('secret')).toBe(true)
  })

  it('battle hidden only when ended', () => {
    expect(hiddenHudKeys(ui, undefined, { phase: 'playing' }).has('ent-boss')).toBe(false)
    expect(hiddenHudKeys(ui, undefined, { phase: 'ended' }).has('ent-boss')).toBe(true)
  })

  it('qte visible only during a qte interaction', () => {
    expect(hiddenHudKeys(ui, undefined, { phase: 'awaitInteraction' }).has('timer')).toBe(true)
    expect(hiddenHudKeys(ui, undefined, { phase: 'awaitInteraction', interactionKind: 'qte' }).has('timer')).toBe(false)
  })

  it('node-level hud overrides: visible:false hides, visible:true un-hides', () => {
    const nodeHud: NodeHud = { elements: [{ element: 'ent-player', visible: false }, { element: 'secret', visible: true }] }
    const h = hiddenHudKeys(ui, nodeHud, { phase: 'playing' })
    expect(h.has('ent-player')).toBe(true) // 节点级隐藏
    expect(h.has('secret')).toBe(false) // 节点级取消全局 never
  })

  it('tolerant: unmatched/absent config hides nothing', () => {
    expect(hiddenHudKeys(undefined, undefined, { phase: 'playing' }).size).toBe(0)
    expect(hiddenHudKeys([], undefined, { phase: 'ended' }).size).toBe(0)
  })
})
