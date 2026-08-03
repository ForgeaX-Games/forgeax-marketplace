import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextOption, TextOptionManifest } from '../TextOption'

afterEach(cleanup)

describe('TextOption', () => {
  it('declares authorable text, appearance, and keyboard trigger inputs', () => {
    expect(TextOptionManifest.label).toBe('文字交互')
    expect(TextOptionManifest.inputs).toEqual([
      { key: 'text', label: '文字', valueType: 'string', default: '摁F交互' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
      { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'F' },
    ])
    expect(TextOptionManifest.events).toEqual([{ id: 'activate', label: '交互' }])
  })

  it('emits once for its configured keyboard trigger', () => {
    const emit = vi.fn()
    render(<TextOption emit={emit} overlay={{ elementId: 'boat', component: 'TextOption', inputs: { triggerKey: 'f' } }} />)
    fireEvent.keyDown(window, { key: 'F' })
    fireEvent.keyDown(window, { key: 'F', repeat: true })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('activate')
    expect(screen.getByRole('button', { name: '摁F交互' })).toBeTruthy()
  })
})
