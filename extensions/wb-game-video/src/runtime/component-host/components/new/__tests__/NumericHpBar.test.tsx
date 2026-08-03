import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
        attrs: { hp: 75, attack: 20 },
        attrMax: { hp: 100, attack: 20 },
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

describe('numeric hp bar components', () => {
  it('declare entity binding and optional numeric overrides', () => {
    expect(BattlePlayerHpBarManifest.inputs?.map((input) => input.key)).toEqual([
      'bind',
      'attr',
      'label',
      'current',
      'max',
      'qi',
      'qiMax',
    ])
    expect(BattlePlayerHpBarManifest.inputs).toEqual(expect.arrayContaining([
      { key: 'bind', label: '绑定对象', valueType: 'string', default: 'ent-player', component: 'entity' },
      { key: 'attr', label: '绑定属性', valueType: 'string', default: 'hp', component: 'attr' },
      { key: 'label', label: '显示名', valueType: 'string', default: '我方', component: 'numberExpr' },
      { key: 'current', label: '当前血量', valueType: 'number', component: 'numberExpr' },
      { key: 'max', label: '最大血量', valueType: 'number', component: 'numberExpr' },
      { key: 'qi', label: '当前气力', valueType: 'number', component: 'numberExpr' },
      { key: 'qiMax', label: '气力上限', valueType: 'number', component: 'numberExpr', default: 5 },
    ]))
    expect(BattleEnemyHpBarManifest.inputs?.map((input) => input.key)).toEqual([
      'bind',
      'attr',
      'label',
      'current',
      'max',
    ])
    expect(BattleEnemyHpBarManifest.inputs).toEqual(expect.arrayContaining([
      { key: 'bind', label: '绑定对象', valueType: 'string', default: 'ent-boss', component: 'entity' },
      { key: 'attr', label: '绑定属性', valueType: 'string', default: 'hp', component: 'attr' },
      { key: 'label', label: '显示名', valueType: 'string', default: '敌方', component: 'numberExpr' },
      { key: 'current', label: '当前血量', valueType: 'number', component: 'numberExpr' },
      { key: 'max', label: '最大血量', valueType: 'number', component: 'numberExpr' },
    ]))
  })

  it('reads current, max, and qi from HUD state by default', () => {
    const player = render(
      <BattlePlayerHpBar
        overlay={{ elementId: 'player', component: 'BattlePlayerHpBar', inputs: {} }}
        ctx={ctx}
      />,
    )
    expect(fillWidth(player.container, '.ks-hud-hp-fill')).toBe('75%')
    expect(player.container.querySelector('.ks-hud-rage')?.getAttribute('aria-label')).toBe('气力 2/5')
    player.unmount()

    const enemy = render(
      <BattleEnemyHpBar
        overlay={{ elementId: 'enemy', component: 'BattleEnemyHpBar', inputs: {} }}
        ctx={ctx}
      />,
    )
    expect(fillWidth(enemy.container, '.ks-hud-boss-fill')).toBe('80%')
  })

  it('allows constants, state bindings, and formulas to override HUD values', () => {
    const { container } = render(
      <BattlePlayerHpBar
        overlay={{
          elementId: 'player-overrides',
          component: 'BattlePlayerHpBar',
          inputs: {
            current: 'entity.ent-player.attr.attack + var.qi',
            max: 44,
            qi: { expr: 'var.qi + 1' },
            qiMax: { expr: 'var.qi + 2' },
            label: { ref: 'entity.ent-player.name' },
          },
        }}
        ctx={ctx}
      />,
    )

    expect(fillWidth(container, '.ks-hud-hp-fill')).toBe('50%')
    expect(container.querySelector('.ks-hud-rage')?.getAttribute('aria-label')).toBe('气力 3/4')
    expect(container.querySelector('.ks-hud-hp-name')?.textContent).toBe('空藏')
  })
})
