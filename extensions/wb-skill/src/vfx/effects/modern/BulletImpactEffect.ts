// @source wb-character/src/vfx/effects/modern/BulletImpactEffect.ts
/**
 * BulletImpactEffect — 
 *
 * ： / / / 
 * ：  +  + （ ） 
 */

import * as THREE from 'three'
import type { ImpactSurface } from './ModernWeaponTypes'

interface ImpactParticle {
  pos: THREE.Vector3
  vel: THREE.Vector3
  r: number; g: number; b: number
  alpha: number; size: number
  elapsed: number; life: number
  active: boolean
}

interface BlastRing {
  mesh: THREE.Mesh
  elapsed: number
  duration: number
  maxScale: number
}

const MAX_PARTICLES = 600

export class BulletImpactEffect {
  private geo:       THREE.BufferGeometry
  private mat:       THREE.ShaderMaterial
  private points:    THREE.Points
  private particles: ImpactParticle[]
  private rings:     BlastRing[] = []

  constructor(private scene: THREE.Scene) {
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      r: 1, g: 1, b: 1, alpha: 0, size: 0.05,
      elapsed: 0, life: 0.4, active: false,
    }))

    this.geo = new THREE.BufferGeometry()
    const pos  = new Float32Array(MAX_PARTICLES * 3)
    const col  = new Float32Array(MAX_PARTICLES * 4)
    const size = new Float32Array(MAX_PARTICLES)
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 4))
    this.geo.setAttribute('aSize',    new THREE.BufferAttribute(size, 1))

    this.mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; varying vec4 vCol;
        void main() {
          vCol = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mv.z);
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
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 2018
    scene.add(this.points)
  }

  /**
   * 
   * @param point     
   * @param normal    （ ）
   * @param surface   
   * @param scale     
   */
  impact(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    surface: ImpactSurface = 'concrete',
    scale = 1.0,
  ): void {
    const cfg = this.getSurfaceConfig(surface, scale)

    //
    let emitted = 0
    for (const p of this.particles) {
      if (p.active || emitted >= cfg.count) continue

      const theta = (Math.random() - 0.5) * Math.PI * 0.7
      const phi   = (Math.random() - 0.5) * Math.PI * 0.5
      const speed = cfg.speed * (0.5 + Math.random())

      const vel = normal.clone()
      vel.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
      vel.applyAxisAngle(new THREE.Vector3(1, 0, 0), phi)
      vel.multiplyScalar(speed)

      const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)]

      p.active  = true; p.elapsed = 0
      p.life    = cfg.life * (0.6 + Math.random() * 0.8)
      p.pos.copy(point)
      p.vel.copy(vel)
      p.r = color.r; p.g = color.g; p.b = color.b
      p.alpha = 1.0
      p.size  = cfg.size * (0.6 + Math.random() * 0.8)
      emitted++
    }

    // ：
    if (surface === 'explosive') {
      this.spawnBlastRing(point, scale)
    }

    // ： （ ）
    if (normal.y > 0.6) {
      this.spawnGroundDust(point, scale)
    }
  }

  update(dt: number): void {
    const pa  = this.geo.attributes['position'].array as Float32Array
    const ca  = this.geo.attributes['aColor'].array   as Float32Array
    const sa  = this.geo.attributes['aSize'].array    as Float32Array

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i]
      if (!p.active) { ca[i * 4 + 3] = 0; continue }

      p.elapsed += dt
      const t = Math.min(p.elapsed / p.life, 1)

      p.vel.y -= 6 * dt
      p.vel.multiplyScalar(1 - 4 * dt)
      p.pos.addScaledVector(p.vel, dt)

      if (p.pos.y < 0.008) { p.pos.y = 0.008; p.vel.y *= -0.15 }

      pa[i * 3]     = p.pos.x; pa[i * 3 + 1] = p.pos.y; pa[i * 3 + 2] = p.pos.z
      ca[i * 4]     = p.r;     ca[i * 4 + 1] = p.g;     ca[i * 4 + 2] = p.b
      ca[i * 4 + 3] = p.alpha * (1 - t * t)
      sa[i]         = p.size

      if (t >= 1) p.active = false
    }

    this.geo.attributes['position'].needsUpdate = true
    this.geo.attributes['aColor'].needsUpdate   = true
    this.geo.attributes['aSize'].needsUpdate    = true

    this.updateRings(dt)
  }

  dispose(): void {
    this.scene.remove(this.points)
    this.geo.dispose(); this.mat.dispose()
    for (const r of this.rings) this.scene.remove(r.mesh)
  }

  // ───  ─────────────────────────────────────────────────────

  private getSurfaceConfig(surface: ImpactSurface, scale: number) {
    switch (surface) {
      case 'flesh':
        return {
          count: Math.round(20 * scale),
          speed: 2.5 * scale,
          life: 0.35,
          size: 0.04 * scale,
          colors: [
            new THREE.Color('#cc2200'), new THREE.Color('#880000'),
            new THREE.Color('#ff4400'), new THREE.Color('#440000'),
          ],
        }
      case 'metal':
        return {
          count: Math.round(18 * scale),
          speed: 3.5 * scale,
          life: 0.25,
          size: 0.035 * scale,
          colors: [
            new THREE.Color('#ff8800'), new THREE.Color('#ffcc44'),
            new THREE.Color('#ffffff'), new THREE.Color('#ff4400'),
          ],
        }
      case 'concrete':
        return {
          count: Math.round(25 * scale),
          speed: 2.0 * scale,
          life: 0.5,
          size: 0.05 * scale,
          colors: [
            new THREE.Color('#aaaaaa'), new THREE.Color('#888888'),
            new THREE.Color('#cccccc'), new THREE.Color('#666666'),
          ],
        }
      case 'explosive':
        return {
          count: Math.round(40 * scale),
          speed: 5.0 * scale,
          life: 0.8,
          size: 0.10 * scale,
          colors: [
            new THREE.Color('#ff6600'), new THREE.Color('#ffcc00'),
            new THREE.Color('#ff2200'), new THREE.Color('#444444'),
          ],
        }
    }
  }

  private spawnBlastRing(point: THREE.Vector3, scale: number): void {
    const geo  = new THREE.RingGeometry(0.01, 0.06, 32)
    const mat  = new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: 0.7,
      depthWrite: false, side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(point.x, Math.max(point.y, 0.02), point.z)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 5
    this.scene.add(mesh)
    this.rings.push({ mesh, elapsed: 0, duration: 0.6, maxScale: 80 * scale })
  }

  private spawnGroundDust(point: THREE.Vector3, scale: number): void {
    // ： ，
    const count = Math.round(10 * scale)
    let emitted = 0
    for (const p of this.particles) {
      if (p.active || emitted >= count) continue
      p.active = true; p.elapsed = 0
      p.life   = 0.6 + Math.random() * 0.4
      p.pos.copy(point)
      p.vel.set(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 1.5 + 0.5,
        (Math.random() - 0.5) * 1.5,
      ).multiplyScalar(scale)
      p.r = 0.7; p.g = 0.65; p.b = 0.6
      p.alpha = 0.5
      p.size  = 0.08 * scale
      emitted++
    }
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.elapsed += dt
      const t = Math.min(r.elapsed / r.duration, 1)
      r.mesh.scale.setScalar(r.maxScale * t)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7
      if (t >= 1) {
        this.scene.remove(r.mesh)
        ;(r.mesh.material as THREE.Material).dispose()
        r.mesh.geometry.dispose()
        this.rings.splice(i, 1)
      }
    }
  }
}
