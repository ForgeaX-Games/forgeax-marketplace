// @source wb-character/src/vfx/mount/SpineRigBridge.ts
/**
 * SpineRigBridge — Spine  →  
 *
 * ：
 *  1.  updateFrame(snapshot) 
 *  2.  getMount(id)  Vector3
 *  3.  Spine ，  null（  MountAdapter ）
 *  4.  getWeaponDirection()，  / 
 *
 * Spine → 3D ：
 *  - Spine  Y-up ，  Three.js 
 *  - Spine X → Three.js X
 *  - Spine Y → Three.js Y（  spineToWorldScale）
 *  - Three.js Z = characterRootZ（  Z，  Spine ）
 *  - ：Spine  worldRotation（ ）→ 3D XY ，Z  facingAngle
 *
 * （effect time-sensitivity）：
 *  ， ：
 *  -  Trail    → （  getMount）
 *  -  Hit      → ， 
 *  -  Aura   → 
 *  -  AOE        →  GROUND ， 
 *  -         →  WEAPON_TIP + weaponDirection
 *
 * （  Spine ）：
 *   // 1. （ ）
 *   const bridge = new SpineRigBridge(boneMap, profile)
 *   adapter.setSpineRig(bridge)
 *
 *   // 2. （  Spine update ）
 *   const snapshot = extractSpineFrameData(spineSkeleton)
 *   bridge.updateFrame(snapshot)
 *   //  adapter.getMount() 
 *
 *   // 3. 
 *   const weaponPos = adapter.weaponTip       // WEAPON_TIP 
 *   const weaponDir = adapter.weaponDirection // （ / ）
 */

import * as THREE from 'three'
import { MountPointId } from './MountPointTypes'
import type { SpineBoneMap, BoneResolvedMount, CharacterRigProfile } from './SpineBoneMapper'

// ── Spine  ──────────────────────────────────────────────────────────

/**
 *  Spine （ ）
 */
export interface SpineBoneData {
  /** Spine  X（Spine ，Y-up）*/
  worldX: number
  /** Spine  Y */
  worldY: number
  /** （ ，Spine ：  Z ， ） */
  worldRotation: number
  /** （Spine ，  tail/tip ） */
  length: number
}

/**
 * 
 * key = Spine （  SpineBoneMap  key ）
 */
export type SpineFrameSnapshot = Map<string, SpineBoneData>

// ──  ──────────────────────────────────────────────────────────

interface MountResolved {
  /** Three.js  */
  position: THREE.Vector3
  /**  */
  sourceBone: string
}

// ── SpineRigBridge ────────────────────────────────────────────────────────────

export class SpineRigBridge {
  /** （ ） */
  private resolved = new Map<MountPointId, MountResolved>()

  /** （ ， ） */
  private _weaponDir = new THREE.Vector3(0, 0, -1)

  /**  */
  private _hasFrame = false

  /**  3D （Three.js ，  rootY=0） */
  private _rootPos = new THREE.Vector3(0, 0, 0)

  /** ，  GC */
  private _tmp = new THREE.Vector3()

  constructor(
    private boneMap: SpineBoneMap,
    private profile: CharacterRigProfile,
  ) {}

  // ──  API ──────────────────────────────────────────────────────────────

  /**
   *  Spine ， 
   *
   * @param snapshot  （  Spine runtime ）
   * @param rootPos    3D （ ， ）
   */
  updateFrame(snapshot: SpineFrameSnapshot, rootPos?: THREE.Vector3): void {
    if (rootPos) this._rootPos.copy(rootPos)

    this._hasFrame = true
    this.resolved.clear()

    //
    for (const [boneName, boneData] of snapshot) {
      const mounts = this.boneMap.get(boneName)
      if (!mounts || mounts.length === 0) continue

      for (const mount of mounts) {
        const pos = this._boneToWorld(boneData, mount.useTip)

        // ，
        const existing = this.resolved.get(mount.mountId)
        if (!existing || mount.priority > this._getPriority(existing.sourceBone)) {
          this.resolved.set(mount.mountId, { position: pos.clone(), sourceBone: boneName })
        }
      }
    }

    // ：
    this._updateWeaponDirection(snapshot)

    //
    this._applyGenderBias()
  }

  /**
   *  Three.js 
   * @returns Vector3  null（ ）
   */
  getMount(id: MountPointId, out?: THREE.Vector3): THREE.Vector3 | null {
    const r = this.resolved.get(id)
    if (!r) return null
    if (out) { out.copy(r.position); return out }
    return r.position.clone()
  }

