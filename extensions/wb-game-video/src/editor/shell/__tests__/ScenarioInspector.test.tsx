import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

function renderInspector(value: ScenarioMeta, section: 'variables' | 'entities' | 'formulas', onRename = vi.fn(() => ({ ok: true as const }))) {
  const onChange = vi.fn()
  render(<ScenarioInspector value={value} section={section} onChange={onChange} onRenameId={onRename} />)
  return { onChange, onRename }
}

describe('ScenarioInspector rules editing', () => {
  it('keeps the shared variable toolbar sticky and blocks duplicate IDs', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const { onRename } = renderInspector({
      variables: {
        health: { id: 'health', initial: 10 },
        rage: { id: 'rage', initial: 0 },
      },
    }, 'variables')
    const toolbar = screen.getByRole('button', { name: '＋ 新建变量' }).closest('.gc-rule-toolbar')
    expect(toolbar).toHaveStyle({ position: 'sticky', top: '0px' })
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
      entities: { hero: { id: 'hero', attrs: { hp: 0 }, attrMeta: { hp: { initial: 0 } } } },
    })
  })

  it('renders numeric limits in the shared rule table columns', () => {
    renderInspector({
      variables: {
        qi: { id: 'qi', name: '气力', initial: 8, min: 0, max: 10 },
      },
    }, 'variables')

    expect(screen.getByLabelText('qi 的最小值')).toHaveValue('0')
    expect(screen.getByLabelText('qi 的最大值')).toHaveValue('10')
    expect(screen.getByLabelText('qi 的初值')).toHaveValue('8')
  })

  it('does not render the removed variable type switcher', () => {
    const { onChange } = renderInspector({
      variables: { title: { id: 'title', initial: 1, min: 0, max: 10 } },
    }, 'variables')
    expect(screen.queryByLabelText('title 的初值类型')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not render a legacy advanced-settings control for a stored string', () => {
    renderInspector({ variables: { title: { id: 'title', initial: '', min: 0, max: 10 } } }, 'variables')
    expect(screen.getByLabelText('title 的初值')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /高级设置/ })).toBeNull()
  })
})
