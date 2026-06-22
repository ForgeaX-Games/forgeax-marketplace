// @source wb-character/src/vfx/combat/CombatPresets.ts
/**
 * CombatPresets -- base stat packs per character class (Lv.1 baseline).
 *
 * Scaling: ATK/MATK/HP grow by 1.08^level from Lv.1 base.
 */

import type { CharacterStatPack, GunStats } from './CombatStats'
import { DEFAULT_SKILL_COEFFS, DEFAULT_GUN_STATS } from './CombatStats'

// ─── Base stat packs (Lv.1) ────────────────────────────────────────────────

const PRESETS_LV1: Record<string, Omit<CharacterStatPack, 'level' | 'skills' | 'gun'>> = {
  'swordsman': {
    charClass: 'swordsman',
    base: { ATK:80,  MATK:20,  DEF:70,  MDEF:50,  HP:1200, HP_CUR:1200, SPD:60,  CRIT_RATE:0.10, CRIT_DMG:1.5 },
  },
  'berserker': {
    charClass: 'berserker',
    base: { ATK:120, MATK:10,  DEF:40,  MDEF:30,  HP:1500, HP_CUR:1500, SPD:70,  CRIT_RATE:0.12, CRIT_DMG:1.8 },
  },
  'mage': {
    charClass: 'mage',
    base: { ATK:20,  MATK:110, DEF:30,  MDEF:90,  HP:800,  HP_CUR:800,  SPD:50,  CRIT_RATE:0.08, CRIT_DMG:2.0 },
  },
  'elementalist': {
    charClass: 'elementalist',
    base: { ATK:30,  MATK:100, DEF:35,  MDEF:85,  HP:850,  HP_CUR:850,  SPD:55,  CRIT_RATE:0.10, CRIT_DMG:1.9 },
  },
  'archer': {
    charClass: 'archer',
    base: { ATK:70,  MATK:30,  DEF:45,  MDEF:55,  HP:900,  HP_CUR:900,  SPD:80,  CRIT_RATE:0.18, CRIT_DMG:1.6 },
  },
  'gunner': {
    charClass: 'gunner',
    base: { ATK:85,  MATK:15,  DEF:45,  MDEF:40,  HP:950,  HP_CUR:950,  SPD:75,  CRIT_RATE:0.20, CRIT_DMG:1.5 },
  },
  'assassin': {
    charClass: 'assassin',
    base: { ATK:90,  MATK:25,  DEF:35,  MDEF:35,  HP:850,  HP_CUR:850,  SPD:90,  CRIT_RATE:0.25, CRIT_DMG:2.0 },
  },
  'shadow-assassin': {
    charClass: 'shadow-assassin',
    base: { ATK:100, MATK:40,  DEF:35,  MDEF:40,  HP:800,  HP_CUR:800,  SPD:90,  CRIT_RATE:0.28, CRIT_DMG:2.2 },
  },
  'fighter': {
    charClass: 'fighter',
    base: { ATK:95,  MATK:20,  DEF:65,  MDEF:60,  HP:1100, HP_CUR:1100, SPD:75,  CRIT_RATE:0.15, CRIT_DMG:1.6 },
  },
  'paladin': {
    charClass: 'paladin',
    base: { ATK:75,  MATK:50,  DEF:90,  MDEF:80,  HP:1400, HP_CUR:1400, SPD:55,  CRIT_RATE:0.08, CRIT_DMG:1.4 },
  },
  'priest': {
    charClass: 'priest',
    base: { ATK:20,  MATK:80,  DEF:40,  MDEF:100, HP:900,  HP_CUR:900,  SPD:50,  CRIT_RATE:0.05, CRIT_DMG:1.5 },
  },
  'summoner': {
    charClass: 'summoner',
    base: { ATK:40,  MATK:90,  DEF:40,  MDEF:75,  HP:900,  HP_CUR:900,  SPD:55,  CRIT_RATE:0.10, CRIT_DMG:1.6 },
  },
  'ninja': {
    charClass: 'ninja',
    base: { ATK:80,  MATK:30,  DEF:35,  MDEF:40,  HP:800,  HP_CUR:800,  SPD:95,  CRIT_RATE:0.22, CRIT_DMG:1.8 },
  },
  'monk': {
    charClass: 'monk',
    base: { ATK:88,  MATK:22,  DEF:70,  MDEF:65,  HP:1050, HP_CUR:1050, SPD:72,  CRIT_RATE:0.14, CRIT_DMG:1.7 },
  },
  'mechanic': {
    charClass: 'mechanic',
    base: { ATK:60,  MATK:50,  DEF:60,  MDEF:55,  HP:1000, HP_CUR:1000, SPD:55,  CRIT_RATE:0.12, CRIT_DMG:1.5 },
  },
  'alchemist': {
    charClass: 'alchemist',
    base: { ATK:55,  MATK:85,  DEF:45,  MDEF:70,  HP:850,  HP_CUR:850,  SPD:58,  CRIT_RATE:0.14, CRIT_DMG:1.6 },
  },
  'exorcist': {
    charClass: 'exorcist',
    base: { ATK:65,  MATK:75,  DEF:55,  MDEF:80,  HP:950,  HP_CUR:950,  SPD:60,  CRIT_RATE:0.12, CRIT_DMG:1.6 },
  },
  'bard': {
    charClass: 'bard',
    base: { ATK:45,  MATK:70,  DEF:45,  MDEF:65,  HP:900,  HP_CUR:900,  SPD:65,  CRIT_RATE:0.10, CRIT_DMG:1.5 },
  },
}

