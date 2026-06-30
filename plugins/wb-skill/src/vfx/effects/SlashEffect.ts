// @source wb-character/src/vfx/effects/SlashEffect.ts
/**
 * 3D 
 *
 * ：
 *  - （createBladeGeometry）： 1/2/4/5 
 *  - （createStraightBladeGeometry）： 3  X 
 *
 * （  -Z  ~40°）：
 *   pitch = -45°（rotation.x = +45°），yaw = ±90°
 *   →  = (±0.707, -0.707, 0)（XY ）
 *   →  ±45°，  X
 */

import * as THREE from 'three'
import { ParticleSystem } from '../core/ParticleSystems'

// ──  ────────────────────────────────────────────────────
export type ElementKey = 'fire' | 'ice' | 'magic' | 'plant' | 'light'

export const ELEMENTS: Record<ElementKey, {
  main: THREE.Color; tail: THREE.Color; core: THREE.Color
  coreIntensity: number; flash: THREE.Color
}> = {
  fire:  { main: new THREE.Color(1.0, 0.35, 0.0), tail: new THREE.Color(0.7, 0.06, 0.0), core: new THREE.Color(1.0, 0.92, 0.4), coreIntensity: 7.0, flash: new THREE.Color(1, 0.9, 0.7) },
  ice:   { main: new THREE.Color(0.2, 0.72, 1.0), tail: new THREE.Color(0.0, 0.25, 0.65), core: new THREE.Color(0.85, 0.98, 1.0), coreIntensity: 6.5, flash: new THREE.Color(0.8, 0.9, 1) },
  magic: { main: new THREE.Color(0.82, 0.18, 1.0), tail: new THREE.Color(0.5, 0.08, 0.8), core: new THREE.Color(1.0, 0.52, 0.95), coreIntensity: 6.5, flash: new THREE.Color(0.6, 0.3, 0.8) },
  plant: { main: new THREE.Color(0.12, 0.82, 0.2), tail: new THREE.Color(0.05, 0.38, 0.1), core: new THREE.Color(0.5, 1.0, 0.3), coreIntensity: 5.5, flash: new THREE.Color(0.7, 1, 0.7) },
  light: { main: new THREE.Color(1.0, 0.88, 0.2), tail: new THREE.Color(0.8, 0.48, 0.0), core: new THREE.Color(1.0, 1.0, 0.85), coreIntensity: 6.5, flash: new THREE.Color(1, 0.95, 0.8) },
}

