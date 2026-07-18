// @source wb-character/src/vfx/mount/MountPointResolver.ts
/**
 * MountPointResolver — 
 *
 * ：
 *   const dims: CharacterDimensions = { height: 1.65, bodyRatio: 7 }
 *   const pos = MountPointResolver.resolve(MountPointId.CHEST, dims)
 *   // pos: THREE.Vector3 in world space
 *
 * ：
 *   -  RATIO_KEYS  ratio 
 *   - （<2  >10）  clamp 
 *   - WEAPON_TIP  dims.weaponLength（  -Z ）
 *   - facingAngle ，  x/z  Y 
 */

import * as THREE from 'three'
import {
  MountPointId,
  CharacterDimensions,
  MountFractions,
  MOUNT_RATIO_TABLE,
  RATIO_KEYS,
} from './MountPointTypes'

// ──  ──────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpFractions(a: MountFractions, b: MountFractions, t: number): MountFractions {
  return {
    yFrac: lerp(a.yFrac, b.yFrac, t),
    xFrac: lerp(a.xFrac, b.xFrac, t),
    zFrac: lerp(a.zFrac, b.zFrac, t),
  }
}

/**
 *  ratioKeys  ratio ，
 *  [loKey, hiKey, t] (t ∈ [0,1] )
 */
function findBracket(ratio: number): [number, number, number] {
  const keys = RATIO_KEYS as unknown as number[]
  if (ratio <= keys[0]) return [keys[0], keys[0], 0]
  if (ratio >= keys[keys.length - 1]) return [keys[keys.length - 1], keys[keys.length - 1], 0]
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]
    const hi = keys[i + 1]
    if (ratio >= lo && ratio <= hi) {
      const t = (ratio - lo) / (hi - lo)
      return [lo, hi, t]
    }
  }
  return [keys[keys.length - 1], keys[keys.length - 1], 0]
}

// ──  ────────────────────────────────────────────────────────────────

export class MountPointResolver {

  /**
   * ，  Vector3（  `out`）
   */
  static resolve(
    id: MountPointId,
    dims: CharacterDimensions,
    out: THREE.Vector3 = new THREE.Vector3(),
  ): THREE.Vector3 {
    const fracs = MountPointResolver.interpolateFractions(id, dims.bodyRatio)

    const H = dims.height
    const rx = dims.rootX ?? 0
    const ry = dims.rootY ?? 0
    const rz = dims.rootZ ?? 0

    let localX = fracs.xFrac * H
    let localY = fracs.yFrac * H
    let localZ = fracs.zFrac * H

    // WEAPON_TIP / WEAPON_TIP_L / MUZZLE： （  -Z ）
    const weaponExtend = dims.weaponLength ?? 0
    if (
      id === MountPointId.WEAPON_TIP ||
      id === MountPointId.WEAPON_TIP_L ||
      id === MountPointId.MUZZLE
    ) {
      localZ -= weaponExtend
    }

    // （  Y ，0 =  -Z， ）
    const facing = dims.facingAngle ?? 0
    if (facing !== 0) {
      const cos = Math.cos(facing)
      const sin = Math.sin(facing)
      const rx2 = cos * localX - sin * localZ
      const rz2 = sin * localX + cos * localZ
      localX = rx2
      localZ = rz2
    }

    out.set(rx + localX, ry + localY, rz + localZ)
    return out
  }

  /**
   * ，  Map<MountPointId, Vector3>
   */
  static resolveAll(
    dims: CharacterDimensions,
  ): Map<MountPointId, THREE.Vector3> {
    const allIds = Object.values(MountPointId) as MountPointId[]
    const result = new Map<MountPointId, THREE.Vector3>()
    for (const id of allIds) {
      result.set(id, MountPointResolver.resolve(id, dims))
    }
    return result
  }

  /**
   *  bodyRatio  MountFractions
   */
  static interpolateFractions(id: MountPointId, bodyRatio: number): MountFractions {
    const [lo, hi, t] = findBracket(bodyRatio)

    if (lo === hi) {
      return MOUNT_RATIO_TABLE[lo][id]
    }

    const a = MOUNT_RATIO_TABLE[lo][id]
    const b = MOUNT_RATIO_TABLE[hi][id]
    return lerpFractions(a, b, t)
  }

  /**
   *  CharacterDimensions " " （WAIST ）
   *  CHAR_POS 
   */
  static getWaistPos(dims: CharacterDimensions): THREE.Vector3 {
    return MountPointResolver.resolve(MountPointId.WAIST, dims)
  }

  /**
   *  VFX  Y（ ）
   *  = dims.rootY ?? 0
   */
  static getGroundY(dims: CharacterDimensions): number {
    return dims.rootY ?? 0
  }
}

// ── ：  CharacterDimensions ─────────────────────────────

/**
 *  CharDummy（scale=1.5, unscaled H=1.65）  dims
 */
export function dimsFromDummy(opts?: Partial<CharacterDimensions>): CharacterDimensions {
  return {
    height:       1.65,   // CharDummy （CHAR_POS ）
    bodyRatio:    7.5,
    rootX:        0,
    rootY:        0,
    rootZ:        0,
    weaponLength: 0,
    facingAngle:  0,
    ...opts,
  }
}

/**
 * （ ）  dims
 * @param heightUnits （  scale ）
 * @param bodyRatio   
 */
export function dimsFromHeight(
  heightUnits: number,
  bodyRatio: number,
  opts?: Partial<CharacterDimensions>,
): CharacterDimensions {
  return {
    height: heightUnits,
    bodyRatio,
    rootX: 0,
    rootY: 0,
    rootZ: 0,
    weaponLength: 0,
    facingAngle: 0,
    ...opts,
  }
}
