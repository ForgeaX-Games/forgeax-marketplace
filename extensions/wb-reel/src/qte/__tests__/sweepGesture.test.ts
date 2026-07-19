import { describe, expect, it } from 'vitest'
import {
  isOnAxis,
  resolveSweep,
  startSweep,
  updateSweep,
} from '../sweepGesture'

describe('isOnAxis', () => {
  it('向右拖 (dx>0) 落在 right 45° 扇形里', () => {
    expect(isOnAxis(10, 0, 'right', 45)).toBe(true)
    expect(isOnAxis(10, 8, 'right', 45)).toBe(true) // 约 38.6°，进容差
    expect(isOnAxis(10, 11, 'right', 45)).toBe(false) // 约 47.7°，出容差
  })
  it('DOM 坐标系下 up = 负 y', () => {
    expect(isOnAxis(0, -10, 'up', 45)).toBe(true)
    expect(isOnAxis(0, 10, 'up', 45)).toBe(false)
  })
  it('反向拖 → false', () => {
    expect(isOnAxis(-10, 0, 'right', 45)).toBe(false)
    expect(isOnAxis(10, 0, 'left', 45)).toBe(false)
  })
  it('零向量视作 on-axis（避免除零）', () => {
    expect(isOnAxis(0, 0, 'right', 45)).toBe(true)
  })
})

describe('startSweep / updateSweep', () => {
  it('起始状态 distance=0、progress=0、未达阈值', () => {
    const s = startSweep(100, 100, 'right')
    const { update } = updateSweep(s, 100, 100)
    expect(update.distance).toBe(0)
    expect(update.progress).toBe(0)
    expect(update.reachedThreshold).toBe(false)
  })
  it('拖到阈值边缘时 progress=1、reachedThreshold=true', () => {
    const s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    const { update } = updateSweep(s, 48, 0)
    expect(update.distance).toBeCloseTo(48)
    expect(update.progress).toBe(1)
    expect(update.reachedThreshold).toBe(true)
    expect(update.onAxis).toBe(true)
  })
  it('超过阈值后 progress 夹紧在 1', () => {
    const s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    const { update } = updateSweep(s, 200, 0)
    expect(update.progress).toBe(1)
  })
  it('反向拖时 onAxis=false（即便超阈值也不算命中）', () => {
    const s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    const { update } = updateSweep(s, -100, 0)
    expect(update.reachedThreshold).toBe(true)
    expect(update.onAxis).toBe(false)
  })
  it('next state 记录最新坐标（纯函数，不改原 state）', () => {
    const s = startSweep(0, 0, 'right')
    const { next } = updateSweep(s, 30, 5)
    expect(next.currentX).toBe(30)
    expect(next.currentY).toBe(5)
    expect(s.currentX).toBe(0) // 原状态未被污染
  })
})

describe('resolveSweep', () => {
  it('达阈值 + 方向正确 → HIT', () => {
    let s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    s = updateSweep(s, 60, 0).next
    expect(resolveSweep(s)).toBe('HIT')
  })
  it('达阈值 + 方向反 → WRONG_DIR', () => {
    let s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    s = updateSweep(s, -60, 0).next
    expect(resolveSweep(s)).toBe('WRONG_DIR')
  })
  it('未达阈值 → TOO_SHORT', () => {
    let s = startSweep(0, 0, 'right', { minDistancePx: 48 })
    s = updateSweep(s, 10, 0).next
    expect(resolveSweep(s)).toBe('TOO_SHORT')
  })
  it('向下拖（DOM y+）判 down 方向正确', () => {
    let s = startSweep(0, 0, 'down', { minDistancePx: 48 })
    s = updateSweep(s, 0, 60).next
    expect(resolveSweep(s)).toBe('HIT')
  })
  it('向上拖（DOM y-）判 up 方向正确', () => {
    let s = startSweep(0, 0, 'up', { minDistancePx: 48 })
    s = updateSweep(s, 0, -60).next
    expect(resolveSweep(s)).toBe('HIT')
  })
})
