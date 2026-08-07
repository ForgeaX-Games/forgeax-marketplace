// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BattleSkill, BattleSkillManifest } from '../BattleSkill'

afterEach(cleanup)

describe('BattleSkill', () => {
  it('declares resource gates and configurable keys', () => {
    expect(BattleSkillManifest.inputs).toEqual([
      { key: 'lightResource', label: '轻攻击资源', valueType: 'number', component: 'numberExpr' },
      { key: 'lightCost', label: '轻攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
      { key: 'heavyResource', label: '重攻击资源', valueType: 'number', component: 'numberExpr' },
      { key: 'heavyCost', label: '重攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 2 },
      { key: 'meditResource', label: '冥想资源', valueType: 'number', component: 'numberExpr' },
      { key: 'meditCost', label: '冥想资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
      { key: 'ultResource', label: '灭世资源', valueType: 'number', component: 'numberExpr' },
      { key: 'ultCost', label: '灭世资源消耗', valueType: 'number', component: 'numberExpr', default: 5 },
      { key: 'lightKey', label: '轻攻击按键', valueType: 'string', default: 'X' },
      { key: 'heavyKey', label: '重攻击按键', valueType: 'string', default: 'A' },
      { key: 'meditKey', label: '冥想按键', valueType: 'string', default: 'S' },
      { key: 'ultKey', label: '灭世按键', valueType: 'string', default: 'B' },
    ])
  })

  it('shows configured keys and emits their matching skill event', () => {
    const emit = vi.fn()
    render(
      <BattleSkill emit={emit} heavyResource={2} lightKey="Q" heavyKey="E" meditKey="R" ultKey="T" />,
    )

    fireEvent.keyDown(window, { key: 'e' })

    expect(screen.getByRole('button', { name: '轻攻击 Q' })).toHaveTextContent('Q')
    expect(screen.getByRole('button', { name: '重攻击 E' })).toHaveTextContent('E')
    expect(emit).toHaveBeenCalledWith('heavy')
  })

  it('locks every skill until its resource meets its configured cost', () => {
    const emit = vi.fn()
    render(
      <BattleSkill
        emit={emit}
        lightResource={1}
        lightCost={2}
        heavyResource={1}
        heavyCost={3}
        meditResource={1}
        meditCost={4}
        ultResource={1}
        ultCost={5}
      />,
    )

    const light = screen.getByRole('button', { name: '轻攻击 X' })
    const heavy = screen.getByRole('button', { name: '重攻击 A' })
    const medit = screen.getByRole('button', { name: '冥想 S' })
    const ult = screen.getByRole('button', { name: '灭世 B' })
    expect(light).toBeDisabled()
    expect(heavy).toBeDisabled()
    expect(medit).toBeDisabled()
    expect(ult).toBeDisabled()

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 's' })
    fireEvent.keyDown(window, { key: 'b' })
    expect(emit).not.toHaveBeenCalled()
  })
})
