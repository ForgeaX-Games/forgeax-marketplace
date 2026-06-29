// @source wb-character/src/vfx/mount/MountAdapter.ts
/**
 * MountAdapter — （ ）
 *
 * ：
 *  Level 1（ ）: SpineRigBridge — Spine 
 *    -  Spine  adapter.setSpineRig(bridge) 
 *    -  Spine  bridge.updateFrame(snapshot) 
 *    - （weaponDirection）
 *
 *  Level 2:  (autoDetectCharacter)
 *    -  Spine ，  Three.js  mesh
 *    - ， 
 *    - / 
 *
 *  Level 3（ ）: （MountPointResolver）
 *    - 
 *    -  bodyRatio + height 
 *
 * ：
 *   // Spine （ ）
 *   const boneMap = buildBoneMap(skeleton.bones.map(b => b.name), profile)
 *   const bridge  = new SpineRigBridge(boneMap, profile)
 *   adapter.setSpineRig(bridge, profile)
 *
 *   // Spine update （ ）
 *   bridge.updateFrame(extractSpineFrame(skeleton))
 *
 *   // 
 *   const pos = adapter.getMount(MountPointId.WEAPON_TIP)
 *   const dir = adapter.weaponDirection   // （  / ）
 */

import * as THREE from 'three'
import { MountPointId, MOUNT_META } from './MountPointTypes'
import { MountPointResolver, dimsFromDummy } from './MountPointResolver'
import { autoDetectCharacter } from './CharacterAutoDetector'
import type { DetectionResult } from './CharacterAutoDetector'
import type { CharacterDimensions } from './MountPointTypes'
import type { SpineRigBridge } from './SpineRigBridge'
import type { CharacterRigProfile, WeaponType } from './SpineBoneMapper'
import { WEAPON_VFX_HINTS } from './SpineBoneMapper'
import type { SpriteAnchorAdapter } from './SpriteAnchorAdapter'

// ──  →  ID  ─────────────────────────────────────────────────
//
//  MOUNT_META.vfxHints ，

const EFFECT_TO_MOUNT = new Map<string, MountPointId>()

// 1.  MOUNT_META
for (const meta of MOUNT_META) {
  for (const hint of meta.vfxHints) {
    EFFECT_TO_MOUNT.set(hint, meta.id)
  }
}

// 2. （  VFX  hint）
const EXPLICIT_MAPPINGS: Array<[string, MountPointId]> = [
  // ─  ─────────────────────────────────────────────────────────
  ['slash',         MountPointId.WEAPON_TIP],
  ['melee_swing',   MountPointId.WEAPON_TIP],
  ['stab',          MountPointId.WEAPON_TIP],
  ['cast_center',   MountPointId.CHEST],
  ['magic_orb',     MountPointId.WEAPON_TIP],
  ['fireball',      MountPointId.WEAPON_TIP],
  ['arrow',         MountPointId.WEAPON_TIP],

  // ─  ─────────────────────────────────────────────────────────
  ['muzzle_flash',  MountPointId.MUZZLE],
  ['bullet_spawn',  MountPointId.MUZZLE],
  ['bullet_trail',  MountPointId.MUZZLE],
  ['shell_eject',   MountPointId.HAND_R],

  // ─  ─────────────────────────────────────────────────────────
  ['hit_light',     MountPointId.CHEST],
  ['hit_heavy',     MountPointId.CHEST],
  ['hit_body',      MountPointId.CHEST],
  ['hit_critical',  MountPointId.CHEST],
  ['hit_elemental', MountPointId.CHEST],
  ['hit_blocked',   MountPointId.HAND_R],
  ['hit_head',      MountPointId.HEAD],
  ['hit_lower',     MountPointId.KNEE],

  // ─  ─────────────────────────────────────────────────────────
  ['aura',          MountPointId.CHEST],
  ['shield',        MountPointId.CHEST],
  ['buff',          MountPointId.HEAD_TOP],
  ['debuff',        MountPointId.HEAD],
  ['stun',          MountPointId.HEAD],
  ['stun_stars',    MountPointId.HEAD],
  ['poison',        MountPointId.CHEST],
  ['freeze',        MountPointId.WAIST],
  ['burn',          MountPointId.CHEST],

  // ─  ─────────────────────────────────────────────────────────
  ['teleport',      MountPointId.WAIST],
  ['dash_trail',    MountPointId.WAIST],
  ['blink',         MountPointId.WAIST],
  ['jump_up',       MountPointId.WAIST],
  ['land_impact',   MountPointId.GROUND],
  ['footstep',      MountPointId.ANKLE],
  ['dust',          MountPointId.ANKLE],

  // ─ /  ────────────────────────────────────────────────────────
  ['aoe_ring',      MountPointId.GROUND],
  ['ground_crack',  MountPointId.GROUND],
  ['shadow',        MountPointId.GROUND],
  ['stomp',         MountPointId.GROUND],
  ['shockwave',     MountPointId.GROUND_PROJ],

  // ─ /  ────────────────────────────────────────────────────────
  ['meteor',        MountPointId.SKY_PROJ],
  ['star_blade',    MountPointId.SKY_PROJ],
  ['sky_strike',    MountPointId.SKY_PROJ],
  ['pillar_up',     MountPointId.HEAD_TOP],
  ['charge_up',     MountPointId.HEAD_TOP],
  ['levelup',       MountPointId.HEAD_TOP],

  // ─  ─────────────────────────────────────────────────────────
  ['spawn',         MountPointId.WAIST],
  ['appear',        MountPointId.WAIST],
  ['dissolve',      MountPointId.WAIST],
  ['death',         MountPointId.WAIST],
  ['revival',       MountPointId.HEAD_TOP],
]
for (const [hint, id] of EXPLICIT_MAPPINGS) {
  EFFECT_TO_MOUNT.set(hint, id)
}

