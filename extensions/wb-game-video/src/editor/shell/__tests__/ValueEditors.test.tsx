// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Entity, Variable } from '../../../runtime/schema/graph-schema'
import type { Formula } from '../../persist/formula-authoring'
import { TextValueEditor } from '../TextValueEditor'
import { ValueExprEditor } from '../ValueExprEditor'

afterEach(cleanup)

const entities: Record<string, Entity> = {
  hero: {
    id: 'hero',
    name: '主角',
    attrs: { hp: 100 },
    attrMeta: { hp: { label: '生命值' } },
  },
}

const variables: Record<string, Variable> = {
  rage: { id: 'rage', name: '怒气', initial: 0 },
}

const formulas: Record<string, Formula> = {
  damage: {
    id: 'damage',
    name: '伤害公式',
    ast: { t: 'num', id: 'n0', v: 10 },
  },
}

describe('numberExpr dropdown labels', () => {
  it('shows concise entity names and entity attributes for text values', () => {
    const onChange = vi.fn()
    render(
      <TextValueEditor
        value={{ ref: 'entity.hero.name' }}
        entities={entities}
        variables={variables}
        onChange={onChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: '文本内容' })
    expect(within(select).getByRole('option', { name: '主角' })).toBeTruthy()
    const attrOption = within(select).getByRole('option', { name: '主角的生命值' }) as HTMLOptionElement
    expect(within(select).getByRole('option', { name: '怒气' })).toBeTruthy()
    expect(select.textContent).not.toContain('（hero）')
    expect(select.textContent).not.toContain('/ 名称')

    fireEvent.change(select, { target: { value: attrOption.value } })
    expect(onChange).toHaveBeenCalledWith({ ref: 'entity.hero.attr.hp' })
  })

  it('shows concise attributes, variables, and formulas without changing expression ids', () => {
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={variables}
        formulas={formulas}
        onChange={onChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: '数值内容' })
    const attrOption = within(select).getByRole('option', { name: '主角的生命值' }) as HTMLOptionElement
    expect(within(select).getByRole('option', { name: '怒气' })).toBeTruthy()
    expect(within(select).getByRole('option', { name: '伤害公式' })).toBeTruthy()
    expect(select.textContent).not.toContain('（hero）')
    expect(select.textContent).not.toContain('（hp）')

    fireEvent.change(select, { target: { value: attrOption.value } })
    expect(onChange).toHaveBeenCalledWith({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: 'hero', attr: 'hp' }],
      },
    })
  })
})
