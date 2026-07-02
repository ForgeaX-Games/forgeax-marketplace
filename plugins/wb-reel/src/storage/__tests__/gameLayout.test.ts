import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  GAME_SLUG_RE,
  isValidGameSlug,
  gameDir,
  assetsDir,
  reelLevelManifestPath,
  reelMediaDir,
  workbenchDir,
  workbenchReelDir,
  workbenchMediaDir,
  legacyReelDir,
  legacyReelAssetsDir,
} from '../gameLayout'

const ROOT = '/proj'
const SLUG = 'my-game'
const base = resolve(ROOT, '.forgeax', 'games', SLUG)

describe('gameLayout · slug validation', () => {
  it('accepts lowercase/digit/hyphen slugs', () => {
    expect(isValidGameSlug('abc')).toBe(true)
    expect(isValidGameSlug('a1-b2')).toBe(true)
    expect(GAME_SLUG_RE.test('1234')).toBe(true)
  })
  it('rejects path-traversal / uppercase / empty', () => {
    expect(isValidGameSlug('../etc')).toBe(false)
    expect(isValidGameSlug('Abc')).toBe(false)
    expect(isValidGameSlug('-lead')).toBe(false)
    expect(isValidGameSlug('')).toBe(false)
    expect(isValidGameSlug(null)).toBe(false)
    expect(isValidGameSlug(undefined)).toBe(false)
  })
})

describe('gameLayout · new layout paths', () => {
  it('resolves the clean assets/ output tree', () => {
    expect(gameDir(ROOT, SLUG)).toBe(base)
    expect(assetsDir(ROOT, SLUG)).toBe(resolve(base, 'assets'))
    expect(reelLevelManifestPath(ROOT, SLUG)).toBe(
      resolve(base, 'assets', 'ReelLevel.pack.json'),
    )
    expect(reelMediaDir(ROOT, SLUG)).toBe(resolve(base, 'assets', 'reel-media'))
  })

  it('resolves the workbench/ raw tree (reel data + per-kind media)', () => {
    expect(workbenchDir(ROOT, SLUG)).toBe(resolve(base, 'workbench'))
    expect(workbenchReelDir(ROOT, SLUG)).toBe(resolve(base, 'workbench', 'reel'))
    expect(workbenchMediaDir(ROOT, SLUG, 'image')).toBe(resolve(base, 'workbench', 'image'))
    expect(workbenchMediaDir(ROOT, SLUG, 'video')).toBe(resolve(base, 'workbench', 'video'))
    expect(workbenchMediaDir(ROOT, SLUG, 'audio')).toBe(resolve(base, 'workbench', 'audio'))
  })

  it('keeps assets/ and workbench/ disjoint (no shared subtree)', () => {
    expect(assetsDir(ROOT, SLUG)).not.toBe(workbenchDir(ROOT, SLUG))
    expect(reelMediaDir(ROOT, SLUG).startsWith(workbenchDir(ROOT, SLUG))).toBe(false)
    expect(workbenchReelDir(ROOT, SLUG).startsWith(assetsDir(ROOT, SLUG))).toBe(false)
  })
})

describe('gameLayout · legacy (pre-migration) paths', () => {
  it('resolves the old reel/ + reel/assets tree as migration sources', () => {
    expect(legacyReelDir(ROOT, SLUG)).toBe(resolve(base, 'reel'))
    expect(legacyReelAssetsDir(ROOT, SLUG)).toBe(resolve(base, 'reel', 'assets'))
  })
})
