// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

afterEach(cleanup)

describe('ScenarioInspector formulas', () => {
  it('creates a formula with an empty expression', () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState<ScenarioMeta>({})
      return <ScenarioInspector value={value} section="formulas" onChange={setValue} />
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '+ 公式' }))

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    expect(input.value).toBe('')
    expect(input).toHaveAttribute('placeholder', '输入公式')

    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(0)
  })
})
