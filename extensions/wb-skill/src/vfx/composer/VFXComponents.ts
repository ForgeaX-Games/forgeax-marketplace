// @source wb-character/src/vfx/composer/VFXComponents.ts
/**
 * VFX （Component Library）
 *
 *  shader 、 。
 *  ComponentResult，  ComponentComposer 。
 *
 * ：
 *   GroundRing     — （  FireImpact）
 *   GroundCrack    —  + 3  + 2 （  FireImpact/EarthShatter）
 *   ScatterPart    — （spark / bubble / star ）
 *   VerticalPillar —  Billboard（  HealingCircle）
 *   ImpactStreak   —  Billboard （Hades ， ）
 *   ContactSpark   — （  attackDir ）
 *   SlashMark      — （  + ，  0.4s，Hades "✕" ）
 */

import * as THREE from 'three'

// ── （  VFXTemplates.ts ）────────────────────────────────────

const uvVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

function fbmGlsl(): string {
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

const _camDir = new THREE.Vector3()
function alignToCamera(mesh: THREE.Mesh, camera: THREE.Camera) {
  camera.getWorldDirection(_camDir)
  _camDir.y = 0
  if (_camDir.lengthSq() < 0.0001) _camDir.set(0, 0, -1)
  _camDir.normalize()
  mesh.rotation.set(0, Math.atan2(-_camDir.x, -_camDir.z), 0)
}

// ──  ──────────────────────────────────────────────────────────────────

export interface ComponentConfig {
  color1?:    [number, number, number]  //  RGB 0-1
  color2?:    [number, number, number]  //  RGB 0-1
  scale?:     number                    // （1.0）
  intensity?: number                    // （1.0）
  count?:     number                    // /
  variant?:   'spark' | 'bubble' | 'star'  //
  /**
   * Y （  ContactSpark ）。
   * （  pos.y）。
   */
  offsetY?:   number
  /**
   * （  XZ ， ）。
   * [1,0] = ，[-1,0] = ，[0.7,0.7] = 。
   *  ImpactStreak 、ContactSpark 。
   * Composer  ComposeConfig.attackDir ， 。
   */
  attackDir?: [number, number]
}

export interface ComponentResult {
  mats:    THREE.ShaderMaterial[]
  meshes:  THREE.Mesh[]
  /** ，  0-1  */
  update(t: number, camera?: THREE.Camera): void
  /** （ ），Composer  */
  baseDur: number
}

function v3(c: [number, number, number]) {
  return new THREE.Vector3(c[0], c[1], c[2])
}

const DEFAULT_C1: [number, number, number] = [1.0, 0.6, 0.15]
const DEFAULT_C2: [number, number, number] = [0.6, 0.1, 0.0]

// ══════════════════════════════════════════════════════════════════════════════
//  GroundRing —
//  baseDur: 0.8s
// ══════════════════════════════════════════════════════════════════════════════

export function buildGroundRing(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1  = v3(cfg.color1 ?? DEFAULT_C1)
  const sc  = cfg.scale     ?? 1.0
  const itx = cfg.intensity ?? 1.0
  const BASE_DUR = 0.8

  const mat = new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0 }, uC: { value: c1 }, uItx: { value: itx } },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uItx; uniform vec3 uC; varying vec2 vUv;
      void main(){
        vec2 c=vUv*2.-1.; float d=length(c);
        float ring1=exp(-pow(d-uP,2.)*90.)*(1.-uP);
        float ring2=exp(-pow(d-(uP*.82),2.)*160.)*(1.-uP)*.28;
        float alpha=(ring1+ring2)*smoothstep(1.,.8,d)*uItx;
        if(alpha<.005)discard;
        gl_FragColor=vec4(uC*(1.7+ring1*.8),alpha);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(pos.x, pos.y + .02, pos.z)
  mesh.scale.setScalar(8 * sc)
  mesh.renderOrder = 5
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t) { mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1) },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GroundCrack — （3  + FBM  + 2 ）
//  baseDur: 1.2s
// ══════════════════════════════════════════════════════════════════════════════

