// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildGen3DHandoffViews } from './CharacterDesign'
import { characterAssetUrl, relPathsToTurnaround3DHandoff } from '../lib/api-client'

describe('buildGen3DHandoffViews', () => {
  it('returns null when front is missing', () => {
    expect(buildGen3DHandoffViews({ back: { path: 'b.png', url: 'http://b' } })).toBeNull()
    expect(buildGen3DHandoffViews({ front: { path: 'f.png', url: '  ' } })).toBeNull()
  })

  it('extracts url strings from view assets', () => {
    expect(buildGen3DHandoffViews({
      front: { path: 'f.png', url: 'http://front' },
      back: { path: 'b.png', url: 'http://back' },
      left: { path: 'l.png', url: 'http://left' },
      right: { path: 'r.png', url: 'http://right' },
    })).toEqual({
      front: 'http://front',
      back: 'http://back',
      left: 'http://left',
      right: 'http://right',
    })
  })

  it('omits empty optional views', () => {
    expect(buildGen3DHandoffViews({
      front: { path: 'f.png', url: 'http://front' },
    })).toEqual({ front: 'http://front' })
  })
})

describe('relPathsToTurnaround3DHandoff', () => {
  it('builds asset URLs from manifest-relative paths', () => {
    const views = relPathsToTurnaround3DHandoff('my-game', 'hero_01', {
      front: 'turnaround/front.jpg',
      back: 'turnaround/back.jpg',
    })
    expect(views).toEqual({
      front: characterAssetUrl('my-game', 'hero_01', 'turnaround/front.jpg'),
      back: characterAssetUrl('my-game', 'hero_01', 'turnaround/back.jpg'),
    })
  })

  it('returns null when front is missing', () => {
    expect(relPathsToTurnaround3DHandoff('my-game', 'hero_01', {
      back: 'turnaround/back.jpg',
    })).toBeNull()
  })
})
