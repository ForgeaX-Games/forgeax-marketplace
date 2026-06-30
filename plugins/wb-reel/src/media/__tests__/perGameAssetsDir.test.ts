import { describe, it, expect } from 'vitest'
import { resolveAssetsDir } from '../../../vite.config'

describe('resolveAssetsDir', () => {
  it('returns per-game dir when slug present and project root found', () => {
    expect(resolveAssetsDir('/proj', 'demo')).toBe('/proj/.forgeax/games/demo/reel/assets')
  })

  it('falls back to package-global dir when no slug', () => {
    expect(resolveAssetsDir('/proj', null)).toBe('/proj/.reel-assets')
  })

  it('falls back to global dir when slug is invalid (path-traversal guard)', () => {
    expect(resolveAssetsDir('/proj', '../evil')).toBe('/proj/.reel-assets')
  })
})
