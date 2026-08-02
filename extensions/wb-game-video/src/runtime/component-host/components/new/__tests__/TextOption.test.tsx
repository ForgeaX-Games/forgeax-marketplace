// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextOption, TextOptionManifest } from '../TextOption'

afterEach(cleanup)

describe('TextOption', () => {
  it('declares authorable text appearance and one selection event', () => {
    expect(TextOptionManifest.inputs).toEqual([
      { key: 'text', label: '文字', valueType: 'string', default: '摁F交互' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
      { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'F' },
    ])
    expect(TextOptionManifest.label).toBe('文字交互')
    expect(TextOptionManifest.events).toEqual([{ id: 'activate', label: '交互' }])
  })

  it('centers the text and emits selection only once', () => {
    const emit = vi.fn()
    render(
      <TextOption emit={emit} text="划船" triggerKey="F" color="#ffd54a" fontSize={3} />,
    )

    const button = screen.getByRole('button', { name: 'F 划船' })
    expect(button).toHaveStyle({ color: '#ffd54a', '--gv-text-font-size': '3cqh' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('activate')
  })

  it('emits from its configured keyboard trigger', () => {
    const emit = vi.fn()
    render(<TextOption emit={emit} triggerKey="f" />)

    fireEvent.keyDown(window, { key: 'F' })
    fireEvent.keyDown(window, { key: 'F', repeat: true })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('activate')
  })
})
