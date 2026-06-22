// @source wb-character/src/vfx/combat/CombatStats.ts
/**
 * CombatStats — 
 *
 * ： 、 、 。
 * ，  Three.js  VFX 。
 */

// ───  ─────────────────────────────────────────────────────────────────

export interface BaseStats {
  ATK:       number   // （ ）
  MATK:      number   //
  DEF:       number   //
  MDEF:      number   //
  HP:        number   //
  HP_CUR:    number   //
  SPD:       number   // （ / ）
  CRIT_RATE: number   //  0~1
  CRIT_DMG:  number   // （  1.5 = 150%）
}

// ─── （ ）─────────────────────────────────────────────────

export interface SkillCoeff {
  slotIndex:   number   // 0~5（  6 ）
  name:        string
  multiplier:  number   // （  ATK/MATK）
  hitCount:    number   // （  → ）
  aoeRadius:   number   // AOE （ ）
  knockback:   number   // （  0~1）
  isMagic:     boolean  // true=  MATK ，false=  ATK
  elementType: string   // （ ）
  cooldown:    number   // （ ）
}

// ───  ──────────────────────────────────────────────────────────────

export interface GunStats {
  firerate:    number   // （ / ）
  bulletSpeed: number   // （ / ）
  spread:      number   // （ ）
  reloadTime:  number   // （ ）
  magSize:     number   //
  damage:      number   // （  ATK ）
}

// ───  ───────────────────────────────────────────────────────────

export interface CharacterStatPack {
  charClass:  string
  level:      number
  base:       BaseStats
  skills:     SkillCoeff[]
  gun?:       GunStats
}

// ───  ───────────────────────────────────────────────────────────────

export const DEFAULT_SKILL_COEFFS: SkillCoeff[] = [
  { slotIndex:0, name:'normal',    multiplier:1.0,  hitCount:1, aoeRadius:0.5, knockback:0.1, isMagic:false, elementType:'physical', cooldown:0    },
  { slotIndex:1, name:'skill1',    multiplier:2.5,  hitCount:2, aoeRadius:1.0, knockback:0.3, isMagic:false, elementType:'fire',     cooldown:5    },
  { slotIndex:2, name:'skill2',    multiplier:2.0,  hitCount:1, aoeRadius:2.0, knockback:0.5, isMagic:true,  elementType:'ice',      cooldown:8    },
  { slotIndex:3, name:'skill3',    multiplier:3.0,  hitCount:3, aoeRadius:1.5, knockback:0.4, isMagic:true,  elementType:'lightning',cooldown:12   },
  { slotIndex:4, name:'skill4',    multiplier:1.8,  hitCount:1, aoeRadius:0,   knockback:0.2, isMagic:false, elementType:'wind',     cooldown:15   },
  { slotIndex:5, name:'ultimate',  multiplier:8.0,  hitCount:5, aoeRadius:4.0, knockback:1.0, isMagic:true,  elementType:'arcane',   cooldown:60   },
]

export const DEFAULT_GUN_STATS: GunStats = {
  firerate: 6, bulletSpeed: 30, spread: 3, reloadTime: 2.0, magSize: 30, damage: 0.8,
}
