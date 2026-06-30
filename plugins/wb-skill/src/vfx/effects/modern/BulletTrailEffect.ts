// @source wb-character/src/vfx/effects/modern/BulletTrailEffect.ts
/**
 * BulletTrailEffect — 
 *
 * ：
 *   bullet  — （ ，AdditiveBlending）
 *   rocket  — （ ）
 *   beam    — （ ， ）
 *   spread  — （  bullet ）
 *   flame   — （ ， ）
 *
 *  Trail ，  30 （ ）。
 */

import * as THREE from 'three'
import type { ModernWeaponConfig, ProjectileType } from './ModernWeaponTypes'

interface TrailSegment {
  start:   THREE.Vector3
  end:     THREE.Vector3
  elapsed: number
  life:    number
  color:   THREE.Color
  width:   number   //
  type:    ProjectileType
  active:  boolean
}

const MAX_TRAILS = 60

export class BulletTrailEffect {
  private geo:     THREE.BufferGeometry
  private mat:     THREE.LineBasicMaterial
  private lines:   THREE.LineSegments
  private trails:  TrailSegment[]

  // （  flame ）
  private flameGeo: THREE.BufferGeometry
  private flameMat: THREE.ShaderMaterial
  private flamePS:  THREE.Points
  private flameParticles: Array<{
    pos: THREE.Vector3; vel: THREE.Vector3
    alpha: number; size: number; elapsed: number; life: number; active: boolean
  }>

  private readonly FLAME_MAX = 400