// ── （ ，  GC） ──────────────────────────────────────

const _tmpPos   = new THREE.Vector3()
const _tmpScale = new THREE.Vector3()

function computeSceneHash(scene: THREE.Scene): string {
  let count  = 0
  let ysum   = 0
  let scaleY = 0

  scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return
    if (!obj.visible) return
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
    if (!(mat instanceof THREE.MeshStandardMaterial)) return

    //  MountPointVisualizer
    let cur: THREE.Object3D | null = obj.parent
    while (cur) {
      if (cur.name === 'MountPointVisualizer') return
      cur = cur.parent
    }

    obj.getWorldPosition(_tmpPos)
    obj.getWorldScale(_tmpScale)
    count++
    ysum   += _tmpPos.y
    scaleY += _tmpScale.y
  })

  //  0.01 ， /
  return `${count}|${ysum.toFixed(2)}|${scaleY.toFixed(2)}`
}

// ── MountAdapter ──────────────────────────────────────────────────────────────

type ChangedCallback = (dims: CharacterDimensions, result: DetectionResult) => void

/**  */
export type MountSource = 'spine' | 'sprite' | 'geometric' | 'static'

export class MountAdapter {
  private dims: CharacterDimensions
  private lastHash = ''
  private changeListeners: ChangedCallback[] = []

  /** Level 1：Spine  */
  private spineRig: SpineRigBridge | null = null

  /** （  Spine ） */
  private rigProfile: CharacterRigProfile | null = null

  /** Level 1.5：  Sprite （2D ） */
  private spriteAnchor: SpriteAnchorAdapter | null = null

  /** （Level 2） */
  lastDetection: DetectionResult | null = null

  /**  */
  mountSource: MountSource = 'static'

  /** ：  */
  detectCooldownMs = 800

  private lastDetectTime = 0

  constructor(private scene: THREE.Scene) {
    this.dims = dimsFromDummy()
    this._runDetect(true)
  }

  // ── Level 1：Spine  API ───────────────────────────────────────────

  /**
   *  Spine （ ）
   *
   * ，getMount()  SpineRigBridge 。
   *  bridge.hasFrame=false  Level 2/3。
   *
   * @param bridge   SpineRigBridge 
   * @param profile  （ / ）
   */
  setSpineRig(bridge: SpineRigBridge, profile: CharacterRigProfile): void {
    this.spineRig   = bridge
    this.rigProfile = profile
    this.mountSource = 'spine'

    //  dims （spineToWorldScale ）
    this.dims = {
      ...this.dims,
      facingAngle: profile.facingAngle,
    }

    for (const cb of this.changeListeners) {
      cb(this.dims, this.lastDetection ?? this._makeEmptyDetection())
    }
  }

  /**
   *  Spine （  / ）
   */
  clearSpineRig(): void {
    this.spineRig    = null
    this.rigProfile  = null
    this.mountSource = this.spriteAnchor?.isActive ? 'sprite' : 'geometric'
  }

  // ── Level 1.5：  Sprite （2D ） ───────────────────────────────

  /**
   *  SpriteAnchorAdapter（ ）
   *
   *  Spine （Level 1）， （Level 2）。
   * （ ）。
   */
  setSpriteAnchor(anchor: SpriteAnchorAdapter): void {
    this.spriteAnchor = anchor
    if (!this.spineRig?.hasFrame) {
      this.mountSource = 'sprite'
    }
    console.log('[MountAdapter] Level 1.5 SpriteAnchor registered')
  }

  /**
   *  SpriteAnchorAdapter（ ）
   */
  clearSpriteAnchor(): void {
    this.spriteAnchor = null
    if (!this.spineRig?.hasFrame) {
      this.mountSource = 'geometric'
    }
    console.log('[MountAdapter] Level 1.5 SpriteAnchor deregistered')
  }

  /**  sprite anchor */
  get hasSpriteAnchor(): boolean {
    return this.spriteAnchor?.isActive === true
  }

