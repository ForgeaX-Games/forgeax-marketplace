import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import type { Entity } from '../../../runtime/schema/graph-schema'
import { ComponentFormFields } from '../component-form-fields'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

registerCoreSkins()

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
  })

  it('keeps paired attribute metadata in sync when either value changes', () => {
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
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"stamina":{"label":"耐力","min":0,"initial":40,"max":120}',
    )

    fireEvent.change(screen.getByLabelText('属性「stamina」的数值'), {
      target: { value: '75' },
    })

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"stamina":{"label":"耐力","min":0,"initial":75,"max":120}',
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

  it('keeps unrelated newly created attributes out of hp value pickers', () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState<ScenarioMeta>({
        entities: { hero: { id: 'hero', name: '主角', attrs: {} } },
      })
      return (
        <>
          <ScenarioInspector value={value} section="entities" onChange={setValue} />
          <ComponentFormFields
            componentId="BattlePlayerHpBar"
            values={{ label: '我方', current: 0, max: 0 }}
            pickers={{ entities: value.entities }}
            onChange={() => undefined}
          />
        </>
      )
    }
    render(<Harness />)

    const hpSelect = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
    fireEvent.click(hpSelect)
    expect(screen.queryByRole('menuitem', { name: '实体属性' })).toBeNull()
    fireEvent.click(hpSelect)

    fireEvent.click(screen.getByRole('button', { name: '+ 属性' }))

    expect(screen.getByLabelText('属性「attr0」的数值')).toHaveValue('0')
    fireEvent.click(hpSelect)
    expect(screen.queryByRole('menuitem', { name: '实体属性' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'attr0' })).toBeNull()
  })

  it('clamps authored current values when a paired maximum is reduced', () => {
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

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":50,"hpMax":50}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"hp":{"min":0,"initial":50,"max":50}',
    )
  })
})
