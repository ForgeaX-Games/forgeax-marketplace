import { describe, expect, it } from 'vitest'
import {
  NPC_OCCUPATIONS_BY_WORLD,
  listNpcOccupations,
  describeNpcOccupation,
} from '../NpcOccupations'

const WORLD_IDS = [
  'modern-urban',
  'medieval-fantasy',
  'cyberpunk',
  'eastern-fantasy',
  'sci-fi',
  'post-apocalypse',
  'steampunk',
  'dark-fantasy',
  'pirate-nautical',
  'mythology',
] as const

describe('NpcOccupations catalog', () => {
  it('exposes occupations for every supported world setting', () => {
    for (const id of WORLD_IDS) {
      expect(NPC_OCCUPATIONS_BY_WORLD[id], `missing world ${id}`).toBeDefined()
      expect(NPC_OCCUPATIONS_BY_WORLD[id].length).toBeGreaterThanOrEqual(5)
    }
  })

  it.each(WORLD_IDS)('world "%s" entries have non-empty zh + en fields', (world) => {
    const list = NPC_OCCUPATIONS_BY_WORLD[world]
    for (const occ of list) {
      expect(occ.zh.trim().length).toBeGreaterThan(0)
      expect(occ.en.trim().length).toBeGreaterThan(0)
    }
  })

  it.each(WORLD_IDS)('world "%s" chinese labels are unique within the world', (world) => {
    const list = NPC_OCCUPATIONS_BY_WORLD[world]
    const zhSet = new Set(list.map(o => o.zh))
    expect(zhSet.size).toBe(list.length)
  })

  it('never describes a civilian as actively holding / wielding a weapon or casting magic', () => {
    // NPC 路人 prompt 片段里绝对不能包含「主动持械 / 战斗中 / 施法」类关键词。
    // 用正则而不是 substring 匹配——否则 "no drawn weapon" 这种合理的否定语
    // 会被误伤（see 测试历史：modern-urban/警察 条目）。
    const forbiddenPatterns: RegExp[] = [
      /\bwielding\b/,
      /\bunsheathed\b/,
      /\bholding (?:a |an )?(?:sword|blade|axe|mace|spear|bow|rifle|pistol|gun|wand|staff)\b/,
      /\bcasting (?:a )?spell\b/,
      /\bglowing (?:aura|spell|magic)\b/,
      /\bsignature ultimate\b/,
      /\bcombat stance\b/,
      /\bbattle stance\b/,
    ]
    for (const [world, list] of Object.entries(NPC_OCCUPATIONS_BY_WORLD)) {
      for (const occ of list) {
        const en = occ.en.toLowerCase()
        for (const pat of forbiddenPatterns) {
          expect(
            pat.test(en),
            `world=${world} occ=${occ.zh} matches forbidden pattern ${pat} in: ${occ.en}`,
          ).toBe(false)
        }
      }
    }
  })
})

describe('listNpcOccupations()', () => {
  it('returns the exact list for known worlds', () => {
    const list = listNpcOccupations('modern-urban')
    expect(list).toBe(NPC_OCCUPATIONS_BY_WORLD['modern-urban'])
  })

  it('falls back to modern-urban for unknown / empty world ids', () => {
    expect(listNpcOccupations('nonexistent-world')).toBe(NPC_OCCUPATIONS_BY_WORLD['modern-urban'])
    expect(listNpcOccupations(undefined)).toBe(NPC_OCCUPATIONS_BY_WORLD['modern-urban'])
    expect(listNpcOccupations(null)).toBe(NPC_OCCUPATIONS_BY_WORLD['modern-urban'])
    expect(listNpcOccupations('')).toBe(NPC_OCCUPATIONS_BY_WORLD['modern-urban'])
  })
})

describe('describeNpcOccupation()', () => {
  it('hits the exact entry when (world, occupation) matches the catalog', () => {
    const out = describeNpcOccupation('modern-urban', '上班族')
    expect(out.zh).toBe('上班族')
    // 英文描述必须是词表原本的富细节版（包含 "office worker" 核心词），不是
    // generic fallback。
    expect(out.en).toMatch(/office worker/i)
    expect(out.en.length).toBeGreaterThan(20)
  })

  it('falls back to the common-occupation hint when occupation is missing in catalog', () => {
    // 中世纪奇幻词表里没有「警察」——但 common hint 表里有 police officer。
    const out = describeNpcOccupation('medieval-fantasy', '警察')
    expect(out.zh).toBe('警察')
    expect(out.en).toMatch(/police officer/i)
    expect(out.en).toMatch(/no weapon/)
  })

  it('falls back to the generic civilian template for unknown occupations', () => {
    const out = describeNpcOccupation('modern-urban', '某种完全没听过的怪职业')
    expect(out.zh).toBe('某种完全没听过的怪职业')
    expect(out.en).toMatch(/ordinary civilian/)
    expect(out.en).toMatch(/no weapon/)
  })

  it('defaults the zh label to 路人 when occupation is empty', () => {
    const out = describeNpcOccupation('modern-urban', '')
    expect(out.zh).toBe('路人')
  })

  it('never emits weapon / combat language in the english fragment', () => {
    // 路人 prompt 的核心前提就是「不生成战斗相关画面」。即使用户乱填职业
    // 名，generic fallback 也要保留 `no weapon` 约束。
    const out = describeNpcOccupation('modern-urban', '疯狂屠龙者')
    expect(out.en).toMatch(/no weapon/i)
    expect(out.en.toLowerCase()).not.toMatch(/(drawn sword|wielding|combat stance)/)
  })
})
