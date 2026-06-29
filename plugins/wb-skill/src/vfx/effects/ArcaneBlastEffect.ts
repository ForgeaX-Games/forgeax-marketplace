// @source wb-character/src/vfx/effects/ArcaneBlastEffect.ts
/**
 *  — Arcane Blast
 *
 *  MagicTeleportEffect ：
 *   Phase 0–0.35s  :  — ， 
 *   Phase 0.35–0.7s:  — ，  6 
 *   Phase 0.7–2.2s :  — ， 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem } from '../core/ParticleSystems'

export interface ArcaneBlastConfig {
  sparkPS: ParticleSystem
  magicPS: ParticleSystem
  onTrauma?: (amount: number) => void
  onFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
}

// ── Shaders ──────────────────────────────────────────────────────

const CIRCLE_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CIRCLE_FRAG = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uProgress; // 0 → 1 
  uniform float uBurst;    // 0 → 1 
  varying vec2 vUv;
  #define PI 3.14159265359

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float angle = atan(c.y, c.x);

    // 
    float ring1 = smoothstep(0.97, 1.00, r) * (1.0 - smoothstep(1.00, 1.02, r));
    float ring2 = smoothstep(0.74, 0.77, r) * (1.0 - smoothstep(0.77, 0.80, r));
    float ring3 = smoothstep(0.50, 0.52, r) * (1.0 - smoothstep(0.52, 0.54, r));

    // 
    float seg = 16.0;
    float runeA = mod(angle + uTime * 1.2, PI * 2.0 / seg);
    float rune  = smoothstep(0.04, 0.07, runeA) * (1.0 - smoothstep(0.10, 0.13, runeA));
    rune *= smoothstep(0.78, 0.82, r) * (1.0 - smoothstep(0.88, 0.92, r));

    // 
    float sa = mod(angle + PI / 6.0, PI / 3.0) - PI / 6.0;
    float sd = r / cos(sa) * 0.5;
    float star = smoothstep(0.28, 0.30, sd) * (1.0 - smoothstep(0.30, 0.33, sd));
    star *= step(r, 0.62);

    // 
    float lines = 0.0;
    for (float i = 0.0; i < 8.0; i++) {
      float la = i * PI / 4.0 - uTime * 1.5;
      float ld = abs(dot(c, vec2(cos(la), sin(la))));
      lines += smoothstep(0.012, 0.003, ld)
             * smoothstep(0.08, 0.25, r) * (1.0 - smoothstep(0.45, 0.60, r));
    }

    float pattern = ring1 + ring2 + ring3 + rune * 0.9 + star * 0.7 + lines * 0.6;

    //  (  + )
    float pm = smoothstep(0.0, uProgress * 1.1, 1.0 - r);
    float bm = 1.0 - uBurst;
    pattern *= pm * bm;

    // →  
    vec3 colA = vec3(0.2, 0.6, 1.0);
    vec3 colB = vec3(0.0, 1.0, 0.9);
    vec3 col  = mix(colA, colB, r * 0.7 + sin(uTime * 3.0) * 0.15);
    col *= 1.0 + pattern * 0.6;

    gl_FragColor = vec4(col, pattern * uAlpha);
  }
`

const PILLAR_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const PILLAR_FRAG = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uProgress; // 0→1 
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float flow    = sin(vUv.y * 18.0 - uTime * 10.0) * 0.5 + 0.5;
    flow         *= sin(vUv.x * 25.0 + uTime * 4.0) * 0.25 + 0.75;
    float sparkle = pow(hash(floor(vUv.x * 24.0) + floor(vUv.y * 32.0) + uTime * 3.0), 7.0);
    float pm      = smoothstep(1.0 - uProgress, 1.0 - uProgress + 0.35, vUv.y);
    float fade    = 1.0 - vUv.y * 0.7;

    vec3 colA = vec3(0.3, 0.7, 1.0);
    vec3 colB = vec3(0.0, 0.9, 1.0);
    vec3 col  = mix(colA, colB, vUv.y) + vec3(1.0) * sparkle * 0.5;

    float alpha = fade * flow * pm * uAlpha;
    alpha += sparkle * 0.35 * pm * uAlpha;

    gl_FragColor = vec4(col, alpha * 0.65);
  }
`

// （ ）
const BOLT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BOLT_FRAG = `
  uniform float uAlpha;
  uniform float uProgress; // 0→1 
  varying vec2 vUv;

  void main() {
    // ： 
    float head = 1.0 - vUv.x;                       // （vUv.x=1） 
    float tail = smoothstep(0.0, 0.3, vUv.x);       // 
    float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;     // 
    edge = pow(edge, 1.5);

    float alpha = head * tail * edge * uAlpha * smoothstep(0.0, 0.15, uProgress);
    alpha *= smoothstep(1.0, 0.85, uProgress);      // 

    vec3 col = mix(vec3(0.3, 0.8, 1.0), vec3(1.0, 1.0, 1.0), head * 0.6);

    gl_FragColor = vec4(col, alpha);
  }
`

// ── Speed Line Shader（camera-facing billboard， ， ）──
//  → / ，
const SPEED_LINE_FRAG = `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  float hash(float n){ return fract(sin(n)*43758.5453); }

  void main(){
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    // ， 
    if(r > 0.94 || r < 0.13) discard;

    float PI   = 3.14159265;
    float angN = (atan(c.y, c.x) + PI) / (PI * 2.0);

    float SLOTS = 22.0;
    float slot  = floor(angN * SLOTS);
    float slotF = fract(angN * SLOTS);
    float h     = hash(slot * 7.31 + 1.13);
    float h2    = hash(slot * 3.77 + 8.31);

    // ：  10  → 
    float tq   = floor(uTime * 10.0);
    float isOn = step(0.45, hash(slot * 11.7 + tq * 17.3));
    if(isOn < 0.5) discard;

    // （ ）
    float lw   = 0.022 + h2 * 0.018;
    float angW = 1.0 - smoothstep(lw * 0.3, lw, abs(slotF - 0.5));

    // 
    float sR     = 0.13 + h * 0.22;
    float len    = 0.22 + h2 * 0.42;
    float eR     = min(sR + len, 0.92);
    float radial = smoothstep(sR - 0.02, sR, r) *
                   smoothstep(eR + 0.02, eR, r);

    // （ ）
    float fade   = 1.0 - smoothstep(sR, eR, r) * 0.55;
    float bright = angW * radial * fade;
    if(bright < 0.005) discard;

    vec3 col = mix(vec3(0.68, 0.90, 1.0), vec3(1.0, 1.0, 1.0), bright);
    gl_FragColor = vec4(col, bright * uAlpha);
  }
`

// ── Speed Aurora Shader（ ， ， ）──
//  AURORA_FRAG， 、 ， " "。
const SPEED_AURORA_FRAG = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    // 
    float w1 = sin(vUv.x * 18.85 + vUv.y * 7.0  - uTime * 7.0)        * 0.5 + 0.5;
    float w2 = sin(vUv.x * 37.70 + vUv.y * 13.0 - uTime * 11.0 + 1.3) * 0.5 + 0.5;
    float w3 = sin(vUv.x * 12.57 - vUv.y * 5.0  - uTime *  4.5 + 2.7) * 0.3 + 0.7;
    float streak = pow(w1 * w2 * w3, 1.4);

    float rise    = 1.0 - smoothstep(uProgress * 0.87, uProgress, vUv.y);
    float bottom  = smoothstep(0.0, 0.07, vUv.y);
    float topFade = 1.0 - vUv.y * 0.55;

    float alpha = streak * rise * bottom * topFade * uAlpha;
    if (alpha < 0.005) discard;

    // （ ， ）
    vec3 col = mix(vec3(0.38, 0.68, 1.0), vec3(0.72, 0.90, 1.0), w1);
    col = mix(col, vec3(0.90, 0.96, 1.0), streak * 0.62);

    gl_FragColor = vec4(col, alpha * 0.38);  // 
  }
`

// ── Aurora Charge Column Shader（ ）────────────────────────────
const AURORA_FRAG = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    // UV.x: 0~1 ; UV.y: 0=  1= 
    //  →  + 
    float w1 = sin(vUv.x * 18.85 + vUv.y * 7.0  - uTime * 7.0)        * 0.5 + 0.5;
    float w2 = sin(vUv.x * 37.70 + vUv.y * 13.0 - uTime * 11.0 + 1.3) * 0.5 + 0.5;
    float w3 = sin(vUv.x * 12.57 - vUv.y * 5.0  - uTime *  4.5 + 2.7) * 0.3 + 0.7;
    float streak = pow(w1 * w2 * w3, 1.4);

    // ：  uProgress 
    float rise   = 1.0 - smoothstep(uProgress * 0.87, uProgress, vUv.y);
    float bottom = smoothstep(0.0, 0.07, vUv.y);
    float topFade = 1.0 - vUv.y * 0.55;

    float alpha = streak * rise * bottom * topFade * uAlpha;
    if (alpha < 0.005) discard;

    //  →  → 
    vec3 col = mix(vec3(0.1, 0.45, 1.0), vec3(0.35, 0.80, 1.0), w1);
    col = mix(col, vec3(0.75, 0.95, 1.0), streak * 0.55);

    gl_FragColor = vec4(col, alpha * 0.55);
  }
`

// ── Effect class ─────────────────────────────────────────────────

const CHAR_POS = new THREE.Vector3(0, 0, 0)
const BOLT_COUNT = 6

export class ArcaneBlastEffect {
  private camera: THREE.Camera
  private circleMesh: THREE.Mesh
  private circleMat: THREE.ShaderMaterial
  private pillarMesh: THREE.Mesh
  private pillarMat: THREE.ShaderMaterial

  // （camera-facing billboard， ）
  private speedLineMesh: THREE.Mesh
  private speedLineMat: THREE.ShaderMaterial

  // （ 、 ， ）
  private speedAuroraMesh: THREE.Mesh
  private speedAuroraMat: THREE.ShaderMaterial

  //
  private auroraChargeMesh: THREE.Mesh
  private auroraChargeMat: THREE.ShaderMaterial

  // （BOLT_COUNT ）
  private bolts: THREE.Mesh[] = []
  private boltMats: THREE.ShaderMaterial[] = []
  private boltDirs: THREE.Vector3[] = []

  active = false
  private age = 0

  constructor(private scene: THREE.Scene, camera: THREE.Camera, private config: ArcaneBlastConfig) {
    this.camera = camera
    // ── （PlaneGeometry billboard， ， ）──
    this.speedLineMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uAlpha: { value: 0 },
      },
      vertexShader:   CIRCLE_VERT,
      fragmentShader: SPEED_LINE_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      depthTest:   false,
      side:        THREE.DoubleSide,
    })
    // 7×7 ，billboard ；UV inscribed circle r=3.5
    this.speedLineMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), this.speedLineMat)
    this.speedLineMesh.renderOrder = 2196
    this.speedLineMesh.visible = false
    scene.add(this.speedLineMesh)

    // ── （SPEED_AURORA_FRAG， ， ）──
    // （  0.8、  0.45、  7.0）， " "
    this.speedAuroraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uAlpha:    { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   CIRCLE_VERT,
      fragmentShader: SPEED_AURORA_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      depthTest:   false,
      side:        THREE.DoubleSide,
    })
    const speedAuroraGeo = new THREE.CylinderGeometry(0.45, 0.80, 7.0, 16, 1, true)
    this.speedAuroraMesh = new THREE.Mesh(speedAuroraGeo, this.speedAuroraMat)
    this.speedAuroraMesh.visible     = false
    this.speedAuroraMesh.renderOrder = 2197
    scene.add(this.speedAuroraMesh)

    // ── （ ，open-ended， ）──
    this.auroraChargeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uAlpha:    { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   CIRCLE_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      depthTest:   false,
      side:        THREE.DoubleSide,
    })
    // ：  0.35、  0.2、  5.5；  y=2.75 →  y=0  y=5.5
    const auroraGeo = new THREE.CylinderGeometry(0.2, 0.35, 5.5, 16, 1, true)
    this.auroraChargeMesh = new THREE.Mesh(auroraGeo, this.auroraChargeMat)
    this.auroraChargeMesh.visible     = false
    this.auroraChargeMesh.renderOrder = 2198
    scene.add(this.auroraChargeMesh)

    // ──  ──
    const circleGeo = new THREE.CircleGeometry(2.0, 64)
    this.circleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uAlpha:    { value: 0 },
        uProgress: { value: 0 },
        uBurst:    { value: 0 },
      },
      vertexShader:   CIRCLE_VERT,
      fragmentShader: CIRCLE_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    })
    this.circleMesh = new THREE.Mesh(circleGeo, this.circleMat)
    this.circleMesh.rotation.x = -Math.PI / 2
    this.circleMesh.visible    = false
    this.circleMesh.renderOrder = 2200
    scene.add(this.circleMesh)

    // ──  ──
    const pillarGeo = new THREE.CylinderGeometry(0.6, 1.0, 4, 32, 1, true)
    this.pillarMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uAlpha:    { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   PILLAR_VERT,
      fragmentShader: PILLAR_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    })
    this.pillarMesh = new THREE.Mesh(pillarGeo, this.pillarMat)
    this.pillarMesh.visible     = false
    this.pillarMesh.renderOrder = 2201
    scene.add(this.pillarMesh)

    // ──  ──
    for (let i = 0; i < BOLT_COUNT; i++) {
      const angle = (i / BOLT_COUNT) * Math.PI * 2
      const dir   = new THREE.Vector3(Math.cos(angle), 0.3, Math.sin(angle)).normalize()
      this.boltDirs.push(dir)

      const boltGeo = new THREE.PlaneGeometry(1.2, 0.18)
      const boltMat = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha:    { value: 0 },
          uProgress: { value: 0 },
        },
        vertexShader:   BOLT_VERT,
        fragmentShader: BOLT_FRAG,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        side:        THREE.DoubleSide,
      })
      const bolt = new THREE.Mesh(boltGeo, boltMat)
      bolt.visible     = false
      bolt.renderOrder = 2202
      scene.add(bolt)
      this.bolts.push(bolt)
      this.boltMats.push(boltMat)
    }
  }

  fire(): void {
    if (this.active) return
    this.active = true
    this.age    = 0

    const origin = CHAR_POS.clone()

    //  billboard（ ）
    this.speedLineMesh.position.set(origin.x, 1.5, origin.z)
    this.speedLineMesh.visible = true
    this.speedLineMat.uniforms.uAlpha.value = 0

    // ：  y=3.5 →  y=0，  y=7
    this.speedAuroraMesh.position.set(origin.x, 3.5, origin.z)
    this.speedAuroraMesh.visible = true
    this.speedAuroraMat.uniforms.uAlpha.value    = 0
    this.speedAuroraMat.uniforms.uProgress.value = 0

    // （  y=0，  y=5.5，  y=2.75）
    this.auroraChargeMesh.position.set(origin.x, 2.75, origin.z)
    this.auroraChargeMesh.visible = true
    this.auroraChargeMat.uniforms.uAlpha.value    = 0
    this.auroraChargeMat.uniforms.uProgress.value = 0

    //
    this.circleMesh.position.set(origin.x, 0.01, origin.z)
    this.circleMesh.visible = false
    this.circleMat.uniforms.uProgress.value = 0
    this.circleMat.uniforms.uAlpha.value    = 0
    this.circleMat.uniforms.uBurst.value    = 0

    // ，  2（  0 →  4）
    this.pillarMesh.position.set(origin.x, 2, origin.z)
    this.pillarMesh.visible = false
    this.pillarMat.uniforms.uAlpha.value    = 0
    this.pillarMat.uniforms.uProgress.value = 0

    //
    for (let i = 0; i < BOLT_COUNT; i++) {
      this.bolts[i].visible = false
      this.boltMats[i].uniforms.uAlpha.value    = 0
      this.boltMats[i].uniforms.uProgress.value = 0
    }
  }

  update(dt: number): void {
    if (!this.active) return

    const dts = dt * 0.001
    this.age += dts
    const t   = this.age
    const now = performance.now() * 0.001

    this.circleMat.uniforms.uTime.value       = now
    this.pillarMat.uniforms.uTime.value       = now
    this.auroraChargeMat.uniforms.uTime.value = now
    this.speedAuroraMat.uniforms.uTime.value  = now
    this.speedLineMat.uniforms.uTime.value    = now
    //
    if (this.speedLineMesh.visible) {
      this.speedLineMesh.quaternion.copy(this.camera.quaternion)
    }

    const origin = CHAR_POS.clone()

    // ── Phase 0:  (0 → 0.45s) ────────────────────
    if (t < 0.45) {
      const p = t / 0.45
      // ，
      const slProg = Easing.easeOutQuad(p)
      // ： （ ）
      this.speedLineMat.uniforms.uAlpha.value      = Easing.easeOutQuad(Math.min(p * 2.5, 1.0)) * 0.70
      // （ ）： ，
      this.speedAuroraMat.uniforms.uAlpha.value    = Easing.easeOutQuad(Math.min(p * 1.5, 1.0)) * 0.85
      this.speedAuroraMat.uniforms.uProgress.value = slProg
      // ： ，easeOutQuad
      this.auroraChargeMat.uniforms.uAlpha.value    = Easing.easeOutQuad(Math.min(p * 2.0, 1.0))
      this.auroraChargeMat.uniforms.uProgress.value = Easing.easeOutQuad(p)
      //
      if (Math.random() < 0.3) {
        const angle  = Math.random() * Math.PI * 2
        const radius = 1.5 + Math.random() * 1.2
        this.config.magicPS.emit({
          position: origin.clone().add(new THREE.Vector3(
            Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius
          )),
          count: 1,
          speed: [1.0, 2.0],
          lifetime: [300, 500],
          size: [0.03, 0.07],
          colorFrom: new THREE.Color(0.4, 0.8, 1.0),
          colorTo:   new THREE.Color(0.2, 0.6, 1.0),
          direction: new THREE.Vector3(-Math.cos(angle), 0.2, -Math.sin(angle)),
          spread: 0.15,
        })
      }
      // （ ， ）
      if (Math.random() < 0.20) {
        const ga = Math.random() * Math.PI * 2
        const gr = Math.random() * 0.9
        this.config.sparkPS.emit({
          position: origin.clone().add(new THREE.Vector3(
            Math.cos(ga) * gr, 0.04, Math.sin(ga) * gr
          )),
          count:     1,
          speed:     [0.05, 0.35],
          lifetime:  [120, 280],
          size:      [0.015, 0.05],
          colorFrom: new THREE.Color(0.6, 0.88, 1.0),
          colorTo:   new THREE.Color(0.3, 0.65, 1.0),
          direction: new THREE.Vector3(Math.cos(ga), 0.1, Math.sin(ga)),
          spread:    0.6,
        })
      }
    }

    // ── Phase 1:  (0.45 → 0.80s) ───────────────────────────
    if (t >= 0.45 && t < 0.80) {
      const p = (t - 0.45) / 0.35
      //
      this.speedLineMat.uniforms.uAlpha.value      = (1.0 - Easing.easeInQuad(p)) * 0.70
      this.speedAuroraMat.uniforms.uAlpha.value    = (1.0 - Easing.easeInQuad(p)) * 0.85
      this.speedAuroraMat.uniforms.uProgress.value = 1.0
      //
      this.auroraChargeMat.uniforms.uAlpha.value    = (1.0 - Easing.easeInQuad(p))
      this.auroraChargeMat.uniforms.uProgress.value = 1.0
      //
      this.circleMesh.visible = true
      this.circleMat.uniforms.uAlpha.value    = Easing.easeOutQuad(p)
      this.circleMat.uniforms.uProgress.value = Easing.easeOutQuad(p)
      //
      if (Math.random() < 0.5) {
        const angle  = Math.random() * Math.PI * 2
        const radius = 0.3 + Math.random() * 1.5
        this.config.magicPS.emit({
          position: origin.clone().add(new THREE.Vector3(
            Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius
          )),
          count: 1,
          speed: [0.8, 2.5],
          lifetime: [400, 700],
          size: [0.04, 0.10],
          colorFrom: new THREE.Color(0.3, 0.7, 1.0),
          colorTo:   new THREE.Color(0.0, 1.0, 1.0),
          direction: new THREE.Vector3(0, 1, 0),
          spread: 0.2,
        })
      }
    }

    // ── Phase 2:  (0.80 → 1.15s) ───────────────────────────
    if (t >= 0.80 && t < 1.15) {
      const p = (t - 0.80) / 0.35
      this.speedLineMesh.visible    = false
      this.speedAuroraMesh.visible  = false
      this.auroraChargeMesh.visible = false
      //
      this.circleMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(p) * 0.6
      this.circleMat.uniforms.uBurst.value = Easing.easeInQuad(p)
      //
      this.pillarMesh.visible = true
      this.pillarMat.uniforms.uAlpha.value    = Easing.easeOutQuad(p)
      this.pillarMat.uniforms.uProgress.value = Easing.easeOutQuad(p)
      // （ ）
      if (t < 0.81) {
        this.config.onFlash?.(150, 220, 255, 120, 0.5)
        this.config.onTrauma?.(0.3)
        this.config.sparkPS.emit({
          position: origin.clone().add(new THREE.Vector3(0, 1.0, 0)),
          count: 40,
          speed: [3, 8],
          lifetime: [500, 1000],
          size: [0.05, 0.14],
          colorFrom: new THREE.Color(0.5, 0.9, 1.0),
          colorTo:   new THREE.Color(0.0, 0.5, 1.0),
          spread: 2.5,
        })
      }
      //
      for (let i = 0; i < BOLT_COUNT; i++) {
        this.bolts[i].visible = true
        const travelMax = 4.5
        const boltPos   = origin.clone()
          .add(this.boltDirs[i].clone().multiplyScalar(p * travelMax))
          .add(new THREE.Vector3(0, 0.7 + this.boltDirs[i].y * p * travelMax, 0))
        this.bolts[i].position.copy(boltPos)
        this.bolts[i].lookAt(boltPos.clone().add(this.boltDirs[i]))
        this.boltMats[i].uniforms.uAlpha.value    = p < 0.5 ? Easing.easeOutQuad(p * 2) : 1.0 - p
        this.boltMats[i].uniforms.uProgress.value = p
      }
    }

    // ── Phase 3:  (1.15 → 2.65s) ───────────────────────────
    if (t >= 1.15 && t < 2.65) {
      const p = (t - 1.15) / 1.5
      this.circleMat.uniforms.uAlpha.value = Math.max(0, (1.0 - Easing.easeInQuad(p)) * 0.4)
      this.circleMat.uniforms.uBurst.value = 1.0
      this.pillarMat.uniforms.uAlpha.value = Math.max(0, 1.0 - Easing.easeInQuad(p * 1.5))
      for (let i = 0; i < BOLT_COUNT; i++) this.bolts[i].visible = false
      if (Math.random() < 0.3) {
        const angle  = Math.random() * Math.PI * 2
        const radius = 1.0 + Math.random() * 2.5
        this.config.magicPS.emit({
          position: origin.clone().add(new THREE.Vector3(
            Math.cos(angle) * radius * p,
            0.5 + Math.random() * 2.0 * p,
            Math.sin(angle) * radius * p
          )),
          count: 1,
          speed: [0.5, 2.0],
          lifetime: [500, 1000],
          size: [0.03, 0.08],
          colorFrom: new THREE.Color(0.2, 0.7, 1.0),
          colorTo:   new THREE.Color(0.0, 0.4, 0.8),
          direction: new THREE.Vector3(0, -1, 0),
          spread: 0.5,
          gravity: 2,
        })
      }
    }

    // ──  ─────────────────────────────────────────────────────
    if (t >= 2.65) {
      this._reset()
    }
  }

  private _reset(): void {
    this.active = false
    this.age    = 0
    this.speedLineMesh.visible    = false
    this.speedAuroraMesh.visible  = false
    this.auroraChargeMesh.visible = false
    this.circleMesh.visible       = false
    this.pillarMesh.visible    = false
    for (const b of this.bolts) b.visible = false
  }

  dispose(): void {
    this._reset()
    this.scene.remove(this.speedLineMesh)
    this.scene.remove(this.speedAuroraMesh)
    this.scene.remove(this.auroraChargeMesh)
    this.scene.remove(this.circleMesh)
    this.scene.remove(this.pillarMesh)
    this.speedLineMat.dispose()
    this.speedLineMesh.geometry.dispose()
    this.speedAuroraMat.dispose()
    this.speedAuroraMesh.geometry.dispose()
    this.auroraChargeMat.dispose()
    this.auroraChargeMesh.geometry.dispose()
    this.circleMat.dispose()
    this.circleMesh.geometry.dispose()
    this.pillarMat.dispose()
    this.pillarMesh.geometry.dispose()
    for (let i = 0; i < BOLT_COUNT; i++) {
      this.scene.remove(this.bolts[i])
      this.boltMats[i].dispose()
      this.bolts[i].geometry.dispose()
    }
  }
}