  /**
   * （ ，Three.js ）
   * - ： （ ）
   * - ： （ ）
   * -  emit 、 
   */
  get weaponDirection(): THREE.Vector3 {
    return this._weaponDir.clone()
  }

  /**
   * 
   */
  get hasWeaponBone(): boolean {
    return this.resolved.has(MountPointId.WEAPON_TIP)
  }

  get hasFrame(): boolean {
    return this._hasFrame
  }

  /**
   *  3D （ ）
   */
  setRootPosition(pos: THREE.Vector3): void {
    this._rootPos.copy(pos)
  }

  // ──  ─────────────────────────────────────────────────────────────────

  /**
   *  Spine  Three.js 
   * @param useTip  true =  tail（  +  × ），false = 
   */
  private _boneToWorld(bone: SpineBoneData, useTip: boolean): THREE.Vector3 {
    const s = this.profile.spineToWorldScale

    let sx = bone.worldX
    let sy = bone.worldY

    if (useTip && bone.length > 0) {
      const radians = (bone.worldRotation * Math.PI) / 180
      sx += Math.cos(radians) * bone.length
      sy += Math.sin(radians) * bone.length
    }

    return this._tmp.set(
      sx * s + this._rootPos.x,
      sy * s + this._rootPos.y,
      this._rootPos.z,          // Z
    ).clone()
  }

  /**
   * 
   * Spine  worldRotation → 3D XY  →  Z 
   */
  private _updateWeaponDirection(snapshot: SpineFrameSnapshot): void {
    const weaponBone = snapshot.get('weapon')
    if (!weaponBone) {
      // fallback：
      const facing = this.profile.facingAngle
      this._weaponDir.set(-Math.sin(facing), 0, -Math.cos(facing)).normalize()
      return
    }

    const rotRad = (weaponBone.worldRotation * Math.PI) / 180
    const localX = Math.cos(rotRad)
    const localY = Math.sin(rotRad)

    //  -Z ，  X  X，Y
    // Z ： （-Z） ，
    const facing = this.profile.facingAngle
    this._weaponDir.set(
      localX * Math.cos(facing),
      localY,
      -localX * Math.sin(facing) - 0.15,  // ， /
    ).normalize()
  }

  /**
   * （ 、 ）
   */
  private _applyGenderBias(): void {
    //  import
    //
    const isFemale = this.profile.gender === 'female'
    const shoulderScale = isFemale ? 0.88 : 1.0
    const waistYBias    = isFemale ? 0.025 : 0.0
    const chestYBias    = isFemale ? 0.020 : 0.0

    for (const mountId of [MountPointId.SHOULDER_R, MountPointId.SHOULDER_L]) {
      const r = this.resolved.get(mountId)
      if (r) {
        // ：  x
        const waist = this.resolved.get(MountPointId.WAIST)
        const centerX = waist?.position.x ?? this._rootPos.x
        r.position.x = centerX + (r.position.x - centerX) * shoulderScale
      }
    }

    const waistR = this.resolved.get(MountPointId.WAIST)
    if (waistR) waistR.position.y += waistYBias

    const chestR = this.resolved.get(MountPointId.CHEST)
    if (chestR) chestR.position.y += chestYBias
  }

  /**  sourceBone （ ） */
  private _getPriority(boneName: string): number {
    const mounts = this.boneMap.get(boneName)
    if (!mounts) return 0
    return Math.max(...mounts.map(m => m.priority))
  }
}

// ── ：  Spine Runtime  ( ) ────────────────────────────────

/**
 *  Spine Runtime  Skeleton 
 *
 *  Spine Runtime for WebGL/Canvas ，
 * skeleton  spine.Skeleton  .bones[] 。
 *
 *  Spine ：
 *   const snapshot = extractSpineFrame(skeleton)
 *   bridge.updateFrame(snapshot)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractSpineFrame(skeleton: any): SpineFrameSnapshot {
  const snapshot: SpineFrameSnapshot = new Map()

  if (!skeleton?.bones) return snapshot

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const bone of skeleton.bones as any[]) {
    snapshot.set(bone.data?.name ?? bone.name, {
      worldX:        bone.worldX        ?? 0,
      worldY:        bone.worldY        ?? 0,
      worldRotation: bone.worldRotation ?? bone.rotation ?? 0,
      length:        bone.data?.length  ?? 0,
    })
  }

  return snapshot
}