  constructor(private scene: THREE.Scene) {
    this.trails = Array.from({ length: MAX_TRAILS }, () => ({
      start: new THREE.Vector3(), end: new THREE.Vector3(),
      elapsed: 0, life: 0.12, color: new THREE.Color(1, 1, 1),
      width: 1, type: 'bullet' as ProjectileType, active: false,
    }))

    // LineSegments for bullet/rocket/beam
    this.geo  = new THREE.BufferGeometry()
    const pos = new Float32Array(MAX_TRAILS * 2 * 3)
    const col = new Float32Array(MAX_TRAILS * 2 * 3)
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
    this.geo.setDrawRange(0, MAX_TRAILS * 2)

    this.mat  = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.lines = new THREE.LineSegments(this.geo, this.mat)
    this.lines.frustumCulled = false
    this.lines.renderOrder = 2015
    scene.add(this.lines)

    //
    this.flameParticles = Array.from({ length: this.FLAME_MAX }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      alpha: 0, size: 0.08, elapsed: 0, life: 0.4, active: false,
    }))
    this.flameGeo = new THREE.BufferGeometry()
    const fp  = new Float32Array(this.FLAME_MAX * 3)
    const fc  = new Float32Array(this.FLAME_MAX * 4)
    const fs  = new Float32Array(this.FLAME_MAX)
    this.flameGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3))
    this.flameGeo.setAttribute('aColor',   new THREE.BufferAttribute(fc, 4))
    this.flameGeo.setAttribute('aSize',    new THREE.BufferAttribute(fs, 1))

    this.flameMat = new THREE.ShaderMaterial({
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
          gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - d * d));
        }
      `,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.flamePS = new THREE.Points(this.flameGeo, this.flameMat)
    this.flamePS.frustumCulled = false
    this.flamePS.renderOrder = 2016
    scene.add(this.flamePS)
  }

  /**
   * 
   * @param origin    （WEAPON_TIP）
   * @param direction （ ）
   * @param distance  （ ）
   * @param config    
   * @param colorHex  （ / ）
   */
  fire(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
    config: ModernWeaponConfig,
    colorHex?: string,
  ): void {
    if (config.projectileType === 'flame') {
      this.emitFlame(origin, direction, config)
      return
    }

    const positions = this.getFirePositions(origin, direction, distance, config)
    for (const { start, end } of positions) {
      for (const t of this.trails) {
        if (t.active) continue
        t.active  = true
        t.elapsed = 0
        t.type    = config.projectileType
        t.start.copy(start)
        t.end.copy(end)
        t.color.set(colorHex ?? this.getDefaultColor(config.projectileType))
        t.life  = this.getLife(config.projectileType)
        t.width = config.trailLength
        break
      }
    }
  }

  update(dt: number): void {
    const posArr = this.geo.attributes['position'].array as Float32Array
    const colArr = this.geo.attributes['color'].array   as Float32Array

    for (let i = 0; i < MAX_TRAILS; i++) {
      const t = this.trails[i]
      const base = i * 2 * 3

      if (!t.active) {
        // （ ）
        for (let k = 0; k < 6; k++) posArr[base + k] = 0
        for (let k = 0; k < 6; k++) colArr[base + k] = 0
        continue
      }

      t.elapsed += dt
      const progress = Math.min(t.elapsed / t.life, 1)
      const alpha    = 1 - progress * progress

      //
      posArr[base]     = t.start.x; posArr[base + 1] = t.start.y; posArr[base + 2] = t.start.z
      posArr[base + 3] = t.end.x;   posArr[base + 4] = t.end.y;   posArr[base + 5] = t.end.z

      const r = t.color.r * alpha, g = t.color.g * alpha, b = t.color.b * alpha
      colArr[base]     = r; colArr[base + 1] = g; colArr[base + 2] = b
      colArr[base + 3] = r * 0.5; colArr[base + 4] = g * 0.5; colArr[base + 5] = b * 0.5

      if (progress >= 1) t.active = false
    }

    this.geo.attributes['position'].needsUpdate = true
    this.geo.attributes['color'].needsUpdate    = true

    this.updateFlame(dt)
  }

  dispose(): void {
    this.scene.remove(this.lines, this.flamePS)
    this.geo.dispose(); this.mat.dispose()
    this.flameGeo.dispose(); this.flameMat.dispose()
  }

  // ───  ─────────────────────────────────────────────────────

  private getFirePositions(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
    config: ModernWeaponConfig,
  ): Array<{ start: THREE.Vector3; end: THREE.Vector3 }> {
    if (config.projectileType !== 'spread') {
      const trailLen = config.trailLength * 0.5
      const end      = origin.clone().addScaledVector(direction, distance)
      const start    = end.clone().addScaledVector(direction, -trailLen)
      return [{ start, end }]
    }

    // ：
    const results: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = []
    const count = config.projectileCount
    const spreadRad = (config.spreadAngle * Math.PI / 180)
    for (let i = 0; i < count; i++) {
      const theta = (Math.random() - 0.5) * spreadRad
      const phi   = (Math.random() - 0.5) * spreadRad
      const d = direction.clone()
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
      d.applyAxisAngle(new THREE.Vector3(1, 0, 0), phi)
      d.normalize()
      const trailLen = config.trailLength * 0.3
      const end      = origin.clone().addScaledVector(d, distance * (0.5 + Math.random() * 0.5))
      const start    = end.clone().addScaledVector(d, -trailLen)
      results.push({ start, end })
    }
    return results
  }

  private emitFlame(origin: THREE.Vector3, dir: THREE.Vector3, config: ModernWeaponConfig): void {
    const count = 6
    let emitted = 0
    for (const p of this.flameParticles) {
      if (p.active || emitted >= count) continue
      const spread = config.spreadAngle * Math.PI / 180
      const theta  = (Math.random() - 0.5) * spread
      const phi    = (Math.random() - 0.5) * spread * 0.5
      const d = dir.clone()
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
      d.applyAxisAngle(new THREE.Vector3(1, 0, 0), phi)
      p.active  = true; p.elapsed = 0
      p.life    = 0.3 + Math.random() * 0.3
      p.pos.copy(origin)
      p.vel.copy(d).multiplyScalar(3 + Math.random() * 2)
      p.size    = 0.15 + Math.random() * 0.1
      p.alpha   = 0.85
      emitted++
    }
  }

  private updateFlame(dt: number): void {
    const pa  = this.flameGeo.attributes['position'].array as Float32Array
    const ca  = this.flameGeo.attributes['aColor'].array   as Float32Array
    const sa  = this.flameGeo.attributes['aSize'].array    as Float32Array

    for (let i = 0; i < this.FLAME_MAX; i++) {
      const p = this.flameParticles[i]
      if (!p.active) { ca[i * 4 + 3] = 0; continue }
      p.elapsed += dt
      const t = Math.min(p.elapsed / p.life, 1)
      p.vel.multiplyScalar(1 - 3 * dt)
      p.vel.y += 1.5 * dt
      p.pos.addScaledVector(p.vel, dt)
      // ： → →
      const r = 1.0, g = Math.max(0.4 - t * 0.4, 0), b = 0.0
      pa[i * 3] = p.pos.x; pa[i * 3 + 1] = p.pos.y; pa[i * 3 + 2] = p.pos.z
      ca[i * 4] = r; ca[i * 4 + 1] = g; ca[i * 4 + 2] = b; ca[i * 4 + 3] = p.alpha * (1 - t * t)
      sa[i] = p.size * (1 + t)
      if (t >= 1) p.active = false
    }

    this.flameGeo.attributes['position'].needsUpdate = true
    this.flameGeo.attributes['aColor'].needsUpdate   = true
    this.flameGeo.attributes['aSize'].needsUpdate    = true
  }

  private getDefaultColor(type: ProjectileType): string {
    switch (type) {
      case 'bullet': return '#ffeecc'
      case 'rocket': return '#ff6600'
      case 'beam':   return '#00ccff'
      case 'spread': return '#ffddaa'
      case 'shell':  return '#ff8800'
      default:       return '#ffffff'
    }
  }

  private getLife(type: ProjectileType): number {
    switch (type) {
      case 'bullet': return 0.06
      case 'rocket': return 0.20
      case 'beam':   return 0.12
      case 'spread': return 0.08
      case 'shell':  return 0.25
      default:       return 0.10
    }
  }
}
