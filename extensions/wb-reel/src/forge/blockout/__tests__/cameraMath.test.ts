import { describe, it, expect } from 'vitest'
import { mmToFov, fovToMm, horizontalToVerticalFov } from '../cameraMath'

describe('cameraMath', () => {
  it('50mm 全画幅水平 fov ≈ 39.6°', () => {
    expect(mmToFov(50)).toBeCloseTo(39.6, 1)
  })

  it('广角 18mm 水平 fov ≈ 90°', () => {
    expect(mmToFov(18)).toBeCloseTo(90, 0)
  })

  it('mm→fov→mm 往返一致', () => {
    expect(fovToMm(mmToFov(35))).toBeCloseTo(35, 3)
    expect(fovToMm(mmToFov(85))).toBeCloseTo(85, 3)
  })

  it('非法 mm（<=0）兜底不 NaN', () => {
    expect(Number.isFinite(mmToFov(0))).toBe(true)
    expect(Number.isFinite(mmToFov(-5))).toBe(true)
  })

  it('水平 fov + aspect → 垂直 fov：方形画幅 aspect=1 时垂直=水平', () => {
    expect(horizontalToVerticalFov(60, 1)).toBeCloseTo(60, 3)
  })

  it('宽画幅 aspect>1 时垂直 fov < 水平 fov', () => {
    expect(horizontalToVerticalFov(60, 16 / 9)).toBeLessThan(60)
  })
})
