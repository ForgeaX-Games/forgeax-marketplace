// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createCoreSkinRegistry } from '../../index'
import type { SkinCtx } from '../../../rendererRegistry'
import { BattleEnemyHpBar, BattleEnemyHpBarManifest } from '../BattleEnemyHpBar'
import { BattlePlayerHpBar, BattlePlayerHpBarManifest } from '../BattlePlayerHpBar'

afterEach(cleanup)

const ctx: SkinCtx = {
  hud: {
    entities: {
      'ent-player': {
        name: '空藏',
        hp: 75,
        maxHp: 100,
        attrs: { hp: 75, hpMax: 150, attack: 20 },
        attrMax: { hp: 100, hpMax: 150, attack: 20 },
      },
      'ent-boss': {
        name: '小怪',
        hp: 240,
        maxHp: 300,
        attrs: { hp: 240, defense: 10 },
        attrMax: { hp: 300, defense: 10 },
      },
    },
    vars: { qi: 2 },
    flags: {},
    score: 0,
  },
}

function fillWidth(container: HTMLElement, selector: string): string {
  return (container.querySelector(selector) as HTMLElement).style.width
}

function renderViaHost(component: string, inputs: Record<string, unknown>) {
  const skins = createCoreSkinRegistry()
  return render(
    <>
      {skins.renderOverlay(
        { elementId: component, component, inputs },
        undefined,
        undefined,
        ctx,
      )}
    </>,
  )
}

describe('numeric hp bar components', () => {
  it('declare only the component-specific authoring fields', () => {
    expect(BattlePlayerHpBarManifest.inputs?.map((input) => input.key)).toEqual([
      'label',
      'current',
      'max',
      'qi',
      'qiMax',
    ])
    expect(BattleEnemyHpBarManifest.inputs?.map((input) => input.key)).toEqual([
      'label',
      'current',
      'max',
    ])
    expect(BattleEnemyHpBarManifest.inputs?.filter((input) => input.required).map((input) => input.key)).toEqual([
      'current',
      'max',
    ])
  })

  it('allows constants, state bindings, and formulas via Host', () => {
    const { container } = renderViaHost('BattlePlayerHpBar', {
      current: 'entity.ent-player.attr.attack + var.qi',
      max: 44,
      qi: { expr: 'var.qi + 1' },
      qiMax: { expr: 'var.qi + 2' },
      label: { ref: 'entity.ent-player.name' },
    })

    expect(fillWidth(container, '.ks-hud-hp-fill')).toBe('50%')
    expect(container.querySelector('.ks-hud-rage')?.getAttribute('aria-label')).toBe('气力 3/4')
    expect(container.querySelector('.ks-hud-hp-name')?.textContent).toBe('空藏')
  })

  it('resolves current and max from independently selected entity properties', () => {
    const { container } = renderViaHost('BattlePlayerHpBar', {
      current: { expr: 'entity.ent-player.attr.hp' },
      max: { expr: 'entity.ent-player.attr.hpMax' },
    })

    expect(fillWidth(container, '.ks-hud-hp-fill')).toBe('50%')
  })

  it('leaf reads already-resolved flat props', () => {
    const { container } = render(
      <BattleEnemyHpBar current={45} max={90} label="悟空" />,
    )
    expect(fillWidth(container, '.ks-hud-boss-fill')).toBe('50%')
    expect(container.querySelector('.ks-hud-boss-name')?.textContent).toBe('悟空')
  })
})
