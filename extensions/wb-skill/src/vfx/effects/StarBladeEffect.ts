// @source wb-character/src/vfx/effects/StarBladeEffect.ts
/**
 *  3D 
 *  vfx-2d StarBlade Presets / 
 *
 * ：
 * 1. Charge  (0.8s)  -  + 
 * 2. Falling (1.25s) - 4 （0.25s ）
 * 3. Impact  (~0.3s) - 、 
 * 4. Dissipate(0.8s) - 12 
 */

import * as THREE from 'three'
import { ParticleSystem } from '../core/ParticleSystems'

// ── （  vfx-2d StarBlade） ──────────────────────────
const COLORS = {
  edge:   new THREE.Color(0.75, 0.45, 0.05),
  mid:    new THREE.Color(1.0,  0.78, 0.25),
  core:   new THREE.Color(1.0,  0.95, 0.75),
  star:   new THREE.Color(1.0,  0.92, 0.55),
  impact: new THREE.Color(1.0,  0.85, 0.4),
  glow:   new THREE.Color(1.0,  0.7,  0.1),
}

// ── （5 ，flat，  XZ ） ──────────────────────
function createStarGeo(outerR: number, innerR: number, points = 5): THREE.BufferGeometry {
  const verts: number[] = [0, 0, 0]
  const n = points * 2
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    verts.push(Math.cos(angle) * r, 0, Math.sin(angle) * r)
  }
  const indices: number[] = []
  for (let i = 1; i <= n; i++) {
    indices.push(0, i, i === n ? 1 : i + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(indices)
  return geo
}

// ── （ ， ）────────────────────────
//  y=0，  y=h；
function createBladeCross(w: number, h: number): THREE.BufferGeometry {
  const hw = w / 2
  const positions = new Float32Array([
    //  1（XY，  ±Z）
    -hw, 0, 0,   hw, 0, 0,   -hw, h, 0,   hw, h, 0,
    //  2（ZY，  ±X）
     0, 0,-hw,    0, 0, hw,    0, h,-hw,    0, h, hw,
  ])
  const uvs = new Float32Array([
    0,0, 1,0, 0,1, 1,1,  //  1: u= , v=0 /v=1
    0,0, 1,0, 0,1, 1,1,  //  2
  ])
  const indices = [0,1,2, 1,3,2,  4,5,6, 5,7,6]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

// ── （ ： → → → → ）──────────
const BLADE_FRAG = `
uniform float uAlpha;
varying vec2 vUv;
varying float vWorldY;   //  Y， 

void main() {
  float cx = abs(vUv.x - 0.5) * 2.0;  // 0= , 1= 
  float hy = vUv.y;                    // 0= , 1= 

  // ── （ ）────────────────────────────────
  // ： 
  float bladeW  = smoothstep(0.0, 0.62, hy) * 0.45;
  // ： 
  float guardW  = smoothstep(0.61, 0.67, hy) * smoothstep(0.77, 0.71, hy) * 1.0;
  // ： 
  float gripW   = smoothstep(0.77, 0.81, hy) * (1.0 - smoothstep(0.91, 0.94, hy)) * 0.18;
  // （ ）： 
  float pommelW = smoothstep(0.92, 0.96, hy) * 0.28;

  float maxHW = max(max(bladeW, guardW), max(gripW, pommelW));
  if (maxHW < 0.005) discard;

  // 
  float glowHW = maxHW + 0.20;
  if (cx > glowHW) discard;

  // ──  ──────────────────────────────────────────────────
  float inSil  = step(cx, maxHW);                                    // 1= 
  float radial = clamp(1.0 - cx / max(maxHW, 0.01), 0.0, 1.0);     // 0= , 1= 
  float coreM  = pow(radial, 5.0) * inSil;
  float bodyM  = pow(radial, 1.8) * inSil;
  float halo   = smoothstep(glowHW, maxHW, cx) * (1.0 - inSil);    // 

  // ──  ──────────────────────────────────────────────────
  float tipBright   = smoothstep(0.20, 0.0, hy) * 2.2;             // 
  float guardBright = smoothstep(0.61, 0.67, hy) * smoothstep(0.77, 0.71, hy) * 1.4;
  float bodyBright  = 1.0 - hy * 0.28;                              // 

  // ──  ──────────────────────────────────────────────────────
  vec3 coreColor  = vec3(1.00, 0.97, 0.82);
  vec3 midColor   = vec3(1.00, 0.80, 0.28);
  vec3 edgeColor  = vec3(0.78, 0.42, 0.05);
  vec3 guardColor = vec3(1.00, 0.92, 0.55);

  vec3 col = mix(edgeColor, midColor, bodyM);
  col = mix(col, coreColor * (bodyBright + tipBright), coreM);
  col += guardColor * guardBright * (0.35 * bodyM + 0.65 * coreM);
  col += vec3(0.65, 0.38, 0.05) * halo;                             // 

  // ── Alpha ─────────────────────────────────────────────────────
  float alpha = (bodyM * 0.65 + coreM * 0.90 + guardBright * bodyM * 0.35 + halo * 0.42) * uAlpha;

  // ：y < 0 ， 
  //  5cm， " " 
  float groundClip = smoothstep(-0.04, 0.12, vWorldY);
  alpha *= groundClip;

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`

const BLADE_VERT = `
varying vec2 vUv;
varying float vWorldY;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldY = worldPos.y;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

// ── （ ： ， ）
//  [0,8,20]  17°， 。
// ：  y=0，  y=h， 。
function createShardGeo(w: number, h: number): THREE.BufferGeometry {
  const j = 0.35
  const rv = () => (Math.random() - 0.5) * j
  const hw = w / 2

  //  1：XY （  ±Z， ）
  // ， （  → ）
  const bw1 = hw * (1.0 + rv())
  const tw1 = hw * (0.5 + rv() * 0.4)
  const bh1 = rv() * h * 0.08        //
  const th1 = h * (1.0 + rv() * 0.2) //

  //  2：YZ （  ±X， ）
  const bw2 = hw * (0.9 + rv())
  const tw2 = hw * (0.45 + rv() * 0.4)
  const bh2 = rv() * h * 0.08
  const th2 = h * (0.95 + rv() * 0.2)

  const positions = new Float32Array([
    //  1（XY，z=0）： 、 、 、
    -bw1, bh1,  0,    bw1, bh1,  0,    tw1, th1,  0,   -tw1, th1,  0,
    //  2（YZ，x=0）： 、 、 、
     0, bh2, -bw2,    0, bh2,  bw2,    0, th2,  tw2,    0, th2, -tw2,
  ])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex([0,1,2, 0,2,3,  4,5,6, 4,6,7])
  return geo
}

// ── （  vfx-3d/Meteor.ts， ）────────────
const CRACK_FRAG = `
uniform float uProgress;
uniform float uAlpha;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float dist = length(uv);

  // 8 ： ， 
  float cracks = 0.0;
  for (int i = 0; i < 8; i++) {
    float a   = float(i) * 0.785 + hash(vec2(float(i), 0.0)) * 0.55;
    vec2  dir = vec2(cos(a), sin(a));
    vec2  perp = vec2(-dir.y, dir.x);
    float len  = dot(uv, dir);
    float rawD = dot(uv, perp);

    if (len > 0.0 && len < 0.9 * uProgress) {
      //  3 ， 
      float disp  = (hash(vec2(len * 3.5,  a * 1.1)) - 0.5) * 0.22; // 
      disp       += (hash(vec2(len * 9.0,  a * 2.3)) - 0.5) * 0.09; // 
      disp       += (hash(vec2(len * 18.0, a * 4.1)) - 0.5) * 0.03; // 
      // （  progress ） 
      float taper = 1.0 - smoothstep(0.6, 1.0, len / (0.9 * uProgress));
      disp *= taper;

      float d = abs(rawD - disp * len);  // 
      // ， 
      float w = 0.011 + hash(vec2(a, len * 2.0)) * 0.010;
      cracks += smoothstep(w, 0.0, d);
    }
  }

  // （ ），  20%
  float crater = smoothstep(0.30 * uProgress, 0.04 * uProgress, dist);

  vec3 glowColor  = vec3(1.00, 0.90, 0.35);
  vec3 crackColor = vec3(1.00, 0.68, 0.12);

  vec3 col = crackColor * cracks + glowColor * crater * 1.76;  // 2.2 × 0.8
  float alpha = (cracks * 0.90 + crater * 0.60) * uAlpha * (1.0 - dist * 0.35);  // crater alpha -20%
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`
const CRACK_VERT = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

// ── （  vfx-3d/Shockwave.ts， ）──────
const WAVE_FRAG = `
uniform float uProgress;
uniform float uAlpha;
varying vec2 vUv;
void main(){
  float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  float distort = sin(vUv.x * 45.0 + uProgress * 12.0) * 0.04;
  float a = uAlpha * (1.0 - uProgress) * edge * (1.0 + distort);
  vec3 col = vec3(1.0, 0.82, 0.28) * (1.0 + uProgress * 0.7);
  gl_FragColor = vec4(col, a * 0.80);
}
`
const WAVE_VERT = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

// ── StarBladeEffect ──────────────────────────────────────────────
export type StarBladeState = 'idle' | 'charging' | 'falling' | 'impacting' | 'dissipating'

export interface StarBladeConfig {
  sparkPS: ParticleSystem
  magicPS: ParticleSystem
  onTrauma?: (amount: number) => void
  onFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
}

export class StarBladeEffect {
  state: StarBladeState = 'idle'
  active = false

  /** ，  fire()  */
  public params = {
    chargeDuration:     0.8,   // （ ）0.3-3.0
    bladeWidth:         0.6,   //  0.2-2.0
    bladeHeight:        5.0,   //  2.0-12.0
    fallHeight:         12.0,  //  5-25
    impactParticles:    50,    //  10-120
    bladeFallDuration:  0.4,   // （ ）0.2-1.5
    bladeDelay:         0.25,  // （ ）0.1-0.8
  }

  private age = 0
  private originPos = new THREE.Vector3()

  //
  private chargeStars: THREE.Mesh[] = []
  private chargeStarMat!: THREE.MeshBasicMaterial

  //
  private blades: THREE.Mesh[] = []
  private bladeMats: THREE.ShaderMaterial[] = []
  private bladeData: {
    startY: number; targetY: number; yaw: number; triggered: boolean
    tiltX: number; tiltZ: number   // （ ），
    offX: number; offZ: number     // XZ
    landed: boolean                //
  }[] = []

  //  +
  private groundCracks:    THREE.Mesh[] = []
  private groundCrackMats: THREE.ShaderMaterial[] = []
  private groundWaves:     THREE.Mesh[] = []
  private groundWaveMats:  THREE.ShaderMaterial[] = []
  private groundEffectAge: number[]  = []   // （ ）
  private groundEffectOn:  boolean[] = []   //

  // （  7 ， ）
  private groundShards: {
    mesh:  THREE.Mesh
    mat:   THREE.MeshBasicMaterial
    offX:  number; offZ: number  //  XZ （ ）
    ryaw:  number                //
    // （ ）
    vx: number; vy: number; vz: number    //  m/s
    avx: number; avy: number; avz: number //  rad/s
    bounces: number                       //
    settled: boolean                      //
  }[][] = []

  //
  private riseStars: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number; lifetime: number }[] = []
  private riseStarMat!: THREE.MeshBasicMaterial

  //
  private impactRing!: THREE.Mesh
  private impactMat!: THREE.ShaderMaterial

  // （  params ，fire() ）
  private CHARGE_DUR = 0.8
  private BLADE_DELAY = 0.25
  private FALL_DUR = 0.4
  private readonly IMPACT_DUR = 0.35
  private readonly DISSIPATE_DUR = 0.8
  private phaseAge = 0

  constructor(private scene: THREE.Scene, private cfg: StarBladeConfig) {
    this.buildChargeStars()
    this.buildBlades()
    this.buildGroundEffects()
    this.buildImpactRing()
    this.buildRiseStarMat()
  }

  // ──  ──────────────────────────────────────────────────────

  private buildChargeStars() {
    this.chargeStarMat = new THREE.MeshBasicMaterial({
      color: COLORS.star,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const sizes = [0.22, 0.12, 0.12, 0.08, 0.08, 0.08, 0.05, 0.05]
    for (const sz of sizes) {
      const geo = createStarGeo(sz, sz * 0.4)
      const m = new THREE.Mesh(geo, this.chargeStarMat)
      m.renderOrder = 3100
      m.visible = false
      this.scene.add(m)
      this.chargeStars.push(m)
    }
  }

  private buildBlades() {
    const BLADE_COUNT = 5
    for (let i = 0; i < BLADE_COUNT; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
        },
        vertexShader:   BLADE_VERT,
        fragmentShader: BLADE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest:  false,   // /
        side: THREE.DoubleSide,
      })
      // ，  y=0，  y=5
      const geo = createBladeCross(0.6, 5.0)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 9000
      mesh.visible = false
      this.scene.add(mesh)
      this.blades.push(mesh)
      this.bladeMats.push(mat)
      this.bladeData.push({
        startY: 14, targetY: -0.3, yaw: 0, triggered: false,
        tiltX: 0, tiltZ: 0, offX: 0, offZ: 0, landed: false,
      })
    }
  }

  private buildGroundEffects() {
    const BLADE_COUNT = 5
    for (let i = 0; i < BLADE_COUNT; i++) {
      // ──  ───────────────────────────────────────────────
      const crackGeo = new THREE.PlaneGeometry(3.5, 3.5)
      crackGeo.rotateX(-Math.PI / 2)
      const crackMat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uAlpha:    { value: 0 },
        },
        vertexShader:   CRACK_VERT,
        fragmentShader: CRACK_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest:  false,
        side: THREE.DoubleSide,
      })
      const crackMesh = new THREE.Mesh(crackGeo, crackMat)
      crackMesh.renderOrder = 9010
      crackMesh.visible = false
      this.scene.add(crackMesh)
      this.groundCracks.push(crackMesh)
      this.groundCrackMats.push(crackMat)

      // ──  ───────────────────────────────────────────────
      const waveGeo = new THREE.RingGeometry(0.1, 1, 64)
      waveGeo.rotateX(-Math.PI / 2)
      const waveMat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uAlpha:    { value: 0 },
        },
        vertexShader:   WAVE_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest:  false,
        side: THREE.DoubleSide,
      })
      const waveMesh = new THREE.Mesh(waveGeo, waveMat)
      waveMesh.renderOrder = 9011
      waveMesh.visible = false
      this.scene.add(waveMesh)
      this.groundWaves.push(waveMesh)
      this.groundWaveMats.push(waveMat)

      this.groundEffectAge.push(0)
      this.groundEffectOn.push(false)

      // ── （7 / ， ， ） ─────────────
      const SHARD_COUNT = 7
      const shardGroup: typeof this.groundShards[0] = []
      for (let s = 0; s < SHARD_COUNT; s++) {
        const angle = (s / SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.8
        const r     = 0.15 + Math.random() * 0.50
        // ：  0.15-0.28m，  0.22-0.38m ——
        const geo   = createShardGeo(0.15 + Math.random() * 0.13, 0.22 + Math.random() * 0.16)
        // ： ， ，
        const tone  = 0.60 + Math.random() * 0.28
        const mat   = new THREE.MeshBasicMaterial({
          color: new THREE.Color(tone + 0.12, tone * 0.82, tone * 0.45),
          transparent: true,
          opacity: 1.0,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest:  false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 9012
        mesh.visible = false
        this.scene.add(mesh)
        shardGroup.push({
          mesh, mat,
          offX: Math.cos(angle) * r,
          offZ: Math.sin(angle) * r,
          ryaw: Math.random() * Math.PI * 2,
          vx: 0, vy: 0, vz: 0,
          avx: 0, avy: 0, avz: 0,
          bounces: 0, settled: false,
        })
      }
      this.groundShards.push(shardGroup)
    }
  }

  private buildImpactRing() {
    const geo = new THREE.RingGeometry(0.1, 4.5, 64)
    geo.rotateX(-Math.PI / 2)
    this.impactMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha:    { value: 0 },
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uAlpha, uProgress, uTime;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c) * 2.0;
          float ring = smoothstep(uProgress + 0.08, uProgress, d) * smoothstep(uProgress - 0.25, uProgress, d);
          vec3 col = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.65, 0.1), d);
          gl_FragColor = vec4(col, ring * uAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.impactRing = new THREE.Mesh(geo, this.impactMat)
    this.impactRing.renderOrder = 3050
    this.impactRing.visible = false
    this.scene.add(this.impactRing)
  }

  private buildRiseStarMat() {
    this.riseStarMat = new THREE.MeshBasicMaterial({
      color: COLORS.core,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  }

  // ──  ──────────────────────────────────────────────────────

  fire(pos = new THREE.Vector3()) {
    if (this.state !== 'idle') return
    this.originPos.copy(pos)
    this.age = 0
    this.phaseAge = 0
    this.state = 'charging'
    this.active = true

    //  params
    this.CHARGE_DUR  = this.params.chargeDuration
    this.BLADE_DELAY = this.params.bladeDelay
    this.FALL_DUR    = this.params.bladeFallDuration

    //
    // position.y  Y（  y=0 = ）
    const heightScale = this.params.bladeHeight / 5.0
    const BLADE_COUNT = this.blades.length

    // ，
    const firstAngle = Math.random() * Math.PI * 2
    // （±80°），
    const sectorAngle = (Math.PI * 2) / BLADE_COUNT

    for (let i = 0; i < BLADE_COUNT; i++) {
      //  +  ±80°  → ，
      const jitter    = (Math.random() - 0.5) * sectorAngle * 1.78
      const baseAngle = firstAngle + i * sectorAngle + jitter

      // ： (1.8~3.2) / (3.0~4.8) / (4.2~6.5) ，
      const radiusTiers = [
        1.8 + Math.random() * 1.4,   //
        3.0 + Math.random() * 1.8,   //
        4.2 + Math.random() * 2.3,   //
        2.2 + Math.random() * 2.6,   // （ ）
      ]
      const radius = radiusTiers[i % radiusTiers.length]

      const offX = Math.cos(baseAngle) * radius
      const offZ = Math.sin(baseAngle) * radius

      // ： 、 （15–28°），
      const tiltDir = Math.random() * Math.PI * 2         //
      const tiltMag = 0.26 + Math.random() * 0.22         // 15–28°
      const tiltX   = Math.cos(tiltDir) * tiltMag
      const tiltZ   = Math.sin(tiltDir) * tiltMag

      // targetY =  Y ；  1/3
      const underground = this.params.bladeHeight * 0.35   // ≈ 1.75m（  5m）

      const data = this.bladeData[i]
      data.triggered = false
      data.landed    = false
      data.startY    = this.params.fallHeight + i * 0.5
      data.targetY   = -underground
      data.offX      = offX
      data.offZ      = offZ
      data.tiltX     = tiltX
      data.tiltZ     = tiltZ
      data.yaw       = Math.random() * Math.PI * 2    //  yaw

      this.blades[i].visible = false
      this.bladeMats[i].uniforms.uAlpha.value = 0
      this.blades[i].scale.set(
        this.params.bladeWidth / 0.6,
        heightScale,
        this.params.bladeWidth / 0.6,
      )
    }
    for (const m of this.chargeStars) m.visible = true
    this.impactRing.visible = false

    // Charge （ ）
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2
      const r = 1.8 + Math.random() * 0.8
      this.cfg.sparkPS.emit({
        position: new THREE.Vector3(
          pos.x + Math.cos(angle) * r,
          pos.y + 0.5 + Math.random() * 1.5,
          pos.z + Math.sin(angle) * r,
        ),
        count: 2,
        speed: [0.5, 2.0],
        lifetime: [400, 800],
        size: [0.06, 0.14],
        colorFrom: COLORS.core.clone(),
        colorTo: COLORS.edge.clone(),
        direction: new THREE.Vector3(0, 1, 0),
        spread: 0.8,
      })
    }
  }

  // ──  ──────────────────────────────────────────────────────

  /** dt：  */
  update(dt: number): void {
    // ，active=false
    this.updateGroundEffects(dt)

    if (!this.active) return
    this.age += dt
    this.phaseAge += dt

    switch (this.state) {
      case 'charging':   this.updateCharge(dt);   break
      case 'falling':    this.updateFalling(dt);  break
      case 'impacting':  this.updateImpact(dt);   break
      case 'dissipating':this.updateDissipate(dt);break
    }

    // （ ）
    this.updateRiseStars(dt)
  }

  // ──  ──────────────────────────────────────────────────────
  private updateCharge(dt: number) {
    const t = this.phaseAge / this.CHARGE_DUR

    //
    for (let i = 0; i < this.chargeStars.length; i++) {
      const m = this.chargeStars[i]
      const baseAngle = (i / this.chargeStars.length) * Math.PI * 2
      const speed = 2.5 + i * 0.15
      const a = baseAngle + this.age * speed
      const r = 0.8 + i * 0.18 + Math.sin(this.age * 3 + i) * 0.1
      const yOff = 0.4 + i * 0.12 + Math.sin(this.age * 2 + i * 0.7) * 0.15
      m.position.set(
        this.originPos.x + Math.cos(a) * r,
        this.originPos.y + yOff,
        this.originPos.z + Math.sin(a) * r,
      )
      m.rotation.y = this.age * 3 + i
      const growScale = Math.min(t * 2, 1) * (1 + Math.sin(this.age * 6 + i) * 0.1)
      m.scale.setScalar(growScale)
    }

    //
    if (Math.random() < 0.6) {
      const angle = Math.random() * Math.PI * 2
      const r = 3.5 + Math.random() * 2.5
      this.cfg.magicPS.emit({
        position: new THREE.Vector3(
          this.originPos.x + Math.cos(angle) * r,
          this.originPos.y + Math.random() * 4,
          this.originPos.z + Math.sin(angle) * r,
        ),
        count: 1,
        speed: [1, 3],
        lifetime: [300, 600],
        size: [0.04, 0.1],
        colorFrom: COLORS.core.clone(),
        colorTo: COLORS.mid.clone(),
        direction: new THREE.Vector3(-Math.cos(angle), 0.5, -Math.sin(angle)),
        spread: 0.4,
      })
    }

    if (this.phaseAge >= this.CHARGE_DUR) {
      this.enterFalling()
    }
  }

  private enterFalling() {
    this.state = 'falling'
    this.phaseAge = 0
    for (const m of this.chargeStars) m.visible = false
    this.cfg.onTrauma?.(0.4)
  }

  // ── （  + ） ────────────────────────────────
  private triggerGroundEffect(i: number) {
    const blade = this.blades[i]
    //  =  XZ ，  y=0.02
    const cx = blade.position.x
    const cz = blade.position.z

    const crack = this.groundCracks[i]
    crack.position.set(cx, 0.02, cz)
    crack.visible = true
    this.groundCrackMats[i].uniforms.uProgress.value = 0
    this.groundCrackMats[i].uniforms.uAlpha.value    = 1

    const wave = this.groundWaves[i]
    wave.position.set(cx, 0.04, cz)
    wave.scale.setScalar(0.15)
    wave.visible = true
    this.groundWaveMats[i].uniforms.uProgress.value = 0
    this.groundWaveMats[i].uniforms.uAlpha.value    = 1

    // ：
    for (const s of this.groundShards[i]) {
      s.mesh.position.set(cx + s.offX, 0.02, cz + s.offZ)
      s.mesh.rotation.set(0, s.ryaw, 0)
      s.mat.opacity = 1.0
      s.mesh.visible = true

      // ：  +
      const dist = Math.sqrt(s.offX * s.offX + s.offZ * s.offZ) || 0.01
      const dirX = s.offX / dist
      const dirZ = s.offZ / dist
      const hSpd = 1.8 + Math.random() * 2.8    //
      s.vx = dirX * hSpd + (Math.random() - 0.5) * 0.6
      s.vy = 2.8 + Math.random() * 2.2           // （ ）
      s.vz = dirZ * hSpd + (Math.random() - 0.5) * 0.6

      // ：
      s.avx = (Math.random() - 0.5) * 16
      s.avy = (Math.random() - 0.5) * 10
      s.avz = (Math.random() - 0.5) * 16

      s.bounces = 0
      s.settled = false
    }

    this.groundEffectAge[i] = 0
    this.groundEffectOn[i]  = true

    // （0.6 × 5  = 3.0 ）
    this.cfg.onTrauma?.(0.6)
    for (let k = 0; k < 10; k++) {
      const angle = Math.random() * Math.PI * 2
      this.cfg.sparkPS.emit({
        position: new THREE.Vector3(cx + Math.cos(angle) * 0.3, 0.1, cz + Math.sin(angle) * 0.3),
        count: 1,
        speed: [2, 6],
        lifetime: [150, 350],
        size: [0.05, 0.14],
        colorFrom: COLORS.core.clone(),
        colorTo:   COLORS.edge.clone(),
        direction: new THREE.Vector3(Math.cos(angle), 0.6 + Math.random() * 0.6, Math.sin(angle)).normalize(),
        spread: 0.5,
        gravity: 12,
      })
    }
  }

  private updateGroundEffects(dt: number) {
    const CRACK_GROW  = 0.45  // （ ）
    const CRACK_STAY  = 0.60  //
    const CRACK_TOTAL = 1.60  //
    const WAVE_DUR    = 0.80  //

    for (let i = 0; i < this.groundEffectOn.length; i++) {
      if (!this.groundEffectOn[i]) continue

      this.groundEffectAge[i] += dt
      const age = this.groundEffectAge[i]

      //
      const crackProgress = Math.min(age / CRACK_GROW, 1)
      const crackAlpha    = age < CRACK_STAY ? 1.0 : Math.max(1 - (age - CRACK_STAY) / (CRACK_TOTAL - CRACK_STAY), 0)
      this.groundCrackMats[i].uniforms.uProgress.value = crackProgress
      this.groundCrackMats[i].uniforms.uAlpha.value    = crackAlpha

      //
      if (age < WAVE_DUR) {
        const wt = age / WAVE_DUR
        this.groundWaveMats[i].uniforms.uProgress.value = wt
        this.groundWaveMats[i].uniforms.uAlpha.value    = 1 - wt * wt
        this.groundWaves[i].scale.setScalar(0.15 + wt * 3.5)  //  3.5m
      } else {
        this.groundWaves[i].visible = false
      }

      // ：  →  →  →  →
      const GRAVITY    = 9.5   // m/s²
      const SHARD_FADE = 1.20  // （ ）
      for (const s of this.groundShards[i]) {
        if (!s.settled) {
          //
          s.vy -= GRAVITY * dt

          //
          s.mesh.position.x += s.vx * dt
          s.mesh.position.y += s.vy * dt
          s.mesh.position.z += s.vz * dt

          //
          s.mesh.rotation.x += s.avx * dt
          s.mesh.rotation.y += s.avy * dt
          s.mesh.rotation.z += s.avz * dt

          // （y ≤ ）
          if (s.mesh.position.y <= 0.02) {
            s.mesh.position.y = 0.02
            s.bounces++

            if (s.bounces >= 2) {
              // ： ，
              s.vx = s.vy = s.vz = 0
              s.avx *= 0.15
              s.avy *= 0.25
              s.avz *= 0.15
              s.settled = true
            } else {
              // ： ，
              s.vy  = Math.abs(s.vy) * 0.32
              s.vx *= 0.60
              s.vz *= 0.60
              s.avx *= 0.50
              s.avy *= 0.70
              s.avz *= 0.50
            }
          }
        } else {
          // ： （ ）
          s.avx *= 1 - dt * 5
          s.avy *= 1 - dt * 3
          s.avz *= 1 - dt * 5
          s.mesh.rotation.x += s.avx * dt
          s.mesh.rotation.y += s.avy * dt
          s.mesh.rotation.z += s.avz * dt
        }

        //
        if (age >= SHARD_FADE) {
          const ft = Math.min((age - SHARD_FADE) / (CRACK_TOTAL - SHARD_FADE), 1)
          s.mat.opacity = Math.max(1 - ft, 0)
        }
      }

      //
      if (age >= CRACK_TOTAL) {
        this.groundCracks[i].visible = false
        for (const s of this.groundShards[i]) s.mesh.visible = false
        this.groundEffectOn[i] = false
      }
    }
  }

  // ──  ──────────────────────────────────────────────────────
  private updateFalling(dt: number) {
    const totalFallDur = this.FALL_DUR + this.BLADE_DELAY * (this.blades.length - 1)

    for (let i = 0; i < this.blades.length; i++) {
      const triggerTime = i * this.BLADE_DELAY
      const data = this.bladeData[i]

      if (!data.triggered && this.phaseAge >= triggerTime) {
        data.triggered = true
        this.blades[i].visible = true
        this.blades[i].position.set(
          this.originPos.x + data.offX,
          data.startY,              // position.y =  Y
          this.originPos.z + data.offZ,
        )
        // ： ，yaw
        this.blades[i].rotation.set(data.tiltX, data.yaw, data.tiltZ)
      }

      if (!data.triggered) continue

      const localAge = this.phaseAge - i * this.BLADE_DELAY
      if (localAge < 0) continue

      const fallT = Math.min(localAge / this.FALL_DUR, 1)
      // （ease in）
      const easedT = fallT * fallT
      const tipY = data.startY + (data.targetY - data.startY) * easedT
      this.blades[i].position.y = tipY          //
      this.bladeMats[i].uniforms.uAlpha.value = Math.min(fallT * 3, 1)

      // （tipY <= 0） ，
      if (tipY <= 0 && !data.landed) {
        data.landed = true
        this.triggerGroundEffect(i)
      }

      //
      if (fallT > 0.05 && Math.random() < 0.5) {
        this.cfg.sparkPS.emit({
          position: this.blades[i].position.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 0.3, 0.5, (Math.random() - 0.5) * 0.3,
          )),
          count: 2,
          speed: [0.5, 2],
          lifetime: [100, 250],
          size: [0.06, 0.15],
          colorFrom: COLORS.core.clone(),
          colorTo: COLORS.edge.clone(),
          direction: new THREE.Vector3(0, 1, 0),
          spread: 1.0,
        })
      }
    }

    if (this.phaseAge >= totalFallDur) {
      this.enterImpact()
    }
  }

  private enterImpact() {
    this.state = 'impacting'
    this.phaseAge = 0
    //  impact ，  updateImpact

    //
    this.impactRing.visible = true
    this.impactRing.position.set(this.originPos.x, 0.03, this.originPos.z)
    this.impactMat.uniforms.uAlpha.value = 1
    this.impactMat.uniforms.uProgress.value = 0

    //
    for (let i = 0; i < this.params.impactParticles; i++) {
      const angle = (i / 50) * Math.PI * 2 + Math.random() * 0.2
      const speed = 5 + Math.random() * 10
      const dir = new THREE.Vector3(
        Math.cos(angle),
        0.15 + Math.random() * 0.35,
        Math.sin(angle),
      ).normalize()

      this.cfg.sparkPS.emit({
        position: new THREE.Vector3(
          this.originPos.x + (Math.random() - 0.5) * 0.5,
          0.1,
          this.originPos.z + (Math.random() - 0.5) * 0.5,
        ),
        count: 2,
        speed: [speed, speed + 3],
        lifetime: [300, 600],
        size: [0.08, 0.22],
        colorFrom: COLORS.core.clone(),
        colorTo: COLORS.edge.clone(),
        direction: dir,
        spread: 0.2,
        gravity: 10,
      })
    }

    //
    this.cfg.magicPS.emit({
      position: new THREE.Vector3(this.originPos.x, 0.3, this.originPos.z),
      count: 12,
      speed: [0.5, 2],
      lifetime: [80, 180],
      size: [0.5, 1.2],
      colorFrom: COLORS.core.clone(),
      colorTo: COLORS.mid.clone(),
      spread: 0.9,
    })

    this.cfg.onTrauma?.(3.0)   // ：scale = 3.0（ ）
    this.cfg.onFlash?.(255, 235, 180, 120, 0.9)

    //
    this.spawnRiseStars()
  }

  private updateImpact(dt: number) {
    const t = this.phaseAge / this.IMPACT_DUR
    this.impactMat.uniforms.uProgress.value = Math.min(t * 1.5, 1)
    this.impactMat.uniforms.uAlpha.value = Math.max(1 - t, 0)
    this.impactMat.uniforms.uTime.value += dt

    // （ ， ）
    const bladeFade = Math.max(1 - t * 1.8, 0)
    for (const mat of this.bladeMats) {
      mat.uniforms.uAlpha.value = bladeFade
    }

    if (this.phaseAge >= this.IMPACT_DUR) {
      this.impactRing.visible = false
      for (const blade of this.blades) blade.visible = false
      this.enterDissipate()
    }
  }

  private enterDissipate() {
    this.state = 'dissipating'
    this.phaseAge = 0
  }

  private updateDissipate(dt: number) {
    if (this.phaseAge >= this.DISSIPATE_DUR) {
      this.state = 'idle'
      this.active = false
    }
  }

  // ──  ──────────────────────────────────────────────────
  private spawnRiseStars() {
    const count = 12
    const phaseSpeed = 2.6
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3
      const r = 0.5 + Math.random() * 1.5
      const spiralOffset = (i / count) * Math.PI * 2 * 3.8  //

      const geo = createStarGeo(0.08 + Math.random() * 0.12, 0.04)
      const m = new THREE.Mesh(geo, this.riseStarMat.clone())
      m.renderOrder = 3150
      m.position.set(
        this.originPos.x + Math.cos(angle) * r,
        0.1 + Math.random() * 0.5,
        this.originPos.z + Math.sin(angle) * r,
      )
      this.scene.add(m)
      this.riseStars.push({
        mesh: m,
        vel: new THREE.Vector3(
          Math.cos(spiralOffset) * 0.5,
          1.2 + Math.random() * 1.5,
          Math.sin(spiralOffset) * 0.5,
        ),
        age: 0,
        lifetime: 0.6 + Math.random() * 0.6,
      })
    }
  }

  private updateRiseStars(dt: number) {
    for (let i = this.riseStars.length - 1; i >= 0; i--) {
      const s = this.riseStars[i]
      s.age += dt
      const t = s.age / s.lifetime

      s.mesh.position.add(s.vel.clone().multiplyScalar(dt))
      s.vel.y -= 0.5 * dt  //
      s.mesh.rotation.y += dt * 4
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(1 - t * t, 0)
      s.mesh.scale.setScalar(Math.max(1 - t, 0.01))

      if (t >= 1) {
        this.scene.remove(s.mesh)
        s.mesh.geometry.dispose()
        ;(s.mesh.material as THREE.MeshBasicMaterial).dispose()
        this.riseStars.splice(i, 1)
      }
    }
  }

  // ──  ──────────────────────────────────────────────────────
  dispose() {
    for (const m of this.chargeStars) {
      this.scene.remove(m)
      m.geometry.dispose()
    }
    this.chargeStarMat.dispose()

    for (let i = 0; i < this.blades.length; i++) {
      this.scene.remove(this.blades[i])
      this.blades[i].geometry.dispose()
      this.bladeMats[i].dispose()
    }

    for (let i = 0; i < this.groundCracks.length; i++) {
      this.scene.remove(this.groundCracks[i])
      this.groundCracks[i].geometry.dispose()
      this.groundCrackMats[i].dispose()
      this.scene.remove(this.groundWaves[i])
      this.groundWaves[i].geometry.dispose()
      this.groundWaveMats[i].dispose()
      for (const s of this.groundShards[i]) {
        this.scene.remove(s.mesh)
        s.mesh.geometry.dispose()
        s.mat.dispose()
      }
    }

    this.scene.remove(this.impactRing)
    this.impactRing.geometry.dispose()
    this.impactMat.dispose()

    for (const s of this.riseStars) {
      this.scene.remove(s.mesh)
      s.mesh.geometry.dispose()
      ;(s.mesh.material as THREE.MeshBasicMaterial).dispose()
    }
    this.riseStarMat.dispose()
  }
}
