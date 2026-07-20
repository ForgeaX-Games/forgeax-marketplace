import { describe, expect, it } from 'vitest'
import {
  parseMinigameMessage,
  type MinigameEvent,
} from '../minigameMessage'

describe('parseMinigameMessage', () => {
  it('rejects non-object payloads', () => {
    expect(parseMinigameMessage(null)).toBeNull()
    expect(parseMinigameMessage(undefined)).toBeNull()
    expect(parseMinigameMessage('ready')).toBeNull()
    expect(parseMinigameMessage(42)).toBeNull()
  })

  it('rejects payloads from other sources', () => {
    expect(
      parseMinigameMessage({
        source: 'something-else',
        type: 'minigame-win',
        id: 'game-1',
      }),
    ).toBeNull()
  })

  it('rejects payloads without a valid id', () => {
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-win',
      }),
    ).toBeNull()
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-win',
        id: '',
      }),
    ).toBeNull()
  })

  it('rejects unknown event types', () => {
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-explode',
        id: 'g',
      }),
    ).toBeNull()
  })

  it('parses minimal ready/win/lose/continue events', () => {
    const types: MinigameEvent['type'][] = [
      'minigame-ready',
      'minigame-win',
      'minigame-lose',
      'minigame-continue',
    ]
    for (const t of types) {
      expect(
        parseMinigameMessage({
          source: 'reel-minigame',
          type: t,
          id: 'magical-witch-platformer-1',
        }),
      ).toEqual({
        type: t,
        id: 'magical-witch-platformer-1',
      })
    }
  })

  it('extracts optional score + reason when present', () => {
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-win',
        id: 'g',
        score: 120,
        reason: 'perfect run',
      }),
    ).toEqual({
      type: 'minigame-win',
      id: 'g',
      score: 120,
      reason: 'perfect run',
    })
  })

  it('ignores non-finite score and empty reason', () => {
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-lose',
        id: 'g',
        score: NaN,
        reason: '',
      }),
    ).toEqual({ type: 'minigame-lose', id: 'g' })
  })

  it('ignores non-number score types', () => {
    expect(
      parseMinigameMessage({
        source: 'reel-minigame',
        type: 'minigame-win',
        id: 'g',
        score: '100' as unknown as number,
      }),
    ).toEqual({ type: 'minigame-win', id: 'g' })
  })
})
