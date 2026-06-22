// @source wb-character/src/vfx/mount/SpriteAnchorAdapter.ts
/**
 * SpriteAnchorAdapter — 2D  Sprite 
 *
 * ──  A（ ）──────────────────────────────────────────────────────────
 *   sprite mesh  + ：
 *  - X/Z  mesh.position（ / ）
 *  - Y = mesh Y + height × yFrac（  bodyRatio ，  ≈ ±5%）
 *
 * ──  A+（T-pose ， ）──────────────────────────────────────────
 *   IndexedDB  EditorSkeleton T-pose ，
 *   head/chest/weapon  yFrac， 。
 *   loadStaticSpine(skeleton, spineHeight) 。
 *
 * ──  B（ ， ）───────────────────────────────────
 *   pose-data.json， ：
 *  - loadPoseData(data)  — ，  'baked' 
 *  - onFrame(actionId, frameIndex) —  SpriteAnimator 
 *   poseData ，getMount() 。
 */

import * as THREE from 'three'
import { MountPointId } from './MountPointTypes'
import type { CharacterDimensions, MountFractions } from './MountPointTypes'
import { MountPointResolver } from './MountPointResolver'
import type { EditorSkeleton } from './SpineEditorTypes'

// ══════════════════════════════════════════════════════════════════════════════
//  B  — pose-data.json
// ══════════════════════════════════════════════════════════════════════════════

/**
 * （  sprite ）
 * （AutoBindTab / GameUploadTab）  pose-data.json
 */
export interface PoseBoneFrame {
  /** key = MountPointId ，value =  sprite  */
  mounts: Partial<Record<MountPointId, { yFrac: number; xFrac: number }>>
}

/**
 * （pose-data.json）
 *
 * ：
 * {
 *   "version": 1,
 *   "spineHeight": 312,
 *   "actions": {
 *     "idle": [ { mounts: { CHEST: {yFrac:0.55, xFrac:0} } }, ... ],
 *     "attack": [ ... ]
 *   }
 * }
 */
export interface PoseBakeData {
  version: 1
  /** Spine （ ） */
  spineHeight: number
  /**  →  */
  actions: Record<string, PoseBoneFrame[]>
}

// ══════════════════════════════════════════════════════════════════════════════
//
// ══════════════════════════════════════════════════════════════════════════════

/**  */
export type SpriteAnchorMode =
  | 'ratio'   //  A  :
  | 'tpose'   //  A+ : T-pose
  | 'baked'   //  B  :

/** T-pose / baked  */
type FracOverrideMap = Partial<Record<MountPointId, { yFrac: number; xFrac: number }>>

// ══════════════════════════════════════════════════════════════════════════════
// SpriteAnchorAdapter
// ══════════════════════════════════════════════════════════════════════════════

export class SpriteAnchorAdapter {
  // ── state ──────────────────────────────────────────────────────────────────

  private mesh: THREE.Mesh | null = null
  private spriteWorldHeight = 1.5
  private dims: CharacterDimensions
  private mode: SpriteAnchorMode = 'ratio'

  //  B
  private poseData: PoseBakeData | null = null
  private currentAction = 'idle'
  private currentFrame  = 0

  //  A+ : T-pose
  private tposeOverrides: FracOverrideMap = {}

