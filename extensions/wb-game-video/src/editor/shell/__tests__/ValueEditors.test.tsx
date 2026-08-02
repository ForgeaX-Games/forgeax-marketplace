// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('labels manually entered text as a constant', () => {
    render(
      <TextValueEditor
        value="敌方"
        entities={{}}
        variables={{}}
        onChange={() => undefined}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('常量')
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: '常量' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '固定文本（手动输入）' })).toBeNull()
  })

  it('cascades through an entity before selecting text state', () => {
    const onChange = vi.fn()
    render(
      <TextValueEditor
        value={{ ref: 'entity.hero.name' }}
        entities={entities}
        variables={variables}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('主角')
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: '实体' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '名称' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '变量' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({ ref: 'entity.hero.attr.hp' })
  })

  it('shows the field note as a placeholder when a text reference is unavailable', () => {
    render(
      <TextValueEditor
        value={{ ref: 'entity.missing.name' }}
        entities={{}}
        variables={{}}
        onChange={() => undefined}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('文本：我方 · 状态：entity.hero.name / var.qi')
    fireEvent.click(picker)
    expect(screen.queryByRole('menuitem', { name: '当前引用（保持原值）' })).toBeNull()
  })

  it('cascades through entity attributes without changing expression ids', () => {
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

    const picker = screen.getByRole('combobox', { name: '数值内容' })
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '变量' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '公式' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: 'hero', attr: 'hp' }],
      },
    })
  })

  it('keeps the cascade panel at a stable scrollable height', () => {
    render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={variables}
        formulas={formulas}
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    const css = document.querySelector('style[data-reel-style="gc-cascading-picker"]')?.textContent ?? ''
    expect(css).toContain('height: min(320px, calc(100vh - 16px))')
    expect(css).toContain('overflow-y: auto')
  })
})
