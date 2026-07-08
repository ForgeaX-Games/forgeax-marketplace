import { describe, expect, it } from 'vitest'
import {
  isLoopScene,
  qteInteractionWindowEnd,
  resolveFireAt,
  resolvePlaybackCapMs,
  shouldActivateTimedQte,
  shouldOpenChoiceDuringPlayback,
} from '../choiceTiming'
import { computeEffectiveEndMs } from '../sceneEndTime'
import { getBlueprintCombatDemoScenario } from '../../scenario/demoScenario'
import type { Scene } from '../../scenario/types'

const loopChoiceScene: Scene = {
  id: 'l1',
  title: 'L1',
  media: { kind: 'VIDEO', ref: 'v' },
  durationMs: 120000,
  dialogue: [],
  mediaPlayMode: 'loop',
  choice: {
    timed: true,
    window: { timeoutMs: 9000, startMs: 400 },
  },
  branches: [
    { id: 'a', kind: 'choice', label: 'A', targetSceneId: 'x' },
    { id: 'b', kind: 'choice', label: 'B', targetSceneId: 'y' },
  ],
}

describe('choiceTiming', () => {
  it('loop scene opens choice during playback window', () => {
    expect(isLoopScene(loopChoiceScene)).toBe(true)
    expect(shouldOpenChoiceDuringPlayback(loopChoiceScene, 500)).toBe(true)
    expect(shouldOpenChoiceDuringPlayback(loopChoiceScene, 100)).toBe(false)
  })

  it('resolveFireAt defaults video_end on loop scenes', () => {
    expect(resolveFireAt(loopChoiceScene)).toBe('video_end')
  })

  it('timed_qte stays active through last cue window + timeout', () => {
    const tele = getBlueprintCombatDemoScenario().scenes.tele!
    const twoCue = {
      ...tele,
      qte: {
        ...tele.qte!,
        cues: [
          ...(tele.qte?.cues ?? []),
          {
            id: 'parry-2',
            shape: 'tap' as const,
            x: 0.4,
            y: 0.6,
            appearAt: 1800,
            targetAt: 2400,
            label: '第二击',
          },
        ],
      },
    }
    const end = qteInteractionWindowEnd(twoCue)
    expect(end).toBeGreaterThan(tele.durationMs)
    expect(shouldActivateTimedQte(twoCue, end - 1)).toBe(true)
    expect(shouldActivateTimedQte(twoCue, end)).toBe(false)
    expect(shouldActivateTimedQte(twoCue, 2000)).toBe(true)
  })

  it('resolvePlaybackCapMs extends effectiveEnd for timed_qte', () => {
    const tele = getBlueprintCombatDemoScenario().scenes.tele!
    const twoCue = {
      ...tele,
      qte: {
        ...tele.qte!,
        cues: [
          ...(tele.qte?.cues ?? []),
          {
            id: 'parry-2',
            shape: 'tap' as const,
            x: 0.4,
            y: 0.6,
            appearAt: 1800,
            targetAt: 2400,
            label: '第二击',
          },
        ],
      },
    }
    const base = computeEffectiveEndMs(twoCue)
    expect(resolvePlaybackCapMs(twoCue, base)).toBe(qteInteractionWindowEnd(twoCue))
    expect(resolvePlaybackCapMs(tele, base)).toBeGreaterThanOrEqual(base)
  })
})