  constructor(dims: CharacterDimensions) {
    this.dims = { ...dims }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  A：Sprite Mesh  /
  // ══════════════════════════════════════════════════════════════════════════

  /**
   *  sprite mesh（ ）
   * @param mesh              SpriteAnimator.mesh
   * @param spriteWorldHeight （Three.js ）
   */
  attachMesh(mesh: THREE.Mesh, spriteWorldHeight: number): void {
    this.mesh = mesh
    this.spriteWorldHeight = spriteWorldHeight
    this.dims = { ...this.dims, height: spriteWorldHeight, rootY: 0 }
    console.log(
      `[SpriteAnchor] mesh : H=${spriteWorldHeight.toFixed(2)} ratio=${this.dims.bodyRatio.toFixed(1)} mode=${this.mode}`,
    )
  }

  /**
   *  sprite mesh（ ）
   *  getMount()  null，MountAdapter  geometric/static。
   */
  detachMesh(): void {
    this.mesh = null
    this.poseData  = null
    this.tposeOverrides = {}
    this.mode = 'ratio'
    console.log('[SpriteAnchor] mesh deregistered')
  }

  /**  sprite mesh */
  get isActive(): boolean { return this.mesh !== null }

  // ══════════════════════════════════════════════════════════════════════════
  //  A+：T-pose （ ， ）
  // ══════════════════════════════════════════════════════════════════════════

  /**
   *  T-pose  Y 。
   * ， ， 。
   *
   * @param skeleton     IndexedDB EDITOR_STATE_KEY  EditorSkeleton
   * @param spineHeight Spine （ ， ）
   */
  loadStaticSpine(skeleton: EditorSkeleton, spineHeight: number): void {
    if (!skeleton?.bones || spineHeight <= 0) return

    const scale = this.spriteWorldHeight / spineHeight  // spine → world
    const overrides: FracOverrideMap = {}
    const bones = skeleton.bones

    // Spine （forgeax_v1 ） →
    // 'root' = ，'tip' = （ ）
    const MAPPINGS: Array<[RegExp, MountPointId, 'root' | 'tip']> = [
      [/^head$/i,                     MountPointId.HEAD,        'root'],
      [/^torso2?$/i,                  MountPointId.CHEST,       'root'],
      [/^pelvis$|^hip$/i,             MountPointId.WAIST,       'root'],
      [/^foot_f$|^foot$/i,            MountPointId.ANKLE,       'root'],
      [/^hand_f$|^hand$/i,            MountPointId.HAND_R,      'root'],
      [/^hand_b$/i,                   MountPointId.HAND_L,      'root'],
      [/^neck$/i,                     MountPointId.NECK,        'root'],
      [/^weapon$/i,                   MountPointId.WEAPON_TIP,  'tip' ],
      [/^weapon$/i,                   MountPointId.WEAPON_ROOT, 'root'],
    ]

    for (const [pattern, mountId, endPoint] of MAPPINGS) {
      // （ ，  root/tip ）
      if (overrides[mountId]) continue

      const bone = Array.from(bones.values()).find(b => pattern.test(b.name))
      if (!bone) continue

      // （Spine  → world）
      //  world ：  localX/Y（T-pose  worldX/Y，  IK ）
      const rawY = endPoint === 'tip'
        ? bone.localY + bone.length * Math.sin(bone.localRotation * Math.PI / 180)
        : bone.localY
      const rawX = endPoint === 'tip'
        ? bone.localX + bone.length * Math.cos(bone.localRotation * Math.PI / 180)
        : bone.localX

      const worldY = rawY * scale
      const worldX = rawX * scale

      overrides[mountId] = {
        yFrac: Math.max(0, Math.min(2.5, worldY / this.spriteWorldHeight)),
        xFrac: worldX / this.spriteWorldHeight,
      }
    }

    this.tposeOverrides = overrides

    const count = Object.keys(overrides).length
    if (count > 0) {
      this.mode = 'tpose'
      console.log(`[SpriteAnchor] T-pose ：  ${count}  → mode=tpose`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  B ：
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 【  B】  pose-data.json， 。
   *  getMount() ， 。
   */
  loadPoseData(data: PoseBakeData): void {
    this.poseData = data
    this.mode = 'baked'
    console.log(
      `[SpriteAnchor]  B ：  (${Object.keys(data.actions).length} , H=${data.spineHeight})`,
    )
  }

  /**
   * 【  B】 （  SpriteAnimator.setFrameCallback ）
   *  A/A+ ；  B 。
   */
  onFrame(actionId: string, frameIndex: number): void {
    this.currentAction = actionId
    this.currentFrame  = frameIndex
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ：
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 。
   *
   * ：  B (baked) >  A+ (tpose) >  A (ratio)
   * mesh  null（MountAdapter ）。
   *
   * @param id  MountPointId
   * @param out  Vector3（ ，  GC）
   */
  getMount(id: MountPointId, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    if (!this.mesh) return null

    const meshPos = this.mesh.position           //  X/Y/Z，
    const H       = this.spriteWorldHeight
    const baseY   = meshPos.y - H * 0.5          // sprite （ ）  Y

    // ──  B：  ──────────────────────────────────────────────────
    if (this.mode === 'baked' && this.poseData) {
      const frames = this.poseData.actions[this.currentAction]
      const baked  = frames?.[this.currentFrame]?.mounts[id]
      if (baked) {
        out.set(
          meshPos.x + baked.xFrac * H,
          baseY     + baked.yFrac * H,
          meshPos.z,
        )
        return out
      }
      //  A+/A
    }

    // ──  A+：T-pose  ────────────────────────────────────────────
    const override = this.tposeOverrides[id]
    let fracs: { yFrac: number; xFrac: number; zFrac?: number }

    if (override) {
      fracs = override
    } else {
      // ──  A： （ ） ────────────────────────────────────────
      const f = MountPointResolver.interpolateFractions(id, this.dims.bodyRatio)
      fracs = { yFrac: f.yFrac, xFrac: f.xFrac, zFrac: f.zFrac }
    }

    out.set(
      meshPos.x + (fracs.xFrac ?? 0) * H,
      baseY     + fracs.yFrac * H,
      meshPos.z + (fracs.zFrac ?? 0) * H,
    )
    return out
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  API
  // ══════════════════════════════════════════════════════════════════════════

  /**  */
  get activeMode(): SpriteAnchorMode { return this.mode }

  /**  */
  getDims(): CharacterDimensions { return { ...this.dims } }

  /** （ ） */
  setDims(dims: Partial<CharacterDimensions>): void {
    this.dims = { ...this.dims, ...dims }
  }

  /** sprite mesh （debug ） */
  getMeshPosition(): THREE.Vector3 | null {
    return this.mesh?.position.clone() ?? null
  }
}
