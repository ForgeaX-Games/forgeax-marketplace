import { describe, expect, it } from 'vitest'
import {
  childWrapStyle,
  layoutHasExplicitSize,
  layoutIsEffectivelyEmpty,
  layoutValueToCss,
  layoutToCss,
  mountWrapStyle,
} from '../schema/layout'

describe('layout', () => {
  it('layoutValueToCss maps fraction and strings', () => {
    expect(layoutValueToCss(0)).toBe('0%')
    expect(layoutValueToCss(0.5)).toBe('50%')
    expect(layoutValueToCss(-0.5)).toBe('-50%')
    expect(layoutValueToCss('12px')).toBe('12px')
    expect(layoutValueToCss('50%')).toBe('50%')
  })

  it('layoutIsEffectivelyEmpty', () => {
    expect(layoutIsEffectivelyEmpty(undefined)).toBe(true)
    expect(layoutIsEffectivelyEmpty({})).toBe(true)
    expect(layoutIsEffectivelyEmpty({ left: 0 })).toBe(false)
  })

  it('layoutHasExplicitSize', () => {
    expect(layoutHasExplicitSize({ width: 1 })).toBe(true)
    expect(layoutHasExplicitSize({ left: 0, top: 0 })).toBe(false)
  })

  it('mountWrapStyle: auto-size when no layout', () => {
    expect(mountWrapStyle()).toEqual({
      position: 'absolute',
      pointerEvents: 'none',
      left: 0,
      top: 0,
      width: 'fit-content',
      height: 'fit-content',
    })
  })

  it('mountWrapStyle: explicit width, auto height', () => {
    expect(mountWrapStyle({ left: 0, top: 0, width: 1 })).toMatchObject({
      position: 'absolute',
      left: '0%',
      top: '0%',
      width: '100%',
      height: 'fit-content',
    })
  })

  it('childWrapStyle: default top-left when mount has size', () => {
    expect(childWrapStyle(undefined, true)).toEqual({
      position: 'absolute',
      left: 0,
      top: 0,
      pointerEvents: 'auto',
    })
  })

  it('childWrapStyle: flow when mount auto-size', () => {
    expect(childWrapStyle(undefined, false)).toEqual({ pointerEvents: 'auto' })
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