export function buildGroundCrack(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1  = v3(cfg.color1 ?? DEFAULT_C1)
  const cDim = c1.clone().multiplyScalar(0.4)
  const sc   = cfg.scale     ?? 1.0
  const itx  = cfg.intensity ?? 1.0
  const cc   = cfg.count     ?? 8
  const BASE_DUR = 1.2

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uC:   { value: c1 },
      uDim: { value: cDim },
      uCC:  { value: cc },
      uItx: { value: itx },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uCC,uItx; uniform vec3 uC,uDim; varying vec2 vUv;
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
            float kt1=.20+_h2(vec2(fi,8.))*.14, kd1=(_h2(vec2(fi,10.))-.5)*1.1;
            float kt2=.44+_h2(vec2(fi,9.))*.15, kd2=(_h2(vec2(fi,11.))-.5)*.85;
            float kt3=.66+_h2(vec2(fi,12.))*.12, kd3=(_h2(vec2(fi,13.))-.5)*.60;
            float kb=0.;
            if(t>kt1)kb+=(t-kt1)*kd1*cLen*.52;
            if(t>kt2)kb+=(t-kt2)*kd2*cLen*.40;
            if(t>kt3)kb+=(t-kt3)*kd3*cLen*.28;
            kb+=(_n2(vec2(len*8.+a,1.4))*2.-1.)*.042;
            kb+=(_n2(vec2(len*17.+a,3.7))*2.-1.)*.016;
            float d=abs(dot(uv,perp)-kb);
            float w=.010+_h2(vec2(a,len*2.))*.009+len*.003;
            cracks+=smoothstep(w,0.,d)*(1.-t*.25);
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
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const R = 3.2 * sc
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(pos.x, pos.y + .10, pos.z)
  mesh.scale.set(R * 2, R * 2, 1)
  mesh.renderOrder = 4
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t) { mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1) },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ScatterPart — （spark / bubble / star ）
//  baseDur: 0.9s
// ══════════════════════════════════════════════════════════════════════════════

