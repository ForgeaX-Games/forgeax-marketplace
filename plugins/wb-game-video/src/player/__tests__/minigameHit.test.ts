import { describe, expect, it } from 'vitest'
import { nextMinigameToTrigger } from '../minigameHit'
import type { MinigameClip } from '../../scenario/types'

function clip(id: string, startMs: number): MinigameClip {
  return { id, minigameId: 'game-x', startMs, durationMs: 1000 }
}

describe('nextMinigameToTrigger', () => {
  it('returns null when no clips', () => {
    expect(
      nextMinigameToTrigger({
        clips: [],
        elapsedMs: 5_000,
        triggeredIds: new Set(),
      }),
    ).toBeNull()
  })

  it('returns null before any clip start', () => {
    expect(
      nextMinigameToTrigger({
        clips: [clip('a', 3_000), clip('b', 6_000)],
        elapsedMs: 1_000,
        triggeredIds: new Set(),
      }),
    ).toBeNull()
  })

  it('returns the earliest clip whose start has been crossed', () => {
    const out = nextMinigameToTrigger({
      clips: [clip('a', 6_000), clip('b', 3_000)],
      elapsedMs: 3_100,
      triggeredIds: new Set(),
    })
    expect(out?.id).toBe('b')
  })

  it('skips already-triggered clips, falls through to next', () => {
    const out = nextMinigameToTrigger({
      clips: [clip('b', 3_000), clip('a', 6_000)],
      elapsedMs: 7_000,
      triggeredIds: new Set(['b']),
    })
    expect(out?.id).toBe('a')
  })

  it('returns null if every reachable clip is already triggered', () => {
    expect(
      nextMinigameToTrigger({
        clips: [clip('a', 1_000), clip('b', 2_000)],
        elapsedMs: 5_000,
        triggeredIds: new Set(['a', 'b']),
      }),
    ).toBeNull()
  })

  it('matches exactly at startMs (inclusive)', () => {
    const out = nextMinigameToTrigger({
      clips: [clip('a', 3_000)],
      elapsedMs: 3_000,
      triggeredIds: new Set(),
    })
    expect(out?.id).toBe('a')
  })
})
