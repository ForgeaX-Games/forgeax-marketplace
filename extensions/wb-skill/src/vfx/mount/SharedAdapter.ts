// @source wb-character/src/vfx/mount/SharedAdapter.ts
/**
 * SharedAdapter — MountAdapter 
 *
 *  VFX 、Spine 、 。
 *  getOrCreateAdapter(scene) ，
 *  getAdapter() 。
 *
 * ： ，  mount/unmount。
 */

import * as THREE from 'three'
import { MountAdapter } from './MountAdapter'
import { SpriteAnchorAdapter } from './SpriteAnchorAdapter'
import type { CharacterDimensions } from './MountPointTypes'
import type { PoseBakeData } from './SpriteAnchorAdapter'

/** SpriteAnchorAdapter （  MountAdapter ） */
let _spriteAnchor: SpriteAnchorAdapter | null = null

let _instance: MountAdapter | null = null

/** （  scene） */
export function getOrCreateAdapter(scene: THREE.Scene): MountAdapter {
  if (!_instance) {
    _instance = new MountAdapter(scene)
    ;(window as any).__mountAdapter = _instance

    // ── ：  sprite  VFX ，  ─────────────────
    if (_spriteAnchor?.isActive) {
      _instance.setSpriteAnchor(_spriteAnchor)
      console.log('[SharedAdapter] supplemental: SpriteAnchor attached to new MountAdapter')
    }

    console.log('[SharedAdapter] MountAdapter singleton created')
  } else if (_spriteAnchor?.isActive && !_instance.hasSpriteAnchor) {
    // MountAdapter  sprite anchor （  VFX  unmount/remount ）
    _instance.setSpriteAnchor(_spriteAnchor)
    console.log('[SharedAdapter] supplemental: SpriteAnchor -> existing MountAdapter')
  }
  return _instance
}

/** （  scene ），  null */
export function getAdapter(): MountAdapter | null {
  return _instance
}

/**
 * （ /Spine ）
 * @param dims  CharacterDimensions（ 、 ）
 */
export function notifyCharacterDims(dims: Partial<CharacterDimensions>): void {
  if (!_instance) return
  const current = _instance.getDims()
  const merged: CharacterDimensions = { ...current, ...dims }
  _instance.setDims(merged)
  console.log(`[SharedAdapter] : H=${merged.height.toFixed(2)} ratio=${merged.bodyRatio.toFixed(1)}`)
}

/**
 * （ ）
 */
export function notifyDetectedDims(height: number, bodyRatio: number, rootY = 0): void {
  if (!_instance) return
  const current = _instance.getDims()
  _instance.setDims({ ...current, height, bodyRatio, rootY })
  //  sprite anchor
  _spriteAnchor?.setDims({ height, bodyRatio, rootY })
  console.log(`[SharedAdapter] : H=${height.toFixed(2)} ratio=${bodyRatio.toFixed(1)} rootY=${rootY.toFixed(2)}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// Level 1.5：SpriteAnchorAdapter
// ══════════════════════════════════════════════════════════════════════════════

/**
 *  sprite mesh（  pixel-char ）
 *
 *  SpriteAnchorAdapter ，  MountAdapter。
 *
 * @param mesh              SpriteAnimator.mesh（THREE.Mesh）
 * @param spriteWorldHeight sprite 
 * @param bodyRatio         （  artStyle ）
 */
export function registerSpriteMesh(
  mesh: THREE.Mesh,
  spriteWorldHeight: number,
  bodyRatio: number,
): SpriteAnchorAdapter {
  if (!_instance) {
    console.warn('[SharedAdapter] registerSpriteMesh: MountAdapter not initialized, called too early')
  }

  if (!_spriteAnchor) {
    const dims: CharacterDimensions = {
      height: spriteWorldHeight,
      bodyRatio,
      rootY: 0,
    }
    _spriteAnchor = new SpriteAnchorAdapter(dims)
    ;(window as any).__spriteAnchor = _spriteAnchor
  }

  _spriteAnchor.setDims({ height: spriteWorldHeight, bodyRatio })
  _spriteAnchor.attachMesh(mesh, spriteWorldHeight)

  if (_instance) {
    _instance.setSpriteAnchor(_spriteAnchor)
    console.log(
      `[SharedAdapter] sprite mesh  →  MountAdapter` +
      ` | pos=(${mesh.position.x.toFixed(2)},${mesh.position.y.toFixed(2)},${mesh.position.z.toFixed(2)})` +
      ` | H=${spriteWorldHeight.toFixed(2)} ratio=${bodyRatio.toFixed(1)}`
    )
  } else {
    // VFX  MountAdapter，  getOrCreateAdapter
    console.log(`[SharedAdapter] sprite mesh （MountAdapter ，  VFX ）: H=${spriteWorldHeight.toFixed(2)} ratio=${bodyRatio.toFixed(1)}`)
  }

  //  A+（T-pose ），
  tryLoadSpineBoost(spriteWorldHeight).catch(() => {/*  */})

  return _spriteAnchor
}

/**
 *  sprite mesh（ ）
 * MountAdapter  geometric/static。
 */
export function unregisterSpriteMesh(): void {
  if (!_spriteAnchor) return
  _spriteAnchor.detachMesh()
  _instance?.clearSpriteAnchor()
  console.log('[SharedAdapter] sprite mesh deregistered')
}

/**
 *  SpriteAnchorAdapter （  null）
 */
export function getSpriteAnchor(): SpriteAnchorAdapter | null {
  return _spriteAnchor
}

/**
 * 【  B 】  sprite anchor 。
 *  pose-data.json ， 。
 */
export function loadSpritePoseData(data: PoseBakeData): void {
  if (!_spriteAnchor) {
    console.warn('[SharedAdapter] loadSpritePoseData: SpriteAnchorAdapter not registered')
    return
  }
  _spriteAnchor.loadPoseData(data)
}

// ──  A+：  IndexedDB  T-pose  ───────────────────────────────

/**
 *  IndexedDB  Spine  T-pose ，
 *  SpriteAnchorAdapter （  A+）。
 *
 * ： ， （  A ）。
 *  registerSpriteMesh ， 。
 */
export async function tryLoadSpineBoost(spriteWorldHeight: number): Promise<void> {
  if (!_spriteAnchor) return

  try {
    // D-1: wb-skill does not bundle the spine pipeline (that lives in wb-anim).
    // Plan A+ (T-pose refinement from Spine skeleton) is unavailable here.
    // Degrade silently to Plan A (ratio-based mount points).
    console.log('[SharedAdapter] Plan A+: spine pipeline not available in wb-skill context, using ratio mode')
    void spriteWorldHeight  // suppress unused parameter lint
    return
  } catch (e) {
    console.warn('[SharedAdapter] Plan A+ load failed (degraded to Plan A):', e)
  }
}
