// @source wb-character/src/vfx/targeting/TargetAcquisitionSystem.ts
/**
 * TargetAcquisitionSystem — 
 *
 * ：
 *   - 
 *   -  / 
 *   -  TargetLockEffect 
 *
 * ，  VFX 。
 */

import * as THREE from 'three'
import { TargetLockEffect } from './TargetLockEffect'
import { type TargetInfo, type AcquisitionParams, type LockState } from './TargetTypes'

export interface AcquisitionResult {
  locked:    TargetInfo | null
  state:     LockState
  candidates: TargetInfo[]  // （ ）
}

/** （ ） */
function priorityScore(t: TargetInfo, attackerPos: THREE.Vector3): number {
  const dist = t.position.distanceTo(attackerPos)
  // 、HP 、  → （ ）
  return dist * 0.5
       - t.threat * 0.3
       + t.hpRatio * 0.2
}

export class TargetAcquisitionSystem {
  private targets:      Map<string, TargetInfo> = new Map()
  private effect:       TargetLockEffect
  private lockedId:     string | null = null
  private lockState:    LockState = 'none'
  private lerpFactor    = 0.1  //

  constructor(private scene: THREE.Scene) {
    this.effect = new TargetLockEffect(scene)
  }

  // ──  ────────────────────────────────────────────────────────────────

  addTarget(info: TargetInfo): void {
    this.targets.set(info.id, info)
  }

  removeTarget(id: string): void {
    this.targets.delete(id)
    if (this.lockedId === id) this.clearLock()
  }

  updateTarget(id: string, partial: Partial<TargetInfo>): void {
    const existing = this.targets.get(id)
    if (existing) Object.assign(existing, partial)
  }

  clearAllTargets(): void {
    this.targets.clear()
    this.clearLock()
  }

  // ──  ────────────────────────────────────────────────────────────────────

  /**
   * ， （ ）
   * 
   */
  acquire(params: AcquisitionParams): AcquisitionResult {
    const { attackerPos, attackerForward, maxRange, fovDeg, enemyOnly } = params
    const halfFovRad = (fovDeg / 2) * (Math.PI / 180)

    const candidates: TargetInfo[] = []
    for (const t of this.targets.values()) {
      if (!t.lockable) continue
      if (enemyOnly && t.relation !== 'enemy') continue

      const dist = t.position.distanceTo(attackerPos)
      if (dist > maxRange) continue

      const toTarget = t.position.clone().sub(attackerPos).normalize()
      const angle    = Math.acos(Math.max(-1, Math.min(1, attackerForward.dot(toTarget))))
      if (angle > halfFovRad) continue

      candidates.push(t)
    }

    //
    candidates.sort((a, b) => priorityScore(a, attackerPos) - priorityScore(b, attackerPos))

    //
    if (candidates.length > 0 && this.lockState === 'none') {
      this.softLock(candidates[0].id)
    }

    return { locked: this.lockedTarget, state: this.lockState, candidates }
  }

  /**  */
  softLock(targetId: string): void {
    const t = this.targets.get(targetId)
    if (!t) return
    this.lockedId  = targetId
    this.lockState = 'soft'
    this.effect.lock(t)
  }

  /** （ ） */
  confirmHardLock(): void {
    if (this.lockState === 'soft') {
      this.lockState = 'hard'
      this.effect.hardLock()
    }
  }

  /** （ ） */
  cycleTarget(params: AcquisitionParams): void {
    const result    = this.acquire(params)
    const candidates = result.candidates
    if (candidates.length <= 1) return

    const currentIdx = candidates.findIndex(t => t.id === this.lockedId)
    const nextIdx    = (currentIdx + 1) % candidates.length
    this.softLock(candidates[nextIdx].id)
  }

  /**  */
  clearLock(): void {
    this.lockedId  = null
    this.lockState = 'none'
    this.effect.unlock()
  }

  // ──  ────────────────────────────────────────────────────────────────

  update(dt: number, camera: THREE.Camera, attackerPos?: THREE.Vector3): void {
    // （ ）
    if (this.lockedId) {
      const t = this.targets.get(this.lockedId)
      if (!t) { this.clearLock(); return }
    }
    this.effect.update(dt, camera, attackerPos)
  }

  dispose(): void {
    this.effect.dispose()
    this.targets.clear()
  }

  // ──  ────────────────────────────────────────────────────────────────────

  get lockedTarget(): TargetInfo | null {
    return this.lockedId ? (this.targets.get(this.lockedId) ?? null) : null
  }
  get state(): LockState    { return this.lockState }
  get allTargets(): TargetInfo[] { return [...this.targets.values()] }
  get lockEffect(): TargetLockEffect { return this.effect }
}

// ─── Demo （ ）────────────────────────────────────────────────────

/**
 * （  mesh + TargetInfo）
 *  mesh （  scene.add）  TargetInfo 
 */
export function createDemoTargets(
  scene: THREE.Scene,
  count = 3,
): { meshes: THREE.Mesh[]; infos: TargetInfo[] } {
  const meshes: THREE.Mesh[] = []
  const infos: TargetInfo[]  = []
  const positions = [
    new THREE.Vector3(-2.0, 0, -1.5),
    new THREE.Vector3( 2.0, 0, -1.5),
    new THREE.Vector3( 0.0, 0, -3.0),
  ]
  const hpRatios  = [0.8, 0.3, 0.6]
  const threats   = [3, 8, 5]

  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const geo  = new THREE.CapsuleGeometry(0.22, 0.75, 4, 8)
    const mat  = new THREE.MeshStandardMaterial({
      color: 0xaa2222, roughness: 0.7, metalness: 0.2,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(positions[i])
    mesh.position.y = 0.65
    mesh.castShadow = true
    scene.add(mesh)
    meshes.push(mesh)

    infos.push({
      id:        `demo-enemy-${i}`,
      position:  positions[i].clone(),
      height:    1.5,
      relation:  'enemy',
      hpRatio:   hpRatios[i],
      threat:    threats[i],
      lockable:  true,
    })
  }
  return { meshes, infos }
}