  /**
   * （Level 1 ， ）
   * ： 、 、 
   */
  get weaponDirection(): THREE.Vector3 {
    if (this.spineRig?.hasFrame) {
      return this.spineRig.weaponDirection
    }
    // ：  -Z
    const angle = this.dims.facingAngle ?? 0
    return new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle)).normalize()
  }

  /**
   *  VFX hint 
   *  bootstrap 
   */
  get weaponVFXHints(): string[] {
    const wt: WeaponType = this.rigProfile?.weaponType ?? 'melee_sword'
    return WEAPON_VFX_HINTS[wt] ?? ['slash']
  }

  /**
   *  Spine （Level 1 ）
   */
  get hasSpineRig(): boolean {
    return this.spineRig?.hasFrame === true
  }

  // ──  API ──────────────────────────────────────────────────────────────

  /**
   * （ ）。 。
   */
  tick(): void {
    const hash = computeSceneHash(this.scene)
    if (hash === this.lastHash) return

    this.lastHash = hash

    const now = performance.now()
    if (now - this.lastDetectTime < this.detectCooldownMs) return

    this._runDetect(false)
  }

  /**
   * （ ）
   */
  forceDetect(): DetectionResult {
    return this._runDetect(true)
  }

  /**
   * 
   *
   * （ ）：
   *  Level 1   (Spine)    → （3D Spine ）
   *  Level 1.5 (Sprite)   → SpriteAnchorAdapter（2D ）
   *  Level 2   (Geometric)→  + 
   *  Level 3   (Static)   → （ ）
   *
   * @param id  MountPointId 
   * @param out  Vector3（  GC）
   */
  getMount(id: MountPointId, out?: THREE.Vector3): THREE.Vector3 {
    // Level 1：Spine
    if (this.spineRig?.hasFrame) {
      const pos = this.spineRig.getMount(id)
      if (pos) {
        this.mountSource = 'spine'
        if (out) { out.copy(pos); return out }
        return pos
      }
    }

    // Level 1.5：  Sprite
    if (this.spriteAnchor?.isActive) {
      const pos = this.spriteAnchor.getMount(id, out ?? new THREE.Vector3())
      if (pos) {
        this.mountSource = 'sprite'
        return pos
      }
    }

    // Level 2 / 3：  dims （  dims）
    this.mountSource = this.lastDetection?.confidence !== 'low' ? 'geometric' : 'static'
    return MountPointResolver.resolve(id, this.dims, out)
  }

  /**
   *  hint ， 
   * @param hint （  EFFECT_TO_MOUNT ）
   */
  getMountForEffect(hint: string, out?: THREE.Vector3): THREE.Vector3 {
    const id = EFFECT_TO_MOUNT.get(hint) ?? MountPointId.CHEST
    return this.getMount(id, out)
  }

  /**
   *  hint  MountPointId（ ）
   */
  getMountIdForEffect(hint: string): MountPointId {
    return EFFECT_TO_MOUNT.get(hint) ?? MountPointId.CHEST
  }

  /**  */
  getDims(): CharacterDimensions {
    return { ...this.dims }
  }

  /** （ ） */
  setDims(dims: CharacterDimensions): void {
    this.dims = dims
  }

  /**
   * 
   * @returns 
   */
  onChanged(cb: ChangedCallback): () => void {
    this.changeListeners.push(cb)
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== cb)
    }
  }

  // ── （ ，  GC）─────────────────────────

  private _v = new THREE.Vector3()

  get waist():     THREE.Vector3 { return this.getMount(MountPointId.WAIST,     this._cloneV()) }
  get chest():     THREE.Vector3 { return this.getMount(MountPointId.CHEST,     this._cloneV()) }
  get head():      THREE.Vector3 { return this.getMount(MountPointId.HEAD,      this._cloneV()) }
  get headTop():   THREE.Vector3 { return this.getMount(MountPointId.HEAD_TOP,  this._cloneV()) }
  get weaponTip(): THREE.Vector3 { return this.getMount(MountPointId.WEAPON_TIP,this._cloneV()) }
  get muzzle():    THREE.Vector3 { return this.getMount(MountPointId.MUZZLE,    this._cloneV()) }
  get ground():    THREE.Vector3 { return this.getMount(MountPointId.GROUND,    this._cloneV()) }
  get handR():     THREE.Vector3 { return this.getMount(MountPointId.HAND_R,    this._cloneV()) }
  get skyProj():   THREE.Vector3 { return this.getMount(MountPointId.SKY_PROJ,  this._cloneV()) }

  private _cloneV() { return new THREE.Vector3() }

  // ──  ──────────────────────────────────────────────────────────────────

  private _makeEmptyDetection(): DetectionResult {
    return { dims: this.dims, confidence: 'low', meshCount: 0, log: [] }
  }

  private _runDetect(force: boolean): DetectionResult {
    this.lastDetectTime = performance.now()

    const result = autoDetectCharacter(this.scene)
    this.lastDetection = result

    //
    if (result.confidence !== 'low' && result.meshCount > 0) {
      const changed =
        result.dims.height    !== this.dims.height    ||
        result.dims.bodyRatio !== this.dims.bodyRatio ||
        result.dims.rootY     !== this.dims.rootY

      if (changed || force) {
        this.dims = result.dims
        for (const cb of this.changeListeners) {
          cb(this.dims, result)
        }
      }
    }

    return result
  }
}

// ── （bootstrap ） ─────────────────────────────────────────

declare global {
  interface Window { __mountAdapter?: MountAdapter }
}

export function getGlobalAdapter(): MountAdapter | undefined {
  return window.__mountAdapter
}
