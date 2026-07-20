import { describe, expect, it } from 'vitest'
import type { Entity, Variable } from '../../../runtime/schema/graph-schema'
import {
  compileValuePick,
  emptyPickTerm,
  listAttrOptions,
  listEntityOptions,
  normalizeTerms,
  resolveValuePick,
} from '../valueExprPick'

const entities: Record<string, Entity> = {
  'ent-player': {
    id: 'ent-player',
    name: '玩家',
    kind: 'player',
    attrs: { attack: 40, defense: 10 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' }, hp: { label: '生命' } },
  },
  'ent-boss': {
    id: 'ent-boss',
    name: 'Boss',
    kind: 'boss',
    attrs: { attack: 55, defense: 20 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
}
const variables: Record<string, Variable> = {
  qi: { id: 'qi', name: '气力', initial: 0 },
}

describe('valueExprPick', () => {
  it('lists entities and attrs from project meta', () => {
    expect(listEntityOptions(entities).map((e) => e.id)).toEqual(['ent-player', 'ent-boss'])
    expect(listAttrOptions(entities['ent-player']).map((a) => a.id).sort()).toEqual([
      'attack',
      'defense',
      'hp',
    ])
  })

  it('compiles add/sub chain', () => {
    const pick = {
      mode: 'pick' as const,
      terms: [
        { op: '-' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '+' as const, source: 'entity' as const, refId: 'ent-boss', attr: 'defense' },
      ],
    }
    expect(compileValuePick(pick)).toMatchObject({
      expr: '(-entity.ent-player.attr.attack+entity.ent-boss.attr.defense)',
    })
  })

  it('compiles attr * attr', () => {
    const pick = {
      mode: 'pick' as const,
      terms: [
        { op: '+' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '*' as const, source: 'entity' as const, refId: 'ent-boss', attr: 'defense' },
      ],
    }
    expect(compileValuePick(pick)).toMatchObject({
      expr: '(entity.ent-player.attr.attack*entity.ent-boss.attr.defense)',
    })
  })

  it('compiles division and const factor', () => {
    expect(
      compileValuePick({
        mode: 'pick',
        terms: [
          { op: '+', source: 'var', refId: 'qi' },
          { op: '/', source: 'const', refId: '', constValue: 2 },
        ],
      }),
    ).toMatchObject({ expr: '(var.qi/2)' })
  })

  it('normalizes: first term to ±, clears cross-source fields', () => {
    expect(
      normalizeTerms([
        { op: '*', source: 'var', refId: 'qi' },
        { op: '-', source: 'const', refId: 'stray', constValue: 2 },
      ]),
    ).toEqual([
      { op: '+', source: 'var', refId: 'qi', attr: undefined, constValue: undefined },
      { op: '-', source: 'const', refId: '', attr: undefined, constValue: 2 },
    ])
  })

  it('compiles const mode', () => {
    expect(compileValuePick({ mode: 'const', const: 100 })).toBe(100)
    expect(compileValuePick({ mode: 'const', const: -30 })).toBe(-30)
  })

  it('resolve 常量保留负号（结算扣血可直接填 -10）', () => {
    expect(resolveValuePick(-10, entities, variables)).toEqual({ mode: 'const', const: -10 })
    expect(resolveValuePick(0, entities, variables)).toEqual({ mode: 'const', const: 0 })
  })

  it('resolve prefers stored sidecar pick', () => {
    const pick = resolveValuePick(
      { expr: 'old' },
      entities,
      variables,
      { mode: 'pick', terms: [{ op: '+', source: 'entity', refId: 'ent-player', attr: 'attack' }] },
    )
    expect(pick.mode).toBe('pick')
    if (pick.mode === 'pick') expect(pick.terms[0]?.attr).toBe('attack')
  })

  it('round-trips compile → resolve via embedded pick', () => {
    const source = {
      mode: 'pick' as const,
      terms: [
        { op: '-' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '*' as const, source: 'const' as const, refId: '', constValue: 2 },
      ],
    }
    const compiled = compileValuePick(source)
    const back = resolveValuePick(compiled, entities, variables)
    expect(back).toEqual(source)
  })

  it('emptyPickTerm seeds from catalog', () => {
    const t = emptyPickTerm(entities, variables)
    expect(t.source).toBe('entity')
    expect(t.refId).toBe('ent-player')
    expect(t.attr).toBeTruthy()
  })
})
