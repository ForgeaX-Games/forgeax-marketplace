import { describe, expect, it } from 'vitest'
import {
  FILM_LOOK_PRESETS,
  FILM_LOOK_LIST,
  DEFAULT_FILM_LOOK,
  filmLookColorPrefix,
  filmLookAuthoringHint,
  type FilmLook,
} from '../config/filmLookPresets'

const ALL: FilmLook[] = [
  'retro-future',
  'baroque-chiaroscuro',
  'teal-orange',
  'bleach-bypass',
  'pastel-symmetry',
  'noir-lowkey',
  'warm-nostalgia',
  'clinical-scifi',
  'morandi-muted',
  'bronze-epic',
]

describe('filmLookPresets', () => {
  it('十个调色风格全部存在 + 字段齐全', () => {
    for (const k of ALL) {
      const p = FILM_LOOK_PRESETS[k]
      expect(p, k).toBeDefined()
      expect(p.id).toBe(k)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.hint.length).toBeGreaterThan(0)
      expect(p.swatch).toHaveLength(2)
      expect(p.swatch[0]).toMatch(/^#/)
      expect(p.swatch[1]).toMatch(/^#/)
      expect(p.tagline.length).toBeGreaterThan(0)
      expect(p.colorPrefix.length).toBeGreaterThan(20)
      expect(p.sceneAdapt.length).toBeGreaterThan(10)
      expect(p.authoringHint.length).toBeGreaterThan(0)
      expect(p.posterPrompt.length).toBeGreaterThan(20)
    }
  })

  it('LIST 顺序稳定 · 十项', () => {
    expect(FILM_LOOK_LIST).toHaveLength(10)
    expect(FILM_LOOK_LIST.map((p) => p.id)).toEqual(ALL)
  })

  it('默认查看色是有效 id', () => {
    expect(ALL).toContain(DEFAULT_FILM_LOOK)
  })

  describe('filmLookColorPrefix', () => {
    it('空/未知 → 空串', () => {
      expect(filmLookColorPrefix(undefined)).toBe('')
      expect(filmLookColorPrefix(null)).toBe('')
      expect(filmLookColorPrefix('bogus' as unknown as FilmLook)).toBe('')
    })
    it('已知 → 返回调色锚点', () => {
      expect(filmLookColorPrefix('teal-orange')).toBe(
        FILM_LOOK_PRESETS['teal-orange'].colorPrefix,
      )
    })
  })

  describe('filmLookAuthoringHint', () => {
    it('空/未知 → 空串', () => {
      expect(filmLookAuthoringHint(undefined)).toBe('')
      expect(filmLookAuthoringHint('bogus' as unknown as FilmLook)).toBe('')
    })
    it('已知 → 含文风 + 场景自适应', () => {
      const h = filmLookAuthoringHint('morandi-muted')
      expect(h).toContain(FILM_LOOK_PRESETS['morandi-muted'].authoringHint)
      expect(h).toContain('场景自适应')
    })
  })

  it('版权安全：调色锚点/海报无常见片名/品牌', () => {
    const banned = /blade runner|gattaca|wes anderson|dune|matrix|kodak/i
    for (const p of FILM_LOOK_LIST) {
      expect(p.colorPrefix, p.id).not.toMatch(banned)
      expect(p.posterPrompt, p.id).not.toMatch(banned)
      expect(p.tagline, p.id).not.toMatch(banned)
    }
  })
})
