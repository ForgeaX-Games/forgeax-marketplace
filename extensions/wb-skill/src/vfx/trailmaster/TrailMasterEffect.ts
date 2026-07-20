// @source wb-character/src/vfx/trailmaster/TrailMasterEffect.ts
/**
 * TrailMasterEffect — 
 *
 * （ ）：
 *   Layer 0     widthScale×2.8  GLOW_FRAG    opacity≤0.50  
 *   Layer 1   widthScale×1.0  TRAIL_FRAG   opacity≤0.85  + 
 *   Layer 2   widthScale×0.22 CORE_FRAG    opacity≤0.90   bloom
 *
 * ：
 *   [0, swingDur]      swipeProgress  1.0 → -0.1（ ）
 *   [swingDur, holdEnd] ，emissive 
 *   [holdEnd, duration] uParticleAlpha → 0（ ）
 */

import * as THREE from 'three'
import {
  TRAIL_VERT,
  GLOW_FRAG, TRAIL_FRAG, CORE_FRAG,
  BLOOD_FRAG, LIGHTNING_FRAG, THUNDER_BOLT_FRAG,
  PARTICLE_VERT, PARTICLE_FRAG,
  makeDefaultTrailUniforms,
  type TrailUniforms,
} from './TrailMasterShader'
import { buildLayeredRibbonGeometries, type ArcParams } from './TrailMasterRibbon'

// ──  ──────────────────────────────────────────────────────

const texCache = new Map<string, THREE.Texture>()
const loader   = new THREE.TextureLoader()
const TEX_BASE = '/textures/trailmaster/'

