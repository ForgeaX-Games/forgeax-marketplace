// @source wb-character/src/vfx/effects/hit/HitSparkEffect.ts
/**
 * HitSparkEffect — 
 *
 * ： ，
 * / / 。
 *
 * ，  ParticleSystem（ ）。
 */

import * as THREE from 'three'
import {
  type HitType,
  type HitElement,
  type HitParams,
  HIT_ELEMENT_COLORS,
  getSparkCount,
} from './HitTypes'

interface SparkParticle {
  pos:      THREE.Vector3
  vel:      THREE.Vector3
  color:    THREE.Color
  alpha:    number
  size:     number
  life:     number  // （ ）
  elapsed:  number
  active:   boolean
}

const _tmp = new THREE.Vector3()

export class HitSparkEffect {
  private geo:     THREE.BufferGeometry
  private mat:     THREE.ShaderMaterial
  private points:  THREE.Points
  private sparks:  SparkParticle[]
  private readonly MAX = 500

  constructor(private scene: THREE.Scene) {
    this.sparks = Array.from({ length: this.MAX }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      color: new THREE.Color(1, 1, 1), alpha: 0, size: 1,
      life: 0.5, elapsed: 0, active: false,
    }))

    this.geo = new THREE.BufferGeometry()
    const pos  = new Float32Array(this.MAX * 3)
    const col  = new Float32Array(this.MAX * 4)
    const size = new Float32Array(this.MAX)
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 4))
    this.geo.setAttribute('aSize',    new THREE.BufferAttribute(size, 1))
    this.geo.setDrawRange(0, this.MAX)

    this.mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float alpha = vColor.a * (1.0 - d * d);
          gl_FragColor = vec4(vColor.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 2020
    scene.add(this.points)
  }

  /**  */
  emit(params: HitParams): void {
    const { type, contactPoint, hitDirection, element, scale = 1.0 } = params
    const count = getSparkCount(type, scale)
    const colors = this.getColors(type, element)

    //  =
    const mainDir = hitDirection.clone().negate().normalize()

    let emitted = 0
    for (const spark of this.sparks) {
      if (spark.active) continue
      if (emitted >= count) break

      // ：  mainDir ±45°
      const theta = (Math.random() - 0.5) * Math.PI * 0.5   //
      const phi   = (Math.random() - 0.5) * Math.PI * 0.4   //
      const speed = this.getBaseSpeed(type) * (0.6 + Math.random() * 0.8) * scale

      _tmp.copy(mainDir)
      _tmp.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
      _tmp.applyAxisAngle(new THREE.Vector3(1, 0, 0), phi)
      _tmp.multiplyScalar(speed)
      // （ ）
      _tmp.y += speed * 0.3

      spark.active  = true
      spark.elapsed = 0
      spark.life    = this.getLife(type) * (0.7 + Math.random() * 0.6)
      spark.pos.copy(contactPoint)
      spark.vel.copy(_tmp)
      spark.size    = this.getSize(type) * (0.6 + Math.random() * 0.8) * scale
      spark.alpha   = 1.0
      spark.color.copy(Math.random() < 0.6 ? colors.spark : colors.glow)

      emitted++
    }
  }

  update(dt: number): void {
    const posArr  = this.geo.attributes['position'].array as Float32Array
    const colArr  = this.geo.attributes['aColor'].array  as Float32Array
    const sizeArr = this.geo.attributes['aSize'].array   as Float32Array

    for (let i = 0; i < this.MAX; i++) {
      const s = this.sparks[i]
      if (!s.active) {
        colArr[i * 4 + 3] = 0
        continue
      }

      s.elapsed += dt
      const t = Math.min(s.elapsed / s.life, 1)

      // ：  +
      s.vel.y    -= 4.5 * dt
      s.vel.multiplyScalar(1 - 3.5 * dt)
      s.pos.addScaledVector(s.vel, dt)

      //
      if (s.pos.y < 0.01) {
        s.pos.y = 0.01
        s.vel.y = Math.abs(s.vel.y) * 0.2  //
      }

      const alpha = (1 - t * t) * s.alpha

      posArr[i * 3]     = s.pos.x
      posArr[i * 3 + 1] = s.pos.y
      posArr[i * 3 + 2] = s.pos.z
      colArr[i * 4]     = s.color.r
      colArr[i * 4 + 1] = s.color.g
      colArr[i * 4 + 2] = s.color.b
      colArr[i * 4 + 3] = alpha
      sizeArr[i]         = s.size * (1 - t * 0.5)

      if (t >= 1) s.active = false
    }

    this.geo.attributes['position'].needsUpdate = true
    this.geo.attributes['aColor'].needsUpdate   = true
    this.geo.attributes['aSize'].needsUpdate    = true
  }

  dispose(): void {
    this.scene.remove(this.points)
    this.geo.dispose()
    this.mat.dispose()
  }

  // ───  ─────────────────────────────────────────────────────

  private getColors(type: HitType, element?: HitElement) {
    if (element) return HIT_ELEMENT_COLORS[element]
    switch (type) {
      case 'blocked':  return { spark: new THREE.Color('#ffdd44'), glow: new THREE.Color('#ffffff') }
      case 'heal':     return { spark: new THREE.Color('#44ff88'), glow: new THREE.Color('#aaffcc') }
      case 'critical': return { spark: new THREE.Color('#ff6600'), glow: new THREE.Color('#ffffff') }
      default:         return HIT_ELEMENT_COLORS['physical']
    }
  }

  private getBaseSpeed(type: HitType): number {
    switch (type) {
      case 'light':    return 2.0
      case 'heavy':    return 4.0
      case 'critical': return 5.5
      case 'elemental':return 3.0
      case 'blocked':  return 2.5
      case 'heal':     return 1.5
    }
  }

  private getLife(type: HitType): number {
    switch (type) {
      case 'light':    return 0.35
      case 'heavy':    return 0.60
      case 'critical': return 0.80
      case 'elemental':return 0.50
      case 'blocked':  return 0.45
      case 'heal':     return 0.70
    }
  }

  private getSize(type: HitType): number {
    switch (type) {
      case 'light':    return 0.06
      case 'heavy':    return 0.12
      case 'critical': return 0.18
      case 'elemental':return 0.10
      case 'blocked':  return 0.09
      case 'heal':     return 0.10
    }
  }
}
