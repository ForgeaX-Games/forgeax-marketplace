import { describe, expect, it } from 'vitest'
import { applyOverlaySettlement, dueOverlaySettlements } from '../performanceRuntime'
import { initEntities } from '../entities'
import { initVarState } from '../conditionEval'
import type { OverlayClip, Scenario } from '../../scenario/types'

const scenario: Scenario = {
  id: 't',
  title: 't',
  rootSceneId: 's1',
  defaultCharMs: 32,
  schemaVersion: 13,
  scenes: { s1: { id: 's1', title: '', media: { kind: 'VIDEO', ref: 'v' }, durationMs: 5000, dialogue: [], branches: [] } },
  entities: {
    'ent-player': { id: 'ent-player', name: 'P', kind: 'player', maxHp: 100, initialHp: 100 },
    'ent-boss': { id: 'ent-boss', name: 'B', kind: 'boss', maxHp: 300, initialHp: 300 },
  },
  variables: { fav: { id: 'fav', name: '好感', kind: 'number', initial: 0 } },
}

const hp = (id: string, entityId: string, value: number) => ({
  id,
  kind: 'entityStat' as const,
  entityId,
  stat: 'hp' as const,
  op: 'add' as const,
  value: -value,
})

const stores = () => ({ vars: initVarState(scenario), items: {}, entities: initEntities(scenario) })

describe('overlaySettlement', () => {
  it('dueOverlaySettlements filters by startMs, dedupes, ignores no-settlement overlays', () => {
    const overlays: OverlayClip[] = [
      { id: 'a', kind: 'text', content: '', startMs: 1000, x: 0.5, y: 0.5, settlement: { effects: [hp('a-hp', 'ent-boss', 10)] } },
      { id: 'b', kind: 'text', content: '', startMs: 2000, x: 0.5, y: 0.5, settlement: { effects: [hp('b-hp', 'ent-boss', 20)] } },
      { id: 'c', kind: 'text', content: 'hi', startMs: 0, x: 0.5, y: 0.5 },
    ]
    expect(dueOverlaySettlements(overlays, 500, new Set())).toEqual([])
    expect(dueOverlaySettlements(overlays, 1500, new Set()).map((o) => o.id)).toEqual(['a'])
    expect(dueOverlaySettlements(overlays, 2500, new Set(['a'])).map((o) => o.id)).toEqual(['b'])
  })

  it('applyOverlaySettlement damages boss and player (hp effects)', () => {
    const r = applyOverlaySettlement(
      { effects: [hp('x-boss', 'ent-boss', 40), hp('x-player', 'ent-player', 15)] },
      scenario,
      stores(),
    )
    expect(r.stores.entities['ent-boss']!.hp).toBe(260)
    expect(r.stores.entities['ent-player']!.hp).toBe(85)
  })

  it('applyOverlaySettlement also applies var effects (converge: full effect types)', () => {
    const r = applyOverlaySettlement(
      { effects: [{ id: 'v', kind: 'var', varId: 'fav', op: 'add', value: 5 }] },
      scenario,
      stores(),
    )
    expect(r.stores.vars.fav).toBe(5)
  })
})
