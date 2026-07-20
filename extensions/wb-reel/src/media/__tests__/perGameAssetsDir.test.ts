import { describe, it, expect } from 'vitest'
import { resolveWorkbenchMediaDir } from '../../../vite.config'

// per-kind 硬切换后：原始媒体落到 workbench/<kind>/，无 slug 落 .reel-workbench/<kind>，
// 不再回退旧 .reel-assets / reel/assets。
describe('resolveWorkbenchMediaDir', () => {
  it('returns per-game per-kind workbench dir when slug valid', () => {
    expect(resolveWorkbenchMediaDir('/proj', 'demo', 'image')).toBe(
      '/proj/.forgeax/games/demo/workbench/image',
    )
    expect(resolveWorkbenchMediaDir('/proj', 'demo', 'video')).toBe(
      '/proj/.forgeax/games/demo/workbench/video',
    )
    expect(resolveWorkbenchMediaDir('/proj', 'demo', 'audio')).toBe(
      '/proj/.forgeax/games/demo/workbench/audio',
    )
  })

  it('falls back to package-global .reel-workbench/<kind> when no slug', () => {
    expect(resolveWorkbenchMediaDir('/proj', null, 'image')).toBe(
      '/proj/.reel-workbench/image',
    )
  })

  it('falls back to global dir when slug is invalid (path-traversal guard)', () => {
    expect(resolveWorkbenchMediaDir('/proj', '../evil', 'video')).toBe(
      '/proj/.reel-workbench/video',
    )
  })
})
