// @source wb-character/src/vfx/effects/HealAura.ts
/**
 * （  v3）
 *
 * ：
 * -  6 ，  (depthTest:false)
 * - （2 ）
 * - （12 ）
 * - （6 ）+ （6 ）
 * -  Sprite （ ， ）
 * - （ ，5 ）
 * - （6 ）
 */

import * as THREE from 'three'
import { ParticleSystem } from '../core/ParticleSystems'

// ──  GLSL ─────────────────────────────────────────────────────
const HUE_ROTATE_GLSL = `
vec3 applyHue(vec3 col,float hue){
  float a=cos(hue*6.28318),b=sin(hue*6.28318);
  vec3 k=vec3(0.57735);
  return col*a+cross(k,col)*b+k*dot(k,col)*(1.0-a);
}`

// ── Canvas （Sprite ）──────────────────────────────
function createCrossSpriteTex(): THREE.CanvasTexture {
  const S = 256
  const cv = document.createElement('canvas'); cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, S, S)
  const cx = S / 2, arm = S * 0.42, tk = S * 0.10

  // （  20%）
  ctx.shadowColor = '#44cc66'; ctx.shadowBlur = 22
  ctx.fillStyle = 'rgba(48,204,80,0.44)'
  ctx.fillRect(cx - arm, cx - tk, arm * 2, tk * 2)
  ctx.fillRect(cx - tk, cx - arm, tk * 2, arm * 2)

  // （  20%）
  ctx.shadowBlur = 8; ctx.fillStyle = '#88dda8'
  ctx.fillRect(cx - arm * 0.90, cx - tk * 0.60, arm * 1.80, tk * 1.20)
  ctx.fillRect(cx - tk * 0.60, cx - arm * 0.90, tk * 1.20, arm * 1.80)

  // （ → ，  20%）
  ctx.shadowBlur = 3; ctx.fillStyle = 'rgba(200,255,220,0.80)'
  ctx.beginPath(); ctx.arc(cx, cx, tk * 0.72, 0, Math.PI * 2); ctx.fill()
  return new THREE.CanvasTexture(cv)
}

// ── （ ， ）────────────────────────
function createBeamGeo(w = 0.046, h = 1.0): THREE.BufferGeometry {
  const hw = w / 2
  const pos = new Float32Array([
    -hw, 0, 0,   hw, 0, 0,   hw, h, 0,  -hw, h, 0,
      0, 0,-hw,   0, 0,hw,    0, h,hw,    0, h,-hw,
  ])
  const uv  = new Float32Array([0,0,1,0,1,1,0,1,  0,0,1,0,1,1,0,1])
  const idx = new Uint16Array([0,1,2, 0,2,3,  4,5,6, 4,6,7])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(uv,  2))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.computeVertexNormals(); return geo
}

// ──  ─────────────────────────────────────────────────────
function createBladeGeo(): THREE.BufferGeometry {
  const w = 0.052, segs = 5
  const verts: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, hw = (w / 2) * (1 - t * 0.90), y = t, bx = t * t * 0.04
    verts.push(-hw+bx, y, 0,  hw+bx, y, 0); uvs.push(0, t, 1, t)
  }
  for (let i = 0; i < segs; i++) {
    const b = i * 2; idx.push(b, b+1, b+2,  b+1, b+3, b+2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs),   2))
  geo.setIndex(idx); geo.computeVertexNormals(); return geo
}

// ── （N ）──────────────────────────────────────────────
function createFlowerGeo(petals = 5, r = 0.10): THREE.BufferGeometry {
  const pos: number[] = [0,0,0], uvs: number[] = [0.5,0.5], idx: number[] = []
  const S = petals * 10
  for (let i = 0; i <= S; i++) {
    const a = (i / S) * Math.PI * 2
    const pr = r * (0.45 + 0.55 * Math.pow(Math.abs(Math.cos(a * petals / 2)), 0.55))
    pos.push(Math.cos(a)*pr, 0, Math.sin(a)*pr)
    uvs.push(0.5+Math.cos(a)*0.5, 0.5+Math.sin(a)*0.5)
    if (i > 0) idx.push(0, i, i+1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2))
  geo.setIndex(idx); geo.computeVertexNormals(); return geo
}

