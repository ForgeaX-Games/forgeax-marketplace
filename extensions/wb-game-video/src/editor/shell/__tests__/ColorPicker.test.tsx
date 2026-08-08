// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorPicker } from '../ColorPicker'

afterEach(cleanup)

describe('ColorPicker trigger', () => {
  it('shows a circular bordered swatch', () => {
    const { container } = render(
      <ColorPicker value="rgba(255,255,255,0.45)" onChange={vi.fn()} />,
    )

    expect(container.querySelector('.gc-cp-swatch-color')).toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.45)',
    })
    const styles = container.ownerDocument.querySelector(
      'style[data-reel-style="color-picker"]',
    )?.textContent
    expect(styles).toContain('width: 14px; height: 14px')
    expect(styles).toContain('border-radius: 50%')
    expect(styles).toContain('border: 1px solid rgba(162, 162, 162, 1)')
  })

  it('shows an uppercase color value without a separate alpha percentage', () => {
    render(<ColorPicker value="#aabbcc" onChange={vi.fn()} />)

    expect(screen.getByText('#AABBCC')).toBeTruthy()
    expect(screen.queryByText('100%')).toBeNull()
  })

  it('uses the manifest placeholder as the alpha slider base color', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ColorPicker value={undefined} placeholder="#f0f0f0" onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '#F0F0F0' }))
    const alphaSlider = document.querySelectorAll<HTMLElement>('.gc-cp-slider')[1]!
    vi.spyOn(alphaSlider, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 12,
      width: 100,
      height: 12,
      toJSON: () => ({}),
    })
    const panelInput = document.querySelector<HTMLInputElement>('.gc-cp-hex-row input')!
    fireEvent.focus(panelInput)
    fireEvent.change(panelInput, { target: { value: '' } })

    fireEvent.pointerDown(alphaSlider, { clientX: 50, clientY: 6 })

    expect(onChange).toHaveBeenLastCalledWith('rgba(240,240,240,0.5)')
    expect(panelInput).toHaveValue('RGBA(240,240,240,0.5)')
    expect(container.querySelector('.gc-cp-value')).toHaveTextContent('#F0F0F0')
  })
})
