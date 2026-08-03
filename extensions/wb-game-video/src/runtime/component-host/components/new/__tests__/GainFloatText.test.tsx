// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GainFloatText } from '../GainFloatText'

describe('GainFloatText', () => {
  it('prefixes unsigned positive numeric parameters with a plus sign', () => {
    render(<GainFloatText parameter="50" />)

    expect(screen.getByText('+50')).toBeInTheDocument()
  })

  it('does not duplicate a fixed minus sign for positive parameters', () => {
    render(<GainFloatText fixedText="-" parameter="50" />)

    expect(screen.getByText('-50')).toBeInTheDocument()
  })

  it('preserves signed, non-positive, and non-numeric parameters', () => {
    const { rerender } = render(<GainFloatText parameter="+50" />)
    expect(screen.getByText('+50')).toBeInTheDocument()

    rerender(<GainFloatText parameter="-50" />)
    expect(screen.getByText('-50')).toBeInTheDocument()

    rerender(<GainFloatText parameter="获得 50 气力" />)
    expect(screen.getByText('获得 50 气力')).toBeInTheDocument()
  })
})