export function buildScatterPart(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1      = v3(cfg.color1    ?? DEFAULT_C1)
  const c2      = v3(cfg.color2    ?? DEFAULT_C2)
  const sc      = cfg.scale        ?? 1.0
  const itx     = cfg.intensity    ?? 1.0
  const n       = Math.min(cfg.count ?? 20, 48)
  const variant = cfg.variant      ?? 'spark'
  const BASE_DUR = 0.9

  const fragSpark = `
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
        float tE=t*t*(3.-2.*t);
        vec2 dir=vec2(cos(a),sin(a));
        vec2 p=dir*spd*tE;
        vec2 dv=uv-p;
        float along=dot(dv,dir);
        float perp=length(dv-along*dir);
        float wid=.006+_sh2(fi*7.)*.008;
        float tailL=spd*tE*.55+.018;
        float cross=exp(-perp*perp/(wid*wid));
        float tail=exp(-pow(max(-along,0.),.65)/(tailL*tailL));
        float head=smoothstep(-.006,.0,-along);
        float spark=cross*tail*head;
        float life=1.-smoothstep(.42,.97,t);
        float freshness=1.-t*.75;
        tot+=spark*life; hot+=spark*life*freshness;
      }
      float alpha=clamp(tot,0.,1.)*(1.-uP*.78)*uItx; if(alpha<.005)discard;
      float heatRatio=clamp(hot/max(tot,.001),0.,1.);
      vec3 col=mix(uC2,uC1*2.8,heatRatio);
      gl_FragColor=vec4(col,alpha);}`

  const fragStar = `
    uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
    float _sh(float n){return fract(sin(n*127.1)*43758.5);}
    float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
    void main(){
      vec2 uv=vUv*2.-1.; float T=uT;
      float tot=0.; float hot=0.;
      for(int i=0;i<${n};i++){
        float fi=float(i);
        float a=_sh(fi*1.1)*6.28318;
        float r=sqrt(_sh(fi*3.7))*.88;
        vec2 p=vec2(cos(a),sin(a))*r;
        float sz=.007+_sh2(fi*7.3)*.028;
        float phase=_sh(fi*13.)*6.28318;
        float speed=1.2+_sh2(fi*5.)*2.8;
        float twinkle=sin(T*speed+phase)*.42+.58;
        vec2 d=uv-p;
        float arm=sz*5.;
        float hLine=exp(-d.y*d.y/(sz*sz*.08))*exp(-d.x*d.x/(arm*arm));
        float vLine=exp(-d.x*d.x/(sz*sz*.08))*exp(-d.y*d.y/(arm*arm));
        float starShape=max(hLine,vLine);
        float core=exp(-(d.x*d.x+d.y*d.y)/(sz*sz*.4))*.6;
        float life=smoothstep(0.,.22,uP)*(1.-smoothstep(.72,1.,uP));
        float v=(starShape+core)*twinkle*life;
        tot+=v; hot+=core*twinkle*life;
      }
      float alpha=clamp(tot,0.,1.)*uItx; if(alpha<.005)discard;
      vec3 col=mix(uC1*2.2,vec3(2.0,2.0,2.8),clamp(hot*3.,0.,1.));
      gl_FragColor=vec4(col,alpha);}`

  const fragBubble = `
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
        vec2 p=vec2(cos(a),sin(a))*r;
        float sz=.025+_sh2(fi*7.3)*.045;
        float phase=_sh(fi*13.)*6.28318;
        float speed=2.5+_sh2(fi*5.)*.3;
        float pulse=sin(T*speed+phase)*.45+.55;
        float drift=_sh2(fi*9.)*6.28318;
        vec2 dv=vec2(cos(drift),sin(drift))*_sh2(fi*17.)*.04;
        float d=length(uv-p-dv);
        float blob=exp(-d*d/(sz*sz))*(1.-smoothstep(sz*.6,sz*1.4,d));
        tot+=blob*pulse*(1.-uP*.9);
      }
      float alpha=clamp(tot,0.,1.)*uItx*.7; if(alpha<.005)discard;
      gl_FragColor=vec4(mix(uC2,uC1*1.9,clamp(tot*1.5,0.,1.)),alpha);}`

  const needsT  = variant !== 'spark'
  const uniforms: Record<string, { value: unknown }> = {
    uP: { value: 0 }, uC1: { value: c1 }, uC2: { value: c2 }, uItx: { value: itx },
  }
  if (needsT) uniforms.uT = { value: performance.now() * .001 }

  const frag = variant === 'star' ? fragStar : variant === 'bubble' ? fragBubble : fragSpark

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: uvVert,
    fragmentShader: frag,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(pos.x, pos.y + .08, pos.z)
  mesh.scale.set(sc * 4, sc * 4, 1)
  mesh.renderOrder = 8
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      if (needsT) (mat.uniforms.uT as { value: number }).value = performance.now() * .001
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  VerticalPillar —  Billboard（ ， ）
//  baseDur: 1.2s
// ══════════════════════════════════════════════════════════════════════════════

export function buildVerticalPillar(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1  = v3(cfg.color1 ?? [1.0, 0.92, 0.75])
  const c2  = v3(cfg.color2 ?? [0.6, 0.25, 0.05])
  const sc  = cfg.scale     ?? 1.0
  const itx = cfg.intensity ?? 1.0
  const T   = performance.now() * .001
  const BASE_DUR = 1.4

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uT:   { value: T },
      uC1:  { value: c1 },
      uC2:  { value: c2 },
      uItx: { value: itx },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
      float _sh(float n){return fract(sin(n*127.1)*43758.5);}
      ${fbmGlsl()}
      void main(){
        vec2 uv=vUv*2.-1.; float T=uT;

        // ── " "  ───────────────────────────────────
        float appear=pow(smoothstep(0.,.28,uP),.50); // 
        float topY=mix(-0.60,1.08,appear);            // 
        float botFade=smoothstep(-1.,-.45,uv.y);      // 
        float yTopMask=smoothstep(topY+0.08,topY-0.01,uv.y); // 

        // ── （  WindSlash ，  90° ）──
        // ：  X  +  + FBM 
        float fibers=0.; float hotFibers=0.;
        for(int i=0;i<8;i++){
          float fi=float(i);
          //  X （  ±0.35 ）
          float xi=(_sh(fi*3.1)*2.-1.)*0.35;
          // （ ）
          float wi=0.016+_sh(fi*7.7)*0.020;
          // FBM （  WindSlash radial FBM ）
          float wobble=fbm2(vec2((uv.x-xi)*4.+fi, uv.y*3.5-T*(2.2+_sh(fi*5.)*1.8)))*.22;
          float dist=abs(uv.x-xi+wobble);
          float strand=smoothstep(wi,0.,dist); // （  exp， ）
          // Y ： （ ）
          float topFi=0.55+_sh(fi*11.)*0.50;
          float yFi=smoothstep(topFi,topFi-0.12,uv.y)*botFade;
          //  Y 
          float speed=2.8+_sh(fi*13.)*2.2;
          float flow=fbm2(vec2(uv.x*5.+fi*.7,uv.y*5.-T*speed))*.5+.5;
          float v=strand*yFi*flow*(0.6+_sh(fi*17.)*0.4); // 
          fibers+=v;
          if(fi<4.) hotFibers+=v; // 4 （ ）
        }

        // ── （ ， ）─────────────────────
        float innerBeam=exp(-uv.x*uv.x*32.);
        //  Y 
        float pulse=pow(sin(uv.y*18.-T*14.)*.5+.5,3.)*0.55+0.45;
        float beamBody=innerBeam*pulse*yTopMask*botFade;

        // ── （  FBM， ）──────────────────────────
        float aura=exp(-uv.x*uv.x*3.0)*fbm2(vec2(uv.x*3.,uv.y*2.-T*.9))*.28;

        // ──  ─────────────────────────────────────────────────
        float body=(fibers*0.80+beamBody*0.90+aura*0.30)*yTopMask;

        // ──  ─────────────────────────────────────────────
        float fade=smoothstep(.58,1.,uP);
        body*=(1.-fade);

        float alpha=body*0.72*uItx;
        if(alpha<.005)discard;

        //  → （c1），  → ，  → 
        float hotRatio=clamp((hotFibers+beamBody*1.5)/max(body,.001),0.,1.);
        vec3 col=mix(uC2*1.0, uC1*2.2, clamp(fibers*1.2+beamBody,0.,1.));
        col=mix(col, vec3(3.2,3.1,2.8), beamBody*pulse*0.70); // 
        gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  //  X（aura ），Y
  mesh.scale.set(sc * 2.2, sc * 6.5, 1)
  mesh.position.set(pos.x, pos.y + sc * 3.0, pos.z)
  mesh.renderOrder = 6
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t, camera) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      mat.uniforms.uT.value = performance.now() * .001
      if (camera) alignToCamera(mesh, camera)
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ImpactFlash — （ ， ）
//  baseDur: 0.25s
//  ： /  0 ；delay:0
// ══════════════════════════════════════════════════════════════════════════════

export function buildImpactFlash(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1  = v3(cfg.color1 ?? [1.0, 0.95, 0.8])
  const sc  = cfg.scale     ?? 1.0
  const itx = cfg.intensity ?? 1.0
  const BASE_DUR = 0.25

  const mat = new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0 }, uC: { value: c1 }, uItx: { value: itx } },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uItx; uniform vec3 uC; varying vec2 vUv;
      void main(){
        vec2 c=vUv*2.-1.; float d=length(c);
        // ： ， 
        float fade=1.-uP;
        float core=exp(-d*d*2.8)*fade*fade*1.8;
        // 
        float halo=exp(-pow(d-uP*.55,2.)*120.)*(1.-uP)*0.65;
        float alpha=(core+halo)*smoothstep(1.,.7,d)*uItx;
        if(alpha<.005)discard;
        // → 
        vec3 col=mix(uC*2.5, vec3(3.2,3.0,2.6), core*0.7);
        gl_FragColor=vec4(col,clamp(alpha,0.,1.));}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(pos.x, pos.y + .05, pos.z)
  mesh.scale.setScalar(sc * 3.5)
  mesh.renderOrder = 10  // ，
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t) { mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1) },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GroundGlow — （ ， ， ）
//  baseDur: 1.5s
//  ： " "， ；
// ══════════════════════════════════════════════════════════════════════════════

