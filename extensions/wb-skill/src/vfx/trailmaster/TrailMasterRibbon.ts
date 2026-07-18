// @source wb-character/src/vfx/trailmaster/TrailMasterRibbon.ts
/**
 * TrailMasterRibbon —  ribbon 
 *
 *  profile（ ）：
 *   t=0 ( / )  → width = 0   ( )
 *   t=0.55           → width = 1.0 ( ， 55% )
 *   t=1.0 ( / ) → width = 0.62 ( )
 *
 * UV ：
 *   UV.x = 0 ( ) → 1 ( )
 *   UV.y = 0 ( ) → 1 ( )
 *
 * widthScale ：
 *   2.5 →  (glow)
 *   1.0 →    (main)
 *   0.22 →  (core)
 */

import * as THREE from 'three'

export interface ArcParams {
  /** （ ，UV.x=0）， ，  +X  0 */
  angleStart:   number
  /** （ ，UV.x=1） */
  angleEnd:     number
  /** （ ） */
  radius:       number
  /** （ ） */
  width:        number
  /** ribbon （  group ，Y ） */
  heightOffset: number
  /** （ ） */
  segments:     number
  /**  taperRatio ，  profile  */
  taperRatio:   number
}

export const DEFAULT_ARC: ArcParams = {
  angleStart:   -Math.PI * 0.75,
  angleEnd:      Math.PI * 0.20,
  radius:        0.90,
  width:         0.28,
  heightOffset:  0.78,
  segments:      60,
  taperRatio:    0.75,
}

// ──  profile ────────────────────────────────────────────────

/**
 *  t ∈ [0,1]，  ∈ [0,1]
 * ：  → （t≈0.55）  → 
 */
function widthProfile(t: number): number {
  const peakT      = 0.55
  const tipFrac    = 0.62   //  =  62%
  if (t <= 0) return 0
  if (t >= 1) return tipFrac
  if (t < peakT) {
    //  → ：sine ease-in (0 → 1)
    return Math.sin((t / peakT) * Math.PI * 0.5)
  } else {
    //  → ：cosine ease-out (1 → tipFrac)
    const u = (t - peakT) / (1.0 - peakT)
    return tipFrac + (1.0 - tipFrac) * Math.cos(u * Math.PI * 0.5)
  }
}

// ──  ────────────────────────────────────────────────────────

/**
 *  ribbon 
 * @param arcParams  （  DEFAULT_ARC）
 * @param widthScale （ ）
 */
export function buildArcRibbonGeometry(
  arcParams?:  Partial<ArcParams>,
  widthScale = 1.0,
): THREE.BufferGeometry {
  const p = { ...DEFAULT_ARC, ...arcParams }
  const { angleStart, angleEnd, radius, width, heightOffset, segments } = p

  const positions: number[] = []
  const uvs:       number[] = []
  const alphas:    number[] = []
  const widthNorm: number[] = []  // （  shader ）
  const indices:   number[] = []

  for (let i = 0; i <= segments; i++) {
    const t     = i / segments                       // 0= , 1=
    const angle = angleStart + (angleEnd - angleStart) * t

    // （ / ）
    const cx = Math.cos(angle) * radius
    const cz = Math.sin(angle) * radius
    // （ ， ）
    const nx = Math.cos(angle)
    const nz = Math.sin(angle)

    const wn     = widthProfile(t)                   //  [0,1]
    const halfW  = (width * 0.5) * wn * widthScale  // （ ）

    // （UV.y=0）、 （UV.y=1）
    positions.push(cx - nx * halfW, heightOffset, cz - nz * halfW)
    positions.push(cx + nx * halfW, heightOffset, cz + nz * halfW)

    uvs.push(t, 0)
    uvs.push(t, 1)

    //  alpha： (t=1) ， (t=0) ；  alpha
    const alpha = wn * (0.25 + 0.75 * t)
    alphas.push(alpha, alpha)
    widthNorm.push(wn, wn)

    if (i < segments) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3
      indices.push(a, c, b,  b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',   new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv',         new THREE.Float32BufferAttribute(uvs, 2))
  geo.setAttribute('aAlpha',     new THREE.Float32BufferAttribute(alphas, 1))
  geo.setAttribute('aWidthNorm', new THREE.Float32BufferAttribute(widthNorm, 1))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/**
 * （  /  / / ）
 * @param coreScale  （trail=0.22  / blood=0.45 ）
 */
export function buildLayeredRibbonGeometries(
  arcParams?: Partial<ArcParams>,
  coreScale  = 0.22,
): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  return [
    buildArcRibbonGeometry(arcParams, 2.8),       // Layer 0:
    buildArcRibbonGeometry(arcParams, 1.0),       // Layer 1:
    buildArcRibbonGeometry(arcParams, coreScale), // Layer 2: /
  ]
}

// ── LiveRibbonGeometry（ ， ）────────────────────────

interface LivePoint { pos: THREE.Vector3; time: number }

export class LiveRibbonGeometry {
  private points: LivePoint[] = []
  readonly geo:   THREE.BufferGeometry
  private maxLen: number
  private width:  number

  constructor(maxPoints = 60, width = 0.25) {
    this.maxLen = maxPoints
    this.width  = width
    this.geo    = new THREE.BufferGeometry()
    const n     = maxPoints * 2
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3))
    this.geo.setAttribute('uv',       new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
    this.geo.setAttribute('aAlpha',   new THREE.Float32BufferAttribute(new Float32Array(n), 1))
  }

  push(worldPos: THREE.Vector3, time: number): void {
    this.points.push({ pos: worldPos.clone(), time })
    if (this.points.length > this.maxLen) this.points.shift()
    this._rebuild()
  }

  private _rebuild(): void {
    const pts = this.points
    const n   = pts.length
    if (n < 2) return
    const pos = this.geo.attributes['position'].array as Float32Array
    const uv  = this.geo.attributes['uv'].array as Float32Array
    const al  = this.geo.attributes['aAlpha'].array as Float32Array

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const p = pts[i].pos
      const d = i < n - 1
        ? pts[i + 1].pos.clone().sub(p).normalize()
        : pts[i - 1].pos.clone().sub(pts[i - 1].pos).normalize()
      const nx = -d.z, nz = d.x  // perpendicular
      const hw = this.width * 0.5
      pos[(i*2)*3]   = p.x - nx * hw; pos[(i*2)*3+1] = p.y; pos[(i*2)*3+2] = p.z - nz * hw
      pos[(i*2+1)*3] = p.x + nx * hw; pos[(i*2+1)*3+1] = p.y; pos[(i*2+1)*3+2] = p.z + nz * hw
      uv[i*4] = t; uv[i*4+1] = 0
      uv[i*4+2] = t; uv[i*4+3] = 1
      al[i*2] = al[i*2+1] = t
    }
    this.geo.attributes['position'].needsUpdate = true
    this.geo.attributes['uv'].needsUpdate = true
    this.geo.attributes['aAlpha'].needsUpdate = true
  }
}