function loadTex(name: string): THREE.Texture {
  if (texCache.has(name)) return texCache.get(name)!
  const tex = loader.load(TEX_BASE + name, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.needsUpdate = true
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  texCache.set(name, tex)
  return tex
}

// ──  ──────────────────────────────────────────────────────

export interface TrailPreset {
  name:           string
  cavityTex:      string
  noiseTex:       string
  emissiveTex:    string
  colorA:         number
  colorB:         number
  noiseTileU:     number
  noiseTileV:     number
  noiseSpeedU:    number
  noiseSpeedV:    number
  noiseStrength:  number
  emissiveTileU:  number
  emissiveTileV:  number
  emissiveSpeedU: number
  emissiveSpeedV: number
  emissiveStrength: number
  emissivePower:  number
  emissiveNoiseStr: number
  cavityStrength: number
  cavityMouths:   number
  opacityNoiseStr: number
  opacityStrength: number
  opacityPower:   number
  particleColor:  number
  particleCount:  number
  arc?:           Partial<ArcParams>
  swingDuration?: number
  duration?:      number
  /** 'trail'= （ ）| 'blood'=  | 'lightning'=  */
  effectType?:    'trail' | 'blood' | 'lightning'
}

// ──  ────────────────────────────────────────────────────────────

type LayerKey = 'glow' | 'main' | 'core'

interface LayerDef { key: LayerKey; frag: string }

const TRAIL_LAYERS: LayerDef[] = [
  { key: 'glow', frag: GLOW_FRAG  },
  { key: 'main', frag: TRAIL_FRAG },
  { key: 'core', frag: CORE_FRAG  },
]

// ： （ ）+ ×2
const BLOOD_LAYERS: LayerDef[] = [
  { key: 'glow', frag: GLOW_FRAG  },   //
  { key: 'main', frag: BLOOD_FRAG },   //
  { key: 'core', frag: BLOOD_FRAG },   // （widthScale×0.45）
]

// ：  +  +  +
const LIGHTNING_LAYERS: LayerDef[] = [
  { key: 'glow', frag: GLOW_FRAG        },  //
  { key: 'main', frag: LIGHTNING_FRAG   },  // （T_Thunder + → ）
  { key: 'core', frag: THUNDER_BOLT_FRAG},  //
]

// ──  Effect  ──────────────────────────────────────────────────────

export class TrailMasterEffect {
  private group:     THREE.Group
  private uniforms:  TrailUniforms   //  uniforms（ ）
  private meshes:    THREE.Mesh[] = []
  private particles: THREE.Points | null = null
  private partUniforms: {
    uParticleColor: { value: THREE.Color }
    uAlpha:         { value: number }
    uEmissivePower: { value: number }
  } | null = null

  private alive    = true
  private age      = 0.0
  private swingDur: number
  private holdEnd:  number
  private duration: number

  constructor(
    scene:   THREE.Scene,
    preset:  TrailPreset,
    origin:  THREE.Vector3 = new THREE.Vector3(),
  ) {
    this.swingDur = preset.swingDuration ?? 0.28
    this.duration = preset.duration      ?? 1.2
    this.holdEnd  = this.swingDur + 0.28

    this.group = new THREE.Group()
    this.group.position.copy(origin)
    scene.add(this.group)

    this.uniforms = makeDefaultTrailUniforms()
    this._applyPreset(preset)

    const isBlood     = preset.effectType === 'blood'
    const isLightning = preset.effectType === 'lightning'
    const layers = isBlood ? BLOOD_LAYERS : isLightning ? LIGHTNING_LAYERS : TRAIL_LAYERS

    // ： =0.45（ ）， =0.85（ ），trail=0.22（ ）
    const coreScale = isBlood ? 0.45 : isLightning ? 0.88 : 0.22
    const [geoGlow, geoMain, geoCore] = buildLayeredRibbonGeometries(preset.arc, coreScale)

    for (const layer of layers) {
      const geo = layer.key === 'glow' ? geoGlow
                : layer.key === 'main' ? geoMain
                :                        geoCore

      const mat = new THREE.ShaderMaterial({
        vertexShader:   TRAIL_VERT,
        fragmentShader: layer.frag,
        uniforms:       this.uniforms as unknown as Record<string, THREE.IUniform>,
        transparent:    true,
        depthWrite:     false,
        blending:       THREE.AdditiveBlending,
        side:           THREE.DoubleSide,
      })

      const mesh = new THREE.Mesh(geo, mat)
      this.meshes.push(mesh)
      this.group.add(mesh)
    }

    //  swipe = 1（ ）
    this.uniforms.uSwipeProgress.value = 1.0

    // ──  ────────────────────────────────────────────────────
    if (preset.particleCount > 0) this._buildParticles(preset)
  }

  // ──  ───────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.alive) return
    this.age += dt
    this.uniforms.uTime.value += dt

    const { swingDur, holdEnd, duration } = this

    // ① swipe：
    if (this.age <= swingDur) {
      const t     = this.age / swingDur
      const eased = 1.0 - Math.pow(1.0 - t, 2.2)   // ease-out quad
      this.uniforms.uSwipeProgress.value = 1.0 - eased * 1.12  //  -0.12
    } else {
      this.uniforms.uSwipeProgress.value = -0.12
    }

    // ②
    let alpha = 1.0
    if (this.age > holdEnd) {
      alpha = 1.0 - (this.age - holdEnd) / (duration - holdEnd)
      alpha = Math.max(0, alpha)
    }
    this.uniforms.uParticleAlpha.value = alpha

    // ③
    if (this.particles) this._updateParticles(dt, alpha)

    if (this.age >= duration) {
      this.alive = false
      this._removeFromScene()
    }
  }

  isAlive(): boolean { return this.alive }

  dispose(): void {
    this._removeFromScene()
    for (const m of this.meshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    if (this.particles) {
      this.particles.geometry.dispose()
      ;(this.particles.material as THREE.Material).dispose()
    }
  }

  // ──  ──────────────────────────────────────────────────────

  private _applyPreset(p: TrailPreset): void {
    const u = this.uniforms
    u.uNoiseTex.value    = loadTex(p.noiseTex)
    u.uEmissiveTex.value = loadTex(p.emissiveTex)
    u.uCavityTex.value   = loadTex(p.cavityTex)

    u.uColorA.value.setHex(p.colorA)
    u.uColorB.value.setHex(p.colorB)
    u.uParticleColor.value.setHex(p.particleColor)

    u.uNoiseTileU.value    = p.noiseTileU
    u.uNoiseTileV.value    = p.noiseTileV
    u.uNoiseSpeedU.value   = p.noiseSpeedU
    u.uNoiseSpeedV.value   = p.noiseSpeedV
    u.uNoiseStrength.value = p.noiseStrength

    u.uEmissiveTileU.value    = p.emissiveTileU
    u.uEmissiveTileV.value    = p.emissiveTileV
    u.uEmissiveSpeedU.value   = p.emissiveSpeedU
    u.uEmissiveSpeedV.value   = p.emissiveSpeedV
    u.uEmissiveStrength.value = p.emissiveStrength
    u.uEmissivePower.value    = p.emissivePower
    u.uEmissiveNoiseStr.value = p.emissiveNoiseStr

    u.uCavityStrength.value   = p.cavityStrength
    u.uCavityMouths.value     = p.cavityMouths
    u.uOpacityNoiseStr.value  = p.opacityNoiseStr ?? 0.1
    u.uOpacityStrength.value  = p.opacityStrength
    u.uOpacityPower.value     = p.opacityPower
  }

  private _buildParticles(p: TrailPreset): void {
    const isBlood = p.effectType === 'blood'
    const count   = p.particleCount
    const pos     = new Float32Array(count * 3)
    const vel     = new Float32Array(count * 3)
    const sizes   = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      if (isBlood) {
        // ： （P_Particle_001 ）
        const theta  = Math.random() * Math.PI * 2
        const phi    = Math.random() * Math.PI
        const spawn  = 0.15 + Math.random() * 0.5   //
        pos[i*3]     = Math.sin(phi) * Math.cos(theta) * spawn
        pos[i*3 + 1] = 0.70 + Math.sin(phi) * Math.sin(theta) * spawn
        pos[i*3 + 2] = Math.cos(phi) * spawn
        // ： （  + ）
        const spd    = 0.8 + Math.random() * 2.2
        vel[i*3]     = Math.sin(phi) * Math.cos(theta) * spd + (Math.random() - 0.5) * 0.4
        vel[i*3 + 1] = Math.abs(Math.sin(phi) * Math.sin(theta)) * spd * 0.6 + 0.3
        vel[i*3 + 2] = Math.cos(phi) * spd + (Math.random() - 0.5) * 0.4
        sizes[i]     = 0.015 + Math.random() * 0.035  //
      } else {
        // ：
        const angle  = Math.PI * 0.20 - Math.random() * Math.PI * 0.95
        const r      = 0.72 + Math.random() * 0.28
        pos[i*3]     = Math.cos(angle) * r
        pos[i*3 + 1] = 0.55 + Math.random() * 0.42
        pos[i*3 + 2] = Math.sin(angle) * r
        vel[i*3]     = (Math.random() - 0.5) * 0.7
        vel[i*3 + 1] = 0.3  + Math.random() * 1.2
        vel[i*3 + 2] = (Math.random() - 0.5) * 0.7
        sizes[i]     = 0.025 + Math.random() * 0.04
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('size',     new THREE.Float32BufferAttribute(sizes, 1))
    geo.userData['vel']     = vel
    geo.userData['isBlood'] = isBlood

    this.partUniforms = {
      uParticleColor: { value: new THREE.Color(isBlood ? 0xcc0000 : p.particleColor) },
      uAlpha:         { value: 1.0 },
      uEmissivePower: { value: isBlood ? 0.6 : 2.0 },  //
    }

    const mat = new THREE.ShaderMaterial({
      vertexShader:   PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: this.partUniforms as unknown as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite:  false,
      blending:    isBlood ? THREE.NormalBlending : THREE.AdditiveBlending,
    })

    this.particles = new THREE.Points(geo, mat)
    this.group.add(this.particles)
  }

  private _updateParticles(dt: number, alpha: number): void {
    if (!this.particles) return
    const pos     = this.particles.geometry.attributes['position'].array as Float32Array
    const vel     = this.particles.geometry.userData['vel'] as Float32Array
    const isBlood = this.particles.geometry.userData['isBlood'] as boolean
    const n       = pos.length / 3

    for (let i = 0; i < n; i++) {
      if (isBlood) {
        // （drag coefficient ≈ 2.5）+
        const drag = 1.0 - Math.min(dt * 2.5, 0.8)
        vel[i*3]     *= drag
        vel[i*3 + 2] *= drag
        vel[i*3 + 1]  = vel[i*3 + 1] * drag - 4.5 * dt  // gravity stronger
      } else {
        vel[i*3 + 1] -= 2.2 * dt
      }
      pos[i*3]     += vel[i*3]     * dt
      pos[i*3 + 1] += vel[i*3 + 1] * dt
      pos[i*3 + 2] += vel[i*3 + 2] * dt
    }
    this.particles.geometry.attributes['position'].needsUpdate = true
    if (this.partUniforms) this.partUniforms.uAlpha.value = alpha * 0.75
  }

  private _removeFromScene(): void {
    if (this.group.parent) this.group.parent.remove(this.group)
  }
}
