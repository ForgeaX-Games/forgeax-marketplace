import { describe, expect, it } from 'vitest'
import { createRng } from '../../../engine/rng'
import type { SkinCtx } from '../../rendererRegistry'
import { resolveNumericValue, resolveTextValue } from '../numericValue'

const ctx: SkinCtx = {
  hud: {
    entities: {
      hero: {
        name: '主角',
        hp: 80,
        maxHp: 100,
        attrs: { hp: 80, attack: 20 },
        attrMax: { hp: 100, attack: 20 },
      },
    },
    vars: { qi: 3 },
    flags: {},
    score: 5,
  },
}

describe('resolveNumericValue', () => {
  it('accepts constants, string expressions, and expression objects', () => {
    expect(resolveNumericValue(12, ctx)).toBe(12)
    expect(resolveNumericValue('entity.hero.attr.attack + var.qi', ctx)).toBe(23)
    expect(resolveNumericValue({ expr: 'score * 2' }, ctx)).toBe(10)
    expect(resolveNumericValue('bad(', ctx)).toBeUndefined()
  })

  it('resolves literal text, state references, and numeric formulas as display text', () => {
    expect(resolveTextValue('我方', ctx)).toBe('我方')
    expect(resolveTextValue({ ref: 'entity.hero.name' }, ctx)).toBe('主角')
    expect(resolveTextValue({ ref: 'entity.hero.attr.hp' }, ctx)).toBe('80')
    expect(resolveTextValue({ ref: 'var.qi' }, ctx)).toBe('3')
    expect(resolveTextValue({ expr: 'entity.hero.attr.attack + var.qi' }, ctx)).toBe('23')
  })

  it('clones runtime RNG before evaluating render-time formulas', () => {
    const rng = createRng(7, 3)
    const runtimeCtx: SkinCtx = {
      ...ctx,
      condition: {
        state: {
          vars: ctx.hud.vars,
          entities: { hero: { attrs: ctx.hud.entities.hero!.attrs } },
          flags: {},
          score: 5,
          rng,
        },
        visited: new Set(),
      },
    }
    const before = rng.getState()
    const first = resolveNumericValue('randInt(1, 100)', runtimeCtx)
    const second = resolveNumericValue({ expr: 'randInt(1, 100)' }, runtimeCtx)

    expect(second).toBe(first)
    expect(rng.getState()).toEqual(before)
  })
})
