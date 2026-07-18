import { describe, expect, it } from 'vitest'
import { layoutValueToCss, layoutToCss } from '../schema/layout'

describe('layout', () => {
  it('layoutValueToCss maps fraction and strings', () => {
    expect(layoutValueToCss(0)).toBe('0%')
    expect(layoutValueToCss(0.5)).toBe('50%')
    expect(layoutValueToCss(-0.5)).toBe('-50%')
    expect(layoutValueToCss('12px')).toBe('12px')
    expect(layoutValueToCss('50%')).toBe('50%')
  })

  it('layoutToCss: vertical center left-aligned', () => {
    expect(
      layoutToCss({ left: 0, top: 0.5, translateY: -0.5 }),
    ).toEqual({
      position: 'absolute',
      left: '0%',
      top: '50%',
      transform: 'translate(0, -50%)',
    })
  })

  it('layoutToCss: true center', () => {
    expect(
      layoutToCss({ left: '50%', top: '50%', translateX: '-50%', translateY: '-50%' }),
    ).toEqual({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    })
  })

  it('layoutToCss: bottom bar', () => {
    expect(layoutToCss({ left: 0, right: 0, bottom: 0, height: 0.12 })).toEqual({
      position: 'absolute',
      left: '0%',
      right: '0%',
      bottom: '0%',
      height: '12%',
    })
  })

  it('layoutToCss: zIndex', () => {
    expect(layoutToCss({ left: 0, top: 0, zIndex: 3 })).toEqual({
      position: 'absolute',
      left: '0%',
      top: '0%',
      zIndex: 3,
    })
  })
})
