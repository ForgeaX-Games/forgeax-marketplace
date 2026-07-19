import { describe, expect, it } from 'vitest'
import {
  BODY_TYPE_PRESETS,
  describeProfession,
  getBodyType,
  type BodyTypePreset,
} from '../BodyTypes'

const CLASS_OPTIONS = [
  '剑士', '狂战士', '魔法师', '元素师', '弓箭手', '枪手',
  '刺客', '暗影刺客', '格斗家', '圣骑士', '牧师', '召唤师',
  '忍者', '武僧', '机械师', '炼金术士', '驱魔师', '吟游诗人',
] as const

describe('BodyTypes catalog', () => {
  it('exposes exactly 6 presets and all ids are unique', () => {
    expect(BODY_TYPE_PRESETS.length).toBe(6)
    const ids = BODY_TYPE_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has humanoid as the first (default) preset', () => {
    expect(BODY_TYPE_PRESETS[0].id).toBe('humanoid')
  })

  it.each(BODY_TYPE_PRESETS)('preset "$id" has all required prompt fields', (preset: BodyTypePreset) => {
    expect(preset.icon).toBeTruthy()
    expect(preset.label).toBeTruthy()
    expect(preset.hint).toBeTruthy()
    expect(preset.references).toBeTruthy()
    expect(preset.speciesEn).toBeTruthy()
    expect(preset.proportionsEn).toBeTruthy()
    expect(preset.anatomyEn).toBeTruthy()
    expect(preset.silhouetteEn).toBeTruthy()
    // humanoid intentionally has empty negative; others must have one
    if (preset.id !== 'humanoid') {
      expect(preset.negativeEn.length).toBeGreaterThan(10)
    }
  })

  it('non-humanoid presets cover every class in CLASS_OPTIONS (no gaps)', () => {
    for (const preset of BODY_TYPE_PRESETS) {
      if (preset.id === 'humanoid') continue
      for (const cls of CLASS_OPTIONS) {
        expect(
          preset.professionRemap[cls],
          `preset "${preset.id}" missing class "${cls}"`,
        ).toBeTruthy()
      }
    }
  })
})

describe('getBodyType', () => {
  it('returns humanoid for null/undefined/unknown id', () => {
    expect(getBodyType(null).id).toBe('humanoid')
    expect(getBodyType(undefined).id).toBe('humanoid')
    expect(getBodyType('').id).toBe('humanoid')
    expect(getBodyType('no-such-type').id).toBe('humanoid')
  })

  it('returns the matching preset for a known id', () => {
    expect(getBodyType('insectoid').id).toBe('insectoid')
    expect(getBodyType('spirit').id).toBe('spirit')
  })
})

describe('describeProfession', () => {
  it('returns the default English class for humanoid (unchanged behavior)', () => {
    expect(describeProfession('humanoid', '魔法师', 'Mage')).toBe('Mage')
    expect(describeProfession(null, '剑士', 'Swordsman')).toBe('Swordsman')
  })

  it('uses the preset remap when present (non-humanoid)', () => {
    const out = describeProfession('insectoid', '刺客', 'Assassin')
    expect(out.toLowerCase()).toContain('hornet')
  })

  it('falls back to generic species anchor when class is not in remap', () => {
    const out = describeProfession('insectoid', '不存在的职业', 'MysteryClass')
    // generic fallback: "{speciesEn}, acting as {classEn or chineseClass}"
    expect(out).toContain('bug-knight')
    expect(out.toLowerCase()).toContain('mysteryclass')
  })

  it('covers every class in CLASS_OPTIONS for every non-humanoid preset via remap (no fallback)', () => {
    for (const preset of BODY_TYPE_PRESETS) {
      if (preset.id === 'humanoid') continue
      for (const cls of CLASS_OPTIONS) {
        const out = describeProfession(preset.id, cls, 'Warrior')
        // If it fell through to the generic fallback we'd see "acting as"
        expect(out, `${preset.id}/${cls}`).not.toContain('acting as')
      }
    }
  })
})
