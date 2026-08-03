import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

function renderInspector(value: ScenarioMeta, section: 'variables' | 'entities' | 'formulas', onRename = vi.fn(() => ({ ok: true as const }))) {
  const onChange = vi.fn()
  render(<ScenarioInspector value={value} section={section} onChange={onChange} onRenameId={onRename} />)
  return { onChange, onRename }
}

describe('ScenarioInspector rules editing', () => {
  it('keeps the section add action sticky and blocks duplicate variable IDs', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const { onRename } = renderInspector({
      variables: {
        health: { id: 'health', initial: 10 },
        rage: { id: 'rage', initial: 0 },
      },
    }, 'variables')
    const heading = screen.getByText('变量').parentElement
    expect(heading).toHaveStyle({ position: 'sticky', top: '0px' })
    const idInput = screen.getAllByLabelText('变量 ID')[0]!
    fireEvent.change(idInput, { target: { value: 'rage' } })
    expect(idInput).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(idInput)
    expect(onRename).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith('变量 ID 无法修改：ID 已存在')
    expect(idInput).toHaveValue('health')
    alert.mockRestore()
  })

  it('allows a numeric attribute value to be cleared before blur, then restores zero', () => {
    const { onChange } = renderInspector({
      entities: { hero: { id: 'hero', attrs: { hp: 12 } } },
    }, 'entities')
    const value = screen.getByLabelText('属性「hp」的数值')
    fireEvent.focus(value)
    fireEvent.change(value, { target: { value: '' } })
    expect(value).toHaveValue('')
    fireEvent.blur(value)
    expect(onChange).toHaveBeenLastCalledWith({
      entities: { hero: { id: 'hero', attrs: { hp: 0 } } },
    })
  })

  it('exposes advanced settings', () => {
    renderInspector({
      variables: {
        qi: { id: 'qi', name: '气力', initial: 8, min: 0, max: 10 },
      },
    }, 'variables')

    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }))
    expect(screen.getByLabelText('qi min')).toHaveValue('0')
    expect(screen.getByLabelText('qi max')).toHaveValue('10')
    expect(screen.getByLabelText('qi initial')).toHaveValue('8')
  })
})
