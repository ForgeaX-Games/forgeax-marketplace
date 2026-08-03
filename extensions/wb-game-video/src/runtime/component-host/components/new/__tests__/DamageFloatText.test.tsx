// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DamageFloatText } from '../DamageFloatText'

describe('DamageFloatText', () => {
  it('prefixes unsigned positive numeric parameters with a plus sign', () => {
    render(<DamageFloatText parameter="25" />)

    expect(screen.getByText('+25')).toBeInTheDocument()
  })

  it('does not duplicate a fixed minus sign for positive parameters', () => {
    render(<DamageFloatText fixedText="-" parameter="50" />)

    expect(screen.getByText('-50')).toBeInTheDocument()
  })

  it('preserves signed, non-positive, and non-numeric parameters', () => {
    const { rerender } = render(<DamageFloatText parameter="+25" />)
    expect(screen.getByText('+25')).toBeInTheDocument()

    rerender(<DamageFloatText parameter="-25" />)
    expect(screen.getByText('-25')).toBeInTheDocument()

    rerender(<DamageFloatText parameter="格挡" />)
    expect(screen.getByText('格挡')).toBeInTheDocument()
  })
})
