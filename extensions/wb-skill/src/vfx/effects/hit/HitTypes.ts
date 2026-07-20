// @source wb-character/src/vfx/effects/hit/HitTypes.ts
/**
 * HitTypes — 
 * ，  Three.js 
 */

import * as THREE from 'three'

/**  */
export type HitType =
  | 'light'      // ：  +
  | 'heavy'      // ：  +
  | 'critical'   // ：  +
  | 'elemental'  // ：
  | 'blocked'    // ：  +
  | 'heal'       // ： （ ）

/** （ ， ） */
export type HitDirection = THREE.Vector3

/** （ ， ） */
export type HitElement =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'dark'
  | 'light'
  | 'physical'

/**  */
export const HIT_ELEMENT_COLORS: Record<HitElement, { spark: THREE.Color; glow: THREE.Color }> = {
  fire:      { spark: new THREE.Color('#ff6600'), glow: new THREE.Color('#ffcc00') },
  ice:       { spark: new THREE.Color('#88ddff'), glow: new THREE.Color('#ffffff') },
  lightning: { spark: new THREE.Color('#ffee00'), glow: new THREE.Color('#aaaaff') },
  poison:    { spark: new THREE.Color('#44ff00'), glow: new THREE.Color('#22aa00') },
  dark:      { spark: new THREE.Color('#9900cc'), glow: new THREE.Color('#ff44ff') },
  light:     { spark: new THREE.Color('#ffffaa'), glow: new THREE.Color('#ffffff') },
  physical:  { spark: new THREE.Color('#e0c090'), glow: new THREE.Color('#ffffff') },
}

/**  */
export interface HitParams {
  /**  */
  type: HitType
  /** （  CHEST  WAIST ） */
  contactPoint: THREE.Vector3
  /** （  → ， ）*/
  hitDirection: HitDirection
  /** （type='elemental' ） */
  element?: HitElement
  /** （1.0 = ， ） */
  scale?: number
}

/**  */
export interface FlashParams {
  /** （0~1） */
  peakIntensity: number
  /** （ ） */
  duration: number
  /**  */
  color: THREE.Color
}

/**  */
export function getFlashParams(type: HitType, element?: HitElement): FlashParams {
  const baseColor = element
    ? HIT_ELEMENT_COLORS[element].glow.clone()
    : new THREE.Color('#ffffff')

  switch (type) {
    case 'light':    return { peakIntensity: 0.4, duration: 0.08, color: baseColor }
    case 'heavy':    return { peakIntensity: 0.8, duration: 0.18, color: baseColor }
    case 'critical': return { peakIntensity: 1.0, duration: 0.28, color: new THREE.Color('#ffffff') }
    case 'elemental': return { peakIntensity: 0.7, duration: 0.15, color: baseColor }
    case 'blocked':  return { peakIntensity: 0.5, duration: 0.10, color: new THREE.Color('#ffdd44') }
    case 'heal':     return { peakIntensity: 0.3, duration: 0.20, color: new THREE.Color('#44ff88') }
  }
}

/**  */
export function getSparkCount(type: HitType, scale = 1.0): number {
  const base: Record<HitType, number> = {
    light:    12,
    heavy:    30,
    critical: 50,
    elemental:24,
    blocked:  20,
    heal:     16,
  }
  return Math.round(base[type] * scale)
}
