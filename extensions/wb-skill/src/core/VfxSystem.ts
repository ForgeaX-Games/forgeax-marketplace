import * as THREE from 'three'
import type { VfxBinding } from '../pipelines/pixel-char/action-lib'

const PARTICLE_COUNT = 64

interface ActiveVfx {
  points: THREE.Points
  elapsed: number
  duration: number
  type: VfxBinding['type']
  velocities: Float32Array
}

export class VfxSystem {
  private scene: THREE.Scene
  private actives: ActiveVfx[] = []
  private textureCache: THREE.Texture | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  trigger(position: THREE.Vector3, binding: VfxBinding): void {
    const preset = this.createPreset(binding, position)
    if (!preset) return
    this.scene.add(preset.points)
    this.actives.push(preset)
  }

  update(dt: number): void {
    for (let i = this.actives.length - 1; i >= 0; i--) {
      const vfx = this.actives[i]
      vfx.elapsed += dt

      const progress = Math.min(vfx.elapsed / vfx.duration, 1)
      this.animateParticles(vfx, dt, progress)

      const mat = vfx.points.material as THREE.PointsMaterial
      mat.opacity = 1 - progress * progress

      if (progress >= 1) {
        this.scene.remove(vfx.points)
        vfx.points.geometry.dispose()
        mat.dispose()
        this.actives.splice(i, 1)
      }
    }
  }

  dispose(): void {
    for (const vfx of this.actives) {
      this.scene.remove(vfx.points)
      vfx.points.geometry.dispose()
      ;(vfx.points.material as THREE.PointsMaterial).dispose()
    }
    this.actives.length = 0
    this.textureCache?.dispose()
    this.textureCache = null
  }

  private getParticleTexture(): THREE.Texture {
    if (this.textureCache) return this.textureCache
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const g = canvas.getContext('2d')!
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gradient
    g.fillRect(0, 0, size, size)
    this.textureCache = new THREE.CanvasTexture(canvas)
    return this.textureCache
  }

  private createPreset(binding: VfxBinding, origin: THREE.Vector3): ActiveVfx {
    const count = PARTICLE_COUNT
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const color = new THREE.Color(binding.color)
    const scale = binding.scale

    switch (binding.type) {
      case 'slash':
        this.initSlash(positions, velocities, count, scale)
        break
      case 'impact':
        this.initImpact(positions, velocities, count, scale)
        break
      case 'aura':
        this.initAura(positions, velocities, count, scale)
        break
      case 'projectile':
        this.initProjectile(positions, velocities, count, scale)
        break
    }

    for (let i = 0; i < count * 3; i += 3) {
      positions[i] += origin.x
      positions[i + 1] += origin.y
      positions[i + 2] += origin.z
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    // 亮度限制：additive blending 下高亮颜色会过曝，限制粒子尺寸和透明度
    const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
    const brightFactor = lum > 0.55 ? 0.55 / lum : 1.0  // 亮度超出阈值时缩放
    const particleSize    = 0.06 * scale * Math.max(brightFactor, 0.4)
    const particleOpacity = lum > 0.55 ? Math.min(0.75, brightFactor + 0.2) : 1.0
    // 避免纯白变成灰色：不改颜色值，只缩小几何尺寸和 opacity
    const mat = new THREE.PointsMaterial({
      color,
      size: particleSize,
      map: this.getParticleTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: particleOpacity,
    })

    const points = new THREE.Points(geo, mat)
    points.renderOrder = 200
    const durationSec = (binding.duration / 8) * 1.2

    return { points, elapsed: 0, duration: durationSec, type: binding.type, velocities }
  }

  private initSlash(pos: Float32Array, vel: Float32Array, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 0.8) * (i / count) - Math.PI * 0.4
      const r = (0.2 + Math.random() * 0.3) * scale
      const idx = i * 3
      pos[idx] = Math.cos(angle) * r * 0.3
      pos[idx + 1] = Math.sin(angle) * r + 0.5
      pos[idx + 2] = (Math.random() - 0.5) * 0.1
      vel[idx] = Math.cos(angle) * 2 * scale
      vel[idx + 1] = Math.sin(angle) * 1.5 * scale
      vel[idx + 2] = (Math.random() - 0.5) * 0.3
    }
  }

  private initImpact(pos: Float32Array, vel: Float32Array, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const idx = i * 3
      pos[idx] = 0
      pos[idx + 1] = 0.5
      pos[idx + 2] = 0
      const speed = (1 + Math.random() * 2) * scale
      vel[idx] = Math.sin(phi) * Math.cos(theta) * speed
      vel[idx + 1] = Math.cos(phi) * speed * 0.5 + 1
      vel[idx + 2] = Math.sin(phi) * Math.sin(theta) * speed
    }
  }

  private initAura(pos: Float32Array, vel: Float32Array, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const r = (0.3 + Math.random() * 0.2) * scale
      const idx = i * 3
      pos[idx] = Math.cos(angle) * r
      pos[idx + 1] = Math.random() * 0.3
      pos[idx + 2] = Math.sin(angle) * r
      vel[idx] = 0
      vel[idx + 1] = (0.5 + Math.random() * 1.5) * scale
      vel[idx + 2] = 0
    }
  }

  private initProjectile(pos: Float32Array, vel: Float32Array, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const idx = i * 3
      const spread = 0.1 * scale
      pos[idx] = (Math.random() - 0.5) * spread
      pos[idx + 1] = 0.5 + (Math.random() - 0.5) * spread
      pos[idx + 2] = 0
      vel[idx] = (3 + Math.random()) * scale
      vel[idx + 1] = (Math.random() - 0.5) * 0.5
      vel[idx + 2] = (Math.random() - 0.5) * 0.3
    }
  }

  private animateParticles(vfx: ActiveVfx, dt: number, _progress: number): void {
    const posAttr = vfx.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const count = arr.length / 3
    const gravity = vfx.type === 'aura' ? 0 : -2

    for (let i = 0; i < count; i++) {
      const idx = i * 3
      vfx.velocities[idx + 1] += gravity * dt
      arr[idx] += vfx.velocities[idx] * dt
      arr[idx + 1] += vfx.velocities[idx + 1] * dt
      arr[idx + 2] += vfx.velocities[idx + 2] * dt
    }
    posAttr.needsUpdate = true
  }
}
