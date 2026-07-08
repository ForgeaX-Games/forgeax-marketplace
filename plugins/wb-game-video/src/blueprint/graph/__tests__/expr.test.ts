import { describe, expect, it } from 'vitest'
import { evalExpr, parseExpr, collectRefs } from '../expr'
import { createRng } from '../rng'

const ctx = () => ({
  vars: { qi: 3, lizhi: 5 },
  entities: {
    'ent-player': { attrs: { attack: 80, defense: 40, hp: 300 } },
    'ent-boss': { attrs: { attack: 75, defense: 50, hp: 700 } },
  },
  flags: { lotusClue: 1 },
  score: 120,
  rng: createRng(1),
})

describe('evalExpr', () => {
  it('arithmetic + refs (damage formula)', () => {
    expect(
      evalExpr('entity.ent-player.attr.attack * 2 - entity.ent-boss.attr.defense', ctx()),
    ).toBe(110)
    expect(evalExpr('var.qi + 1', ctx())).toBe(4)
    expect(evalExpr('score / 2', ctx())).toBe(60)
    expect(evalExpr('entity.ent-boss.attr.hp', ctx())).toBe(700)
  })

  it('precedence and parentheses', () => {
    expect(evalExpr('2 + 3 * 4', ctx())).toBe(14)
    expect(evalExpr('(2 + 3) * 4', ctx())).toBe(20)
    expect(evalExpr('-var.qi + 10', ctx())).toBe(7)
  })

  it('comparisons & logic return 1/0', () => {
    expect(evalExpr('var.qi >= 3 && flag.lotusClue == 1', ctx())).toBe(1)
    expect(evalExpr('entity.ent-boss.attr.hp <= 0', ctx())).toBe(0)
    expect(evalExpr('var.qi < 3 || score > 100', ctx())).toBe(1)
    expect(evalExpr('var.qi != 3', ctx())).toBe(0)
  })

  it('rng functions reproducible via ctx.rng seed', () => {
    expect(evalExpr('randInt(1,6)', ctx())).toBe(evalExpr('randInt(1,6)', ctx()))
    const c = ctx()
    const v = evalExpr('chance(1)', c)
    expect(v).toBe(1)
  })

  it('unknown symbol throws', () => {
    expect(() => evalExpr('var.nope + 1', ctx())).toThrow()
    expect(() => evalExpr('entity.ghost.hp', ctx())).toThrow()
  })

  it('parse error throws', () => {
    expect(() => parseExpr('2 +')).toThrow()
    expect(() => parseExpr('(2 + 3')).toThrow()
  })

  it('collectRefs lists referenced symbols (for validator)', () => {
    const refs = collectRefs('var.qi + entity.ent-boss.attr.defense - score')
    expect(refs.vars).toContain('qi')
    expect(refs.entities).toContain('ent-boss')
    expect(refs.usesScore).toBe(true)
  })
})