// ── （ ）────────────────────────────────
function createBladeGeometry(
  centerR: number, maxHalfW: number,
  startAngle: number, endAngle: number,
  segments: number, bladeExp: number, uniform: boolean,
): THREE.BufferGeometry {
  const MIN_W = maxHalfW * 0.04           //
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = startAngle + (endAngle - startAngle) * t
    const cx = Math.cos(angle), cz = Math.sin(angle)
    const w = Math.max(
      uniform ? maxHalfW : Math.pow(Math.sin(Math.PI * t), bladeExp) * maxHalfW,
      MIN_W,
    )
    positions.push(cx * Math.max(centerR - w, 0.01), 0, cz * Math.max(centerR - w, 0.01))
    uvs.push(t, 0)
    positions.push(cx * (centerR + w), 0, cz * (centerR + w))
    uvs.push(t, 1)
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2
    indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

// ── （  X ）─────────────────────────────────
//  Z ，  -length/2  +length/2
// UV.x: 0= , 1=    UV.y: 0= , 1= （ =0.5）
function createStraightBladeGeometry(
  length: number, maxHalfW: number,
  segments: number, bladeExp: number,
): THREE.BufferGeometry {
  const MIN_W = maxHalfW * 0.04
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const z = (t - 0.5) * length
    const w = Math.max(Math.pow(Math.sin(Math.PI * t), bladeExp) * maxHalfW, MIN_W)
    positions.push(-w, 0, z);  uvs.push(t, 0)
    positions.push( w, 0, z);  uvs.push(t, 1)
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2
    indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

// ──  ────────────────────────────────────────────────
const SLASH_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SLASH_FRAG = `
uniform float uProgress;
uniform float uFade;
uniform float uHeadFade;
uniform vec3  uMain;
uniform vec3  uTail;
uniform vec3  uCore;
uniform float uCoreIntensity;
uniform float uGlowScale;   // ： ，0.2-4.0
uniform float uColorMix;    // ：0= ，1= 
varying vec2 vUv;

void main() {
  float arcPos = vUv.x;
  float r      = vUv.y;

  if (arcPos > uProgress + 0.005) discard;

  // relPos: 0= , 1= 
  float relPos    = arcPos / max(uProgress, 0.001);
  float trailFade = max(pow(relPos, 0.42), 0.22);

  // 
  float head = smoothstep(uProgress + uHeadFade, uProgress - uHeadFade * 0.35, arcPos);

  // ： (r=0.5) ， 
  float radialDist = abs(r - 0.5) * 2.0;
  float radialGlow = 1.0 - radialDist;
  float coreMask   = pow(radialGlow, 7.0);
  //  2.8 ， 
  float edgeAlpha  = pow(radialGlow, 2.8);

  // ：  →  → （ ）
  float t1 = smoothstep(0.0, 0.45, relPos);
  float t2 = smoothstep(0.58, 1.0,  relPos);
  vec3 fullGrad = mix(uTail * 0.55, uMain, t1);
  fullGrad      = mix(fullGrad, uCore * 1.7, t2);
  // uColorMix ：0= ，1= 
  vec3 alongColor = mix(uMain, fullGrad, uColorMix);

  // ： ， 
  vec3 col = mix(alongColor * 0.55, alongColor, pow(radialGlow, 1.6));
  // uGlowScale 
  col = mix(col, uCore * uCoreIntensity * uGlowScale, coreMask);

  // 
  col = mix(uTail * 0.15, col, trailFade * 0.72 + 0.28);

  float alpha = edgeAlpha * head * trailFade * (1.0 - uFade);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`

// ── SlashTrail：  ─────────────────────────────────────────
interface SlashConfig {
  // （straight=false ）：
  centerR?:   number
  startAngle?: number
  endAngle?:   number
  uniform?:    boolean
  // （straight=true ）：
  straight?:  boolean
  length?:    number
  // ：
  halfWidth:  number
  bladeExp?:  number
  segments?:  number
  // ：
  slashDuration: number
  fadeDuration:  number
  yaw:   number
  pitch: number   // rotation.x = -pitch
  yPos:  number
  element: ElementKey
}

export class SlashTrail {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  cfg: SlashConfig

  constructor(private scene: THREE.Scene, cfg: SlashConfig) {
    this.cfg = cfg
    const el = ELEMENTS[cfg.element]
    const geo = cfg.straight && cfg.length != null
      ? createStraightBladeGeometry(cfg.length, cfg.halfWidth, cfg.segments ?? 44, cfg.bladeExp ?? 0.58)
      : createBladeGeometry(cfg.centerR!, cfg.halfWidth, cfg.startAngle!, cfg.endAngle!, cfg.segments ?? 56, cfg.bladeExp ?? 0.65, cfg.uniform ?? false)

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress:      { value: 0 },
        uFade:          { value: 0 },
        uHeadFade:      { value: 0.09 },
        uMain:          { value: el.main.clone() },
        uTail:          { value: el.tail.clone() },
        uCore:          { value: el.core.clone() },
        uCoreIntensity: { value: el.coreIntensity },
        uGlowScale:     { value: 1.0 },
        uColorMix:      { value: 1.0 },
      },
      vertexShader:   SLASH_VERT,
      fragmentShader: SLASH_FRAG,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false,
      depthTest:      false,   //
      side:           THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.renderOrder = 9000
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  setElement(key: ElementKey): void {
    const el = ELEMENTS[key]
    this.mat.uniforms.uMain.value.copy(el.main)
    this.mat.uniforms.uTail.value.copy(el.tail)
    this.mat.uniforms.uCore.value.copy(el.core)
    this.mat.uniforms.uCoreIntensity.value = el.coreIntensity
  }

  /**
   * 。
   * @param extraYaw （ ）： （  yaw，0=+Z）。
   *
   * ：  local " " ——
   *   -  (createStraightBladeGeometry)  local +Z 
   *   -  (createBladeGeometry)          local +X
   *  cfg.yaw=0 " "，  -π/2 。
   *  cfg.yaw " "。
   */
  fire(originX = 0, originZ = 0, extraYaw = 0): void {
    this.mesh.position.set(originX, this.cfg.yPos, originZ)
    const isArc = !(this.cfg.straight && this.cfg.length != null)
    const baseOffset = isArc ? -Math.PI / 2 : 0
    this.mesh.rotation.set(-this.cfg.pitch, this.cfg.yaw + extraYaw + baseOffset, 0)
    this.mat.uniforms.uProgress.value = 0
    this.mat.uniforms.uFade.value = 0
    this.age = 0
    this.active = true
    this.mesh.visible = true
  }

  update(dt: number): boolean {
    if (!this.active) return false
    this.age += dt
    this.mat.uniforms.uProgress.value = Math.min(this.age / this.cfg.slashDuration, 1)
    if (this.age > this.cfg.slashDuration) {
      const fadeT = (this.age - this.cfg.slashDuration) / this.cfg.fadeDuration
      this.mat.uniforms.uFade.value = Math.min(fadeT, 1)
      if (fadeT >= 1) { this.active = false; this.mesh.visible = false; return true }
    }
    return false
  }

  /** ，  slash ，  false  */
  getHeadWorldPos(target: THREE.Vector3): boolean {
    if (!this.active || this.age > this.cfg.slashDuration) return false
    const progress = this.mat.uniforms.uProgress.value
    if (progress <= 0) return false

    if (this.cfg.straight && this.cfg.length != null) {
      // ：  z_local = (progress - 0.5) * length
      target.set(0, 0, (progress - 0.5) * this.cfg.length)
    } else {
      // ：  headAngle
      const a = this.cfg.startAngle! + (this.cfg.endAngle! - this.cfg.startAngle!) * progress
      target.set(Math.cos(a) * this.cfg.centerR!, 0, Math.sin(a) * this.cfg.centerR!)
    }
    target.applyMatrix4(this.mesh.matrixWorld)
    return true
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}

// ──  ─────────────────────────────────────────────────────
interface CrossDef {
  yaw: number; pitch?: number; yPos?: number
  centerR?: number; halfWidth?: number; bladeExp?: number
  straight?: boolean; length?: number
  element?: ElementKey
}

interface ComboHit {
  // （straight=false） （straight=true）
  straight?: boolean; length?: number
  centerR?: number; startAngle?: number; endAngle?: number; uniform?: boolean
  halfWidth: number; bladeExp?: number
  yaw: number; pitch: number; yPos: number
  slashDuration: number; fadeDuration: number
  particleCount: number; element: ElementKey
  cross?: CrossDef
  /** （  params.glowScale），  bloom  */
  glowScale?: number
  /**
   * （true =  aimDir ，  360°/ ）。
   *  false = ， " "。
   */
  centered?: boolean
}

/** （ ）：  centered=false ， " " */
const FORWARD_OFFSET = 0.45

// ── （ ）────────────────────────────────────────
//  = yPos + centerR * |sin(maxAbsAngle)| * sin(|pitch|)
//  = yPos + (length/2) * |sin(pitch)| （  pitch < 0  sin(pitch)<0，  z_local ）
//  > 0.5，
// ：yPos （  originY=  Y）。
//  1.5m ：  " - - " ，
//  2.5m+  yPos=2.0 。
// ：halfWidth/centerR ，  yPos 。
const COMBO_HITS: ComboHit[] = [
  // ── 1 ： （ ）──────────────────────────
  // yPos  1.4  1.0， - ，
  {
    centerR: 1.6, halfWidth: 0.38, bladeExp: 0.62,
    startAngle: -Math.PI * 0.45, endAngle: Math.PI * 0.08,
    yaw: 0, pitch: Math.PI * 0.28, yPos: 1.0,
    slashDuration: 0.16, fadeDuration: 0.11,
    particleCount: 16, element: 'fire',
  },
  // ── 2 ： （ ， 1 ）──────────────
  {
    centerR: 1.6, halfWidth: 0.38, bladeExp: 0.62,
    startAngle: -Math.PI * 0.08, endAngle: Math.PI * 0.45,
    yaw: 0, pitch: Math.PI * 0.28, yPos: 1.0,
    slashDuration: 0.15, fadeDuration: 0.10,
    particleCount: 18, element: 'fire',
  },
  // ── 3 ：  X （ - ）────────────────────
  // createStraightBladeGeometry  z = (t-0.5)*length，  mesh
  // → yaw  X ；±π/4 = 90° ，  X。
  //  FORWARD_OFFSET  0.45m，X ；yPos=0.85 - ，
  //  yPos=1.3 " " 。
  // ：length=1.8, pitch=0, yPos=0.85 →  = 0.85 ✓
  {
    straight: true, length: 1.8, halfWidth: 0.28, bladeExp: 0.60,
    yaw:  -Math.PI * 0.25,     //  45°
    pitch: 0,                  //  X（ - ），
    yPos: 0.85,
    slashDuration: 0.18, fadeDuration: 0.14,
    particleCount: 22, element: 'ice',
    glowScale: 0.55,
    cross: {
      yaw: Math.PI * 0.25,     //  45°，  90°
      pitch: 0,
      straight: true, length: 1.8,
      halfWidth: 0.28,
      element: 'ice',
    },
  },
  // ── 4 ： （ ）──────────────────────
  // pitch=0 → ，yPos=0.35 ；centered=true
  {
    centerR: 2.0, halfWidth: 0.42, bladeExp: 0.68,
    startAngle: -Math.PI * 0.78, endAngle: Math.PI * 0.78,
    yaw: 0, pitch: 0, yPos: 0.35,
    slashDuration: 0.09, fadeDuration: 0.08,
    particleCount: 14, element: 'light',
    centered: true,
    cross: {
      centerR: 0.85, halfWidth: 0.22,
      yaw: 0, pitch: 0,
      element: 'light',
    },
  },
  // ── 5 ： （ ， ）────────────────────
  // pitch≈0 → ，yPos=0.8 - ；centered=true  360°
  {
    centerR: 1.45, halfWidth: 0.78, uniform: true,
    startAngle: 0, endAngle: Math.PI * 2,
    yaw: 0, pitch: 0.04, yPos: 0.8,
    slashDuration: 0.21, fadeDuration: 0.12,
    particleCount: 32, element: 'magic',
    centered: true,
  },
]

// ── ComboSystem ──────────────────────────────────────────────────
export interface ComboConfig {
  sparkPS: ParticleSystem
  onFlash?: (r: number, g: number, b: number) => void
  onTrauma?: (amount: number) => void
}

export interface SlashParams {
  elementOverride: ElementKey | ''
  radiusScale:     number
  speedScale:      number
  particleMult:    number
  glowScale:       number   //  0.2-4.0
  colorMix:        number   //  0.0-1.0
}

type TrailPair = [SlashTrail, SlashTrail | null]

export class ComboSystem {
  private trails: TrailPair[]
  private comboIndex = 0
  private comboTimer = 0
  private readonly COMBO_WINDOW = 1.5
  private readonly _headPos = new THREE.Vector3()

  public params: SlashParams = {
    elementOverride: '',
    radiusScale:     1.0,
    speedScale:      1.0,
    particleMult:    1.0,
    glowScale:       1.0,
    colorMix:        1.0,
  }

  constructor(private scene: THREE.Scene, private cfg: ComboConfig) {
    this.trails = COMBO_HITS.map(h => {
      const primary = new SlashTrail(scene, this.hitToConfig(h))
      const cross = h.cross ? new SlashTrail(scene, this.crossToConfig(h, h.cross)) : null
      return [primary, cross] as TrailPair
    })
  }

  //  ComboHit  SlashConfig
  private hitToConfig(h: ComboHit): SlashConfig {
    return {
      straight: h.straight, length: h.length,
      centerR: h.centerR, startAngle: h.startAngle, endAngle: h.endAngle, uniform: h.uniform,
      halfWidth: h.halfWidth, bladeExp: h.bladeExp,
      slashDuration: h.slashDuration, fadeDuration: h.fadeDuration,
      yaw: h.yaw, pitch: h.pitch, yPos: h.yPos, element: h.element,
    }
  }

  //  CrossDef  SlashConfig
  private crossToConfig(h: ComboHit, c: CrossDef): SlashConfig {
    const useStraight = c.straight ?? h.straight
    return {
      straight: useStraight, length: c.length ?? h.length,
      centerR: c.centerR ?? h.centerR,
      startAngle: h.startAngle, endAngle: h.endAngle, uniform: h.uniform,
      halfWidth: c.halfWidth ?? h.halfWidth,
      bladeExp: c.bladeExp ?? h.bladeExp,
      slashDuration: h.slashDuration, fadeDuration: h.fadeDuration,
      yaw: c.yaw, pitch: c.pitch ?? h.pitch,
      yPos: c.yPos ?? h.yPos, element: c.element ?? h.element,
    }
  }

  /**
   * 。
   * @param originX/originZ 
   * @param originY  Y（_groundY），  yPos ；
   *                 0， （  Y=0 ）。
   * @param aimYaw （ ，  +Y ）；0 =  +Z 。
   *                VFXManager ， 。
   */
  /**
   * ，  Three.js Mesh（primary + cross， ）。
   *  VFXManager  overlayScene " " 。
   */
  attack(originX = 0, originZ = 0, originY = 0, aimYaw = 0): THREE.Mesh[] {
    if (this.comboTimer <= 0 && this.comboIndex !== 0) this.comboIndex = 0

    const idx = this.comboIndex % COMBO_HITS.length
    const hit = COMBO_HITS[idx]
    const [primary, cross] = this.trails[idx]

    const elemP = (this.params.elementOverride || hit.element) as ElementKey
    const elemC = (this.params.elementOverride || hit.cross?.element || hit.element) as ElementKey

    //  centered
    //  - centered=true  (  / ) → ，
    //  - centered=false (  / )  →  FORWARD_OFFSET，
    const ox = hit.centered ? originX : originX + Math.sin(aimYaw) * FORWARD_OFFSET
    const oz = hit.centered ? originZ : originZ + Math.cos(aimYaw) * FORWARD_OFFSET

    primary.setElement(elemP)
    primary.mesh.scale.setScalar(this.params.radiusScale)
    primary.cfg.slashDuration = hit.slashDuration * this.params.speedScale
    primary.cfg.fadeDuration  = hit.fadeDuration  * this.params.speedScale
    primary.fire(ox, oz, aimYaw)
    //  yPos  Y ，
    primary.mesh.position.y += originY

    if (cross) {
      cross.setElement(elemC)
      cross.mesh.scale.setScalar(this.params.radiusScale)
      cross.cfg.slashDuration = hit.slashDuration * this.params.speedScale
      cross.cfg.fadeDuration  = hit.fadeDuration  * this.params.speedScale
      cross.fire(ox, oz, aimYaw)
      cross.mesh.position.y += originY
    }

    this.emitImpactParticles(hit, elemP, ox, oz, originY)
    const el = ELEMENTS[elemP]
    this.cfg.onFlash?.(el.flash.r, el.flash.g, el.flash.b)
    this.cfg.onTrauma?.(0.2 + idx * 0.08)

    this.comboIndex = (this.comboIndex + 1) % COMBO_HITS.length
    this.comboTimer = this.COMBO_WINDOW

    const fired: THREE.Mesh[] = [primary.mesh]
    if (cross) fired.push(cross.mesh)
    return fired
  }

  private emitImpactParticles(hit: ComboHit, element: ElementKey, ox: number, oz: number, oy = 0): void {
    const el     = ELEMENTS[element]
    const center = new THREE.Vector3(ox, hit.yPos + oy, oz)
    const count  = Math.round(hit.particleCount * this.params.particleMult)
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 3 + Math.random() * 6
      const dir   = new THREE.Vector3(Math.cos(angle), 0.15 + Math.random() * 0.45, Math.sin(angle)).normalize()
      this.cfg.sparkPS.emit({
        position: center.clone().add(new THREE.Vector3((Math.random()-.5)*.4, 0, (Math.random()-.5)*.4)),
        count: 1, speed: [speed, speed+2], lifetime: [150, 380],
        size: [0.06, 0.18], colorFrom: el.core.clone(), colorTo: el.main.clone(),
        direction: dir, spread: 0.3, gravity: 8,
      })
    }
    this.cfg.sparkPS.emit({
      position: center, count: 5, speed: [1, 3],
      lifetime: [80, 160], size: [0.28, 0.65],
      colorFrom: el.core.clone(), colorTo: el.main.clone(), spread: 0.8,
    })
  }

  /** （ ）*/
  stopAllTrails(): void {
    for (const [primary, cross] of this.trails) {
      primary.active = false
      primary.mesh.visible = false
      if (cross) { cross.active = false; cross.mesh.visible = false }
    }
  }

  /** （ ）*/
  resetCombo(): void {
    this.comboIndex = 0
    this.comboTimer = 0
  }

  update(dt: number): void {
    for (let i = 0; i < this.trails.length; i++) {
      const [primary, cross] = this.trails[i]
      //  glowScale  params.glowScale ，
      //  ice  bloom
      const perHit = COMBO_HITS[i].glowScale ?? 1.0
      const glow   = this.params.glowScale * perHit
      //  shader uniform，
      primary.mat.uniforms.uGlowScale.value = glow
      primary.mat.uniforms.uColorMix.value  = this.params.colorMix
      if (cross) {
        cross.mat.uniforms.uGlowScale.value = glow
        cross.mat.uniforms.uColorMix.value  = this.params.colorMix
      }

      primary.update(dt)
      cross?.update(dt)
      // ：
      this.emitTrailParticle(primary)
      if (cross) this.emitTrailParticle(cross)
    }
    if (this.comboTimer > 0) this.comboTimer -= dt
  }

  /** （  60% ， ）*/
  private emitTrailParticle(trail: SlashTrail): void {
    if (Math.random() > 0.62) return
    if (!trail.getHeadWorldPos(this._headPos)) return
    const el = ELEMENTS[trail.cfg.element]
    this.cfg.sparkPS.emit({
      position: this._headPos.clone(),
      count: 1,
      speed: [1.2, 4.0],
      lifetime: [65, 170],
      size: [0.03, 0.10],
      colorFrom: el.core.clone(),
      colorTo: el.main.clone(),
      direction: new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        0.35 + Math.random() * 0.65,
        (Math.random() - 0.5) * 0.8,
      ).normalize(),
      spread: 0.5,
      gravity: 5,
    })
  }

  dispose(): void {
    for (const [primary, cross] of this.trails) {
      primary.dispose()
      cross?.dispose()
    }
  }
}
