// @source wb-character/src/vfx/templates/VFXTemplates.ts
/**
 * VFX  (Route B)
 *
 * ， ：
 *   - （ ， ）
 *   - （  primaryColor ）
 *   - （ ）
 *   - 
 *
 * ：
 *   FireImpact   — / （ ）
 *   ArcaneStrike — / 
 *   FrostSlam    — / 
 */

import * as THREE from 'three'

// ──  ──────────────────────────────────────────────────────────────

export interface TemplateParams {
  primaryColor:   [number, number, number]  // ，RGB 0-1
  secondaryColor: [number, number, number]  // ， /
  scale:          number                    // ，0.5-3.0
  duration:       number                    // ，0.5-2.0
  intensity:      number                    // ，0.5-2.0
  crackCount?:    number                    // ，4-14
  particleCount?: number                    // ，8-48
}

export interface ITemplate {
  update(dt: number, camera?: THREE.Camera): void
  isAlive(): boolean
  dispose(): void
}

// ：billboard ， （Y ）
// ： ，  =
// quaternion.copy （ ），
//  Y  → " "
const _camDir = new THREE.Vector3()
function alignToCamera(mesh: THREE.Mesh, camera: THREE.Camera) {
  camera.getWorldDirection(_camDir)
  _camDir.y = 0
  if (_camDir.lengthSq() < 0.0001) _camDir.set(0, 0, -1)
  _camDir.normalize()
  //  Y ： ，
  mesh.rotation.set(0, Math.atan2(-_camDir.x, -_camDir.z), 0)
}

// ──  shader  ──────────────────────────────────────────────────────

const uvVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

function fbmGlsl() {
  return `
    float _h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5);}
    float _n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(_h(i),_h(i+vec3(1,0,0)),f.x),mix(_h(i+vec3(0,1,0)),_h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(_h(i+vec3(0,0,1)),_h(i+vec3(1,0,1)),f.x),mix(_h(i+vec3(0,1,1)),_h(i+vec3(1,1,1)),f.x),f.y),f.z);}
    float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*_n3(p);p*=2.2;a*=.5;}return v;}
    float _h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
    float _n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(_h2(i),_h2(i+vec2(1,0)),f.x),mix(_h2(i+vec2(0,1)),_h2(i+vec2(1,1)),f.x),f.y);}
    float fbm2(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*_n2(p);p*=2.;a*=.5;}return v;}`
}

// ：  shader（  THREE.Points， ）
// spark  ： （ ）
// bubble ：
// star   ： ， / /
function scatterFrag(n: number, bubble = false, star = false): string {
  if (star) return `
    uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
    float _sh(float n){return fract(sin(n*127.1)*43758.5);}
    float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
    void main(){
      vec2 uv=vUv*2.-1.; float T=uT;
      float tot=0.; float hot=0.;
      for(int i=0;i<${n};i++){
        float fi=float(i);
        // （sqrt ）
        float a=_sh(fi*1.1)*6.28318;
        float r=sqrt(_sh(fi*3.7))*.88;
        vec2 pos=vec2(cos(a),sin(a))*r;
        // （ = ， = ）
        float sz=.007+_sh2(fi*7.3)*.028;
        // 
        float phase=_sh(fi*13.)*6.28318;
        float speed=1.2+_sh2(fi*5.)*2.8;
        float twinkle=sin(T*speed+phase)*.42+.58;
        // ：  +  Gaussian，max 
        vec2 d=uv-pos;
        float arm=sz*5.;  // 
        float hLine=exp(-d.y*d.y/(sz*sz*.08))*exp(-d.x*d.x/(arm*arm));
        float vLine=exp(-d.x*d.x/(sz*sz*.08))*exp(-d.y*d.y/(arm*arm));
        float starShape=max(hLine,vLine);
        // 
        float core=exp(-(d.x*d.x+d.y*d.y)/(sz*sz*.4))*.6;
        float life=smoothstep(0.,.22,uP)*(1.-smoothstep(.72,1.,uP));
        float v=(starShape+core)*twinkle*life;
        tot+=v; hot+=core*twinkle*life;
      }
      float alpha=clamp(tot,0.,1.)*uItx; if(alpha<.005)discard;
      // ， 
      vec3 col=mix(uC1*2.2,vec3(2.0,2.0,2.8),clamp(hot*3.,0.,1.));
      gl_FragColor=vec4(col,alpha);}` // star variant
  if (bubble) return `
    uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
    float _sh(float n){return fract(sin(n*127.1)*43758.5);}
    float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
    void main(){
      vec2 uv=vUv*2.-1.; float T=uT;
      float tot=0.;
      for(int i=0;i<${n};i++){
        float fi=float(i);
        float a=_sh(fi*1.1)*6.28318;
        float r=.06+_sh(fi*3.7)*.78;
        vec2 pos=vec2(cos(a),sin(a))*r;
        // 、  → 
        float sz=.025+_sh2(fi*7.3)*.045;
        float phase=_sh(fi*13.)*6.28318;
        float speed=2.5+_sh2(fi*5.)*.3;
        float pulse=sin(T*speed+phase)*.45+.55;
        // 
        float drift=_sh2(fi*9.)*6.28318;
        vec2 dv=vec2(cos(drift),sin(drift))*_sh2(fi*17.)*.04;
        float d=length(uv-pos-dv);
        // 、  → 
        float blob=exp(-d*d/(sz*sz))*(1.-smoothstep(sz*.6,sz*1.4,d));
        tot+=blob*pulse*(1.-uP*.9);
      }
      float alpha=clamp(tot,0.,1.)*uItx*.7; if(alpha<.005)discard;
      gl_FragColor=vec4(mix(uC2,uC1*1.9,clamp(tot*1.5,0.,1.)),alpha);}` // bubble variant
  return `
    uniform float uP,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
    float _sh(float n){return fract(sin(n*127.1)*43758.5);}
    float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
    void main(){
      vec2 uv=vUv*2.-1.;
      float tot=0.; float hot=0.;
      for(int i=0;i<${n};i++){
        float fi=float(i);
        float a=_sh(fi*1.1)*6.28318;
        float spd=.09+_sh(fi*3.7)*.68;
        float delay=_sh(fi*11.)*.2;
        float t=clamp((uP-delay)/max(1.-delay,.01),0.,1.);
        // ： （ ）
        float tE=t*t*(3.-2.*t);
        vec2 dir=vec2(cos(a),sin(a));
        vec2 pos=dir*spd*tE;
        // ： ， 
        vec2 dv=uv-pos;
        float along=dot(dv,dir);   // （ = = ）
        float perp=length(dv-along*dir);   // 
        float wid=.006+_sh2(fi*7.)*.008;   // （ ）
        float tailL=spd*tE*.55+.018;       // 
        float cross=exp(-perp*perp/(wid*wid));
        float tail=exp(-pow(max(-along,0.),.65)/(tailL*tailL));  // 
        float head=smoothstep(-.006,.0,-along);  // 
        float spark=cross*tail*head;
        float life=1.-smoothstep(.42,.97,t);
        float freshness=1.-t*.75;  // 
        tot+=spark*life;
        hot+=spark*life*freshness;
      }
      float alpha=clamp(tot,0.,1.)*(1.-uP*.78)*uItx; if(alpha<.005)discard;
      // ： / ， 
      float heatRatio=clamp(hot/max(tot,.001),0.,1.);
      vec3 col=mix(uC2,uC1*2.8,heatRatio);
      gl_FragColor=vec4(col,alpha);}`
}



// ══════════════════════════════════════════════════════════════════════════════
//  ：FireImpact   /
//  ：[0ms] +  → [50ms]  → [100ms]  → [200ms]
// ══════════════════════════════════════════════════════════════════════════════

export class FireImpact implements ITemplate {
  private meshes:  THREE.Mesh[]  = []
  private mats:    THREE.ShaderMaterial[] = []
  private t = 0;  private alive = true
  private readonly dur: number
  private readonly sc: number
  private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 1.5
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1

    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const cDim = c1.clone().multiplyScalar(0.4)
    const T = performance.now() * .001

