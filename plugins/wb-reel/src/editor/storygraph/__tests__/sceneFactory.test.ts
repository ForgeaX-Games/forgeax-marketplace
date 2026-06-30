import { describe, expect, it } from 'vitest'
import { makeBlankScene } from '../sceneFactory'

describe('makeBlankScene', () => {
  it('returns a scene with sane defaults', () => {
    const s = makeBlankScene()
    expect(s.id).toMatch(/^sc-/)
    expect(s.title).toBeTruthy()
    expect(s.durationMs).toBeGreaterThan(0)
    expect(s.media.kind).toBe('PLACEHOLDER')
    expect(s.dialogue).toEqual([])
    expect(s.branches).toEqual([])
  })

  it('id is unique on each call', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 16; i++) {
      ids.add(makeBlankScene().id)
    }
    expect(ids.size).toBe(16)
  })

  it('honors provided title', () => {
    expect(makeBlankScene({ title: '雨夜外景' }).title).toBe('雨夜外景')
  })

  it('honors provided durationMs', () => {
    expect(makeBlankScene({ durationMs: 12000 }).durationMs).toBe(12000)
  })

  it('id-only title falls back to a localized default', () => {
    const s = makeBlankScene()
    expect(s.title.length).toBeGreaterThan(0)
    expect(s.title).not.toMatch(/^sc-/)
  })
})
