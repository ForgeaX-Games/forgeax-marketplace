// @source wb-character/src/vfx/combat/CombatFormula.ts
/**
 * CombatFormula — 
 *
 *  RPG ：
 *    =  *  *  * 
 *
 * ， 。
 */

import type { BaseStats, SkillCoeff, GunStats } from './CombatStats'

// ───  ─────────────────────────────────────────────────────────────────

export interface DamageResult {
  /** （ ）*/
  raw:         number
  /**  */
  reduced:     number
  /** （ ） */
  final:       number
  isCritical:  boolean
  /** （hitCount > 1 ）*/
  perHit:      number[]
  /** （0~1 → UI ）*/
  knockback:   number
}

export interface GunDamageResult {
  single:      number   //
  dps:         number   // DPS（ ）
  reloadDps:   number   //  DPS
  isCritical:  boolean
}

// ─── （ ）────────────────────────────────────────────────────

function defReduction(def: number): number {
  // 200 DEF → 50% ；  75%
  return Math.min(def / (def + 200), 0.75)
}

// ─── （ ， ）─────────────────────────

const ELEMENT_BONUS: Record<string, number> = {
  physical:  1.00,
  fire:      1.10,
  ice:       1.05,
  lightning: 1.12,
  wind:      1.03,
  dark:      1.08,
  light:     1.08,
  poison:    1.06,
  arcane:    1.15,
  mechanical:1.05,
  explosive: 1.20,
  nature:    1.04,
}

// ───  ──────────────────────────────────────────────────────────────

/**
 * 
 * @param attStats  
 * @param skill     
 * @param defStats  （ ，  0 ）
 * @param forceCrit （  UI ）
 */
export function calcSkillDamage(
  attStats:  BaseStats,
  skill:     SkillCoeff,
  defStats?: Partial<BaseStats>,
  forceCrit  = false,
): DamageResult {
  const basePower = skill.isMagic ? attStats.MATK : attStats.ATK
  const rawPerHit = Math.round(basePower * skill.multiplier / skill.hitCount)

  const def         = skill.isMagic
    ? (defStats?.MDEF ?? 0)
    : (defStats?.DEF  ?? 0)
  const reduction   = defReduction(def)
  const afterDef    = Math.round(rawPerHit * (1 - reduction))

  const elemBonus   = ELEMENT_BONUS[skill.elementType] ?? 1.0
  const withElem    = Math.round(afterDef * elemBonus)

  const isCrit      = forceCrit || Math.random() < attStats.CRIT_RATE
  const critMult    = isCrit ? attStats.CRIT_DMG : 1.0
  const finalPerHit = Math.round(withElem * critMult)

  const perHit   = Array(skill.hitCount).fill(finalPerHit)
  const rawTotal = rawPerHit * skill.hitCount
  const final    = finalPerHit * skill.hitCount

  return {
    raw:        rawTotal,
    reduced:    Math.round(afterDef * skill.hitCount),
    final,
    isCritical: isCrit,
    perHit,
    knockback:  skill.knockback,
  }
}

// ───  ──────────────────────────────────────────────────────────────

/**
 * /DPS
 */
export function calcGunDamage(
  attStats: BaseStats,
  gun:      GunStats,
  defStats?: Partial<BaseStats>,
  forceCrit = false,
): GunDamageResult {
  const raw       = Math.round(attStats.ATK * gun.damage)
  const reduction = defReduction(defStats?.DEF ?? 0)
  const afterDef  = Math.round(raw * (1 - reduction))

  const isCrit    = forceCrit || Math.random() < attStats.CRIT_RATE
  const single    = Math.round(afterDef * (isCrit ? attStats.CRIT_DMG : 1.0))

  // DPS = single * firerate（ ）
  const dps       = Math.round(single * gun.firerate)

  //  DPS = (magSize * single) / (magSize / firerate + reloadTime)
  const clipTime  = gun.magSize / gun.firerate + gun.reloadTime
  const reloadDps = Math.round((gun.magSize * single) / clipTime)

  return { single, dps, reloadDps, isCritical: isCrit }
}

// ─── VFX （  → ）────────────────────────────────────

/**
 *  VFX 
 * - 0~500 ：scale 0.5~1.0
 * - 500~2000 ：scale 1.0~1.8
 * - >2000 ：scale 1.8~3.0（ ）
 */
export function damageToVFXScale(damage: number): number {
  if (damage <= 500)  return 0.5 + (damage / 500) * 0.5
  if (damage <= 2000) return 1.0 + ((damage - 500) / 1500) * 0.8
  return Math.min(1.8 + ((damage - 2000) / 3000) * 1.2, 3.0)
}

/**
 * 
 * knockback 0~1 → HitEffect scale 0.5~2.0
 */
export function knockbackToHitScale(knockback: number): number {
  return 0.5 + knockback * 1.5
}