/** Gun presets for ranged classes */
const GUN_PRESETS: Partial<Record<string, GunStats>> = {
  'gunner':           { firerate:8,  bulletSpeed:35, spread:2,  reloadTime:1.8, magSize:30, damage:0.85 },
  'mechanic':         { firerate:15, bulletSpeed:28, spread:5,  reloadTime:2.5, magSize:50, damage:0.60 },
  'shadow-assassin':  { firerate:3,  bulletSpeed:40, spread:1,  reloadTime:2.0, magSize:8,  damage:1.20 },
}

// ─── Stat scaling ──────────────────────────────────────────────────────────

const GROWTH = 1.08  // per-level multiplier

/** Build a full stat pack for a class at a given level */
export function getStatPack(charClass: string, level = 1): CharacterStatPack {
  const preset = PRESETS_LV1[charClass] ?? PRESETS_LV1['swordsman']
  const mult   = Math.pow(GROWTH, level - 1)

  const base = { ...preset.base }
  base.ATK    = Math.round(base.ATK   * mult)
  base.MATK   = Math.round(base.MATK  * mult)
  base.HP     = Math.round(base.HP    * mult)
  base.HP_CUR = base.HP  // reset to full

  return {
    charClass,
    level,
    base,
    skills: DEFAULT_SKILL_COEFFS.map(s => ({ ...s })),
    gun:    GUN_PRESETS[charClass] ? { ...GUN_PRESETS[charClass]! } : undefined,
  }
}

/** All available class IDs */
export const CLASS_LIST = Object.keys(PRESETS_LV1)

/** Short description note for a class */
export function getClassNote(charClass: string): string {
  const notes: Record<string, string> = {
    'swordsman':      'balanced combo',
    'berserker':      'high ATK AoE',
    'mage':           'high magic multi-hit',
    'elementalist':   'multi-element',
    'archer':         'high crit pierce',
    'gunner':         'high crit firerate',
    'assassin':       'high crit swift',
    'shadow-assassin':'dark high crit',
    'fighter':        'melee shockwave',
    'paladin':        'tank holy',
    'priest':         'support heal',
    'summoner':       'summon multi-target',
    'ninja':          'ultra-fast multi-hit',
    'monk':           'chi shock',
    'mechanic':       'mech multi-tool',
    'alchemist':      'poison blast AoE',
    'exorcist':       'light-dark dual',
    'bard':           'support buff',
  }
  return notes[charClass] ?? ''
}
