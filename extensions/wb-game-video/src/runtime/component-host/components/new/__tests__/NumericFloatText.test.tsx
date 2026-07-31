import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRng } from '../../../../engine/rng'
import type { SkinCtx } from '../../../rendererRegistry'
import {
  DamageFloatTextOverlay,
  damageFloatTextComponent,
} from '../DamageFloatText'
import {
  GainFloatTextOverlay,
  gainFloatTextComponent,
} from '../GainFloatText'
import { resolveNumericFloatValue } from '../numericFloatText'

afterEach(cleanup)

const ctx: SkinCtx = {
  hud: {
    entities: {
      hero: {
        hp: 100,
        maxHp: 100,
        attrs: { hp: 100, attack: 20 },
        attrMax: { hp: 100, attack: 20 },
      },
    },
    vars: { bonus: 3 },
    flags: {},
    score: 0,
  },
}

describe('numeric float text components', () => {
  it('declare a shared constant-or-formula value input', () => {
    expect(damageFloatTextComponent.inputs).toEqual([
      { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: -25 },
    ])
    expect(gainFloatTextComponent.inputs).toEqual([
      { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: 50 },
    ])
  })

  it('render fixed numbers and evaluate formula values from SkinCtx', () => {
    render(
      <>
        <DamageFloatTextOverlay
          overlay={{ elementId: 'fixed-damage', component: 'damageFloatText', inputs: { value: -25 } }}
          ctx={ctx}
        />
        <GainFloatTextOverlay
          overlay={{ elementId: 'fixed-gain', component: 'gainFloatText', inputs: { value: 50 } }}
          ctx={ctx}
        />
        <DamageFloatTextOverlay
          overlay={{
            elementId: 'formula-damage',
            component: 'damageFloatText',
            inputs: { value: { expr: '-(entity.hero.attr.attack + var.bonus)' } },
          }}
          ctx={ctx}
        />
        <GainFloatTextOverlay
          overlay={{
            elementId: 'formula-gain',
            component: 'gainFloatText',
            inputs: { value: { expr: 'entity.hero.attr.attack / 2' } },
          }}
          ctx={ctx}
        />
      </>,
    )

    expect(screen.getByText('-25')).toBeTruthy()
    expect(screen.getByText('+50')).toBeTruthy()
    expect(screen.getByText('-23')).toBeTruthy()
    expect(screen.getByText('+10')).toBeTruthy()
  })

  it('keeps legacy text values readable when value is absent', () => {
    render(
      <DamageFloatTextOverlay
        overlay={{ elementId: 'legacy', component: 'damageFloatText', inputs: { text: '-9' } }}
        ctx={ctx}
      />,
    )

    expect(screen.getByText('-9')).toBeTruthy()
  })

  it('does not advance runtime RNG when a random formula is evaluated repeatedly', () => {
    const rng = createRng(0)
    const runtimeCtx: SkinCtx = {
      ...ctx,
      condition: {
        state: {
          vars: { bonus: 3 },
          entities: { hero: { attrs: { hp: 100, attack: 20 } } },
          flags: {},
          score: 0,
          rng,
        },
        visited: new Set(),
      },
    }
    const value = { expr: '-floor((entity.hero.attr.attack + var.bonus) * (0.85 + rand() * 0.3) * (1 + chance(1) * 0.5))' }
    const before = rng.getState()
    const first = resolveNumericFloatValue(value, runtimeCtx)
    const second = resolveNumericFloatValue(value, runtimeCtx)

    expect(second).toBe(first)
    expect(rng.getState()).toEqual(before)
  })
})