function hueToCol(hue: number): THREE.Color {
  return new THREE.Color().setHSL((hue + 0.33) % 1, 0.85, 0.55)
}

// ── （ ）────────────────────────
function createRibbonGeo(segs = 80, turns = 2.8, r = 0.28, h = 1.70, w = 0.095): THREE.BufferGeometry {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const theta = t * turns * Math.PI * 2
    const y = t * h
    const cr = Math.cos(theta), sr = Math.sin(theta)
    //  (-sin, dY/dtheta, cos)，
    // ： 、 ，
    const ky = 0.22
    pos.push((r-w*0.5)*cr, y - w*ky*0.5, (r-w*0.5)*sr)
    pos.push((r+w*0.5)*cr, y + w*ky*0.5, (r+w*0.5)*sr)
    uvs.push(0, t,  1, t)
    if (i > 0) { const b=(i-1)*2; idx.push(b,b+1,b+2, b+1,b+3,b+2) }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2))
  geo.setIndex(idx); geo.computeVertexNormals(); return geo
}

// ──  ────────────────────────────────────────────────────
const RIBBON_FRAG = `${HUE_ROTATE_GLSL}
uniform float uTime,uAlpha,uHue,uIntensity;
varying vec2 vUv;
#define PI 3.14159265
void main(){
  float x=vUv.x, y=vUv.y;
  // （ ， ）
  float edge=pow(sin(x*PI),0.48);
  // ： ， 
  float hFade=smoothstep(1.0,0.72,y)*smoothstep(0.0,0.04,y);
  // 
  float flow=y-uTime*0.70;
  float pat=0.52+0.48*sin(flow*11.0);
  // 
  float ripple=0.82+0.18*sin(x*7.0-uTime*2.8);
  vec3 c1=applyHue(vec3(0.15,0.78,0.25),uHue);
  vec3 c2=applyHue(vec3(0.62,1.00,0.70),uHue);
  vec3 col=mix(c1,c2,pat*0.70)*uIntensity;
  float alpha=edge*hFade*(0.48+0.52*pat)*ripple*0.62*uAlpha;
  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0));
}`

// ──  ────────────────────────────────────────────────────
const BEAM_FRAG = `${HUE_ROTATE_GLSL}
uniform float uTime,uAlpha,uHue,uIntensity;
varying vec2 vUv;
void main(){
  float y=vUv.y, x=vUv.x;
  // （pow  0.55 → 1.2， ）
  float edge=pow(max(1.0-abs(x-0.5)*2.0,0.0),1.20);
  // ： 
  float hFade=pow((1.0-y)*smoothstep(0.0,0.08,y),0.75);
  // ： （  0.42±0.58 → 0.68±0.32）， 
  float scroll=y-uTime*0.75;
  float energy=0.68+0.32*sin(scroll*6.0+uTime*0.8);
  vec3 dark=applyHue(vec3(0.03,0.18,0.06),uHue);
  vec3 bright=applyHue(vec3(0.12,0.62,0.18),uHue);
  float cm=energy*(0.20+0.80*(1.0-pow(y,0.7)));
  vec3 col=mix(dark,bright,clamp(cm,0.0,1.0))*uIntensity;
  //  alpha  40%（  1.0  → 0.60）
  gl_FragColor=vec4(col,clamp(edge*hFade*uAlpha*0.60,0.0,1.0));
}`

// ════════════════════════════════════════════════════════════════════
export class HealAura {
  active = false; timer = 0
  private _hue = 0; private _intensity = 1

  //
  private gFlower: THREE.Mesh; private gFlowerMat: THREE.ShaderMaterial

  //
  private pulseRings: THREE.Mesh[] = []
  private pulseRingMats: THREE.ShaderMaterial[] = []
  private pulseAge = [0, 0.75]
  private readonly PULSE_PERIOD = 1.5

  //
  private grassItems: {
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial
    swayPhase: number; offX: number; offZ: number
    baseRotY: number; origScaleX: number; origScaleY: number; growAge: number
  }[] = []
  private bladeGeo: THREE.BufferGeometry

