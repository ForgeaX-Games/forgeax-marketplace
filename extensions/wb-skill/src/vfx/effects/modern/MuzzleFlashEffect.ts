// @source wb-character/src/vfx/effects/modern/MuzzleFlashEffect.ts
/**
 * MuzzleFlashEffect — 
 *
 * ：WEAPON_TIP（ ）
 * ：2~4 （  33~66ms）， 
 *
 * ：
 *   L1 （ ）
 *   L2 （Billboard，4 ）
 *   L3 （ ， ）
 */

import * as THREE from 'three'
import type { ModernWeaponConfig } from './ModernWeaponTypes'
import type { WorldStyleEntry } from '../../style/WorldStylePalette'

interface SmokeParticle {
  pos: THREE.Vector3
  vel: THREE.Vector3
  alpha: number
  size: number
  elapsed: number
  life: number
  active: boolean
}

const SMOKE_MAX = 200

export class MuzzleFlashEffect {
  // L1 —
  private coreMesh:  THREE.Mesh
  private coreMat:   THREE.MeshBasicMaterial
  // L2 — （ ）
  private flareH:    THREE.Mesh
  private flareV:    THREE.Mesh
  private flareMat:  THREE.MeshBasicMaterial
  // L3 —
  private smokeGeo:  THREE.BufferGeometry
  private smokeMat:  THREE.ShaderMaterial
  private smokePS:   THREE.Points
  private particles: SmokeParticle[]

  private active = false
  private elapsed = 0
  private duration = 0.05
  private muzzlePos = new THREE.Vector3()
  private muzzleDir = new THREE.Vector3(0, 0, -1)

  constructor(private scene: THREE.Scene) {
    // ──  ──────────────────────────────────────────
    const coreGeo = new THREE.SphereGeometry(1, 8, 8)
    this.coreMat  = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat)
    this.coreMesh.renderOrder = 2030
    scene.add(this.coreMesh)

    // ──  ──────────────────────────────────────
    const flareGeo = new THREE.PlaneGeometry(1, 1)
    this.flareMat  = new THREE.MeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.flareH = new THREE.Mesh(flareGeo, this.flareMat)
    this.flareV = new THREE.Mesh(flareGeo, this.flareMat)
    this.flareV.rotation.z = Math.PI / 2
    scene.add(this.flareH)
    scene.add(this.flareV)

