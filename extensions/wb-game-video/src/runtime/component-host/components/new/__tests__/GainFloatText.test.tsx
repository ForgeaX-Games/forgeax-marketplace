// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GainFloatText } from '../GainFloatText'

describe('GainFloatText', () => {
  it('preserves unsigned positive numeric parameters without a plus sign', () => {
    render(<GainFloatText parameter="50" />)

    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('concatenates fixed text and preserves explicit parameter signs', () => {
    const { rerender } = render(<GainFloatText fixedText="-" parameter="50" />)
    expect(screen.getByText('-50')).toBeInTheDocument()

    rerender(<GainFloatText parameter="+50" />)
    expect(screen.getByText('+50')).toBeInTheDocument()

    rerender(<GainFloatText parameter="-50" />)
    expect(screen.getByText('-50')).toBeInTheDocument()

    rerender(<GainFloatText parameter="获得 50 气力" />)
    expect(screen.getByText('获得 50 气力')).toBeInTheDocument()
  })
})