  //  /
  private colorFlowers: { mesh:THREE.Mesh; mat:THREE.MeshBasicMaterial; offX:number; offZ:number; bobPhase:number; growAge:number }[] = []
  private whiteFlowers: { mesh:THREE.Mesh; mat:THREE.MeshBasicMaterial; offX:number; offZ:number; bobPhase:number; growAge:number }[] = []
  private colorFlowerGeo: THREE.BufferGeometry
  private whiteFlowerGeo: THREE.BufferGeometry

  // （ ）
  private beamGeo: THREE.BufferGeometry
  private pillars: {
    mesh: THREE.Mesh; mat: THREE.ShaderMaterial
    offX: number; offZ: number; height: number
    state: 'idle'|'grow'|'hold'|'fade'; age: number; holdTime: number; nextSpawn: number
  }[] = []

  //  Sprite
  private crossTex: THREE.CanvasTexture
  private crossItems: { sprite:THREE.Sprite; mat:THREE.SpriteMaterial; vy:number; age:number; lifetime:number; active:boolean }[] = []
  private crossTimer = 0

  //
  private ribbonGeo: THREE.BufferGeometry
  private ribbonMat: THREE.ShaderMaterial
  private ribbons: THREE.Mesh[] = []

  //
  private orbs: THREE.Mesh[] = []; private orbMat: THREE.ShaderMaterial

  //  shader
  private shaderMats: THREE.ShaderMaterial[] = []

  private readonly PETAL_COLORS = [
    new THREE.Color(1.00, 0.72, 0.88), new THREE.Color(1.00, 0.98, 0.58),
    new THREE.Color(0.70, 1.00, 0.72), new THREE.Color(0.80, 0.85, 1.00),
    new THREE.Color(1.00, 0.85, 0.62), new THREE.Color(0.92, 1.00, 0.92),
  ]

