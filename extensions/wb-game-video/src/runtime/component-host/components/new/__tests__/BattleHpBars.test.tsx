// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createCoreSkinRegistry } from '../../index'
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
        },
        'ent-boss': {
          hp: bossHp,
          maxHp: 700,
          attrs: { hp: bossHp },
          attrMax: { hp: 700 },
        },
      },
      vars: { qi: 2 },
      flags: {},
      score: 0,
    },
  }
}

describe('ink health bars via RuntimeComponentHost', () => {
  it('Host resolves formulas into flat player props', () => {
    const skins = createCoreSkinRegistry()
    const { container } = render(
      <>
        {skins.renderOverlay(
          {
            elementId: 'player-hp',
            component: 'BattlePlayerHpBar',
            inputs: {
              current: { expr: 'entity.ent-player.attr.hp' },
              max: 300,
              qi: { expr: 'var.qi' },
            },
          },
          undefined,
          undefined,
          ctx(60, 700),
        )}
      </>,
    )

    expect((container.querySelector('.ks-hud-hp-fill') as HTMLElement).style.width).toBe('20%')
    expect(container.querySelector('[aria-label="气力 2/5"]')).not.toBeNull()
  })

  it('updates enemy fill when the formula context changes', () => {
    const skins = createCoreSkinRegistry()
    const overlay = {
      elementId: 'enemy-hp',
      component: 'BattleEnemyHpBar',
      inputs: { current: { expr: 'entity.ent-boss.attr.hp' }, max: 700 },
    }
    const view = render(<>{skins.renderOverlay(overlay, undefined, undefined, ctx(300, 700))}</>)
    expect((view.container.querySelector('.ks-hud-boss-fill') as HTMLElement).style.width).toBe('100%')

    view.rerender(<>{skins.renderOverlay(overlay, undefined, undefined, ctx(300, 350))}</>)
    expect((view.container.querySelector('.ks-hud-boss-fill') as HTMLElement).style.width).toBe('50%')
  })

  it('leaf shrinks when flat current prop decreases', () => {
    const view = render(<BattleEnemyHpBar current={700} max={700} label="小怪" />)
    expect((view.container.querySelector('.ks-hud-boss-fill') as HTMLElement).style.width).toBe('100%')

    view.rerender(<BattleEnemyHpBar current={350} max={700} label="小怪" />)
    expect((view.container.querySelector('.ks-hud-boss-fill') as HTMLElement).style.width).toBe('50%')
  })

  it('player leaf renders from flat props without ctx', () => {
    const { container } = render(<BattlePlayerHpBar current={20} max={100} qi={2} qiMax={5} />)
    expect((container.querySelector('.ks-hud-hp-fill') as HTMLElement).style.width).toBe('20%')
    expect(container.querySelector('[aria-label="气力 2/5"]')).not.toBeNull()
  })
})