    // ──  ──────────────────────────────────────
    this.particles = Array.from({ length: SMOKE_MAX }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      alpha: 0, size: 0.1, elapsed: 0, life: 0.4, active: false,
    }))
    this.smokeGeo  = new THREE.BufferGeometry()
    const pos  = new Float32Array(SMOKE_MAX * 3)
    const col  = new Float32Array(SMOKE_MAX * 4)
    const sz   = new Float32Array(SMOKE_MAX)
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.smokeGeo.setAttribute('aColor',   new THREE.BufferAttribute(col, 4))
    this.smokeGeo.setAttribute('aSize',    new THREE.BufferAttribute(sz, 1))

    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; varying vec4 vCol;
        void main() {
          vCol = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec4 vCol;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - d));
        }
      `,
      transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.smokePS = new THREE.Points(this.smokeGeo, this.smokeMat)
    this.smokePS.frustumCulled = false
    this.smokePS.renderOrder = 2025
    scene.add(this.smokePS)
  }

  /**
   * 
   * @param weaponTip   
   * @param fireDir     （ ）
   * @param config      
   * @param worldStyle  （ ）
   */
  fire(
    weaponTip: THREE.Vector3,
    fireDir: THREE.Vector3,
    config: ModernWeaponConfig,
    worldStyle?: WorldStyleEntry['particleStyle'],
  ): void {
    this.active    = true
    this.elapsed   = 0
    this.duration  = 0.033 + (1 / Math.max(config.fireRate, 1)) * 0.5
    this.duration  = Math.min(this.duration, 0.08)
    this.muzzlePos.copy(weaponTip)
    this.muzzleDir.copy(fireDir)

    const s = config.muzzleFlashScale
    if (s <= 0) return

    //
    this.coreMesh.position.copy(weaponTip)
    this.coreMesh.scale.setScalar(s * 0.12)
    this.coreMat.opacity = 1.0

    //
    this.flareH.position.copy(weaponTip)
    this.flareV.position.copy(weaponTip)
    this.flareH.scale.setScalar(s * 0.5)
    this.flareV.scale.setScalar(s * 0.35)
    this.flareMat.opacity = 0.9

    // （Billboard ）
    this.flareH.lookAt(this.scene.position) // ：  update

    //
    const smokeColor = this.getSmokeColor(worldStyle)
    const count = Math.floor(8 * s)
    let emitted = 0
    for (const p of this.particles) {
      if (p.active || emitted >= count) continue
      p.active  = true
      p.elapsed = 0
      p.life    = 0.3 + Math.random() * 0.4
      p.pos.copy(weaponTip)
      const spread = 0.15
      p.vel.set(
        fireDir.x + (Math.random() - 0.5) * spread,
        fireDir.y + (Math.random() - 0.5) * spread + 0.3,
        fireDir.z + (Math.random() - 0.5) * spread,
      ).multiplyScalar(1.0 + Math.random() * 1.5)
      p.size  = (0.06 + Math.random() * 0.08) * s
      p.alpha = smokeColor.a
      emitted++
    }
    this._smokeColor = smokeColor
  }

  private _smokeColor = { r: 0.5, g: 0.5, b: 0.5, a: 0.5 }

  update(dt: number, camera: THREE.Camera): void {
    if (this.active) {
      this.elapsed += dt
      const t = Math.min(this.elapsed / this.duration, 1)
      const fade = 1 - t * t

      this.coreMat.opacity  = fade
      this.flareMat.opacity = fade * 0.9

      // Billboard：
      this.flareH.quaternion.copy(camera.quaternion)
      this.flareV.quaternion.copy(camera.quaternion)

      if (t >= 1) {
        this.active = false
        this.coreMat.opacity  = 0
        this.flareMat.opacity = 0
      }
    }

    //
    const posArr  = this.smokeGeo.attributes['position'].array as Float32Array
    const colArr  = this.smokeGeo.attributes['aColor'].array   as Float32Array
    const sizeArr = this.smokeGeo.attributes['aSize'].array    as Float32Array
    const sc = this._smokeColor

    for (let i = 0; i < SMOKE_MAX; i++) {
      const p = this.particles[i]
      if (!p.active) { colArr[i * 4 + 3] = 0; continue }

      p.elapsed += dt
      const t = Math.min(p.elapsed / p.life, 1)
      p.vel.multiplyScalar(1 - 2.5 * dt)
      p.vel.y += 0.4 * dt
      p.pos.addScaledVector(p.vel, dt)

      posArr[i * 3]     = p.pos.x
      posArr[i * 3 + 1] = p.pos.y
      posArr[i * 3 + 2] = p.pos.z
      colArr[i * 4]     = sc.r
      colArr[i * 4 + 1] = sc.g
      colArr[i * 4 + 2] = sc.b
      colArr[i * 4 + 3] = sc.a * (1 - t * t)
      sizeArr[i]         = p.size * (1 + t * 1.5)

      if (t >= 1) p.active = false
    }

    this.smokeGeo.attributes['position'].needsUpdate = true
    this.smokeGeo.attributes['aColor'].needsUpdate   = true
    this.smokeGeo.attributes['aSize'].needsUpdate    = true
  }

  dispose(): void {
    this.scene.remove(this.coreMesh, this.flareH, this.flareV, this.smokePS)
    this.coreMat.dispose()
    this.flareMat.dispose()
    this.smokeGeo.dispose()
    this.smokeMat.dispose()
  }

  // ───  ────────────────────────────────────────
  private getSmokeColor(style?: WorldStyleEntry['particleStyle']): { r: number; g: number; b: number; a: number } {
    switch (style) {
      case 'hex':    return { r: 0.0, g: 0.9, b: 1.0, a: 0.45 }  // ：
      case 'energy': return { r: 0.2, g: 0.5, b: 1.0, a: 0.40 }  // ：
      case 'gear':   return { r: 0.7, g: 0.6, b: 0.3, a: 0.50 }  // ：
      case 'dust':   return { r: 0.5, g: 0.4, b: 0.3, a: 0.55 }  // ：
      default:       return { r: 0.4, g: 0.4, b: 0.4, a: 0.45 }  // ：
    }
  }
}
