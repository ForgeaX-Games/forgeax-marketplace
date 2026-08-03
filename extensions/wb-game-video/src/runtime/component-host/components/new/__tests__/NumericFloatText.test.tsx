// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRng } from '../../../../engine/rng'
import { resolveComponentInputs } from '../../../resolveComponentInputs'
import type { SkinCtx } from '../../../rendererRegistry'
import { createCoreSkinRegistry } from '../../index'
import {
  DamageFloatText,
  DamageFloatTextManifest,
} from '../DamageFloatText'
import {
  GainFloatText,
  GainFloatTextManifest,
} from '../GainFloatText'

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

function renderViaHost(component: string, inputs: Record<string, unknown>, skinCtx: SkinCtx = ctx) {
  const skins = createCoreSkinRegistry()
  return render(
    <>
      {skins.renderOverlay(
        { elementId: component, component, inputs },
        undefined,
        undefined,
        skinCtx,
      )}
    </>,
  )
}

describe('numeric float text components', () => {
  it('declare fixed text and a dynamic parameter input', () => {
    expect(DamageFloatTextManifest.inputs).toEqual([
      { key: 'fixedText', label: '固定文本', valueType: 'string', default: '' },
      { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#ff5a5a' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
      { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
    ])
    expect(GainFloatTextManifest.inputs).toEqual([
      { key: 'fixedText', label: '固定文本', valueType: 'string', default: '' },
      { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#ffd54a' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
      { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
    ])
  })

  it('Host resolves parameter; leaf concatenates fixed text', () => {
    renderViaHost('DamageFloatText', { fixedText: '伤害 ', parameter: -25 })
    renderViaHost('GainFloatText', { fixedText: '获得 ', parameter: '青铜钥匙' })
    renderViaHost('GainFloatText', { fixedText: '获得 ', parameter: { ref: 'var.bonus' } })
    renderViaHost('DamageFloatText', { parameter: { expr: '-(entity.hero.attr.attack + var.bonus)' } })
    renderViaHost('GainFloatText', { parameter: { expr: 'entity.hero.attr.attack / 2' } })

    expect(screen.getByText('伤害 -25')).toBeTruthy()
    expect(screen.getByText('获得 青铜钥匙')).toBeTruthy()
    expect(screen.getByText('获得 +3')).toBeTruthy()
    expect(screen.getByText('-23')).toBeTruthy()
    expect(screen.getByText('-10')).toBeTruthy()
  })

  it('uses each skin default appearance and accepts its optional text overrides', () => {
    const { rerender } = render(<DamageFloatText parameter="-25" />)
    expect(screen.getByText('-25')).toHaveStyle({ color: '#ff5a5a', '--gv-text-font-size': '3.5cqh' })

    rerender(<GainFloatText parameter="+50" color="#123456" fontSize={4} />)
    expect(screen.getByText('+50')).toHaveStyle({ color: '#123456', '--gv-text-font-size': '4cqh' })
  })

  it('scales the entire float animation from its total duration input', () => {
    render(<DamageFloatText parameter="-25" durationMs={2400} />)
    expect(screen.getByText('-25').parentElement).toHaveStyle({ '--gv-animation-duration': '2400ms' })
    expect(resolveComponentInputs(DamageFloatTextManifest, {}, ctx).durationMs).toBe(1100)
    expect(resolveComponentInputs(DamageFloatTextManifest, { durationMs: 0 }, ctx).durationMs).toBe(1100)
  })

  it('Host applies parameter fallback when it is absent', () => {
    renderViaHost('DamageFloatText', {})
    expect(screen.getByText('-25')).toBeTruthy()
  })

  it('keeps an explicitly empty parameter empty', () => {
    expect(resolveComponentInputs(DamageFloatTextManifest, { parameter: '' }, ctx).parameter).toBe('')
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
    const first = resolveComponentInputs(DamageFloatTextManifest, { parameter: value }, runtimeCtx).parameter
    const second = resolveComponentInputs(DamageFloatTextManifest, { parameter: value }, runtimeCtx).parameter

    expect(second).toBe(first)
    expect(rng.getState()).toEqual(before)
  })
})
