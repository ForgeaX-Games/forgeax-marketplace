// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BattleSkill, BattleSkillManifest } from '../BattleSkill'

afterEach(cleanup)

describe('BattleSkill', () => {
  it('declares resource gates and configurable keys', () => {
    expect(BattleSkillManifest.inputs).toEqual([
      { key: 'qi', label: '当前气力', valueType: 'number', component: 'numberExpr' },
      { key: 'heavyCost', label: '重攻击气力消耗', valueType: 'number', component: 'numberExpr', default: 2 },
      { key: 'ultCost', label: '灭世气力消耗', valueType: 'number', component: 'numberExpr', default: 5 },
      { key: 'lightKey', label: '轻攻击按键', valueType: 'string', default: 'X' },
      { key: 'heavyKey', label: '重攻击按键', valueType: 'string', default: 'A' },
      { key: 'meditKey', label: '冥想按键', valueType: 'string', default: 'S' },
      { key: 'ultKey', label: '灭世按键', valueType: 'string', default: 'B' },
    ])
  })

  it('shows configured keys and emits their matching skill event', () => {
    const emit = vi.fn()
    render(
      <BattleSkill emit={emit} qi={2} lightKey="Q" heavyKey="E" meditKey="R" ultKey="T" />,
    )

    fireEvent.keyDown(window, { key: 'e' })

    expect(screen.getByRole('button', { name: '轻攻击 Q' })).toHaveTextContent('Q')
    expect(screen.getByRole('button', { name: '重攻击 E' })).toHaveTextContent('E')
    expect(emit).toHaveBeenCalledWith('heavy')
  })

  it('locks costly skills until qi meets their configured costs', () => {
    const emit = vi.fn()
    render(<BattleSkill emit={emit} qi={1} heavyCost={2} ultCost={5} />)

    const heavy = screen.getByRole('button', { name: '重攻击 A' })
    const ult = screen.getByRole('button', { name: '灭世 B' })
    expect(heavy).toBeDisabled()
    expect(ult).toBeDisabled()

    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'b' })
    expect(emit).not.toHaveBeenCalled()
  })
})
