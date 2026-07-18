import { describe, expect, it } from 'vitest'
import {
  isQTEKeyboardKey,
  isQTEKeyEvent,
  pickKeyboardCue,
} from '../cueKeybinding'
import type { HitVerdict } from '../QTEEngine'
import type { QTECue, QTEHitWindow } from '../../scenario/types'

const window: QTEHitWindow = { perfect: 80, great: 160, good: 280 }

function tap(id: string, appearAt: number, targetAt: number): QTECue {
  return { id, shape: 'tap', x: 0.5, y: 0.5, appearAt, targetAt }
}

describe('isQTEKeyboardKey', () => {
  it('accepts Space (key=" ") and Enter', () => {
    expect(isQTEKeyboardKey(' ')).toBe(true)
    expect(isQTEKeyboardKey('Enter')).toBe(true)
  })
  it('also accepts the legacy "Spacebar"  spelling for Edge/Firefox quirks', () => {
    expect(isQTEKeyboardKey('Spacebar')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isQTEKeyboardKey('a')).toBe(false)
    expect(isQTEKeyboardKey('Escape')).toBe(false)
    expect(isQTEKeyboardKey('')).toBe(false)
  })
})

describe('isQTEKeyEvent', () => {
  it('accepts a real KeyboardEvent shape with no modifier', () => {
    const e = { key: ' ', ctrlKey: false, metaKey: false, altKey: false }
    expect(isQTEKeyEvent(e)).toBe(true)
  })
  it('rejects when any system modifier is held (avoid stealing Ctrl-Space etc.)', () => {
    expect(
      isQTEKeyEvent({ key: ' ', ctrlKey: true, metaKey: false, altKey: false }),
    ).toBe(false)
    expect(
      isQTEKeyEvent({ key: ' ', ctrlKey: false, metaKey: true, altKey: false }),
    ).toBe(false)
    expect(
      isQTEKeyEvent({ key: ' ', ctrlKey: false, metaKey: false, altKey: true }),
    ).toBe(false)
  })
  it('rejects non-QTE keys', () => {
    expect(
      isQTEKeyEvent({ key: 'a', ctrlKey: false, metaKey: false, altKey: false }),
    ).toBe(false)
  })
})

describe('pickKeyboardCue', () => {
  it('returns null when no cue is currently live', () => {
    const cues = [tap('a', 5000, 5500)]
    expect(pickKeyboardCue(cues, [], window, 100)).toBeNull()
  })

  it('returns the only live cue', () => {
    const cues = [tap('a', 1000, 1500)]
    expect(pickKeyboardCue(cues, [], window, 1300)?.id).toBe('a')
  })

  it('skips already-resolved cues', () => {
    const cues = [tap('a', 1000, 1500), tap('b', 1100, 1600)]
    const verdicts: HitVerdict[] = [
      {
        cueId: 'a',
        judgement: 'PERFECT',
        deltaMs: 0,
        score: 100,
        timing: 'ON',
      },
    ]
    expect(pickKeyboardCue(cues, verdicts, window, 1500)?.id).toBe('b')
  })

  it('prefers the cue with the smallest |targetAt - now| —— 玩家心理预期：撞最近那个', () => {
    const cues = [tap('far', 0, 800), tap('near', 0, 1010), tap('mid', 0, 1300)]
    expect(pickKeyboardCue(cues, [], window, 1000)?.id).toBe('near')
  })

  it('ignores cues that are still before appearAt', () => {
    const cues = [tap('future', 5000, 5500), tap('now', 900, 1100)]
    expect(pickKeyboardCue(cues, [], window, 1050)?.id).toBe('now')
  })

  it('ignores cues whose good window has passed', () => {
    const cues = [tap('expired', 0, 100), tap('live', 1000, 1500)]
    // good window = 280 → cue "expired" 在 now=1050 时 (targetAt+good=380) 已过
    expect(pickKeyboardCue(cues, [], window, 1050)?.id).toBe('live')
  })

  it('returns null when nothing is selectable', () => {
    const cues = [tap('a', 0, 100)]
    expect(pickKeyboardCue(cues, [], window, 9999)).toBeNull()
  })
})
