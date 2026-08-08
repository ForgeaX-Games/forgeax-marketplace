import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import type { Entity } from '../../../runtime/schema/graph-schema'
import { ComponentFormFields } from '../component-form-fields'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

registerTestComponents()

function EntityHarness({ initial }: { initial: Record<string, Entity> }): JSX.Element {
  const [value, setValue] = useState<ScenarioMeta>({ entities: initial })
  return (
    <>
      <ScenarioInspector value={value} section="entities" onChange={setValue} />
      <output data-testid="entities-state">{JSON.stringify(value.entities)}</output>
    </>
  )
}

describe('ScenarioInspector entity attributes', () => {
  it('seeds new entities and attributes with numbered display names', () => {
    render(<EntityHarness initial={{}} />)

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建实体' }))
    expect(screen.getByRole('dialog', { name: '新建实体' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('实体名称'), { target: { value: '主角' } })
    fireEvent.change(screen.getByLabelText('实体id'), { target: { value: 'hero' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.queryByText('暂无属性')).toBeNull()
    expect(screen.getByLabelText('hero 的属性名称')).toHaveValue('属性1')

    fireEvent.click(screen.getByRole('button', { name: '新增属性' }))
    const names = screen.getAllByLabelText('hero 的属性名称')
    expect(names[0]).toHaveValue('属性1')
    expect(names[1]).toHaveValue('属性2')
  })

  it('renders existing property IDs as editable controls', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { attr0: 10 },
            attrMeta: { attr0: { label: '生命', max: 100 } },
          },
        }}
      />,
    )

    const idInput = screen.getByRole('textbox', { name: 'hero 的属性 ID' })
    expect(idInput).toHaveValue('attr0')
    expect(idInput).not.toHaveAttribute('readonly')
    const entityIdInput = screen.getByRole('textbox', { name: '实体 ID' })
    expect(entityIdInput).toHaveValue('hero')
    expect(entityIdInput).not.toHaveAttribute('readonly')
  })

  it('closes an entity overflow menu when clicking outside', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', name: '主角', attrs: {} },
      }} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '实体 主角更多操作' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens rename and delete confirmation dialogs from the overflow menu', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', name: '主角', attrs: {} },
      }} />,
    )

    const overflow = screen.getByRole('button', { name: '实体 主角更多操作' })
    fireEvent.click(overflow)
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    expect(screen.getByRole('dialog', { name: '重命名实体 主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))

    fireEvent.click(overflow)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog', { name: '删除实体 主角' })).toHaveTextContent('确认删除主角吗？')
  })

  it('stores each attribute initial value independently', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { stamina: 40, staminaMax: 100 },
            attrMeta: { stamina: { label: '耐力', min: 0, initial: 300, max: 300 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('属性「staminaMax」的数值'), {
      target: { value: '120' },
    })
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"staminaMax":120')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"staminaMax":{"initial":120}',
    )

    fireEvent.change(screen.getByLabelText('属性「stamina」的数值'), {
      target: { value: '75' },
    })

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"stamina":{"label":"耐力","min":0,"initial":75,"max":300}',
    )
  })

  it('allows a required attribute value to stay empty until blur', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 60, hpMax: 100 },
            attrMeta: { hp: { initial: 60, max: 100 } },
          },
        }}
      />,
    )

    const hpInput = screen.getByLabelText('属性「hp」的数值')
    fireEvent.focus(hpInput)
    fireEvent.change(hpInput, { target: { value: '' } })

    expect(hpInput).toHaveValue('')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":60')

    fireEvent.blur(hpInput)

    expect(hpInput).toHaveValue('0')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":0,"hpMax":100}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":{"initial":0,"max":100}')
  })

  it('does not couple independent attributes when their value changes', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 80, hpMax: 100 },
            attrMeta: { hp: { min: 0, initial: 80, max: 100 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('属性「hpMax」的数值'), {
      target: { value: '50' },
    })

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":80,"hpMax":50}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"hp":{"min":0,"initial":80,"max":100}',
    )
  })

  it('edits an entity property range in the table columns', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 80 },
            attrMeta: { hp: { initial: 80 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('hero 的 hp 最小值'), {
      target: { value: '10' },
    })
    fireEvent.blur(screen.getByLabelText('hero 的 hp 最小值'))
    fireEvent.change(screen.getByLabelText('hero 的 hp 最大值'), {
      target: { value: '60' },
    })
    fireEvent.blur(screen.getByLabelText('hero 的 hp 最大值'))

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":60}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":{"initial":60,"min":10,"max":60}')
  })

  it('edits string attributes without a type switcher', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', attrs: { title: '' } },
      }} />,
    )
    expect(screen.queryByLabelText('属性「title」的数值类型')).toBeNull()
    expect(screen.queryByRole('button', { name: /高级设置/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('属性「title」的数值'), { target: { value: '守护者' } })
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"title":"守护者"')
  })
})
