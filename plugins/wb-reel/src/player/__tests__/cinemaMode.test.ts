import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CINEMA_DELAY_MS,
  normalizeCinemaDelay,
  shouldActivateCinema,
} from '../cinemaMode'

describe('shouldActivateCinema', () => {
  it('默认 2000ms：1999 不激活，2000 激活，2500 激活', () => {
    expect(shouldActivateCinema(0)).toBe(false)
    expect(shouldActivateCinema(1999)).toBe(false)
    expect(shouldActivateCinema(2000)).toBe(true)
    expect(shouldActivateCinema(2500)).toBe(true)
  })

  it('可覆盖 delay：500ms 时 499 不激活 / 500 激活', () => {
    expect(shouldActivateCinema(499, 500)).toBe(false)
    expect(shouldActivateCinema(500, 500)).toBe(true)
  })

  it('负数或 NaN 返回 false（不激活 + 不崩）', () => {
    expect(shouldActivateCinema(-1)).toBe(false)
    expect(shouldActivateCinema(Number.NaN)).toBe(false)
    expect(shouldActivateCinema(1000, Number.NaN)).toBe(false)
    expect(shouldActivateCinema(1000, -100)).toBe(false)
  })
})

describe('normalizeCinemaDelay', () => {
  it('非数字或负数 / NaN 回落到默认值', () => {
    expect(normalizeCinemaDelay(undefined)).toBe(DEFAULT_CINEMA_DELAY_MS)
    expect(normalizeCinemaDelay(null)).toBe(DEFAULT_CINEMA_DELAY_MS)
    expect(normalizeCinemaDelay('2s')).toBe(DEFAULT_CINEMA_DELAY_MS)
    expect(normalizeCinemaDelay(Number.NaN)).toBe(DEFAULT_CINEMA_DELAY_MS)
    expect(normalizeCinemaDelay(-500)).toBe(DEFAULT_CINEMA_DELAY_MS)
  })

  it('小数四舍五入成整数毫秒', () => {
    expect(normalizeCinemaDelay(1999.4)).toBe(1999)
    expect(normalizeCinemaDelay(1999.6)).toBe(2000)
  })

  it('0 合法：立即激活', () => {
    expect(normalizeCinemaDelay(0)).toBe(0)
    expect(shouldActivateCinema(0, normalizeCinemaDelay(0))).toBe(true)
  })

  it('自定义 fallback 生效', () => {
    expect(normalizeCinemaDelay(undefined, 1500)).toBe(1500)
  })
})