    // ── （ ， / ）────────────────────
    const explMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv); float T=uT;
          //  FBM ， 
          float a1=atan(uv.y,uv.x);
          float n1=fbm2(vec2(dist*3.+T*.9, a1*1.4-T*.7));
          float n2=fbm2(vec2(dist*6.-T*.6, a1*2.3+T*1.1));
          float n3=fbm2(vec2(uv.x*4.+T*.3, uv.y*4.-T*.4));
          float nv=n1*.5+n2*.3+n3*.2;
          // 
          float front=uP*.92;
          float bloom=smoothstep(front+nv*.22,front-nv*.14,dist);
          float late=smoothstep(.25,.88,uP);
          // ：  →  →  → （ ）
          float heat=clamp(1.-dist/max(front,.01),0.,1.);  // 
          float coreGlow=exp(-dist*dist*5.)*(1.-uP*1.15);
          // ：
          //   0= /   0.3=   0.6= (1.8x)  1.0= (3.5x)
          float fi=clamp(nv*.6+heat*.7+coreGlow*.5,0.,1.);
          vec3 col;
          if(fi<.3)      col=mix(uC2*.6, uC2,          fi/.3);
          else if(fi<.6) col=mix(uC2,    uC1,          (fi-.3)/.3);
          else if(fi<.85)col=mix(uC1,    uC1*2.2,      (fi-.6)/.25);
          else           col=mix(uC1*2.2,vec3(2.8,2.5,1.8),(fi-.85)/.15); // 
          //  late 
          float alpha=bloom*(1.-uP*.92)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(col*mix(1.4,.08,late),alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const explMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1), explMat)
    explMesh.rotation.x = -Math.PI/2
    explMesh.position.set(pos.x, pos.y+.14, pos.z)
    explMesh.renderOrder = 8; scene.add(explMesh)
    this.meshes.push(explMesh); this.mats.push(explMat)

    // ── （  + ， ）────────────────────────────
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uItx; uniform vec3 uC; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.-1.; float d=length(c);
          // ： ， 
          float ring1=exp(-pow(d-uP,2.)*90.)*(1.-uP);
          // ： 、 ， 
          float ring2=exp(-pow(d-(uP*.82),2.)*160.)*(1.-uP)*.28;
          float alpha=(ring1+ring2)*smoothstep(1.,.8,d)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(uC*(1.7+ring1*.8),alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), ringMat)
    ringMesh.rotation.x = -Math.PI/2
    ringMesh.position.set(pos.x, pos.y+.02, pos.z)
    ringMesh.scale.setScalar(8 * this.sc)   // ，  uP  UV
    ringMesh.renderOrder = 5; scene.add(ringMesh)
    this.meshes.push(ringMesh); this.mats.push(ringMat)

    // ──  ─────────────────────────────────────────────────────────────────
    const cc = p.crackCount ?? 8
    const crackMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uDim:{value:cDim}, uCC:{value:cc}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uCC,uItx; uniform vec3 uC,uDim; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv);
          float cLen=.90*uP; float cracks=0.;
          for(int i=0;i<14;i++){
            if(float(i)>=uCC)break;
            float fi=float(i);
            float a=fi*(6.2832/uCC)+_h2(vec2(fi,0.))*.85;
            vec2 dir=vec2(cos(a),sin(a)),perp=vec2(-dir.y,dir.x);
            float len=dot(uv,dir);
            if(len>0.&&len<cLen){
              float t=len/max(cLen,.001);
              //  — 
              float kt1=.20+_h2(vec2(fi,8.))*.14, kd1=(_h2(vec2(fi,10.))-.5)*1.1;
              float kt2=.44+_h2(vec2(fi,9.))*.15, kd2=(_h2(vec2(fi,11.))-.5)*.85;
              float kt3=.66+_h2(vec2(fi,12.))*.12, kd3=(_h2(vec2(fi,13.))-.5)*.60;
              float kb=0.;
              if(t>kt1)kb+=(t-kt1)*kd1*cLen*.52;
              if(t>kt2)kb+=(t-kt2)*kd2*cLen*.40;
              if(t>kt3)kb+=(t-kt3)*kd3*cLen*.28;
              //  FBM （ ）
              kb+=(_n2(vec2(len*8.+a,1.4))*2.-1.)*.042;
              kb+=(_n2(vec2(len*17.+a,3.7))*2.-1.)*.016;
              float d=abs(dot(uv,perp)-kb);
              float w=.010+_h2(vec2(a,len*2.))*.009+len*.003;
              cracks+=smoothstep(w,0.,d)*(1.-t*.25);
              // （  kt1 ）
              if(t>kt1+.06){
                float ba=a+(_h2(vec2(a,4.))-.5)*1.3;
                vec2 bd=vec2(cos(ba),sin(ba));
                float blen=dot(uv-dir*cLen*kt1,bd);
                if(blen>0.&&blen<cLen*.30){
                  float bt=blen/max(cLen*.30,.001);
                  float bb=(_h2(vec2(ba,5.))-.5)*.35*max(bt-.25,0.);
                  float bd2=abs(dot(uv-dir*cLen*kt1,vec2(-bd.y,bd.x))-bb);
                  cracks+=smoothstep(.007,0.,bd2)*(1.-bt)*.6;
                }
              }
              // （  kt2 ）
              if(t>kt2+.05){
                float ba2=a+(_h2(vec2(a,14.))-.5)*1.5;
                vec2 bd2v=vec2(cos(ba2),sin(ba2));
                float blen2=dot(uv-dir*cLen*kt2,bd2v);
                if(blen2>0.&&blen2<cLen*.20){
                  float bt2=blen2/max(cLen*.20,.001);
                  float bd3=abs(dot(uv-dir*cLen*kt2,vec2(-bd2v.y,bd2v.x)));
                  cracks+=smoothstep(.006,0.,bd3)*(1.-bt2)*.40;
                }
              }
            }
          }
          float crater=smoothstep(.28*uP,.08*uP,dist);
          float fade=1.-smoothstep(.55,1.,uP);
          vec3 col=mix(uDim,uC,cracks);
          float alpha=(cracks*.88+crater*.32)*(1.-dist*.35)*fade*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(col*2.,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const crR = 3.2 * this.sc
    const crackMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), crackMat)
    crackMesh.rotation.x = -Math.PI/2
    crackMesh.position.set(pos.x, pos.y+.10, pos.z)
    crackMesh.scale.set(crR*2, crR*2, 1)
    crackMesh.renderOrder = 4; scene.add(crackMesh)
    this.meshes.push(crackMesh); this.mats.push(crackMat)


    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 3.2
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(16, false),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.12, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera) {
    this.t += dt
    const T = performance.now() * .001
    const s = this.sc; const d = this.dur

    // （ ）：delay 0.05s，  d*0.5
    const exP = Math.min(Math.max((this.t - .05) / (d * .5), 0), 1)
    this.mats[0].uniforms.uP.value = exP
    this.mats[0].uniforms.uT.value = T
    this.meshes[0].scale.setScalar(1 + exP * (2.8*s - 1))

    // ：delay 0，  d*0.28（  scale，uP ）
    const rgP = Math.min(this.t / (d * .28), 1)
    this.mats[1].uniforms.uP.value = rgP

    // ：delay 0.15s，  d*0.6
    const crP = Math.min(Math.max((this.t - .15) / (d * .6), 0), 1)
    this.mats[2].uniforms.uP.value = crP
    this.mats[2].uniforms.uT.value = T


    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = Math.min(Math.max((this.t - .05) / (this.dur * .55), 0), 1)
    this.mats[this.mats.length-1].uniforms.uT.value = T

    if (this.t > this.dur + .3) this.alive = false
  }

  isAlive() { return this.alive }
  dispose() {
    this.meshes.forEach(m => { this.scene.remove(m); m.geometry.dispose() })
    this.mats.forEach(m => m.dispose())
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ：ArcaneStrike   /
//  ：[0ms]  → [80ms]  → [200ms]  → [300ms]
// ══════════════════════════════════════════════════════════════════════════════

export class ArcaneStrike implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 1.8
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1

    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    // ── （ ， ）──────────────────────────
    const flashMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv);
          float T=uT;
          // 
          float angle=atan(uv.y,uv.x);
          float spin=fbm2(vec2(dist*4.+T*.5, angle*2.+T*.8));
          float core=exp(-dist*dist*6.)*(1.-uP*1.2);
          float ripple=exp(-pow(dist-.3*uP,2.)*15.)*(1.-uP*.8);
          float rune=spin*(1.-dist)*(1.-uP*1.1);
          float alpha=(core*.9+ripple*.7+rune*.5)*(1.-smoothstep(.0,.9,uP))*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(uC*2.5,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const flashM = new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1), flashMat)
    flashM.rotation.x = -Math.PI/2
    flashM.position.set(pos.x, pos.y+.1, pos.z)
    flashM.scale.setScalar(this.sc * 2.0)
    flashM.renderOrder = 12; scene.add(flashM)
    this.meshes.push(flashM); this.mats.push(flashMat)

    // ── 3 （ ）─────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      const delay = i * .12
      const maxR  = (4 + i * 2.5) * this.sc
      const rMat = new THREE.ShaderMaterial({
        uniforms: { uP:{value:0}, uC:{value:i===0?c1:c2}, uItx:{value:this.itx*(.9-i*.15)}, uDelay:{value:delay} },
        vertexShader: uvVert,
        fragmentShader: `
          uniform float uP,uItx; uniform vec3 uC; varying vec2 vUv;
          void main(){
            vec2 c=vUv*2.-1.; float d=length(c);
            float ring=exp(-pow(d-uP,2.)*80.)*(1.-uP);
            float alpha=ring*.85*uItx;
            if(alpha<.005)discard;
            gl_FragColor=vec4(uC*1.8,alpha);}`,
        transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
      })
      const rMesh = new THREE.Mesh(new THREE.CircleGeometry(1,64), rMat)
      rMesh.rotation.x = -Math.PI/2
      rMesh.position.set(pos.x, pos.y+.06, pos.z)
      rMesh.renderOrder = 5+i; scene.add(rMesh)
      this.meshes.push(rMesh); this.mats.push(rMat)
      ;(rMat as any)._maxR = maxR; (rMat as any)._delay = delay
    }

    // ──  ─────────────────────────────────────────────────────────────
    const runeMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC,uC2; varying vec2 vUv;
        #define PI 3.14159
        void main(){
          vec2 c=vUv-0.5; float r=length(c)*2.; float a=atan(c.y,c.x);
          float ring=exp(-pow(r-.88,2.)*220.);
          float ring2=exp(-pow(r-.58,2.)*320.);
          float seg=12.; float ra=mod(a+uT*1.1,PI*2./seg);
          float rune=smoothstep(.02,.05,ra)*(1.-smoothstep(.08,.11,ra));
          rune*=smoothstep(.80,.84,r)*(1.-smoothstep(.90,.93,r));
          float sa=mod(a+PI/6.,PI/3.)-PI/6.; float sd=r/cos(sa)*.5;
          float star=smoothstep(.24,.26,sd)*(1.-smoothstep(.26,.29,sd)); star*=step(r,.58);
          float fadeIn=smoothstep(0.,.15,uP); float fadeOut=1.-smoothstep(.6,1.,uP);
          float body=(ring+ring2*.5+rune*.8+star)*fadeIn*fadeOut*uItx;
          if(body<.005)discard;
          gl_FragColor=vec4(mix(uC2,uC,ring+star),body);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const runeR = 3.5 * this.sc
    const runeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), runeMat)
    runeMesh.rotation.x = -Math.PI/2
    runeMesh.position.set(pos.x, pos.y+.08, pos.z)
    runeMesh.scale.set(runeR*2, runeR*2, 1)
    runeMesh.renderOrder = 4; scene.add(runeMesh)
    this.meshes.push(runeMesh); this.mats.push(runeMat)


    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 3.0
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(16, false),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.12, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera) {
    this.t += dt
    const T = performance.now() * .001

    // （ ）
    this.mats[0].uniforms.uP.value = this.t
    this.mats[0].uniforms.uT.value = T

    // 3 （index 1,2,3），
    for (let i = 0; i < 3; i++) {
      const m = this.mats[1+i]; const delay = (m as any)._delay ?? 0; const maxR = (m as any)._maxR ?? 8
      const p = Math.min(Math.max((this.t - delay) / (this.dur * .45), 0), 1)
      m.uniforms.uP.value = p
      this.meshes[1+i].scale.setScalar(1 + p * (maxR - 1))
    }

    // （index 4）
    const runeP = Math.min(Math.max((this.t - .18) / (this.dur * .7), 0), 1)
    this.mats[4].uniforms.uP.value = runeP
    this.mats[4].uniforms.uT.value = T


    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = Math.min(Math.max((this.t - .1) / (this.dur * .45), 0), 1)
    this.mats[this.mats.length-1].uniforms.uT.value = T

    if(this.t > this.dur+.3) this.alive=false
  }

  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()})
    this.mats.forEach(m=>m.dispose())
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ：FrostSlam   /
//  ：[0ms]  → [60ms]  → [150ms]  → [250ms]
// ══════════════════════════════════════════════════════════════════════════════

