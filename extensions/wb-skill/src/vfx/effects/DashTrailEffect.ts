// @source wb-character/src/vfx/effects/DashTrailEffect.ts
/**
 *  v5
 *
 * - 3 （  / ）
 * - base ， 
 * - vertex shader ，fragment shader sin 
 * - （AdditiveBlending）
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'

// ── Streak Vertex（ ）─────────────────────────────────────

const STREAK_VERT = `
  varying vec2 vUv;
  uniform float uCurve;

  void main() {
    vUv = uv;
    vec3 pos = position;
    // ： ， （ ）
    pos.y += sin(uv.x * 3.14159) * uCurve;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

// ── Streak Fragment（Value Noise FBM + ）──────────────

const STREAK_FRAG = `
  uniform float uAlpha;
  uniform float uBright;
  uniform float uHue;    // 0-1 （0= ）
  varying vec2 vUv;

  // ──  ───────────────────────────────────────────────
  float hashN(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hashN(i);
    float b = hashN(i + vec2(1.0, 0.0));
    float c = hashN(i + vec2(0.0, 1.0));
    float d = hashN(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v  = vn(p) * 0.500;
    p = p * 2.17 + vec2(5.71, 3.31);
    v += vn(p) * 0.250;
    p = p * 2.17 + vec2(2.53, 7.91);
    v += vn(p) * 0.125;
    return v * (1.0 / 0.875);
  }

  // ── （Rodrigues  (1,1,1) ）────────────────
  vec3 rotHue(vec3 c, float h) {
    float ang = h * 6.28318;
    vec3  k   = vec3(0.57735);          // normalize(1,1,1)
    float ca  = cos(ang);
    float sa  = sin(ang);
    return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
  }

  void main() {
    float cx = vUv.x;
    float vy = vUv.y;
    float cy = abs(vy - 0.5) * 2.0;

    vec2  coordA = vec2(cx * 1.8, vy * 6.8);
    vec2  coordB = vec2(cx * 3.2 + 1.7, vy * 5.1 + 2.4);
    float nA = fbm(coordA);
    float nB = fbm(coordB);

    float tipF = pow(1.0 - cx, 0.65);

    // ──  ────────────────────────────────────────────────
    float baseEdge = 1.0 - cy;
    float edgeDisp = (nA - 0.44) * 1.55 * tipF;
    float edge     = smoothstep(0.0, 0.20, baseEdge - edgeDisp);

    float nFine    = vn(vec2(cx * 9.5, vy * 16.0 + 0.5));
    float fineDisp = (nFine - 0.5) * 0.38 * pow(tipF, 1.6);
    edge          *= smoothstep(0.0, 0.14, baseEdge - fineDisp);

    float tipFade = smoothstep(0.0, 0.12, cx);

    // ── （ ， ）───────────────────────
    // + 
    float holeThresh = 0.36 + tipF * 0.18 + cy * 0.10;
    float holeMask   = smoothstep(holeThresh - 0.07, holeThresh + 0.07, nB);

    float alpha = edge * tipFade * holeMask * uAlpha * uBright;
    if (alpha < 0.003) discard;

    // ── （ ）────────────────────────────
    // (cx=0):   → :   → (cx=1): 
    // ：  0→0.90 
    float t  = pow(cx, 0.55);          // 0(tip) → 1(base)， 
    float r  = mix(0.72, 1.00, t);
    float g  = t * t * 0.90;           // ： ， 
    float bv = mix(0.30, 1.20, t);     // ： ， 
    vec3 col = vec3(r, g, 0.0) * bv;

    // ： ， 
    float heat = 1.0 - pow(cy, 1.0);
    float midW = sin(cx * 3.14159);
    col += vec3(0.20, 0.08, 0.00) * heat * midW;

    // （hue=0 ）
    if (uHue > 0.001) col = rotHue(col, uHue);

    gl_FragColor = vec4(col, alpha);
  }
`

// ── Spark  Shaders ────────────────────────────────────────────

const SPARK_VERT = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vAlpha      = aAlpha;
    gl_PointSize = aSize * aAlpha + 2.0;
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SPARK_FRAG = `
  varying float vAlpha;

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv) * 2.0;
    if (d > 1.0) discard;
    vec3 col = mix(vec3(1.00, 0.95, 0.30), vec3(1.00, 0.22, 0.00), d * d);
    gl_FragColor = vec4(col, (1.0 - d * d) * vAlpha);
  }
`

// ──  ──────────────────────────────────────────────────────

interface StreakDef {
  len:    number
  width:  number
  fan:    number  // （rad）
  bright: number
  curve:  number  // （ = ， = ）
}

const STREAK_DEFS: StreakDef[] = [
  { len: 3.2, width: 0.74, fan:  0.00, bright: 1.00, curve:  0.14 }, // （ ， ）
  { len: 2.6, width: 0.50, fan:  0.50, bright: 0.90, curve:  0.20 }, //
  { len: 2.0, width: 0.34, fan: -0.42, bright: 0.76, curve: -0.07 }, //
]

const FADE_IN  = 0.08
const HOLD     = 0.14
const FADE_OUT = 0.20
const TOTAL    = FADE_IN + HOLD + FADE_OUT  // 0.42 s

// ──  ──────────────────────────────────────────────────────

const MAX_SPARKS = 32

interface Spark {
  pos:      THREE.Vector3
  vel:      THREE.Vector3
  age:      number
  lifetime: number
  size:     number
}

// ── Effect ────────────────────────────────────────────────────────

export class DashTrailEffect {
  private meshes: THREE.Mesh[]           = []
  private mats:   THREE.ShaderMaterial[] = []

  active = false
  private age = 0
  private pos = new THREE.Vector3()
  private dir = new THREE.Vector3(1, 0, 0)

  // Sparks
  private sparks:          Spark[]   = []
  private sparkGeo!:       THREE.BufferGeometry
  private sparkMat!:       THREE.ShaderMaterial
  private sparkPoints!:    THREE.Points
  private sparkPositions!: Float32Array
  private sparkAlphas!:    Float32Array
  private sparkSizes!:     Float32Array
  private sparksLive = false

  constructor(
    private scene:  THREE.Scene,
    private camera: THREE.Camera,
  ) {
    // ──  mesh ──
    for (const def of STREAK_DEFS) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha:  { value: 0 },
          uBright: { value: def.bright },
          uCurve:  { value: def.curve },
          uHue:    { value: 0 },
        },
        vertexShader:   STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        depthTest:   false,
        side:        THREE.DoubleSide,
      })

      const geo = new THREE.PlaneGeometry(def.len, def.width)
      // （ / ），
      geo.translate(-def.len / 2, 0, 0)

      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 2210
      mesh.visible     = false
      scene.add(mesh)

      this.meshes.push(mesh)
      this.mats.push(mat)
    }

    // ──  ──
    this.sparkPositions = new Float32Array(MAX_SPARKS * 3)
    this.sparkAlphas    = new Float32Array(MAX_SPARKS)
    this.sparkSizes     = new Float32Array(MAX_SPARKS)

    // （ ）
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkPositions[i * 3 + 1] = -100
    }

    this.sparkGeo = new THREE.BufferGeometry()
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3))
    this.sparkGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(this.sparkAlphas,    1))
    this.sparkGeo.setAttribute('aSize',    new THREE.BufferAttribute(this.sparkSizes,     1))

    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader:   SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })

    this.sparkPoints = new THREE.Points(this.sparkGeo, this.sparkMat)
    this.sparkPoints.renderOrder = 2205
    this.sparkPoints.visible     = false
    scene.add(this.sparkPoints)

    console.log('[DashTrail v5] initialized')
  }

  fire(pos: THREE.Vector3, dir: THREE.Vector3): void {
    this.active = true
    this.age    = 0
    //  pos.y（  VFXManager ）
    this.pos.copy(pos)
    this.dir.copy(dir).normalize()
    for (const m of this.meshes) m.visible = true

    // ──  ──
    this.sparks = []
    const backDir = dir.clone().negate()
    for (let i = 0; i < MAX_SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.6 + Math.random() * 1.8
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        0.3 + Math.random() * 1.0,
        Math.sin(angle) * speed,
      )
      // （ ， ）
      vel.addScaledVector(backDir, 0.4 + Math.random() * 0.9)

      this.sparks.push({
        pos:      pos.clone().setY(0.05 + Math.random() * 0.12),
        vel,
        age:      0,
        lifetime: 0.20 + Math.random() * 0.35,
        size:     3.0 + Math.random() * 5.0,
      })
    }
    this.sparkPoints.visible = true
    this.sparksLive          = true
  }

  /** （0= ，0.5= ，0.33= …） */
  setHue(hue: number): void {
    for (const mat of this.mats) mat.uniforms.uHue.value = hue
  }

  /** （overlayScene） （  + ） */
  getForegroundObjects(): THREE.Object3D[] {
    return [...this.meshes, this.sparkPoints]
  }

  /**
   * （  mesh，1.0 = ）。
   *  VFXManager.update() 。
   */
  setScale(scale: number): void {
    for (const mesh of this.meshes) mesh.scale.setScalar(scale)
  }

  /**
   * @param dt       （ ，  THREE.Clock.getDelta）
   * @param charPos  （ ）；  base 
   */
  update(dt: number, charPos?: THREE.Vector3): void {
    // （ ）
    if (this.sparksLive) this._updateSparks(dt)

    if (!this.active) return

    // （VFXManager  Y=groundY+0.70）
    if (charPos) {
      this.pos.copy(charPos)
    }

    this.age += dt
    if (this.age >= TOTAL) {
      this._reset()
      return
    }

    let alpha: number
    if (this.age < FADE_IN) {
      alpha = Easing.easeOutQuad(this.age / FADE_IN)
    } else if (this.age < FADE_IN + HOLD) {
      alpha = 1.0
    } else {
      alpha = 1.0 - Easing.easeInQuad((this.age - FADE_IN - HOLD) / FADE_OUT)
    }

    const camRight  = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const camUp     = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    // dashAngle：  +x ；  x=0  x=-len，
    const dashAngle = Math.atan2(this.dir.dot(camUp), this.dir.dot(camRight))

    for (let i = 0; i < STREAK_DEFS.length; i++) {
      const def  = STREAK_DEFS[i]
      const mesh = this.meshes[i]
      const mat  = this.mats[i]

      mesh.position.copy(this.pos)
      mesh.quaternion.copy(this.camera.quaternion)
      mesh.rotateZ(dashAngle + def.fan)
      mat.uniforms.uAlpha.value = alpha
    }
  }

  private _updateSparks(dt: number): void {
    let anyAlive = false
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i]
      if (s.age >= s.lifetime) {
        this.sparkPositions[i * 3 + 1] = -100
        this.sparkAlphas[i]             = 0
        continue
      }
      s.age += dt
      s.vel.y -= 5.0 * dt          //
      s.vel.y  = Math.max(s.vel.y, -1.5)
      s.pos.addScaledVector(s.vel, dt)
      s.pos.y  = Math.max(s.pos.y, 0.0)

      this.sparkPositions[i * 3]     = s.pos.x
      this.sparkPositions[i * 3 + 1] = s.pos.y
      this.sparkPositions[i * 3 + 2] = s.pos.z
      this.sparkAlphas[i]             = 1.0 - s.age / s.lifetime
      this.sparkSizes[i]              = s.size
      anyAlive = true
    }

    if (!anyAlive) {
      this.sparkPoints.visible = false
      this.sparksLive          = false
    } else {
      this.sparkPoints.visible = true;
      (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.sparkGeo.attributes.aAlpha   as THREE.BufferAttribute).needsUpdate = true;
      (this.sparkGeo.attributes.aSize    as THREE.BufferAttribute).needsUpdate = true
    }
  }

  private _reset(): void {
    this.active = false
    this.age    = 0
    for (const m of this.meshes) m.visible = false
    for (const mat of this.mats) mat.uniforms.uAlpha.value = 0
  }

  dispose(): void {
    this._reset()
    this.sparkPoints.visible = false
    for (let i = 0; i < this.meshes.length; i++) {
      this.scene.remove(this.meshes[i])
      this.mats[i].dispose()
      this.meshes[i].geometry.dispose()
    }
    this.meshes = []
    this.mats   = []
    this.scene.remove(this.sparkPoints)
    this.sparkGeo.dispose()
    this.sparkMat.dispose()
  }
}
