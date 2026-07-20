import { describe, it, expect, beforeEach } from 'vitest'
import { useCinemaGate } from '../cinemaGate'

describe('useCinemaGate', () => {
  beforeEach(() => {
    useCinemaGate.setState({ holds: 0 })
  })

  it('初始 holds = 0', () => {
    expect(useCinemaGate.getState().holds).toBe(0)
  })

  it('hold 累加，release 递减', () => {
    const g = useCinemaGate.getState()
    g.hold()
    g.hold()
    expect(useCinemaGate.getState().holds).toBe(2)
    g.release()
    expect(useCinemaGate.getState().holds).toBe(1)
    g.release()
    expect(useCinemaGate.getState().holds).toBe(0)
  })

  it('release 不会变成负数（防止 hook cleanup 重复调用）', () => {
    const g = useCinemaGate.getState()
    g.release()
    g.release()
    expect(useCinemaGate.getState().holds).toBe(0)
  })

  it('多个独立 hold 的持有者可互不干扰', () => {
    const g = useCinemaGate.getState()
    g.hold() // overlay A
    g.hold() // overlay B
    g.release() // A 卸载
    expect(useCinemaGate.getState().holds).toBe(1)
    g.release() // B 卸载
    expect(useCinemaGate.getState().holds).toBe(0)
  })
})