  constructor(private scene: THREE.Scene, private magicPS: ParticleSystem) {

    // ══════════════════════════════════════════════════════════════
    //  （ ）
    //  depthTest:false →
    // ══════════════════════════════════════════════════════════════
    const runeGeo = new THREE.CircleGeometry(1.0, 128); runeGeo.rotateX(-Math.PI / 2)
    this.gFlowerMat = new THREE.ShaderMaterial({
      uniforms: { uTime:{value:0}, uAlpha:{value:0}, uHue:{value:0}, uIntensity:{value:1} },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `${HUE_ROTATE_GLSL}
        uniform float uTime,uAlpha,uHue,uIntensity;
        varying vec2 vUv;
        void main(){
          vec2 c=vUv-0.5; float dist=length(c); float angle=atan(c.y,c.x);
          if(dist>0.502) discard;
          float n=6.0;
          float pr=0.268+0.128*pow(abs(cos(angle*n*0.5)),0.55);
          float petal=smoothstep(pr+0.035,pr-0.01,dist);
          float ring =smoothstep(pr+0.055,pr+0.01,dist)*smoothstep(pr-0.018,pr+0.022,dist);
          float center=smoothstep(0.072,0.018,dist);
          float rot=angle+uTime*0.38;
          float seg=pow(abs(sin(rot*n*0.5)),7.0)*petal;
          float pulse=0.80+0.20*sin(uTime*3.8);

          // 
          float goldRing=smoothstep(0.502,0.475,dist)*smoothstep(0.440,0.472,dist);
          // →  [0.475, 0.32]
          float toGreen=smoothstep(0.475,0.300,dist);

          vec3 pc=applyHue(vec3(0.22,0.92,0.38),uHue);
          vec3 rc=applyHue(vec3(0.55,1.00,0.65),uHue);
          vec3 cc=applyHue(vec3(1.00,1.00,0.70),uHue);
          vec3 goldCol=vec3(1.0,0.88,0.35)*uIntensity*0.80;
          vec3 greenCol=(pc*(petal*0.42+ring*0.78)+rc*seg*0.35+cc*center*0.92)*uIntensity;

          vec3 col=mix(goldCol, greenCol, toGreen);
          col+=goldCol*goldRing*1.08;

          float a=(petal*0.192+ring*0.448+center*0.56+goldRing*0.576+seg*0.176)*uAlpha*pulse;
          gl_FragColor=vec4(col,clamp(a,0.0,1.0));
        }`,
      transparent:true, blending:THREE.AdditiveBlending,
      depthWrite:false, depthTest:false,   // ← ：
      side:THREE.DoubleSide,
    })
    this.gFlower = new THREE.Mesh(runeGeo, this.gFlowerMat)
    this.gFlower.visible = false; this.gFlower.renderOrder = 9060; scene.add(this.gFlower)

    // ══════════════════════════════════════════════════════════════
    //  （  → ）
    // ══════════════════════════════════════════════════════════════
    for (let i = 0; i < 2; i++) {
      const g = new THREE.RingGeometry(0.02, 0.09, 64); g.rotateX(-Math.PI/2)
      const m = new THREE.ShaderMaterial({
        uniforms: { uProgress:{value:0}, uAlpha:{value:0}, uHue:{value:0}, uIntensity:{value:1} },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `${HUE_ROTATE_GLSL}
          uniform float uProgress,uAlpha,uHue,uIntensity;
          void main(){
            float f=(1.0-uProgress)*(1.0-uProgress);
            vec3 col=mix(vec3(1.0,0.88,0.35), applyHue(vec3(0.33,1.0,0.48),uHue), uProgress)*uIntensity;
            gl_FragColor=vec4(col,f*uAlpha*0.48);
          }`,
        transparent:true, blending:THREE.AdditiveBlending,
        depthWrite:false, depthTest:false, side:THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(g, m)
      mesh.visible=false; mesh.renderOrder=9061; scene.add(mesh)
      this.pulseRings.push(mesh); this.pulseRingMats.push(m)
    }

    // ══════════════════════════════════════════════════════════════
    //
    // ══════════════════════════════════════════════════════════════
    this.bladeGeo = createBladeGeo()
    for (let i = 0; i < 12; i++) {
      const angle=Math.random()*Math.PI*2, r=0.15+Math.random()*0.80
      const scX=0.75+Math.random()*0.55, scY=0.16+Math.random()*0.22
      const mat=new THREE.MeshBasicMaterial({
        color:new THREE.Color(0.12+Math.random()*0.10, 0.55+Math.random()*0.22, 0.10),
        transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false,
      })
      const mesh=new THREE.Mesh(this.bladeGeo, mat)
      mesh.scale.set(scX, 0.001, 1); mesh.visible=false; mesh.renderOrder=9064; scene.add(mesh)
      this.grassItems.push({
        mesh, mat, swayPhase:Math.random()*Math.PI*2,
        offX:Math.cos(angle)*r, offZ:Math.sin(angle)*r,
        baseRotY:Math.random()*Math.PI*2,
        origScaleX:scX, origScaleY:scY, growAge:-(Math.random()*0.9),
      })
    }

    // ══════════════════════════════════════════════════════════════
    //
    // ══════════════════════════════════════════════════════════════
    this.colorFlowerGeo = createFlowerGeo(5, 0.18)   //
    for (let i = 0; i < 6; i++) {
      const angle=(i/6)*Math.PI*2+Math.random()*0.55, r=0.18+Math.random()*0.72
      const mat=new THREE.MeshBasicMaterial({
        color:this.PETAL_COLORS[i%this.PETAL_COLORS.length].clone(),
        transparent:true, opacity:0.0,
        blending:THREE.NormalBlending,     // ，
        side:THREE.DoubleSide, depthWrite:false, depthTest:false,
      })
      const mesh=new THREE.Mesh(this.colorFlowerGeo, mat)
      mesh.rotation.x=-Math.PI/2; mesh.scale.setScalar(0.001)
      mesh.visible=false; mesh.renderOrder=9065; scene.add(mesh)
      this.colorFlowers.push({ mesh, mat, offX:Math.cos(angle)*r, offZ:Math.sin(angle)*r, bobPhase:Math.random()*Math.PI*2, growAge:-(Math.random()*1.3) })
    }

    // ══════════════════════════════════════════════════════════════
    //
    // ══════════════════════════════════════════════════════════════
    this.whiteFlowerGeo = createFlowerGeo(6, 0.13)   //
    for (let i = 0; i < 6; i++) {
      const angle=(i/6)*Math.PI*2+Math.PI/6+Math.random()*0.4, r=0.12+Math.random()*0.65
      const mat=new THREE.MeshBasicMaterial({
        color:new THREE.Color(0.96, 1.0, 0.97),
        transparent:true, opacity:0.0,
        side:THREE.DoubleSide, depthWrite:false, depthTest:false,
      })
      const mesh=new THREE.Mesh(this.whiteFlowerGeo, mat)
      mesh.rotation.x=-Math.PI/2; mesh.scale.setScalar(0.001)
      mesh.visible=false; mesh.renderOrder=9066; scene.add(mesh)
      this.whiteFlowers.push({ mesh, mat, offX:Math.cos(angle)*r, offZ:Math.sin(angle)*r, bobPhase:Math.random()*Math.PI*2, growAge:-(Math.random()*1.0) })
    }

    // ══════════════════════════════════════════════════════════════
    //  （5 ，  →  alpha）
    // ══════════════════════════════════════════════════════════════
    this.beamGeo = createBeamGeo(0.046, 1.0)
    for (let i = 0; i < 5; i++) {
      const angle=Math.random()*Math.PI*2, r=0.15+Math.random()*0.85
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime:{value:0}, uAlpha:{value:0}, uHue:{value:0}, uIntensity:{value:1} },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: BEAM_FRAG,
        transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
      })
      const mesh=new THREE.Mesh(this.beamGeo, mat)
      mesh.scale.set(1,0.001,1); mesh.visible=false; mesh.renderOrder=9063; scene.add(mesh)
      this.pillars.push({
        mesh, mat,
        offX:Math.cos(angle)*r, offZ:Math.sin(angle)*r,
        height:0.80+Math.random()*0.55,
        state:'idle', age:0, holdTime:1.0+Math.random()*0.8,
        nextSpawn: i * 0.55,
      })
    }