export class FrostSlam implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 2.0
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1

    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    // ── （ ： 、 ， ）───────────────────────
    const cc = p.crackCount ?? 10
    const frostMat = new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uT:{value:T},uC1:{value:c1},uC2:{value:c2},uCC:{value:cc},uItx:{value:this.itx}},
      vertexShader: uvVert,
      fragmentShader:`
        uniform float uP,uT,uCC,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv);
          float cLen=.92*uP; float cracks=0.;
          for(int i=0;i<14;i++){
            if(float(i)>=uCC)break;
            float fi=float(i);
            float a=fi*(6.2832/uCC)+_h2(vec2(fi,1.))*.5;
            vec2 dir=vec2(cos(a),sin(a)),perp=vec2(-dir.y,dir.x);
            float len=dot(uv,dir);
            if(len>0.&&len<cLen){
              float t=len/max(cLen,.001);
              float kb=0.;
              float kt1=.28+_h2(vec2(fi,8.))*.18; float kd1=(_h2(vec2(fi,10.))-.5)*.5;
              float kt2=.56+_h2(vec2(fi,9.))*.18; float kd2=(_h2(vec2(fi,11.))-.5)*.35;
              if(t>kt1)kb+=(t-kt1)*kd1*cLen*.55;
              if(t>kt2)kb+=(t-kt2)*kd2*cLen*.38;
              kb+=(_n2(vec2(len*9.+a,2.1))*2.-1.)*.012;
              float d=abs(dot(uv,perp)-kb);
              float w=.008+_h2(vec2(a,len*2.))*.006+len*.002;
              float strength=smoothstep(w,0.,d)*(1.-t*.22);
              cracks+=strength;
              // 
              if(t>kt1+.04&&cracks>0.){
                float ba=a+(_h2(vec2(a,4.))-.5)*.9;
                vec2 bd=vec2(cos(ba),sin(ba));
                float blen=dot(uv-dir*cLen*kt1,bd);
                if(blen>0.&&blen<cLen*.22){
                  float bt=blen/max(cLen*.22,.001);
                  float bb=bt>0.4?(_h2(vec2(ba,5.))-.5)*.3*(bt-.4):0.;
                  float bd2=abs(dot(uv-dir*cLen*kt1,vec2(-bd.y,bd.x))-bb);
                  cracks+=smoothstep(.006,0.,bd2)*(1.-bt)*.5;
                }
              }
            }
          }
          float frost=fbm2(uv*4.+uT*.05)*smoothstep(.95*uP,0.,dist)*.3;
          float ice=smoothstep(.22*uP,.06*uP,dist);
          float fadeOut=1.-smoothstep(.5,1.,uP);
          vec3 col=mix(uC2,uC1,cracks+frost);
          float alpha=(cracks*.9+frost*.4+ice*.2)*(1.-dist*.3)*fadeOut*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(col*1.8,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const fR = 3.8 * this.sc
    const frostMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), frostMat)
    frostMesh.rotation.x=-Math.PI/2; frostMesh.position.set(pos.x,pos.y+.10,pos.z)
    frostMesh.scale.set(fR*2, fR*2, 1); frostMesh.renderOrder=4
    scene.add(frostMesh); this.meshes.push(frostMesh); this.mats.push(frostMat)

    // ── （ ， ）────────────────────────────────
    const mistMat = new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uT:{value:T},uC1:{value:c1},uC2:{value:c2},uItx:{value:this.itx}},
      vertexShader: uvVert,
      fragmentShader:`
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2;
        varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv);
          float T=uT;
          // ：  + 
          float angle=atan(uv.y,uv.x);
          float nv=fbm2(vec2(dist*5.+angle*1.3, angle*2.-T*.2))*.6
                  +fbm2(vec2(uv.x*4.+T*.1, uv.y*4.-T*.1))*.4;
          float spread=smoothstep(uP+.02, uP-.15, dist+nv*.18);
          float edge=exp(-pow(dist-uP*.95,2.)*30.)*(1.-uP*.7);
          float core=exp(-dist*dist*3.)*(1.-uP*1.4);
          vec3 col=mix(uC2,uC1,nv+edge*.5);
          float alpha=(spread*.5+edge*.8+core*.4)*(1.-uP*.9)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(col*(1.+edge*.5),alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const mistMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1), mistMat)
    mistMesh.rotation.x=-Math.PI/2
    mistMesh.position.set(pos.x,pos.y+.1,pos.z)
    mistMesh.renderOrder=10; scene.add(mistMesh); this.meshes.push(mistMesh); this.mats.push(mistMat)

    // ──  ───────────────────────────────────────────────────────────────
    const ringMat = new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uC:{value:c1},uItx:{value:this.itx}},
      vertexShader:uvVert,
      fragmentShader:`
        uniform float uP,uItx; uniform vec3 uC; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.-1.; float d=length(c);
          float ring=exp(-pow(d-uP,2.)*80.)*(1.-uP)*.8;
          float alpha=ring*uItx; if(alpha<.005)discard;
          gl_FragColor=vec4(uC*1.4,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const ringMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),ringMat)
    ringMesh.rotation.x=-Math.PI/2; ringMesh.position.set(pos.x,pos.y+.02,pos.z)
    ringMesh.scale.setScalar(9*this.sc)  //  scale，uP
    ringMesh.renderOrder=5; scene.add(ringMesh); this.meshes.push(ringMesh); this.mats.push(ringMat)

    // ──  billboard（camera-aligned， ）────────────────────────
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float dist=length(uv);
          float T=uT;
          // ：  + 
          float strips=fbm2(vec2(uv.x*6.+T*.05, uv.y*2.-T*.1));
          float facets=abs(sin(uv.x*8.))*abs(cos(uv.y*3.));
          // 
          float outline=exp(-pow(dist-.4,2.)*18.)*(1.-uP*.8);
          // ： ， ， 
          float melt=uP*.9;
          float body=smoothstep(melt+.08, melt-.05, abs(uv.x)*.8+uv.y*.1+dist*.2-strips*.3);
          vec3 col=mix(uC2, uC1, strips*.5+facets*.3+outline*.5);
          col=mix(col, vec3(1.), (1.-dist)*.3*(1.-uP*1.1));
          float alpha=(body*.75+outline*.6)*(1.-uP*.9)*uItx*.8;
          if(alpha<.005)discard;
          gl_FragColor=vec4(col*1.3,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const pillarH = this.sc * 2.5
    const pillarMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1,1,1), pillarMat)
    pillarMesh.position.set(pos.x, pos.y + pillarH * .5, pos.z)
    pillarMesh.scale.set(pillarH * .7, pillarH * 1.3, 1)
    pillarMesh.renderOrder = 9; scene.add(pillarMesh)
    this.meshes.push(pillarMesh); this.mats.push(pillarMat)  // index 3

    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 2.8
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(14, false),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.12, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001

    // ：delay 0.2s，
    const frP=Math.min(Math.max((this.t-.2)/(this.dur*.65),0),1)
    this.mats[0].uniforms.uP.value=frP; this.mats[0].uniforms.uT.value=T

    // （ ）：delay 0.04s，
    const mP=Math.min(Math.max((this.t-.04)/(this.dur*.38),0),1)
    this.mats[1].uniforms.uP.value=mP; this.mats[1].uniforms.uT.value=T
    this.meshes[1].scale.setScalar(1+mP*(2.5*this.sc-1))

    // ：delay 0（  scale，uP ）
    const rP=Math.min(this.t/(this.dur*.22),1)
    this.mats[2].uniforms.uP.value=rP

    //  billboard（index 3，camera-aligned）
    const pP=Math.min(Math.max((this.t-.0)/(this.dur*.55),0),1)
    this.mats[3].uniforms.uP.value=pP; this.mats[3].uniforms.uT.value=T
    if(camera) alignToCamera(this.meshes[3], camera)

    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = Math.min(Math.max((this.t - .06) / (this.dur * .5), 0), 1)
    this.mats[this.mats.length-1].uniforms.uT.value = T

    if(this.t>this.dur+.3)this.alive=false
  }

  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()})
    this.mats.forEach(m=>m.dispose())
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ：LightningStrike
// ══════════════════════════════════════════════════════════════════════════════
export class LightningStrike implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 1.1; this.sc = p.scale ?? 1; this.itx = p.intensity ?? 1
    const c1 = new THREE.Vector3(...p.primaryColor), c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    //
    const flashMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `uniform float uP,uItx;uniform vec3 uC;varying vec2 vUv;
        void main(){vec2 uv=vUv*2.-1.;float d=length(uv);
          float flash=exp(-d*d*2.)*(1.-smoothstep(.0,.35,uP));
          float ring=exp(-pow(d-.2,2.)*40.)*(1.-uP*2.5);
          float alpha=(flash*.9+ring*.7)*uItx;if(alpha<.005)discard;
          gl_FragColor=vec4(uC*2.5+.5,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const flashM = new THREE.Mesh(new THREE.PlaneGeometry(1,1), flashMat)
    flashM.rotation.x=-Math.PI/2; flashM.position.set(pos.x,pos.y+.1,pos.z)
    flashM.scale.setScalar(this.sc*2.2); flashM.renderOrder=10; scene.add(flashM)
    this.meshes.push(flashM); this.mats.push(flashMat)

    //
    const arcMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `uniform float uP,uT,uItx;uniform vec3 uC;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float d=length(uv);float T=uT;
          float angle=atan(uv.y,uv.x);
          float nv=fbm2(vec2(angle*3.+T*8.,d*4.-T*3.))*.5+.5;
          float ring=exp(-pow(d-uP*.85,2.)*55.)*(1.-uP);
          float alpha=ring*(.5+nv*.8)*uItx;if(alpha<.005)discard;
          gl_FragColor=vec4(uC*1.8+.2,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const arcR=4.0*this.sc
    const arcM = new THREE.Mesh(new THREE.CircleGeometry(1,64), arcMat)
    arcM.rotation.x=-Math.PI/2; arcM.position.set(pos.x,pos.y+.09,pos.z)
    arcM.renderOrder=6; scene.add(arcM)
    this.meshes.push(arcM); this.mats.push(arcMat); (arcMat as any)._maxR=arcR

    //  billboard（  +  + ）
    const boltH=this.sc*5.5
    const boltMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `uniform float uP,uT,uItx;uniform vec3 uC1,uC2;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float T=uT;
          // ： 
          float n1=fbm2(vec2(uv.y*3.2+T*6.5,.5))*.38;
          float n2=fbm2(vec2(uv.y*7.5-T*10.,2.2))*.24;
          float n3=(_n2(vec2(uv.y*20.+T*16.,4.1))*2.-1.)*.10;
          float n4=(_n2(vec2(uv.y*38.+T*22.,7.3))*2.-1.)*.04;
          float path=n1+n2+n3+n4;
          float cx=uv.x-path;
          // （ ， ）+  + 
          float core=exp(-cx*cx*320.)*.98;
          float glow=exp(-cx*cx*22.)*.75;
          float warm=exp(-cx*cx*3.5)*.28;
          // （ ）
          float flk=.52+.48*sin(T*110.+uv.y*7.)*sin(T*73.+uv.y*4.5);
          // Y ：  & 
          float yF=smoothstep(-1.,-.50,uv.y)*(1.-smoothstep(.60,1.,uv.y));
          // ： （ ）+ （0.3s ）
          float blink1=1.-smoothstep(.0,.22,uP);
          float blink2=smoothstep(.28,.32,uP)*(1.-smoothstep(.55,.72,uP))*.7;
          float blink=max(blink1,blink2);
          // ： ， ， 
          vec3 col=uC1*2.4+warm*uC2*.6; col=mix(col,vec3(2.8,2.7,3.0),core*.8);
          float alpha=(core+glow*.75+warm*.45)*yF*flk*blink*uItx;
          if(alpha<.005)discard;gl_FragColor=vec4(col,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const boltM = new THREE.Mesh(new THREE.PlaneGeometry(1,1), boltMat)
    boltM.position.set(pos.x,pos.y+boltH*.5,pos.z); boltM.scale.set(boltH*.38,boltH*1.3,1)
    boltM.renderOrder=12; scene.add(boltM); this.meshes.push(boltM); this.mats.push(boltMat)

    // （ ， ）
    const bolt2Mat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T+1.3}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx*.7} },
      vertexShader: uvVert,
      fragmentShader: `uniform float uP,uT,uItx;uniform vec3 uC1,uC2;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float T=uT;
          float fork=smoothstep(-.1,.5,uv.y);
          float jag=fbm2(vec2(uv.y*6.+T*8.,1.8))*.32+fbm2(vec2(uv.y*12.-T*9.,3.))*.14;
          float jag2=(_n2(vec2(uv.y*25.+T*18.,5.))*2.-1.)*.06;
          float cx=abs(uv.x-(jag+jag2+fork*.20));
          float core=exp(-cx*cx*400.)*.7;
          float glow=exp(-cx*cx*50.)*.55;
          float yF=smoothstep(-1.,-.25,uv.y)*(1.-smoothstep(.10,.70,uv.y));
          float flk=.38+.62*sin(T*95.+uv.y*10.);
          float blink1=1.-smoothstep(.0,.24,uP);
          float blink2=smoothstep(.30,.34,uP)*(1.-smoothstep(.50,.68,uP))*.65;
          float blink=max(blink1,blink2);
          float alpha=(core+glow*.7)*yF*flk*blink*uItx; if(alpha<.005)discard;
          gl_FragColor=vec4(uC1*2.2+uC2*.4,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const bolt2M = new THREE.Mesh(new THREE.PlaneGeometry(1,1), bolt2Mat)
    bolt2M.position.set(pos.x+this.sc*.32,pos.y+boltH*.30,pos.z+this.sc*.12)
    bolt2M.scale.set(boltH*.28,boltH*.62*1.3,1); bolt2M.renderOrder=11; scene.add(bolt2M)
    this.meshes.push(bolt2M); this.mats.push(bolt2Mat)

    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 2.5
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(12, false),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.1, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001
    this.mats[0].uniforms.uP.value=this.t*3.
    const aP=Math.min(Math.max((this.t-.04)/(this.dur*.45),0),1)
    this.mats[1].uniforms.uP.value=aP; this.mats[1].uniforms.uT.value=T
    this.meshes[1].scale.setScalar(1+aP*((this.mats[1] as any)._maxR-1))
    // bolt uP （4→1.4），  50ms  ~200ms，
    this.mats[2].uniforms.uP.value=this.t*1.4; this.mats[2].uniforms.uT.value=T
    this.mats[3].uniforms.uP.value=this.t*1.3; this.mats[3].uniforms.uT.value=T+1.3
    if(camera){alignToCamera(this.meshes[2],camera);alignToCamera(this.meshes[3],camera)}
    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = Math.min(Math.max((this.t - .03) / (this.dur * .4), 0), 1)
    this.mats[this.mats.length-1].uniforms.uT.value = T
    if(this.t>this.dur+.2) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ：MeleeSlash
// ══════════════════════════════════════════════════════════════════════════════
export class MeleeSlash implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur=(p.duration??1)*.85; this.sc=p.scale??1; this.itx=p.intensity??1
    const c1=new THREE.Vector3(...p.primaryColor),c2=new THREE.Vector3(...p.secondaryColor)
    const T=performance.now()*.001

    //
    const slashMat=new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uT:{value:T},uC1:{value:c1},uC2:{value:c2},uItx:{value:this.itx}},
      vertexShader:uvVert,
      fragmentShader:`uniform float uP,uT,uItx;uniform vec3 uC1,uC2;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float T=uT;
          float ca=cos(.7),sa=sin(.7);
          vec2 ruv=vec2(uv.x*ca-uv.y*sa,uv.x*sa+uv.y*ca);
          float arc=exp(-ruv.x*ruv.x*6.)*smoothstep(-.85,.85,ruv.y)*(1.-smoothstep(.55,.9,abs(ruv.y)));
          float nv=fbm2(ruv*4.+vec2(T*.1,0.))*.4+.6;
          float fade=1.-smoothstep(.3,.85,uP);
          float alpha=arc*nv*fade*uItx*.85;if(alpha<.005)discard;
          gl_FragColor=vec4(mix(uC2,uC1*2.,arc*nv),alpha);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    })
    const slashM=new THREE.Mesh(new THREE.PlaneGeometry(1,1),slashMat)
    slashM.rotation.x=-Math.PI/2; slashM.position.set(pos.x,pos.y+.1,pos.z)
    slashM.scale.set(3.5*this.sc*2, 3.5*this.sc*2, 1); slashM.renderOrder=8; scene.add(slashM)
    this.meshes.push(slashM); this.mats.push(slashMat)

    //
    const waveMat=new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uC:{value:c1},uItx:{value:this.itx}},
      vertexShader:uvVert,
      fragmentShader:`uniform float uP,uItx;uniform vec3 uC;varying vec2 vUv;
        void main(){vec2 c=vUv*2.-1.;float d=length(c);
          float ring=exp(-pow(d-uP*.7,2.)*55.)*(1.-uP*.9);
          float alpha=ring*.7*uItx;if(alpha<.005)discard;gl_FragColor=vec4(uC*1.5,alpha);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    })
    const waveM=new THREE.Mesh(new THREE.CircleGeometry(1,48),waveMat)
    waveM.rotation.x=-Math.PI/2; waveM.position.set(pos.x,pos.y+.08,pos.z)
    waveM.renderOrder=5; scene.add(waveM); this.meshes.push(waveM); this.mats.push(waveMat)


    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 3.0
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(14, false),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.1, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001
    this.mats[0].uniforms.uP.value=Math.min(this.t/(this.dur*.7),1); this.mats[0].uniforms.uT.value=T
    const wP=Math.min(this.t/(this.dur*.35),1)
    this.mats[1].uniforms.uP.value=wP; this.meshes[1].scale.setScalar(1+wP*(7*this.sc-1))
    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = Math.min(Math.max((this.t - .0) / (this.dur * .45), 0), 1)
    this.mats[this.mats.length-1].uniforms.uT.value = T
    if(this.t>this.dur+.2) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ：PoisonCloud
// ══════════════════════════════════════════════════════════════════════════════
export class PoisonCloud implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur=(p.duration??1)*2.2; this.sc=p.scale??1; this.itx=p.intensity??1
    const c1=new THREE.Vector3(...p.primaryColor),c2=new THREE.Vector3(...p.secondaryColor)
    const T=performance.now()*.001

    //
    const puddleMat=new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uT:{value:T},uC1:{value:c1},uC2:{value:c2},uItx:{value:this.itx}},
      vertexShader:uvVert,
      fragmentShader:`uniform float uP,uT,uItx;uniform vec3 uC1,uC2;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float T=uT;float d=length(uv);
          float n1=fbm2(uv*2.8+vec2(T*.08,-T*.06));float n2=fbm2(uv*5.2-vec2(T*.12,T*.05));
          float nv=n1*.65+n2*.35;
          float spread=smoothstep(uP*.9+nv*.25,uP*.9-nv*.15,d);
          float bubble=fbm2(uv*7.+vec2(T*.15,-T*.2))*.5+.5;
          float late=smoothstep(.5,.95,uP);
          vec3 col=mix(uC2,uC1,bubble*.6+nv*.4); col=mix(col,uC1*1.8,(1.-d)*.3*(1.-late));
          float alpha=spread*(.5+bubble*.3)*(1.-late*.5)*uItx*.75;
          if(alpha<.005)discard;gl_FragColor=vec4(col,alpha);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    })
    const puddleM=new THREE.Mesh(new THREE.PlaneGeometry(1,1),puddleMat)
    puddleM.rotation.x=-Math.PI/2; puddleM.position.set(pos.x,pos.y+.08,pos.z)
    puddleM.scale.set(3.8*this.sc*2, 3.8*this.sc*2, 1); puddleM.renderOrder=4; scene.add(puddleM)
    this.meshes.push(puddleM); this.mats.push(puddleMat)

    //
    const rimMat=new THREE.ShaderMaterial({
      uniforms:{uP:{value:0},uT:{value:T},uC:{value:c1},uItx:{value:this.itx}},
      vertexShader:uvVert,
      fragmentShader:`uniform float uP,uT,uItx;uniform vec3 uC;varying vec2 vUv;
        ${fbmGlsl()}
        void main(){vec2 uv=vUv*2.-1.;float d=length(uv);float T=uT;
          float nv=fbm2(vec2(atan(uv.y,uv.x)*2.+T*.5,d*3.))*.4+.6;
          float ring=exp(-pow(d-uP*.88,2.)*35.)*(1.-uP*.8)*nv;
          float alpha=ring*.6*uItx;if(alpha<.005)discard;gl_FragColor=vec4(uC*2.,alpha);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    })
    const rimM=new THREE.Mesh(new THREE.CircleGeometry(1,64),rimMat)
    rimM.rotation.x=-Math.PI/2; rimM.position.set(pos.x,pos.y+.1,pos.z)
    rimM.renderOrder=5; scene.add(rimM); this.meshes.push(rimM); this.mats.push(rimMat)


    // ── （ ， ，  gl_PointSize ）
    const _scR = this.sc * 2.0
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uItx:{value:this.itx}, uC1:{value:c1}, uC2:{value:c2}, uT:{value:0} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(20, true),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y + 0.14, pos.z)
    scatMesh.scale.set(_scR*2, _scR*2, 1)
    scatMesh.renderOrder = 10; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001
    const pP=Math.min(Math.max((this.t-.15)/(this.dur*.55),0),1)
    this.mats[0].uniforms.uP.value=pP; this.mats[0].uniforms.uT.value=T
    const rP=Math.min(Math.max((this.t-.08)/(this.dur*.45),0),1)
    this.mats[1].uniforms.uP.value=rP; this.mats[1].uniforms.uT.value=T
    this.meshes[1].scale.setScalar(1+rP*(3.8*this.sc-1))
    // （ ， ）
    this.mats[this.mats.length-1].uniforms.uP.value = this.t / this.dur
    this.mats[this.mats.length-1].uniforms.uT.value = T
    if(this.t>this.dur+.4) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HealingCircle —  /  /
// ═══════════════════════════════════════════════════════════════════════════
export class HealingCircle implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 2.0
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1
    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    // ── （ ， ）
    const poolMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
          if(d>1.)discard;
          float a=atan(uv.y,uv.x);
          //  +  → 
          float sym=abs(cos(a*6.+T*.25))*.5+abs(cos(a*4.-T*.18))*.3+.2;
          float nv=fbm2(vec2(a*2.+T*.3,d*5.-T*.5))*.35+.65;
          // 
          float front=smoothstep(uP+.06,uP-.06,d)*smoothstep(.0,.18,uP);
          float edge=exp(-pow(d-uP*.98,2.)*55.)*(1.-uP*.35);
          // 
          float pulse=exp(-d*d*6.)*(sin(T*2.8)*.3+.7)*(1.-uP*.6)*.5;
          float v=(sym*nv*front*.7+edge*.5+pulse)*uItx;
          if(v<.005)discard;
          vec3 col=mix(uC2*1.2,uC1*2.4,sym*nv);
          gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), poolMat)
    poolMesh.rotation.x = -Math.PI/2
    poolMesh.position.set(pos.x, pos.y+.04, pos.z)
    poolMesh.scale.setScalar(this.sc * 3.5)
    poolMesh.renderOrder = 4; scene.add(poolMesh)
    this.meshes.push(poolMesh); this.mats.push(poolMat)

    // ── （ ）
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.-1.; float d=length(c); float T=uT;
          float r1=exp(-pow(d-uP,2.)*55.)*(1.-uP*.75);
          float r2=exp(-pow(d-uP*.68,2.)*90.)*(1.-uP*.9)*.45;
          float r3=exp(-pow(d-uP*.38,2.)*140.)*(1.-uP)*.2;
          // ： 
          float wiggle=sin(atan(c.y,c.x)*12.+T*2.)*.012;
          float rb=exp(-pow(d-uP+wiggle,2.)*60.)*.3*(1.-uP*.7);
          float alpha=(r1+r2+r3+rb)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(uC*1.6,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), ringMat)
    ringMesh.rotation.x = -Math.PI/2
    ringMesh.position.set(pos.x, pos.y+.06, pos.z)
    ringMesh.scale.setScalar(this.sc * 4.5)
    ringMesh.renderOrder = 5; scene.add(ringMesh)
    this.meshes.push(ringMesh); this.mats.push(ringMat)

    // ── （  billboard， ）
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float T=uT;
          // ： 
          float xW=exp(-uv.x*uv.x*(6.+uv.y*3.));
          // 
          float flow =fbm2(vec2(uv.x*4.+T*.1, uv.y*3.-T*1.4))*.5+.5;
          float flow2=fbm2(vec2(uv.x*7.-T*.2, uv.y*5.-T*2.1))*.4+.6;
          // 
          float yF=smoothstep(1.,.15,uv.y)*smoothstep(-1.,-.05,uv.y);
          float appear=smoothstep(0.,.2,uP); float fade=smoothstep(.65,1.,uP);
          float body=xW*(flow*.55+flow2*.45)*yF*appear*(1.-fade);
          float alpha=body*0.58*uItx;
          if(alpha<.005)discard;
          vec3 col=mix(uC1*1.1,uC1*2.0+vec3(.04,.18,.06),flow2);
          gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const pillarMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), pillarMat)
    pillarMesh.scale.set(this.sc*1.8, this.sc*5*1.3, 1)
    pillarMesh.position.set(pos.x, pos.y+this.sc*2.5, pos.z)
    pillarMesh.renderOrder = 6; scene.add(pillarMesh)
    this.meshes.push(pillarMesh); this.mats.push(pillarMat)

    // ── （star ）
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(24, false, true),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y+.08, pos.z)
    scatMesh.scale.set(this.sc*3.5, this.sc*3.5, 1)
    scatMesh.renderOrder = 8; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001; const d=this.dur
    this.mats[0].uniforms.uP.value=Math.min(this.t/(d*.75),1); this.mats[0].uniforms.uT.value=T
    this.mats[1].uniforms.uP.value=Math.min(this.t/(d*.5),1);  this.mats[1].uniforms.uT.value=T
    this.mats[2].uniforms.uP.value=Math.min(this.t/(d*.9),1);  this.mats[2].uniforms.uT.value=T
    if(camera) alignToCamera(this.meshes[2], camera)
    this.mats[3].uniforms.uP.value=Math.min(Math.max((this.t-.1)/(d*.55),0),1); this.mats[3].uniforms.uT.value=T
    if(this.t>d+.35) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WindSlash —  /  /
// ═══════════════════════════════════════════════════════════════════════════
export class WindSlash implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 0.9
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1
    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    // ── （ ）
    const gndMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        float _sh(float n){return fract(sin(n*127.1)*43758.5);}
        void main(){
          vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
          float a=atan(uv.y,uv.x);
          // ： 
          float streaks=0.;
          for(int i=0;i<6;i++){
            float fi=float(i);
            float ai=_sh(fi*3.1)*6.28318;
            float ri=.15+_sh(fi*7.7)*.65;
            float wi=.008+_sh(fi*11.)*.012;
            // 
            float arc=exp(-pow(d-ri,2.)/(wi*wi));
            float angDiff=abs(mod(a-ai+3.14159,6.28318)-3.14159);
            float angFade=smoothstep(.8,.0,angDiff);
            streaks+=arc*angFade;
          }
          // 
          float radial=fbm2(vec2(a*3.+T*.8,d*6.-T*3.))*.5+.5;
          float front=smoothstep(uP+.08,uP-.05,d)*smoothstep(0.,.1,uP);
          float v=(streaks*.6+radial*front*.3)*uP*(2.-uP)*uItx;
          if(v<.005)discard;
          vec3 col=mix(uC2,uC1*1.8,streaks);
          gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const gndMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), gndMat)
    gndMesh.rotation.x = -Math.PI/2
    gndMesh.position.set(pos.x, pos.y+.04, pos.z)
    gndMesh.scale.setScalar(this.sc * 3.2)
    gndMesh.renderOrder = 4; scene.add(gndMesh)
    this.meshes.push(gndMesh); this.mats.push(gndMat)

    // ──  billboard（ ）
    const slashMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float T=uT;
          float d=length(uv); float a=atan(uv.y,uv.x);
          // ： 
          float arcR=.52; float arcW=.14;
          float arc=exp(-pow(d-arcR,2.)/(arcW*arcW));
          // （ ）
          float angMask=smoothstep(-2.2,-1.0,a)*smoothstep(2.2,1.0,a);
          //  + FBM 
          float nv=fbm2(vec2(a*3.+T*.5,d*4.))*.25+.75;
          // ： 
          float appear=smoothstep(0.,.15,uP); float fade=smoothstep(.5,1.,uP);
          float body=arc*angMask*nv*appear*(1.-fade);
          // 
          float glow=exp(-pow(d-arcR,2.)*3.)*angMask*.3*(1.-fade);
          float alpha=(body*.85+glow)*uItx;
          if(alpha<.005)discard;
          vec3 col=mix(uC1*2.,uC1*3.5+vec3(.2,.3,.4),nv);
          gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const slashMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), slashMat)
    slashMesh.scale.set(this.sc*3.5, this.sc*3.5*1.3, 1)
    slashMesh.position.set(pos.x, pos.y+this.sc*1.2, pos.z)
    slashMesh.renderOrder = 7; scene.add(slashMesh)
    this.meshes.push(slashMesh); this.mats.push(slashMat)

    // ── （ ， ）
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(18),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y+.06, pos.z)
    scatMesh.scale.set(this.sc*2.8, this.sc*2.8, 1)
    scatMesh.renderOrder = 8; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001; const d=this.dur
    this.mats[0].uniforms.uP.value=Math.min(this.t/(d*.6),1); this.mats[0].uniforms.uT.value=T
    this.mats[1].uniforms.uP.value=Math.min(this.t/(d*.7),1); this.mats[1].uniforms.uT.value=T
    if(camera) alignToCamera(this.meshes[1], camera)
    this.mats[2].uniforms.uP.value=Math.min(Math.max((this.t-.05)/(d*.5),0),1); this.mats[2].uniforms.uT.value=T
    if(this.t>d+.2) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EarthShatter —  /  /
// ═══════════════════════════════════════════════════════════════════════════
export class EarthShatter implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 1.6
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1
    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001
    const cc = p.crackCount ?? 9

    // ── （  + ）
    const crackMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uCC:{value:cc}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uCC,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        float _sh(float n){return fract(sin(n*127.1)*43758.5);}
        float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
        void main(){
          vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
          // ：  FBM
          float rock=fbm2(uv*4.+T*.05)*.5+fbm2(uv*8.+T*.03)*.25+.25;
          float cracks=0.; float glow=0.;
          float cLen=.92*uP;
          for(int i=0;i<12;i++){
            if(float(i)>=uCC)break;
            float fi=float(i);
            float a=fi*(6.2832/uCC)+_sh(fi)*.65;
            vec2 dir=vec2(cos(a),sin(a)),perp=vec2(-dir.y,dir.x);
            float len=dot(uv,dir);
            if(len>0.&&len<cLen){
              float t=len/max(cLen,.001);
              // （ ， ）
              float kt1=.20+_sh(fi+8.)*.18;  float kd1=(_sh(fi+10.)-.5)*1.2;
              float kt2=.46+_sh(fi+9.)*.16;  float kd2=(_sh(fi+11.)-.5)*1.0;
              float kt3=.68+_sh(fi+12.)*.10;  float kd3=(_sh(fi+13.)-.5)*.7;
              float kb=0.;
              if(t>kt1) kb+=kd1*(t-kt1)*cLen*1.0;
              if(t>kt2) kb+=kd2*(t-kt2)*cLen*.7;
              if(t>kt3) kb+=kd3*(t-kt3)*cLen*.45;
              // 
              kb+=(_n2(vec2(len*8.+a,1.7))*2.-1.)*.040;
              kb+=(_n2(vec2(len*16.+a,3.5))*2.-1.)*.016;
              float dist=abs(dot(uv,perp)-kb);
              // （  + ）
              float w=.014+_sh2(fi+3.)*.012+len*.005;
              float str=smoothstep(w,0.,dist)*(1.-t*.15);
              cracks+=str; glow+=exp(-dist*dist*22.)*str*.45;
              // （  kt1）
              if(t>kt1+.06){
                float ba=a+(_sh(fi+20.)-.5)*1.4;
                vec2 bd=vec2(cos(ba),sin(ba));
                float blen=dot(uv-dir*cLen*kt1,bd);
                if(blen>0.&&blen<cLen*.32){
                  float bt=blen/max(cLen*.32,.001);
                  float dist2=abs(dot(uv-dir*cLen*kt1,vec2(-bd.y,bd.x)));
                  cracks+=smoothstep(.010,0.,dist2)*(1.-bt)*.55;
                }
              }
              // （  kt2）
              if(t>kt2+.05){
                float ba2=a+(_sh(fi+30.)-.5)*1.6;
                vec2 bd2=vec2(cos(ba2),sin(ba2));
                float blen2=dot(uv-dir*cLen*kt2,bd2);
                if(blen2>0.&&blen2<cLen*.20){
                  float bt2=blen2/max(cLen*.20,.001);
                  float dist3=abs(dot(uv-dir*cLen*kt2,vec2(-bd2.y,bd2.x)));
                  cracks+=smoothstep(.008,0.,dist3)*(1.-bt2)*.40;
                }
              }
            }
          }
          // 
          float core=exp(-d*d*10.)*(1.-uP*.8)*.7;
          float v=(cracks*.65+glow*.3+core+rock*cracks*.2)*uItx;
          if(v<.005)discard;
          vec3 col=mix(uC2*.8,uC1*2.2,cracks+core);
          gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const crackMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), crackMat)
    crackMesh.rotation.x = -Math.PI/2
    crackMesh.position.set(pos.x, pos.y+.05, pos.z)
    crackMesh.scale.setScalar(this.sc * 3.8)
    crackMesh.renderOrder = 4; scene.add(crackMesh)
    this.meshes.push(crackMesh); this.mats.push(crackMat)

    // ── （ ）
    const dustMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
          float a=atan(uv.y,uv.x);
          //  +  FBM
          float nv=fbm2(vec2(a*2.+T*.4,d*5.-T*1.2))*.5+fbm2(vec2(d*8.-T*.9,a*4.))*.3+.2;
          float front=exp(-pow(d-uP*.9,2.)*22.)*nv*(1.-uP*.8);
          float inner=smoothstep(uP*.95,uP*.3,d)*(1.-uP*.7)*.25;
          float v=(front+inner)*uItx;
          if(v<.005)discard;
          vec3 col=mix(uC2*1.5,uC1*1.2,nv);
          gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const dustMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), dustMat)
    dustMesh.rotation.x = -Math.PI/2
    dustMesh.position.set(pos.x, pos.y+.07, pos.z)
    dustMesh.scale.setScalar(this.sc * 4.2)
    dustMesh.renderOrder = 5; scene.add(dustMesh)
    this.meshes.push(dustMesh); this.mats.push(dustMat)

    // ── （  billboard）
    const rockMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float T=uT;
          // 
          float xW=exp(-uv.x*uv.x*(5.+max(uv.y,0.)*8.));
          // ：  T*2.8（  T*0.8），  T*0.5
          float nv=fbm2(vec2(uv.x*5.+T*.5,uv.y*3.-T*2.8));
          float nv2=fbm2(vec2(uv.x*8.-T*.3,uv.y*6.-T*3.5))*.5+.5;
          float chunks=step(.38,nv)*(1.-step(.82,nv));
          float fine=step(.45,nv2)*(1.-step(.78,nv2))*.5; // 
          // 
          float yF=smoothstep(1.,.0,uv.y)*smoothstep(-1.,.1,uv.y);
          float appear=smoothstep(0.,.18,uP); float fade=smoothstep(.5,.9,uP);
          float body=xW*(chunks*.65+fine*.25+nv*.1)*yF*appear*(1.-fade);
          float alpha=body*.85*uItx;
          if(alpha<.005)discard;
          vec3 col=mix(uC2*1.8,uC1*2.5,chunks);
          gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const rockMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), rockMat)
    rockMesh.scale.set(this.sc*2.5, this.sc*3.5*1.3, 1)
    rockMesh.position.set(pos.x, pos.y+this.sc*1.75, pos.z)
    rockMesh.renderOrder = 6; scene.add(rockMesh)
    this.meshes.push(rockMesh); this.mats.push(rockMat)

    // ── （ ）
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(22),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y+.08, pos.z)
    scatMesh.scale.set(this.sc*4, this.sc*4, 1)
    scatMesh.renderOrder = 9; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)

    // ──  billboard（ ， + ）
    const debrisMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        float _sh(float n){return fract(sin(n*127.1)*43758.5);}
        float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
        //  (interior, faceBright, edgePoly) 
        vec3 rockLP(vec2 p, float r, float seed){
          float lp=length(p); if(lp>r*2.8)return vec3(0.);
          float a=mod(atan(p.y,p.x)+6.28318,6.28318);
          float sides=3.+floor(_sh2(seed+.5)*1.7);   // 3 or 4 
          float segA=6.28318/sides;
          float faceIdx=floor(a/segA);
          float modA=mod(a,segA)-segA*.5;
          float faceR=r*(0.65+_sh(seed*11.+faceIdx)*.62);  // 
          float poly=faceR/max(cos(modA),.10);
          float edge=smoothstep(poly,poly*.88,lp);           // 
          float bright=0.42+_sh2(seed*4.+faceIdx)*.68;      // 
          return vec3(edge,bright,poly);
        }
        void main(){
          vec2 uv=vUv*2.-1.;
          float tot=0.; vec3 tcol=vec3(0.);
          for(int i=0;i<9;i++){
            float fi=float(i);
            float ang=_sh(fi*1.7)*6.28318;
            float spd=0.55+_sh(fi*2.3)*.60;
            float sz=0.028+_sh2(fi*5.1)*.040;          // 
            // ： 
            float delay=_sh(fi*3.7)*.12;
            float t=max(uP-delay,0.)*spd;
            // ： + （ ）
            float px=cos(ang)*t*.82; float pz=sin(ang)*t*.82;
            float bx=px*.65+pz*.30; float by=t*1.85-t*t*5.2;
            // （ ）
            float spin=t*(_sh(fi*9.)*8.-4.);
            float cs=cos(spin),sn=sin(spin);
            vec2 dp=uv-vec2(bx,by);
            vec2 rdp=vec2(dp.x*cs-dp.y*sn, dp.x*sn+dp.y*cs);
            vec3 rb=rockLP(rdp,sz,fi);
            float chunk=rb.x; float bright=rb.y; float poly=rb.z;
            // ： 
            float lp=length(rdp);
            float rimWidth=poly*.14;
            float rim=smoothstep(rimWidth,0.,abs(lp-(poly*.93)))*chunk;
            // 、 （ ）
            float life=smoothstep(0.,.03,t)*max(1.-t*1.05,0.);
            float v=(chunk+rim*.6)*life;
            // ： （ ）+ 
            // additive blending 
            vec3 face=uC1*(bright*1.2+0.65);             // （ ）
            vec3 shadow=mix(uC2*1.0, uC1*.8, bright);    // 
            vec3 edge3=vec3(1.2,0.85,0.3)*1.8;           // ： 
            vec3 chunkCol=mix(shadow,face,bright)+edge3*rim*.5;
            tcol+=chunkCol*v; tot+=v;
          }
          //  alpha （additive blending ）
          float alpha=clamp(tot*2.8,0.,1.)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(tot>.001?tcol/tot:uC1,alpha);}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const debrisH = this.sc * 1.8
    const debrisMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), debrisMat)
    debrisMesh.scale.set(this.sc*3.8, this.sc*3.2, 1)
    debrisMesh.position.set(pos.x, pos.y + debrisH, pos.z)
    debrisMesh.renderOrder = 10; scene.add(debrisMesh)
    this.meshes.push(debrisMesh); this.mats.push(debrisMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001; const d=this.dur
    this.mats[0].uniforms.uP.value=Math.min(Math.max((this.t-.05)/(d*.7),0),1); this.mats[0].uniforms.uT.value=T
    const dustP=Math.min(this.t/(d*.35),1)
    this.mats[1].uniforms.uP.value=dustP; this.mats[1].uniforms.uT.value=T
    this.mats[2].uniforms.uP.value=Math.min(this.t/(d*.65),1); this.mats[2].uniforms.uT.value=T
    if(camera) alignToCamera(this.meshes[2], camera)
    this.mats[3].uniforms.uP.value=Math.min(Math.max((this.t-.08)/(d*.5),0),1); this.mats[3].uniforms.uT.value=T
    // （index 4）
    if(this.mats.length>4){
      this.mats[4].uniforms.uP.value=Math.min(Math.max((this.t-.02)/(d*.55),0),1); this.mats[4].uniforms.uT.value=T
      if(camera) alignToCamera(this.meshes[4], camera)
    }
    if(this.t>d+.4) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ShadowVoid —  /  /
// ═══════════════════════════════════════════════════════════════════════════
export class ShadowVoid implements ITemplate {
  private meshes: THREE.Mesh[] = []; private mats: THREE.ShaderMaterial[] = []
  private t = 0; private alive = true
  private readonly dur: number; private readonly sc: number; private readonly itx: number

  constructor(private scene: THREE.Scene, pos: THREE.Vector3, p: TemplateParams) {
    this.dur = (p.duration ?? 1) * 1.8
    this.sc  = p.scale ?? 1
    this.itx = p.intensity ?? 1
    const c1 = new THREE.Vector3(...p.primaryColor)
    const c2 = new THREE.Vector3(...p.secondaryColor)
    const T = performance.now() * .001

    // ── （ ， ）
    const voidMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
          if(d>1.)discard;
          float a=atan(uv.y,uv.x);
          // ： 
          float swirl=fbm2(vec2(a*2.+d*3.-T*.8, d*4.+T*.5))*.5+.5;
          float swirl2=fbm2(vec2(a*3.-T*1.2, d*6.+T*.3))*.4+.6;
          // ： 
          float hole=smoothstep(.08,.35,d)*smoothstep(.95,.5,d);
          // 
          float rim=exp(-pow(d-.75,2.)*20.)*(1.-uP*.5);
          float pulse=exp(-pow(d-uP*.9,2.)*45.)*(1.-uP*.6)*1.2;
          float v=(hole*(swirl*.5+swirl2*.4)*uP+rim*.5+pulse)*uItx;
          if(v<.005)discard;
          vec3 col=mix(uC2*.5,uC1*2.2,swirl*hole+rim);
          gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, side:THREE.DoubleSide,
    })
    const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), voidMat)
    voidMesh.rotation.x = -Math.PI/2
    voidMesh.position.set(pos.x, pos.y+.04, pos.z)
    voidMesh.scale.setScalar(this.sc * 3.0)
    voidMesh.renderOrder = 4; scene.add(voidMesh)
    this.meshes.push(voidMesh); this.mats.push(voidMat)

    // ── （ ）
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC:{value:c1}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 c=vUv*2.-1.; float d=length(c); float T=uT;
          float a=atan(c.y,c.x);
          // ： 
          float tentacle=fbm2(vec2(a*5.+T*.6,d*3.))*.18;
          float ring=exp(-pow(d-uP+tentacle,2.)*65.)*(1.-uP*.7);
          // 
          float ring2=exp(-pow(d-uP*.6,2.)*110.)*(1.-uP*.85)*.35;
          float alpha=(ring+ring2)*uItx;
          if(alpha<.005)discard;
          gl_FragColor=vec4(uC*2.5,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, side:THREE.DoubleSide,
    })
    const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), ringMat)
    ringMesh.rotation.x = -Math.PI/2
    ringMesh.position.set(pos.x, pos.y+.06, pos.z)
    ringMesh.scale.setScalar(this.sc * 5.5)
    ringMesh.renderOrder = 5; scene.add(ringMesh)
    this.meshes.push(ringMesh); this.mats.push(ringMat)

    // ── （  billboard， ）
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
        ${fbmGlsl()}
        void main(){
          vec2 uv=vUv*2.-1.; float T=uT;
          // ： 、 
          float xW=exp(-uv.x*uv.x*(3.5-uv.y*.8));
          float smoke=fbm2(vec2(uv.x*3.+T*.08,uv.y*2.-T*.5))*.5+.5;
          float smoke2=fbm2(vec2(uv.x*6.-T*.12,uv.y*4.-T*.9))*.4+.6;
          // 
          float edgeX=exp(-pow(abs(uv.x)-.3,2.)*18.);
          float yF=smoothstep(1.,.0,uv.y)*smoothstep(-1.,0.,uv.y);
          float appear=smoothstep(0.,.3,uP); float fade=smoothstep(.6,1.,uP);
          float body=xW*(smoke*.6+smoke2*.4)*yF*appear*(1.-fade);
          float alpha=(body*.8+edgeX*yF*.15)*uItx;
          if(alpha<.005)discard;
          vec3 col=mix(uC2*.8,uC1*2.,smoke2+edgeX*.3);
          gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const smokeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), smokeMat)
    smokeMesh.scale.set(this.sc*2, this.sc*4.5*1.3, 1)
    smokeMesh.position.set(pos.x, pos.y+this.sc*2.2, pos.z)
    smokeMesh.renderOrder = 6; scene.add(smokeMesh)
    this.meshes.push(smokeMesh); this.mats.push(smokeMat)

    // ── （star ： ）
    const scatMat = new THREE.ShaderMaterial({
      uniforms: { uP:{value:0}, uT:{value:T}, uC1:{value:c1}, uC2:{value:c2}, uItx:{value:this.itx} },
      vertexShader: uvVert,
      fragmentShader: scatterFrag(26, false, true),
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
    })
    const scatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), scatMat)
    scatMesh.rotation.x = -Math.PI/2
    scatMesh.position.set(pos.x, pos.y+.08, pos.z)
    scatMesh.scale.set(this.sc*3.2, this.sc*3.2, 1)
    scatMesh.renderOrder = 8; scene.add(scatMesh)
    this.meshes.push(scatMesh); this.mats.push(scatMat)
  }

  update(dt: number, camera?: THREE.Camera){
    this.t+=dt; const T=performance.now()*.001; const d=this.dur
    this.mats[0].uniforms.uP.value=Math.min(this.t/(d*.8),1); this.mats[0].uniforms.uT.value=T
    this.mats[1].uniforms.uP.value=Math.min(this.t/(d*.45),1); this.mats[1].uniforms.uT.value=T
    this.mats[2].uniforms.uP.value=Math.min(this.t/(d*.9),1); this.mats[2].uniforms.uT.value=T
    if(camera) alignToCamera(this.meshes[2], camera)
    this.mats[3].uniforms.uP.value=Math.min(Math.max((this.t-.1)/(d*.6),0),1); this.mats[3].uniforms.uT.value=T
    if(this.t>d+.4) this.alive=false
  }
  isAlive(){return this.alive}
  dispose(){
    this.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()}); this.mats.forEach(m=>m.dispose())
  }
}
