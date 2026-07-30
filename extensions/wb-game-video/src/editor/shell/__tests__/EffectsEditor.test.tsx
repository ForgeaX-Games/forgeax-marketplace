// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GraphEffect } from '../../../runtime/schema/graph-schema'
import { EffectsEditor } from '../editors'

afterEach(cleanup)

describe('EffectsEditor numeric operations', () => {
  it('lets subtraction and division own their operation state while keeping the operand editable', () => {
    let latest: GraphEffect[] = []
    function Harness(): JSX.Element {
      const [effects, setEffects] = useState<GraphEffect[]>([{
        kind: 'attr',
        entityId: 'hero',
        attr: 'hp',
        op: 'add',
        value: 2,
      }])
      latest = effects
      return (
        <EffectsEditor
          value={effects}
          entities={{
            hero: { id: 'hero', name: '主角', attrs: { hp: 100 } },
          }}
          onChange={setEffects}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: '÷' }))
    expect(screen.getByRole('button', { name: '÷' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('常量数值')).toHaveValue('2')
    expect(latest[0]).toMatchObject({ op: 'mul', value: { expr: '1/(2)' } })

    fireEvent.change(screen.getByLabelText('常量数值'), { target: { value: '4' } })
    expect(latest[0]).toMatchObject({ op: 'mul', value: { expr: '1/(4)' } })

    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByRole('button', { name: '−' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('常量数值')).toHaveValue('4')
    expect(latest[0]).toMatchObject({ op: 'add', value: { expr: '-(4)' } })

    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByRole('button', { name: '+' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('常量数值')).toHaveValue('4')
    expect(latest[0]).toMatchObject({ op: 'add', value: 4 })
  })
})