    // ══════════════════════════════════════════════════════════════
    //   Sprite （ ， ）
    // ══════════════════════════════════════════════════════════════
    this.crossTex = createCrossSpriteTex()
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.crossTex, blending:THREE.AdditiveBlending,
        transparent:true, opacity:0.0, depthWrite:false,
      })
      mat.depthTest = false
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(0.001); sprite.visible=false; sprite.renderOrder=9068; scene.add(sprite)
      this.crossItems.push({ sprite, mat, vy:0, age:0, lifetime:0, active:false })
    }

    // ══════════════════════════════════════════════════════════════
    //  （2 ，  180° ）
    // ══════════════════════════════════════════════════════════════
    this.ribbonGeo = createRibbonGeo()
    this.ribbonMat = new THREE.ShaderMaterial({
      uniforms: { uTime:{value:0}, uAlpha:{value:0}, uHue:{value:0}, uIntensity:{value:1} },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: RIBBON_FRAG,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(this.ribbonGeo, this.ribbonMat)
      mesh.rotation.y = i * Math.PI   //  180°
      mesh.visible = false; mesh.renderOrder = 9062; scene.add(mesh)
      this.ribbons.push(mesh)
    }

    // ══════════════════════════════════════════════════════════════
    //
    // ══════════════════════════════════════════════════════════════
    this.orbMat = new THREE.ShaderMaterial({
      uniforms: { uTime:{value:0}, uAlpha:{value:0}, uHue:{value:0}, uIntensity:{value:1} },
      vertexShader: `varying vec3 vN,vV;
        void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `${HUE_ROTATE_GLSL}
        uniform float uTime,uAlpha,uHue,uIntensity; varying vec3 vN,vV;
        void main(){
          float f=pow(1.0-max(dot(normalize(vN),normalize(vV)),0.0),2.0);
          vec3 col=mix(applyHue(vec3(0.18,0.78,0.28),uHue)*0.45,applyHue(vec3(0.70,1.00,0.72),uHue),f)*uIntensity;
          col+=vec3(1.0)*pow(f,5.0)*0.30;
          float pulse=0.82+0.18*sin(uTime*4.2);
          gl_FragColor=vec4(col*pulse,mix(0.22,0.52,f)*uAlpha);
        }`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
    })
    const orbGeo = new THREE.SphereGeometry(0.096, 12, 10)
    for (let i = 0; i < 6; i++) {
      const m=new THREE.Mesh(orbGeo, this.orbMat)
      m.visible=false; m.renderOrder=9066; scene.add(m); this.orbs.push(m)
    }

    this.shaderMats = [
      this.gFlowerMat, ...this.pulseRingMats, this.orbMat,
      this.ribbonMat, ...this.pillars.map(p => p.mat),
    ]
  }

  // ── /  ─────────────────────────────────────────────────
  applyColor(hue: number, intensity: number) {
    this._hue = hue; this._intensity = intensity
    for (const m of this.shaderMats) {
      m.uniforms.uHue.value       = hue
      m.uniforms.uIntensity.value = intensity
    }
    const gc = hueToCol(hue)
    for (const g of this.grassItems) g.mat.color.copy(gc)
  }

  setActive(v: boolean) {
    this.active = v
    this.gFlower.visible = v
    this.orbs.forEach(m => { m.visible = v })
    if (!v) {
      this.pulseRings.forEach(m => { m.visible = false })
      this.crossItems.forEach(p => { p.sprite.visible = false; p.active = false })
      this.pillars.forEach(p => { p.mesh.visible = false; p.state = 'idle'; p.age = 0 })
      this.ribbons.forEach(m => { m.visible = false })
      this.grassItems.forEach(g => { g.mesh.visible = false; g.growAge = -(Math.random()*0.9) })
      this.colorFlowers.forEach(f => { f.mesh.visible = false; f.mat.opacity = 0; f.growAge = -(Math.random()*1.3) })
      this.whiteFlowers.forEach(f => { f.mesh.visible = false; f.mat.opacity = 0; f.growAge = -(Math.random()*1.0) })
      this.gFlowerMat.uniforms.uAlpha.value = 0
      this.orbMat.uniforms.uAlpha.value     = 0
      this.crossTimer = 0; this.timer = 0
    }
  }

  update(dt: number, targetPos: THREE.Vector3, radius = 1.2, speed = 1.5) {
    if (!this.active) return
    const dtSec = dt * 0.001
    this.timer += dtSec
    const t = this.timer, now = performance.now() * 0.001
    const fadeIn = Math.min(t / 0.75, 1.0)
    const R = radius

    // ──  ────────────────────────────────────────────
    this.gFlowerMat.uniforms.uTime.value  = now
    this.gFlowerMat.uniforms.uAlpha.value = fadeIn
    this.gFlower.position.set(targetPos.x, targetPos.y + 0.02, targetPos.z)
    this.gFlower.scale.setScalar(R)
    this.gFlower.rotation.y = t * 0.24

    // ──  ──────────────────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      this.pulseAge[i] += dtSec
      if (this.pulseAge[i] >= this.PULSE_PERIOD) this.pulseAge[i] = 0
      const prog = this.pulseAge[i] / this.PULSE_PERIOD
      this.pulseRings[i].position.set(targetPos.x, targetPos.y + 0.025, targetPos.z)
      this.pulseRings[i].scale.setScalar(R * (0.20 + prog * 2.15))
      this.pulseRings[i].visible = true
      this.pulseRingMats[i].uniforms.uProgress.value = prog
      this.pulseRingMats[i].uniforms.uAlpha.value    = fadeIn
    }

    // ──  ────────────────────────────────────────────────────
    for (const g of this.grassItems) {
      g.growAge += dtSec
      if (g.growAge < 0) continue
      const grow = Math.min(g.growAge / 0.65, 1.0)
      g.mesh.visible = true
      g.mesh.position.set(targetPos.x + g.offX*(R/1.2), targetPos.y+0.01, targetPos.z + g.offZ*(R/1.2))
      g.mesh.rotation.y = g.baseRotY
      g.mesh.rotation.z = Math.sin(t * 1.9 + g.swayPhase) * 0.095 * grow
      g.mesh.scale.set(g.origScaleX, g.origScaleY * grow, 1)
      g.mat.opacity = Math.min(grow * fadeIn * 0.70, 0.70)
    }

    // ──  ────────────────────────────────────────────────
    for (const f of this.colorFlowers) {
      f.growAge += dtSec
      if (f.growAge < 0) continue
      const bloom = Math.min(f.growAge / 0.52, 1.0)
      const bob   = Math.sin(t * 1.15 + f.bobPhase) * 0.024
      f.mesh.visible = true
      f.mesh.position.set(targetPos.x + f.offX*(R/1.2), targetPos.y+0.03+bob, targetPos.z + f.offZ*(R/1.2))
      f.mesh.scale.setScalar(Math.max(bloom, 0.001))
      f.mat.opacity = bloom * 0.532 * fadeIn
    }

    // ──  ────────────────────────────────────────────────
    for (const f of this.whiteFlowers) {
      f.growAge += dtSec
      if (f.growAge < 0) continue
      const bloom = Math.min(f.growAge / 0.45, 1.0)
      const bob   = Math.sin(t * 1.35 + f.bobPhase) * 0.020
      f.mesh.visible = true
      f.mesh.position.set(targetPos.x + f.offX*(R/1.2), targetPos.y+0.03+bob, targetPos.z + f.offZ*(R/1.2))
      f.mesh.scale.setScalar(Math.max(bloom, 0.001))
      f.mat.opacity = bloom * 0.538 * fadeIn
    }

    // ──  ────────────────────────────────────────────────
    for (const p of this.pillars) {
      p.mat.uniforms.uTime.value = now
      p.nextSpawn -= dtSec
      if (p.state === 'idle') {
        if (p.nextSpawn <= 0) {
          const ang = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * R * 0.85
          p.offX = Math.cos(ang) * r; p.offZ = Math.sin(ang) * r
          p.height = 0.80 + Math.random() * 0.55
          p.state = 'grow'; p.age = 0
        }
        continue
      }
      p.age += dtSec
      p.mesh.visible = true
      p.mesh.position.set(targetPos.x + p.offX, targetPos.y + 0.01, targetPos.z + p.offZ)
      if (p.state === 'grow') {
        const grow = Math.min(p.age / 0.38, 1.0)
        p.mesh.scale.set(1, p.height * Math.max(grow, 0.001), 1)
        p.mat.uniforms.uAlpha.value = grow * fadeIn
        if (p.age >= 0.38) { p.state = 'hold'; p.age = 0 }
      } else if (p.state === 'hold') {
        p.mesh.scale.set(1, p.height, 1)
        p.mat.uniforms.uAlpha.value = fadeIn
        if (p.age >= p.holdTime) { p.state = 'fade'; p.age = 0 }
      } else if (p.state === 'fade') {
        const fv = 1.0 - Math.min(p.age / 0.38, 1.0)
        p.mat.uniforms.uAlpha.value = fv * fadeIn
        if (p.age >= 0.38) {
          p.mesh.visible = false; p.state = 'idle'
          p.nextSpawn = 0.25 + Math.random() * 0.75
        }
      }
    }

    // ──  Sprite ──────────────────────────────────────────────
    this.crossTimer += dtSec
    if (this.crossTimer > 0.20) {
      this.crossTimer = 0
      const slot = this.crossItems.find(x => !x.active)
      if (slot) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * R * 0.88
        slot.sprite.position.set(targetPos.x + Math.cos(ang)*r, targetPos.y + 0.08, targetPos.z + Math.sin(ang)*r)
        slot.sprite.scale.setScalar(0.20 + Math.random() * 0.18)
        slot.vy = 0.55 + Math.random() * 0.95
        slot.age = 0; slot.lifetime = 0.80 + Math.random() * 0.80
        slot.active = true; slot.sprite.visible = true; slot.mat.opacity = 0
      }
    }
    for (const p of this.crossItems) {
      if (!p.active) continue
      p.age += dtSec; p.sprite.position.y += p.vy * dtSec
      p.mat.opacity = Math.sin(Math.PI * Math.min(p.age / p.lifetime, 1.0)) * fadeIn
      if (p.age >= p.lifetime) { p.active = false; p.sprite.visible = false }
    }

    // ──  ────────────────────────────────────────────────
    this.ribbonMat.uniforms.uTime.value  = now
    this.ribbonMat.uniforms.uAlpha.value = fadeIn
    for (let i = 0; i < this.ribbons.length; i++) {
      this.ribbons[i].visible = true
      this.ribbons[i].position.set(targetPos.x, targetPos.y, targetPos.z)
      //  Y ，
      this.ribbons[i].rotation.y = i * Math.PI + t * speed * 0.60
    }

    // ──  ────────────────────────────────────────────────
    this.orbMat.uniforms.uTime.value = now; this.orbMat.uniforms.uAlpha.value = fadeIn
    for (let i = 0; i < this.orbs.length; i++) {
      const a = (i/6)*Math.PI*2 + t*speed*0.55, bob = Math.sin(t*2.0+i*1.05)*0.18
      this.orbs[i].position.set(targetPos.x+Math.cos(a)*R, targetPos.y+0.45+bob, targetPos.z+Math.sin(a)*R)
    }

    // ──  ────────────────────────────────────────────────
    if (Math.floor(t*10) !== Math.floor((t-dtSec)*10)) {
      const ang=Math.random()*Math.PI*2, r=0.15+Math.random()*R*0.92
      this.magicPS.emit({
        position: new THREE.Vector3(targetPos.x+Math.cos(ang)*r, targetPos.y+0.05, targetPos.z+Math.sin(ang)*r),
        count:1, speed:[0.28,1.1], lifetime:[800,2200], size:[0.05,0.16],
        colorFrom: hueToCol(this._hue).multiplyScalar(this._intensity),
        colorTo:   hueToCol(this._hue).multiplyScalar(0.25),
        direction: new THREE.Vector3(0,1,0), spread:0.6,
      })
    }
    if (Math.random() < 0.055) {
      const ang=Math.random()*Math.PI*2
      this.magicPS.emit({
        position: new THREE.Vector3(targetPos.x+Math.cos(ang)*R*0.82, targetPos.y+Math.random()*0.9, targetPos.z+Math.sin(ang)*R*0.82),
        count:1, speed:[0.4,1.3], lifetime:[500,950], size:[0.10,0.26],
        colorFrom: new THREE.Color(0.85,1.0,0.85),
        colorTo:   hueToCol(this._hue).multiplyScalar(0.4),
        spread:1.4,
      })
    }
  }

  /**
   * （overlayScene） ：
   * 、 、 、 。
   * ， 。
   */
  getForegroundObjects(): THREE.Object3D[] {
    const result: THREE.Object3D[] = [
      ...this.pillars.map(p => p.mesh),
      ...this.orbs,
      ...this.ribbons,
      ...this.crossItems.map(c => c.sprite),
    ]
    return result
  }

  /** （0–1），  sprite  */
  getPulse(): number {
    return 0.5 + 0.5 * Math.sin(this.timer * 2.5)
  }

  dispose() {
    const meshes = [
      this.gFlower, ...this.pulseRings, ...this.orbs,
      ...this.grassItems.map(g => g.mesh),
      ...this.colorFlowers.map(f => f.mesh),
      ...this.whiteFlowers.map(f => f.mesh),
      ...this.pillars.map(p => p.mesh),
    ]
    for (const m of meshes) this.scene.remove(m)
    this.crossItems.forEach(p => { this.scene.remove(p.sprite); p.mat.dispose() })
    this.ribbons.forEach(m => this.scene.remove(m))
    this.bladeGeo.dispose(); this.colorFlowerGeo.dispose()
    this.whiteFlowerGeo.dispose(); this.beamGeo.dispose()
    this.ribbonGeo.dispose(); this.ribbonMat.dispose()
    ;(this.gFlower.geometry as THREE.BufferGeometry).dispose()
    for (const m of this.shaderMats) m.dispose()
    this.grassItems.forEach(g => g.mat.dispose())
    this.colorFlowers.forEach(f => f.mat.dispose())
    this.whiteFlowers.forEach(f => f.mat.dispose())
    this.crossTex.dispose()
  }
}
