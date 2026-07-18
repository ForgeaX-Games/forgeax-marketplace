import { describe, it, expect } from 'vitest'
import {
  makeReelLevelPack,
  REEL_GAME_ASSET_KIND,
  REEL_LEVEL_SCHEMA_VERSION,
  INTERNAL_TEXT_PACKAGE_KIND,
  REEL_LEVEL_MANIFEST_FILENAME,
  type ReelLevelPack,
} from '../reelLevel'

describe('reelLevel · contract constants', () => {
  it('pins the engine-canonical InternalTextPackage shell + filename', () => {
    expect(INTERNAL_TEXT_PACKAGE_KIND).toBe('internal-text-package')
    expect(REEL_GAME_ASSET_KIND).toBe('reel-game')
    expect(REEL_LEVEL_SCHEMA_VERSION).toBe('1.0.0')
    expect(REEL_LEVEL_MANIFEST_FILENAME).toBe('ReelLevel.pack.json')
  })
})

describe('reelLevel · makeReelLevelPack', () => {
  it('wraps a single reel-game asset into a valid pack', () => {
    const pack: ReelLevelPack<{ id: string }> = makeReelLevelPack({
      guid: '0190a0b1-0000-7000-8000-000000000001',
      kind: REEL_GAME_ASSET_KIND,
      name: 'demo',
      payload: { id: 's1' },
      refs: [],
    })
    expect(pack.schemaVersion).toBe('1.0.0')
    expect(pack.kind).toBe('internal-text-package')
    expect(pack.assets).toHaveLength(1)
    expect(pack.assets[0]!.kind).toBe('reel-game')
    expect(pack.assets[0]!.payload).toEqual({ id: 's1' })
  })

  it('forces refs:[] even when omitted (engine requires the field present)', () => {
    const pack = makeReelLevelPack({
      guid: 'g',
      kind: REEL_GAME_ASSET_KIND,
      payload: {},
      // @ts-expect-error intentionally omit refs to prove the default fill
      refs: undefined,
    })
    expect(Array.isArray(pack.assets[0]!.refs)).toBe(true)
    expect(pack.assets[0]!.refs).toEqual([])
  })
})
