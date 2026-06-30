// @source wb-character/src/vfx/targeting/TargetTypes.ts
/**
 * TargetTypes — 
 */

import * as THREE from 'three'

/**  */
export type TargetRelation = 'enemy' | 'neutral' | 'friendly' | 'interactive'

/**  */
export type LockState = 'none' | 'soft' | 'hard'

/**  */
export interface TargetInfo {
  id:         string
  position:   THREE.Vector3
  /** （ ） */
  height:     number
  relation:   TargetRelation
  /**  HP  0~1（ ） */
  hpRatio:    number
  /**  0~10 */
  threat:     number
  /**  */
  lockable:   boolean
}

/**  */
export interface AcquisitionParams {
  /**  */
  attackerPos:   THREE.Vector3
  /** （ ， ）*/
  attackerForward: THREE.Vector3
  /**  */
  maxRange:      number
  /** （ ， ，  120 =  60°）*/
  fovDeg:        number
  /**  */
  enemyOnly:     boolean
}

/** （ ） */
export const LOCK_COLORS: Record<TargetRelation, THREE.Color> = {
  enemy:       new THREE.Color(0xff2222),
  neutral:     new THREE.Color(0xffffff),
  friendly:    new THREE.Color(0x44ff44),
  interactive: new THREE.Color(0xffcc00),
}

/** ： →  */
export function getLockColor(relation: TargetRelation, progress: number): THREE.Color {
  const base = LOCK_COLORS[relation].clone()
  //
  base.multiplyScalar(0.6 + progress * 0.4)
  return base
}
