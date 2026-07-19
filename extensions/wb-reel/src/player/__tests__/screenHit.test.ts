import { describe, it, expect } from 'vitest'
import { nextScreenToTrigger, pendingScreensAtEnd } from '../screenHit'
import type { ScreenClip } from '../../scenario/types'

const clips: ScreenClip[] = [
  { id: 'c1', screenId: 'chest', startMs: 1000 },
  { id: 'c2', screenId: 'search', startMs: 3000 },
]

describe('nextScreenToTrigger', () => {
  it('未到时间不触发', () => {
    expect(nextScreenToTrigger({ clips, elapsedMs: 500, triggeredIds: new Set() })).toBeNull()
  })

  it('到点返回最早未触发的 clip', () => {
    const hit = nextScreenToTrigger({ clips, elapsedMs: 1200, triggeredIds: new Set() })
    expect(hit?.id).toBe('c1')
  })

  it('已触发的跳过', () => {
    const hit = nextScreenToTrigger({ clips, elapsedMs: 3200, triggeredIds: new Set(['c1']) })
    expect(hit?.id).toBe('c2')
  })

  it('全部触发过 → null', () => {
    expect(
      nextScreenToTrigger({ clips, elapsedMs: 9999, triggeredIds: new Set(['c1', 'c2']) }),
    ).toBeNull()
  })

  it('空 clips → null', () => {
    expect(nextScreenToTrigger({ clips: [], elapsedMs: 9999, triggeredIds: new Set() })).toBeNull()
  })
})

describe('pendingScreensAtEnd', () => {
  it('返回第一个未触发的(无视时间)', () => {
    const p = pendingScreensAtEnd({ clips, triggeredIds: new Set(['c1']) })
    expect(p?.id).toBe('c2')
  })

  it('全部触发过 → null', () => {
    expect(pendingScreensAtEnd({ clips, triggeredIds: new Set(['c1', 'c2']) })).toBeNull()
  })
})