export function buildGroundGlow(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  cfg: ComponentConfig,
): ComponentResult {
  const c1  = v3(cfg.color1 ?? DEFAULT_C1)
  const c2  = v3(cfg.color2 ?? DEFAULT_C2)
  const sc  = cfg.scale     ?? 1.0
  const itx = cfg.intensity ?? 1.0
  const T   = performance.now() * .001
  const BASE_DUR = 1.5

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uT:   { value: T },
      uC1:  { value: c1 },
      uC2:  { value: c2 },
      uItx: { value: itx },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uT,uItx; uniform vec3 uC1,uC2; varying vec2 vUv;
      ${fbmGlsl()}
      void main(){
        vec2 uv=vUv*2.-1.; float d=length(uv); float T=uT;
        // ：  30%  95% 
        float expand=0.30+uP*0.65;
        // FBM 
        float a=atan(uv.y,uv.x);
        float n1=fbm2(vec2(a*1.3+T*.12, d*4.-T*.08))*.28;
        float n2=fbm2(vec2(uv.x*3.+T*.07, uv.y*3.-T*.05))*.18;
        float nv=n1+n2;
        // ： 
        float glow=smoothstep(expand+0.18+nv, expand-0.06+nv, d);
        // （ ）
        float edge=exp(-pow(d-(expand*.92+nv*.5),2.)*18.)*.55;
        // ： 
        float appear=smoothstep(0.,.12,uP);
        float fade=1.-smoothstep(.50,1.,uP);
        float v=(glow*.65+edge)*appear*fade*uItx;
        if(v<.005)discard;
        // ， 
        vec3 col=mix(uC2*.9, uC1*1.6, clamp(glow*1.2+edge*.4,0.,1.));
        gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const R = 4.5 * sc
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(pos.x, pos.y + .06, pos.z)
  mesh.scale.setScalar(R)
  mesh.renderOrder = 3  // ， /
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      mat.uniforms.uT.value = performance.now() * .001
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ContactSpark — （  Billboard， ）
//  baseDur: 0.45s
//
//   ScatterPart ：
//    - （  -PI/2），  billboard（  alignToCamera）
//    - + ， " " （ ）
//    -  offsetY  Y （  y≈1.2）
//    - 、 、 ， " "
// ══════════════════════════════════════════════════════════════════════════════

export function buildContactSpark(
  scene: THREE.Scene,
  pos:   THREE.Vector3,
  cfg:   ComponentConfig,
): ComponentResult {
  const c1     = v3(cfg.color1 ?? [1.0, 0.85, 0.3])
  const c2     = v3(cfg.color2 ?? [1.0, 0.25, 0.0])
  const sc     = cfg.scale     ?? 1.0
  const itx    = cfg.intensity ?? 1.0
  const n      = Math.min(cfg.count ?? 16, 32)
  // offsetY  1.2： （  0.2 + 1.0 ）
  const spawnY = cfg.offsetY ?? (pos.y + 1.0)
  const dir    = cfg.attackDir ?? [1, 0]
  const BASE_DUR = 0.70

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uC1:  { value: c1 },
      uC2:  { value: c2 },
      uItx: { value: itx },
      // billboard UV ：x= ，y=
      // attackDir[0] （ =+1， =-1）；y 0（ ）
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uItx; uniform vec3 uC1,uC2; uniform vec2 uDir; varying vec2 vUv;
      float _sh(float n){return fract(sin(n*127.1)*43758.5);}
      float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
      void main(){
        vec2 uv=vUv*2.-1.;
        float tot=0.; float hot=0.;
        float baseA=atan(uDir.y,uDir.x); // 
        for(int i=0;i<${n};i++){
          float fi=float(i);
          float a;
          // 65% （±115°）， 35% 
          if(fi < float(${n})*0.65){
            float spread=2.0; // ±115° 
            a=baseA+(_sh(fi*1.1)*2.-1.)*spread;
          } else {
            a=_sh(fi*7.3+100.)*6.28318; // 
          }
          // ， 
          float spd=.16+_sh(fi*3.7)*.75;
          float delay=_sh(fi*11.)*.15;
          float t=clamp((uP-delay)/max(1.-delay,.01),0.,1.);
          float tE=t*t*(3.-2.*t);

          // ： 
          float dx=cos(a)*spd*tE;
          // ： （ ， ）
          float vy=abs(sin(a))*.65+.25;
          float dy=vy*t - 1.20*t*t;

          vec2 p=vec2(dx,dy);
          // 
          float sz=.020+_sh2(fi*7.)*.022;
          float d=length(uv-p);
          float core=exp(-d*d/(sz*sz*.3));
          float halo=exp(-d*d/(sz*sz*5.))*0.4;
          float spark=(core+halo);
          float life=1.-smoothstep(.55,1.,t);
          float fresh=1.-t*.80;
          tot+=spark*life;
          hot+=core*life*fresh;
        }
        float alpha=clamp(tot,0.,1.)*(1.-uP*.50)*uItx;
        if(alpha<.005)discard;
        float heatR=clamp(hot/max(tot,.001),0.,1.);
        vec3 col=mix(uC2*1.2, uC1*2.8, heatR);
        gl_FragColor=vec4(col,alpha);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  //  billboard： ，  alignToCamera
  // （5.0），
  mesh.scale.set(sc * 5.0, sc * 5.0, 1)
  mesh.position.set(pos.x, spawnY, pos.z)
  mesh.renderOrder = 9
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t, camera) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      if (camera) alignToCamera(mesh, camera)
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ImpactStreak — （Hades ）
//  baseDur: 0.35s
//
//  ：
//    -  Billboard（  ContactSpark ）， （y≈0.8）
//    - 18 ，  attackDir （65%  ±80° ）
//    - （0.35s）、 、T=0 ， " "
//    -  ImpactFlash ：Flash ，Streak
//    -  GroundRing/GroundCrack（ ） ，  → Z
// ══════════════════════════════════════════════════════════════════════════════

const N_STREAK = 18

export function buildImpactStreak(
  scene: THREE.Scene,
  pos:   THREE.Vector3,
  cfg:   ComponentConfig,
): ComponentResult {
  const c1     = v3(cfg.color1 ?? [1.0, 0.9, 0.7])
  const c2     = v3(cfg.color2 ?? [1.0, 0.4, 0.05])
  const sc     = cfg.scale     ?? 1.0
  const itx    = cfg.intensity ?? 1.0
  const dir    = cfg.attackDir ?? [1, 0]
  const spawnY = cfg.offsetY ?? (pos.y + 0.8)
  const BASE_DUR = 0.55

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uC1:  { value: c1 },
      uC2:  { value: c2 },
      uItx: { value: itx },
      //  billboard UV （x= , y= ）
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uItx; uniform vec3 uC1,uC2; uniform vec2 uDir; varying vec2 vUv;
      float _sh(float n){return fract(sin(n*127.1)*43758.5);}
      float _sh2(float n){return fract(sin(n*311.7)*91267.3);}
      void main(){
        vec2 uv=vUv*2.-1.;
        float tot=0.; float hot=0.;
        float baseA=atan(uDir.y,uDir.x); // 
        for(int i=0;i<${N_STREAK};i++){
          float fi=float(i);
          float a; float w;
          //  65%  ±80° （ ）
          if(fi < ${N_STREAK.toFixed(1)}*0.65){
            float spread=1.4; // ±80°
            a=baseA+(_sh(fi*1.1)*2.-1.)*spread;
            w=1.0;
          } else {
            //  35% （ ）
            a=_sh(fi*7.3+100.)*6.28318;
            w=0.28+max(0.,dot(vec2(cos(a),sin(a)),normalize(uDir)))*0.22;
          }
          vec2 sDir=vec2(cos(a),sin(a));
          float spd=0.22+_sh2(fi*3.7)*0.42;
          float delay=_sh(fi*11.)*0.06;
          float t=clamp((uP-delay)/max(1.-delay,0.01),0.,1.);
          // ease-out： ， 
          float tE=t*(2.-t);

          float tipLen=spd*tE;
          float along=dot(uv,sDir);
          float perp=length(uv-along*sDir);

          // ： （Hades ）
          float width=0.007+_sh(fi*5.)*0.006;
          float thin=exp(-perp*perp/(width*width));
          //  tipLen， （ ）
          float inLine=smoothstep(0.,0.018,along)*
                       smoothstep(tipLen,tipLen*0.35,along);
          // （ ， ）
          float streak=thin*inLine*w*(1.-t*t);
          tot+=streak;
          // " "（ ）
          if(fi<${N_STREAK.toFixed(1)}*0.65) hot+=streak;
        }
        float alpha=clamp(tot,0.,1.)*uItx;
        if(alpha<0.005)discard;
        //  → ×3（ ），  → ×1.8
        vec3 col=mix(uC2*1.8, uC1*3.0, clamp(hot/max(tot,0.001),0.,1.));
        gl_FragColor=vec4(col,alpha);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  //  billboard： ，alignToCamera
  // （5.0），
  mesh.scale.set(sc * 5.0, sc * 5.0, 1)
  mesh.position.set(pos.x, spawnY, pos.z)
  mesh.renderOrder = 11  // ，  ImpactFlash
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t, camera) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      if (camera) alignToCamera(mesh, camera)
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SlashMark — （Hades "✕" ）
//  baseDur: 0.40s
//
//  ：
//    -  Billboard， （offsetY  pos.y+1.0）
//    - ：  attackDir  +30°（ ）
//    - ： ， （ "✕" ）
//    - FBM ： 、
//    - ，  0 ；40%
//    -  ImpactFlash（ ） ：SlashMark ，
//
//  （delay  0）：
//    ImpactFlash  → （0.25s）
//    ImpactStreak → （0.55s）
//    SlashMark    → （0.40s）←
// ══════════════════════════════════════════════════════════════════════════════

export function buildSlashMark(
  scene: THREE.Scene,
  pos:   THREE.Vector3,
  cfg:   ComponentConfig,
): ComponentResult {
  const c1     = v3(cfg.color1 ?? [1.0, 0.92, 0.75])
  const c2     = v3(cfg.color2 ?? [0.8, 0.45, 0.05])
  const sc     = cfg.scale     ?? 1.0
  const itx    = cfg.intensity ?? 1.0
  const dir    = cfg.attackDir ?? [1, 0]
  const spawnY = cfg.offsetY ?? (pos.y + 1.0)
  const BASE_DUR = 0.65

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uP:   { value: 0 },
      uC1:  { value: c1 },
      uC2:  { value: c2 },
      uItx: { value: itx },
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
    },
    vertexShader: uvVert,
    fragmentShader: `
      uniform float uP,uItx; uniform vec3 uC1,uC2; uniform vec2 uDir; varying vec2 vUv;
      ${fbmGlsl()}
      void main(){
        vec2 uv=vUv*2.-1.;

        // FBM （ ）
        float nx=fbm2(vec2(uv.x*7.+0.3, uv.y*7.-0.5))*0.028;
        float ny=fbm2(vec2(uv.x*7.-0.7, uv.y*7.+0.2))*0.028;
        vec2 uvD=uv+vec2(nx,ny);

        // ：attackDir  +30°
        vec2 mDir=normalize(vec2(
          uDir.x*0.866 - uDir.y*0.500,
          uDir.x*0.500 + uDir.y*0.866
        ));
        vec2 mPerp=vec2(-mDir.y, mDir.x);

        float mAlong=dot(uvD,mDir);
        float mPerpa=dot(uvD,mPerp);
        float mHalfLen=0.62;
        // ── ：  +  +  ──────────────────
        float mCore =exp(-mPerpa*mPerpa/0.00055); // 
        float mMid  =exp(-mPerpa*mPerpa/0.0025 ); // （ ）
        float mGlow =exp(-mPerpa*mPerpa/0.016  )*0.35; // 
        float mMask =smoothstep(mHalfLen+0.07,mHalfLen-0.06,abs(mAlong));
        float mTaper=1.-pow(abs(mAlong)/mHalfLen,1.6)*0.40;
        float mainLine=(mCore*0.80+mMid*0.55+mGlow)*mMask*max(mTaper,0.);

        float cAlong=dot(uvD,mPerp);
        float cPerp =dot(uvD,mDir);
        float cHalfLen=0.38;
        float cCore =exp(-cPerp*cPerp/0.00050)*0.85;
        float cMid  =exp(-cPerp*cPerp/0.0022 )*0.60;
        float cGlow =exp(-cPerp*cPerp/0.015  )*0.28;
        float cMask =smoothstep(cHalfLen+0.06,cHalfLen-0.05,abs(cAlong));
        float cTaper=1.-pow(abs(cAlong)/cHalfLen,1.8)*0.50;
        float crossLine=(cCore+cMid+cGlow)*cMask*max(cTaper,0.)*0.65;

        float tot=mainLine+crossLine;

        // ： ，55% （ ）
        float fade=smoothstep(0.52,1.0,uP);
        float v=tot*(1.-fade*fade)*uItx;
        if(v<0.005)discard;

        // ：  → ，  → ，  → 
        float coreRatio=clamp((mCore+cCore*0.65)*1.2,0.,1.);
        vec3 col=mix(uC2*1.2, uC1*2.4, clamp(tot*0.9,0.,1.));
        col=mix(col, vec3(4.0,3.9,3.6), coreRatio*0.80); // 
        gl_FragColor=vec4(col,clamp(v,0.,1.));}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  mesh.scale.set(sc * 5.5, sc * 5.5, 1)
  mesh.position.set(pos.x, spawnY, pos.z)
  mesh.renderOrder = 12  // renderOrder ，  0
  scene.add(mesh)

  return {
    mats:    [mat],
    meshes:  [mesh],
    baseDur: BASE_DUR,
    update(t, camera) {
      mat.uniforms.uP.value = Math.min(t / BASE_DUR, 1)
      if (camera) alignToCamera(mesh, camera)
    },
  }
}
