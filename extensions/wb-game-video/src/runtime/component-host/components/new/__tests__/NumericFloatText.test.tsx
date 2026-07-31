import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRng } from '../../../../engine/rng'
import type { SkinCtx } from '../../../rendererRegistry'
import {
  DamageFloatText,
  DamageFloatTextManifest,
} from '../DamageFloatText'
import {
  GainFloatText,
  GainFloatTextManifest,
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
    expect(DamageFloatTextManifest.inputs).toEqual([
      { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: -25 },
      { key: 'color', label: '字色', valueType: 'string', component: 'color' },
      { key: 'fontSize', label: '字号', valueType: 'number' },
    ])
    expect(GainFloatTextManifest.inputs).toEqual([
      { key: 'value', label: '数值', valueType: 'number', component: 'numberExpr', default: 50 },
      { key: 'color', label: '字色', valueType: 'string', component: 'color' },
      { key: 'fontSize', label: '字号', valueType: 'number' },
    ])
  })

  it('render fixed numbers and evaluate formula values from SkinCtx', () => {
    render(
      <>
        <DamageFloatText
          overlay={{ elementId: 'fixed-damage', component: 'DamageFloatText', inputs: { value: -25 } }}
          ctx={ctx}
        />
        <GainFloatText
          overlay={{ elementId: 'fixed-gain', component: 'GainFloatText', inputs: { value: 50 } }}
          ctx={ctx}
        />
        <DamageFloatText
          overlay={{
            elementId: 'formula-damage',
            component: 'DamageFloatText',
            inputs: { value: { expr: '-(entity.hero.attr.attack + var.bonus)' } },
          }}
          ctx={ctx}
        />
        <GainFloatText
          overlay={{
            elementId: 'formula-gain',
            component: 'GainFloatText',
            inputs: { value: { expr: 'entity.hero.attr.attack / 2' } },
          }}
          ctx={ctx}
        />
        <GainFloatText
          overlay={{
            elementId: 'legacy-string-expression',
            component: 'GainFloatText',
            inputs: { value: 'entity.hero.attr.attack + var.bonus + 1' },
          }}
          ctx={ctx}
        />
      </>,
    )

    expect(screen.getByText('-25')).toBeTruthy()
    expect(screen.getByText('+50')).toBeTruthy()
    expect(screen.getByText('-23')).toBeTruthy()
    expect(screen.getByText('+10')).toBeTruthy()
    expect(screen.getByText('+24')).toBeTruthy()
  })

  it('uses each skin default appearance and accepts its optional text overrides', () => {
    const { rerender } = render(
      <DamageFloatText overlay={{ elementId: 'damage', component: 'DamageFloatText', inputs: { value: -25 } }} />,
    )
    expect(screen.getByText('-25')).toHaveStyle({ color: '#ff5a5a', '--gv-text-font-size': '3.5cqh' })

    rerender(
      <GainFloatText
        overlay={{ elementId: 'gain', component: 'GainFloatText', inputs: { value: 50, color: '#123456', fontSize: 4 } }}
      />,
    )
    expect(screen.getByText('+50')).toHaveStyle({ color: '#123456', '--gv-text-font-size': '4cqh' })
  })

  it('keeps legacy text values readable when value is absent', () => {
    render(
      <DamageFloatText
        overlay={{ elementId: 'legacy', component: 'DamageFloatText', inputs: { text: '-9' } }}
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
