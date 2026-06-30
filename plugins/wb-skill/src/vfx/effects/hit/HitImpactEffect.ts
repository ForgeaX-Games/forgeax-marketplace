// @source wb-character/src/vfx/effects/hit/HitImpactEffect.ts
/**
 * HitImpactEffect — 
 *
 *  HitFlashEffect + HitSparkEffect， 。
 * （ / ）。
 */

import * as THREE from 'three'
import { HitFlashEffect } from './HitFlashEffect'
import { HitSparkEffect } from './HitSparkEffect'
import { type HitParams } from './HitTypes'

interface GroundRingSession {
  mesh:    THREE.Mesh
  elapsed: number
  maxR:    number
  duration:number
}

export class HitImpactEffect {
  private flash: HitFlashEffect
  private spark: HitSparkEffect
  private rings: GroundRingSession[] = []
  private ringMat: THREE.MeshBasicMaterial

  constructor(private scene: THREE.Scene) {
    this.flash = new HitFlashEffect()
    this.spark = new HitSparkEffect(scene)

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  }

  /**
   * 
   * @param params   （ 、 、 、 ）
   * @param target    Object3D（ ）
   * @param scale    （ ，1.0= ）
   */
  trigger(
    params: HitParams,
    target?: THREE.Object3D,
    scale = 1.0,
  ): void {
    const p = { ...params, scale }

    //
    this.spark.emit(p)

    // （  Three.js ）
    if (target) {
      this.flash.trigger(target, params.type, params.element, scale)
    }

    // /  →
    if (params.type === 'heavy' || params.type === 'critical') {
      this.spawnGroundRing(params.contactPoint, params.type, scale)
    }
  }

  update(dt: number): void {
    this.flash.update(dt)
    this.spark.update(dt)
    this.updateRings(dt)
  }

  dispose(): void {
    this.spark.dispose()
    this.flash.reset()
    for (const r of this.rings) this.scene.remove(r.mesh)
    this.rings = []
    this.ringMat.dispose()
  }

  // ───  ────────────────────────────────────────────────

  private spawnGroundRing(
    contactPoint: THREE.Vector3,
    type: 'heavy' | 'critical',
    scale: number,
  ): void {
    const isCrit = type === 'critical'
    const maxR    = (isCrit ? 1.2 : 0.7) * scale
    const duration = isCrit ? 0.5 : 0.35

    const mat = this.ringMat.clone()
    mat.color.set(isCrit ? '#ff6600' : '#ccaa44')

    const geo  = new THREE.RingGeometry(0.01, 0.02, 32)
    const mesh = new THREE.Mesh(geo, mat)
    // ：Y=0.015  Z-fighting
    mesh.position.set(contactPoint.x, 0.015, contactPoint.z)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 5
    this.scene.add(mesh)

    this.rings.push({ mesh, elapsed: 0, maxR, duration })
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.elapsed += dt
      const t = Math.min(r.elapsed / r.duration, 1)
      const radius = r.maxR * t
      const innerR = Math.max(radius - 0.04, 0.01)

      //  Ring（ ：  + ）
      r.mesh.scale.setScalar(radius / 0.02)
      const mat = r.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (1 - t) * 0.6

      if (t >= 1) {
        this.scene.remove(r.mesh)
        ;(r.mesh.material as THREE.Material).dispose()
        r.mesh.geometry.dispose()
        this.rings.splice(i, 1)
      }
    }
  }
}
