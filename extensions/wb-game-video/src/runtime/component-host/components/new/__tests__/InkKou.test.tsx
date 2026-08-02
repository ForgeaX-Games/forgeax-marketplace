// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InkKou, InkKouManifest } from '../InkKou'

afterEach(cleanup)

describe('InkKou', () => {
  it('starts its exit animation immediately after emitting the knock event', () => {
    const emit = vi.fn()
    const { container } = render(<InkKou emit={emit} />)

    fireEvent.click(screen.getByRole('button', { name: '叩' }))

    expect(emit).toHaveBeenCalledWith('kou')
    expect(container.firstElementChild).toHaveClass('is-exiting')
  })

  it('shows and listens for its configured keyboard key', () => {
    const emit = vi.fn()
    render(<InkKou emit={emit} triggerKey="q" />)

    fireEvent.keyDown(window, { key: 'Q' })

    expect(screen.getByText('q')).toBeTruthy()
    expect(emit).toHaveBeenCalledWith('kou')
    expect(InkKouManifest.inputs).toEqual([
      { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'A' },
    ])
  })
})
