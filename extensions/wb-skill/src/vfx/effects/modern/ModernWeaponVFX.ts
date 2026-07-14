// @source wb-character/src/vfx/effects/modern/ModernWeaponVFX.ts
/**
 * ModernWeaponVFX — （  + ）
 *
 *  MuzzleFlashEffect + BulletTrailEffect + BulletImpactEffect，
 *  fire() / impact() / update() 。
 *
 * ：
 *   const vfx = new ModernWeaponVFX(scene)
 *   vfx.setWeapon('assault_rifle', 'post-apocalypse')
 *   vfx.fire(weaponTip, fireDir)          // 
 *   vfx.impact(hitPoint, hitNormal, 'concrete') // 
 *   //  render loop ：
 *   vfx.update(dt, camera)
 */

import * as THREE from 'three'
import { MuzzleFlashEffect }  from './MuzzleFlashEffect'
import { BulletTrailEffect }  from './BulletTrailEffect'
import { BulletImpactEffect } from './BulletImpactEffect'
import {
  MODERN_WEAPON_CONFIGS,
  inferWeaponCategory,
  type ModernWeaponCategory,
  type ImpactSurface,
} from './ModernWeaponTypes'
import { getWorldStyle } from '../../style/WorldStylePalette'
import { getClassAffinity, ELEMENT_COLORS } from '../../style/ClassElementAffinity'

export class ModernWeaponVFX {
  private muzzle:  MuzzleFlashEffect
  private trail:   BulletTrailEffect
  private impact:  BulletImpactEffect

  private currentCategory: ModernWeaponCategory = 'handgun'
  private currentWorldId   = 'modern-urban'
  private currentClass     = 'gunner'

  constructor(private scene: THREE.Scene) {
    this.muzzle = new MuzzleFlashEffect(scene)
    this.trail  = new BulletTrailEffect(scene)
    this.impact = new BulletImpactEffect(scene)
  }

  /**
   * （ ）
   * @param category   （  inferWeaponCategory ）
   * @param worldId    WorldSetting ID
   * @param charClass  （ ）
   */
  setWeapon(
    category: ModernWeaponCategory,
    worldId = 'modern-urban',
    charClass = 'gunner',
  ): void {
    this.currentCategory = category
    this.currentWorldId  = worldId
    this.currentClass    = charClass
  }

  /**
   * 
   */
  setFromProfile(charClass: string, worldSetting: string): void {
    const category = inferWeaponCategory(charClass, worldSetting)
    this.setWeapon(category, worldSetting, charClass)
  }

  /**
   * ：  + 
   * @param weaponTip  （WEAPON_TIP ）
   * @param fireDir    （ ）
   * @param distance   （ ，  15）
   */
  fire(
    weaponTip: THREE.Vector3,
    fireDir: THREE.Vector3,
    distance = 15,
  ): void {
    const config     = MODERN_WEAPON_CONFIGS[this.currentCategory]
    const worldStyle = getWorldStyle(this.currentWorldId).particleStyle
    const clsAffinity = getClassAffinity(this.currentClass)
    const elemColor  = ELEMENT_COLORS[clsAffinity.primaryElement]
    const colorHex   = '#' + elemColor.main.getHexString()

    this.muzzle.fire(weaponTip, fireDir, config, worldStyle)
    this.trail.fire(weaponTip, fireDir, distance, config, colorHex)
  }

  /**
   * 
   * @param point   
   * @param normal  
   * @param surface 
   * @param scale   （ ）
   */
  onImpact(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    surface: ImpactSurface = 'concrete',
    scale = 1.0,
  ): void {
    this.impact.impact(point, normal, surface, scale)
  }

  /**
   * （  render loop ）
   */
  update(dt: number, camera: THREE.Camera): void {
    this.muzzle.update(dt, camera)
    this.trail.update(dt)
    this.impact.update(dt)
  }

  dispose(): void {
    this.muzzle.dispose()
    this.trail.dispose()
    this.impact.dispose()
  }

  // ───  ──────────────────────────────────────────────────

  get category(): ModernWeaponCategory { return this.currentCategory }
  get worldId():  string { return this.currentWorldId }
}

// ───  ────────────────────────────────────────────────────────

/**
 *  ModernWeaponVFX 
 */
export function createModernWeaponVFX(
  scene: THREE.Scene,
  charClass: string,
  worldSetting: string,
): ModernWeaponVFX {
  const vfx = new ModernWeaponVFX(scene)
  vfx.setFromProfile(charClass, worldSetting)
  return vfx
}
