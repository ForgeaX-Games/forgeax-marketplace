import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Entity } from '../../../runtime/schema/graph-schema'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

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
  it('creates the first property with the same editable placeholder as later properties', () => {
    render(<EntityHarness initial={{ hero: { id: 'hero', name: '主角', attrs: {} } }} />)

    fireEvent.click(screen.getByRole('button', { name: '+ 属性' }))

    const idInput = screen.getByRole('textbox', { name: '属性「attr0」的 id' })
    expect(idInput).toHaveValue('')
    expect(idInput).toHaveAttribute('placeholder', 'attr0')

    fireEvent.change(idInput, { target: { value: 'hp' } })
    fireEvent.keyDown(idInput, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: '属性「hp」的 id' })).toHaveValue('hp')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":0}')
  })

  it('keeps existing property ids read-only', () => {
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

    const idInput = screen.getByRole('textbox', { name: '属性「attr0」的 id' })
    expect(idInput).toHaveValue('attr0')
    expect(idInput).toHaveAttribute('readonly')
  })

  it('shows generated ids as placeholders so typing does not append to them', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { hp: 10 },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ 属性' }))
    const idInput = screen.getByRole('textbox', { name: '属性「attr1」的 id' }) as HTMLInputElement
    expect(idInput).toHaveValue('')
    expect(idInput).toHaveAttribute('placeholder', 'attr1')

    fireEvent.change(idInput, { target: { value: 'maxhp' } })
    fireEvent.keyDown(idInput, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: '属性「maxhp」的 id' })).toHaveValue('maxhp')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":10,"maxhp":0}')
  })
})
