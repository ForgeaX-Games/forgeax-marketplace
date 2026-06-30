// @source wb-character/src/vfx/effects/hit/HitFlashEffect.ts
/**
 * HitFlashEffect — 
 *
 *  emissive （ → ），
 * 。  VFX 。
 *
 * ：
 *   const flash = new HitFlashEffect()
 *   flash.trigger(targetMesh, { peakIntensity: 0.8, duration: 0.15, color: new THREE.Color('#fff') })
 *   //  update ：
 *   flash.update(deltaTime)
 */

import * as THREE from 'three'
import { getFlashParams, type FlashParams, type HitType, type HitElement } from './HitTypes'

interface FlashSession {
  /** （  emissive ） */
  targets: Array<{
    mat: THREE.MeshStandardMaterial
    originalEmissive: THREE.Color
    originalIntensity: number
  }>
  params: FlashParams
  elapsed: number
}

export class HitFlashEffect {
  private sessions: FlashSession[] = []

  /**
   * 
   * @param root    —  Object3D（ ）
   * @param type    — 
   * @param element — （ ）
   * @param scale   — （1.0= ）
   */
  trigger(
    root: THREE.Object3D,
    type: HitType,
    element?: HitElement,
    scale = 1.0,
  ): void {
    const params = getFlashParams(type, element)
    params.peakIntensity *= scale

    const targets: FlashSession['targets'] = []

    root.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return
      const mat = child.material
      if (!Array.isArray(mat) && mat instanceof THREE.MeshStandardMaterial) {
        targets.push({
          mat,
          originalEmissive: mat.emissive.clone(),
          originalIntensity: mat.emissiveIntensity,
        })
      }
    })

    if (targets.length === 0) return

    this.sessions.push({ targets, params, elapsed: 0 })
  }

  /**
   * 
   * @param dt 
   */
  update(dt: number): void {
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      const s = this.sessions[i]
      s.elapsed += dt

      const t = Math.min(s.elapsed / s.params.duration, 1)
      // ： ，
      const intensity = s.params.peakIntensity * (1 - t * t)

      for (const { mat } of s.targets) {
        mat.emissive.copy(s.params.color)
        mat.emissiveIntensity = intensity
      }

      if (t >= 1) {
        //  emissive
        for (const { mat, originalEmissive, originalIntensity } of s.targets) {
          mat.emissive.copy(originalEmissive)
          mat.emissiveIntensity = originalIntensity
        }
        this.sessions.splice(i, 1)
      }
    }
  }

  /**  */
  reset(): void {
    for (const s of this.sessions) {
      for (const { mat, originalEmissive, originalIntensity } of s.targets) {
        mat.emissive.copy(originalEmissive)
        mat.emissiveIntensity = originalIntensity
      }
    }
    this.sessions = []
  }

  get isActive(): boolean {
    return this.sessions.length > 0
  }
}
