import { describe, expect, it } from 'vitest'
import { initState } from '../engine-init'
import { createRng } from '../rng'
import type { GameScenario } from '../graph-schema'

const scn = (): GameScenario => ({
  schemaVersion: 'test',
  variables: {
    qi: { id: 'qi', name: '气力', kind: 'number', initial: 1, min: 0, max: 5 },
    lotusClue: { id: 'lotusClue', name: '线索', kind: 'flag', initial: 0 },
  },
  entities: {
    'ent-player': { id: 'ent-player', kind: 'player', attrs: { speed: 30, hp: 300 }, attrMeta: { hp: { max: 300, initial: 300 } } },
    'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { attack: 75 }, attrMeta: { hp: { max: 700, initial: 700 } } },
  },
  rng: { seed: 5 },
  graph: { nodes: [], edges: [] },
})

describe('initState', () => {
  it('seeds vars, varMeta, flags, entities(attrs), rng', () => {
    const st = initState(scn())
    expect(st.vars.qi).toBe(1)
    expect(st.varMeta?.qi).toEqual({ min: 0, max: 5 })
    expect(st.flags.lotusClue).toBe(0)
    expect(st.entities['ent-player']!.attrs.hp).toBe(300)
    expect(st.entities['ent-player']!.attrs.speed).toBe(30)
    expect(st.entities['ent-player']!.attrMeta?.hp?.max).toBe(300)
    // ent-boss 未给 attrs.hp，但 attrMeta.hp.initial=700 → 补上初值
    expect(st.entities['ent-boss']!.attrs.hp).toBe(700)
    expect(st.entities['ent-boss']!.attrs.attack).toBe(75)
    expect(st.score).toBe(0)
  })

  it('rng seeded from scenario.rng.seed (reproducible)', () => {
    const st = initState(scn())
    expect(st.rng!.next()).toBe(createRng(5).next())
  })

  it('defaults seed 0 when rng absent', () => {
    const s = scn()
    delete s.rng
    const st = initState(s)
    expect(st.rng!.next()).toBe(createRng(0).next())
  })
})
