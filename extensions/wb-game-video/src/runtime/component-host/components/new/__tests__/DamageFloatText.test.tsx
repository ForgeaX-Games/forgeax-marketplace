// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DamageFloatText } from '../DamageFloatText'

describe('DamageFloatText', () => {
  it('preserves unsigned positive numeric parameters without a plus sign', () => {
    render(<DamageFloatText parameter="25" />)

    expect(screen.getByText('25')).toBeInTheDocument()
  })

  it('concatenates fixed text and preserves explicit parameter signs', () => {
    const { rerender } = render(<DamageFloatText fixedText="-" parameter="50" />)
    expect(screen.getByText('-50')).toBeInTheDocument()

    rerender(<DamageFloatText parameter="+25" />)
    expect(screen.getByText('+25')).toBeInTheDocument()

    rerender(<DamageFloatText parameter="-25" />)
    expect(screen.getByText('-25')).toBeInTheDocument()

    rerender(<DamageFloatText parameter="格挡" />)
    expect(screen.getByText('格挡')).toBeInTheDocument()
  })
})
