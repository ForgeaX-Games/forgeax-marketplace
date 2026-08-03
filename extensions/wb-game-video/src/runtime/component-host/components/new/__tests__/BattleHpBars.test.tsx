// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkinCtx } from '../../../rendererRegistry'
import { BattleEnemyHpBar } from '../BattleEnemyHpBar'
import { BattlePlayerHpBar } from '../BattlePlayerHpBar'

afterEach(cleanup)

function ctx(playerHp: number, bossHp: number): SkinCtx {
  return {
    hud: {
      entities: {
        'ent-player': {
          hp: playerHp,
          maxHp: 300,
          attrs: { hp: playerHp },
          attrMax: { hp: 300 },
          initialAttrs: { hp: 300 },
        },
        'ent-boss': {
          hp: bossHp,
          maxHp: 700,
          attrs: { hp: bossHp },
          attrMax: { hp: 700 },
          initialAttrs: { hp: 700 },
        },
      },
      vars: { qi: 2 },
      flags: {},
      score: 0,
    },
  }
}

describe('bound ink health bars', () => {
  it('projects the player entity delta onto the authored 100-point display baseline', () => {
    const { container } = render(BattlePlayerHpBar({
      overlay: {
        elementId: 'player-hp',
        component: 'BattlePlayerHpBar',
        inputs: { current: 100, max: 100 },
      },
      ctx: ctx(220, 700),
    }))

    expect((container.querySelector('.ks-hud-hp-fill') as HTMLElement).style.width).toBe('20%')
    expect(container.querySelector('[aria-label="气力 2/5"]')).not.toBeNull()
  })

  it('uses the enemy binding and follows its entity delta', () => {
    const { container } = render(BattleEnemyHpBar({
      overlay: {
        elementId: 'enemy-hp',
        component: 'BattleEnemyHpBar',
        inputs: { current: 100, max: 100 },
      },
      ctx: ctx(300, 630),
    }))

    expect((container.querySelector('.ks-hud-boss-fill') as HTMLElement).style.width).toBe('30%')
  })
})
