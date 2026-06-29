import { describe, it, expect } from 'vitest'
import {
  REEL_GAME_SCHEMA_VERSION,
  makeReelGamePayload,
  extractScenario,
} from '../reelGamePayload'

describe('reelGamePayload', () => {
  it('wraps a scenario with the schema version', () => {
    const p = makeReelGamePayload({ id: 's1', title: 'demo' })
    expect(p).toEqual({
      schemaVersion: REEL_GAME_SCHEMA_VERSION,
      scenario: { id: 's1', title: 'demo' },
    })
  })

  it('extracts scenario back from a payload', () => {
    expect(extractScenario({ schemaVersion: 1, scenario: { id: 's1' } })).toEqual({ id: 's1' })
  })

  it('returns null when payload is missing scenario', () => {
    expect(extractScenario({ schemaVersion: 1 })).toBeNull()
  })

  it('returns null when payload is not an object', () => {
    expect(extractScenario(null)).toBeNull()
    expect(extractScenario('nope')).toBeNull()
  })
})
