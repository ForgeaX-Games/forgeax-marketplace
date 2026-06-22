// @source wb-character/src/vfx/effects/BigFireballEffect.ts
/**
 *  (BigFireballEffect)
 *  →  → 
 */

import * as THREE from 'three'

export interface BigFireballCallbacks {
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerSlowmo?: (duration: number, scale: number) => void
}

// ──  ─────────────────────────────────────────────────
const uvVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

export class BigFireballEffect {
  active = false
  phase: 'charge' | 'flight' | 'impact' | 'embers' = 'charge'
  timer = 0

  chargeTime        = 0.35
  initialSpeed      = 16
  maxLifetime       = 5.0
  hitRadius         = 1.0
  impactDuration    = 1.60   //  s
  explosionMaxScale = 3.8    //
  flowSpeed         = 1.5    //
  explosionAlpha    = 0.55   //
  brightness        = 0.72   // （0.2–2.0）
  hue               = 0.0    // （0.0–1.0）
  colorMix          = 0.0    // （0.0–1.0）

  position  = new THREE.Vector3()
  velocity  = new THREE.Vector3()
  targetPos = new THREE.Vector3()

  //
  chargeMesh: THREE.Mesh;          chargeMat: THREE.ShaderMaterial
  chargeParticles: THREE.Points;   chargeParticleMat: THREE.ShaderMaterial
  chargeParticlePositions: Float32Array; chargeParticleCount = 35
  heatGlowMesh: THREE.Mesh;        heatGlowMat: THREE.ShaderMaterial
  //
  fireballMesh: THREE.Mesh;        fireballMat: THREE.ShaderMaterial
  fireGlowMesh: THREE.Mesh;        fireGlowMat: THREE.ShaderMaterial
  trailMesh: THREE.Mesh;           trailMat: THREE.ShaderMaterial
  //
  explosionMesh: THREE.Mesh;       explosionMat: THREE.ShaderMaterial
  // （ ）
  smokeLayers: THREE.Mesh[] = [];   smokeMats: THREE.ShaderMaterial[] = []
  smokeActive = false;              smokeTimer = 0
  private smokeDuration = 5.0
  shockwaveMesh: THREE.Mesh;       shockwaveMat: THREE.ShaderMaterial
  //
  debrisPoints: THREE.Points;      debrisMat: THREE.ShaderMaterial
  debrisPositions: Float32Array;   debrisVelocities: THREE.Vector3[] = []
  debrisLifetimes: Float32Array;   debrisTypeAttrib: Float32Array
  debrisSizeMult: Float32Array;    debrisRandSeed: Float32Array;  debrisCount = 14
  //
  emberPoints: THREE.Points;       emberMat: THREE.ShaderMaterial
  emberPositions: Float32Array;    emberVelocities: THREE.Vector3[] = []
  emberLifetimes: Float32Array;    emberMaxLifetimes: Float32Array
  emberCount = 40;                 emberSpawnTimer = 0
  // （ ）
  ashPoints: THREE.Points;         ashMat: THREE.ShaderMaterial
  ashPositions: Float32Array;      ashTypeAttrib: Float32Array
  ashSizeMult: Float32Array;       ashRandSeed: Float32Array
  ashCount = 18
  private ashTimer = 0;            private ashDuration = 2.0

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private cbs: BigFireballCallbacks = {},
  ) {
    // ──  ────────────────────────────────────────────────────
    this.chargeMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal,vPosition; uniform float uTime,uProgress;
        float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        void main(){
          vNormal=normalize(normalMatrix*normal); vPosition=position;
          float n=hash(position+uTime)*0.05*uProgress;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position*(1.0+n),1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec3 vNormal,vPosition;
        float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        void main(){
          float fresnel=pow(1.0-max(dot(vNormal,vec3(0,0,1)),0.0),2.5);
          float turb=hash(vPosition*3.0+uTime*0.5);
          float flow=sin(vPosition.y*12.0+uTime*6.0)*0.5+0.5;
          vec3 orange=vec3(1.0,0.55,0.12),white=vec3(1.0,0.95,0.8),dkred=vec3(0.7,0.12,0.02);
          vec3 col=mix(orange,white,fresnel*uProgress);
          col=mix(col,dkred,(1.0-fresnel)*turb*0.35);
          col+=vec3(1.0,0.7,0.2)*flow*0.15*uProgress;
          float alpha=(0.35+fresnel*0.65*uProgress)*(0.8+turb*0.2);
          gl_FragColor=vec4(col*(1.0+uProgress*0.8),alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.chargeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), this.chargeMat)
    this.chargeMesh.visible = false; this.chargeMesh.renderOrder = 2000
    scene.add(this.chargeMesh)

    // ── （3D ） ───────────────────────────────────
    this.chargeParticlePositions = new Float32Array(this.chargeParticleCount * 3)
    const cpGeo = new THREE.BufferGeometry()
    cpGeo.setAttribute('position', new THREE.BufferAttribute(this.chargeParticlePositions, 3))
    this.chargeParticleMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader: `
        uniform float uProgress;
        void main(){
          vec4 m=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=(6.0+uProgress*5.0)*(1.0/-m.z);
          gl_Position=projectionMatrix*m;}`,
      fragmentShader: `
        uniform float uProgress;
        void main(){
          float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0)discard;
          vec3 col=mix(vec3(1.0,0.9,0.5),vec3(1.0,0.35,0.04),d);
          gl_FragColor=vec4(col*2.2,pow(1.0-d,1.5));}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.chargeParticles = new THREE.Points(cpGeo, this.chargeParticleMat)
    this.chargeParticles.visible = false; this.chargeParticles.renderOrder = 2001
    scene.add(this.chargeParticles)

    // ──  ──────────────────────────────────────────────
    const heatGeo = new THREE.CircleGeometry(1, 48)
    heatGeo.rotateX(-Math.PI / 2)
    this.heatGlowMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c),angle=atan(c.y,c.x);
          float flicker=0.75+0.25*sin(uTime*8.0+angle*3.0);
          float rays=pow(abs(sin(angle*6.0+uTime*2.0)),4.0);
          float glow=exp(-dist*dist*2.5)*(0.5+rays*0.5);
          vec3 col=mix(vec3(1.0,0.3,0.0),vec3(1.0,0.8,0.2),glow);
          gl_FragColor=vec4(col*1.4,glow*uProgress*flicker*0.65);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.heatGlowMesh = new THREE.Mesh(heatGeo, this.heatGlowMat)
    this.heatGlowMesh.visible = false; this.heatGlowMesh.renderOrder = 1998
    scene.add(this.heatGlowMesh)

    // ──  Billboard ──────────────────────────────────────────
    // ， ，
    this.fireballMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBrightness: { value: 0.72 }, uHue: { value: 0.0 }, uColorMix: { value: 0.0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uTime,uBrightness,uHue,uColorMix; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){
          vec2 i=floor(p),f=fract(p);
          float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
        float fbm(vec2 p){
          float f=0.0;
          f+=0.500*noise(p); p*=2.01;
          f+=0.250*noise(p); p*=2.01;
          f+=0.125*noise(p);
          return f;}
        vec3 hueShift(vec3 rgb,float h){
          float ang=h*6.28318;
          vec3 k=vec3(0.57735);
          return rgb*cos(ang)+cross(k,rgb)*sin(ang)+k*dot(k,rgb)*(1.0-cos(ang));}
        void main(){
          vec2 uv=vUv*2.0-1.0;
          float dist=length(uv);

          // ： ，  0
          float bdMask=smoothstep(0.95,0.18,dist);
          float n =fbm(uv*3.0+uTime*1.5)*bdMask;           // 
          float n2=fbm(uv*5.5-uTime*2.2)*bdMask;           // 
          float n3=fbm(uv*1.8+vec2(uTime*0.7,-uTime*1.0))*bdMask; // 

          //  alpha（ ， ）
          float body =smoothstep(0.90,0.05,dist);
          float gauss=exp(-dist*dist*4.2);      //  Gaussian 
          float inner=smoothstep(0.35,0.0,dist); // 
          float mid  =smoothstep(0.65,0.15,dist); // 
          float outer=smoothstep(0.90,0.55,dist); // 

          // ── 5 ：  →  →  →  →  ──
          vec3 white    =vec3(1.00,0.97,0.88);  // 
          vec3 yellow   =vec3(1.00,0.85,0.28);  // 
          vec3 orange   =vec3(1.00,0.45,0.08);  // 
          vec3 crimson  =vec3(0.75,0.09,0.02);  // 
          vec3 smokePurp=vec3(0.28,0.02,0.10);  // （ ）

          vec3 col=mix(smokePurp,crimson,outer);   // ： → 
          col=mix(col,orange,mid*0.9);             // ：→ 
          col=mix(col,yellow,inner*0.8);           // ：→ 
          col=mix(col,white, gauss*0.9);           // ：→ 

          // （ ，  alpha ）
          float swirl=n3*outer*(1.0-inner)*0.55;
          col=mix(col,orange*1.4,swirl);           // 
          float dark=smoothstep(0.25,0.72,n2)*(1.0-inner)*0.45;
          col=mix(col,crimson*0.65,dark);          // 

          // 
          col=mix(col,hueShift(col,uHue),uColorMix);

          float alpha=body;
          gl_FragColor=vec4(col*(1.6+gauss*1.4)*uBrightness,alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.fireballMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fireballMat)
    this.fireballMesh.visible = false; this.fireballMesh.renderOrder = 2003
    scene.add(this.fireballMesh)

    // ── （  Gaussian， ） ──────────────────
    this.fireGlowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c);
          // ：smoothstep  +  Gaussian，  dist>0.85  alpha 
          float circleMask=smoothstep(0.85,0.45,dist);
          float glow=exp(-dist*dist*4.5)*circleMask;
          float pulse=0.82+0.18*sin(uTime*5.5);
          vec3 col=mix(vec3(0.9,0.18,0.0),vec3(1.0,0.55,0.08),glow);
          gl_FragColor=vec4(col,glow*pulse*0.4);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.fireGlowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fireGlowMat)
    this.fireGlowMesh.visible = false; this.fireGlowMesh.renderOrder = 2002
    scene.add(this.fireGlowMesh)

    // ──  ──────────────────────────────────────────────────────
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBrightness: { value: 0.72 }, uHue: { value: 0.0 }, uColorMix: { value: 0.0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uTime,uBrightness,uHue,uColorMix; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){
          vec2 i=floor(p),f=fract(p);
          float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
        float fbm(vec2 p){
          float v=0.0;
          v+=0.50*noise(p); p*=2.1;
          v+=0.25*noise(p); p*=2.1;
          v+=0.12*noise(p);
          return v;}
        vec3 hueShift(vec3 rgb,float h){
          float ang=h*6.28318;
          vec3 k=vec3(0.57735);
          return rgb*cos(ang)+cross(k,rgb)*sin(ang)+k*dot(k,rgb)*(1.0-cos(ang));}
        void main(){
          float trail=vUv.y, width=abs(vUv.x-0.5)*2.0, taper=1.0-trail;
          // FBM ， 
          float n1=fbm(vec2(trail*3.5-uTime*1.8, width*2.0))*0.22;
          float n2=noise(vec2(trail*7.0-uTime*3.5, width*4.5))*0.10;
          float nEdge=n1+n2;
          // ， 
          float limit=width/max(taper*0.85+0.15,0.01) - nEdge*0.6;
          float edge=smoothstep(1.0+nEdge*0.4, -0.05, limit);
          vec3 yellow=vec3(1.0,0.88,0.38),orange=vec3(1.0,0.38,0.06),red=vec3(0.82,0.07,0.01),purple=vec3(0.42,0.01,0.26);
          vec3 col=mix(yellow,orange,trail*0.6); col=mix(col,red,trail*trail); col=mix(col,purple,pow(trail,3.0));
          col=mix(col,hueShift(col,uHue),uColorMix);
          gl_FragColor=vec4(col*1.8*uBrightness,edge*(taper*0.7+0.15));}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    //  × 1.5 × 1.2（1.6→2.4→2.88），  × 0.8（6.0→4.8）
    this.trailMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.88, 4.8, 1, 22), this.trailMat)
    this.trailMesh.visible = false; this.trailMesh.renderOrder = 2001
    scene.add(this.trailMesh)

    // ──  ── SphereGeometry  3D，  ─────────
    // ：  3D ， ，
    this.explosionMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uFlowSpeed: { value: 1.5 }, uAlpha: { value: 0.55 } },
      vertexShader: `
        varying vec3 vNormal, vPos, vViewDir;
        varying float vWorldY;
        void main(){
          vNormal  = normalize(normalMatrix * normal);
          vPos     = position;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldY  = worldPos.y;
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime,uFlowSpeed,uAlpha;
        varying vec3 vNormal,vPos,vViewDir;
        varying float vWorldY;
        float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float noise3(vec3 p){
          vec3 i=floor(p),f=fract(p);
          float a=hash3(i),b=hash3(i+vec3(1,0,0)),c=hash3(i+vec3(0,1,0)),d=hash3(i+vec3(1,1,0));
          float e=hash3(i+vec3(0,0,1)),ff=hash3(i+vec3(1,0,1)),g=hash3(i+vec3(0,1,1)),h=hash3(i+vec3(1,1,1));
          vec3 u=f*f*(3.0-2.0*f);
          return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,ff,u.x),mix(g,h,u.x),u.y),u.z);}
        float fbm3(vec3 p){
          float v=0.0;
          v+=0.500*noise3(p); p*=2.2;
          v+=0.250*noise3(p); p*=2.2;
          v+=0.125*noise3(p);
          return v;}
        void main(){
          // ， 
          if (vWorldY < 0.02) discard;
          // uFlowSpeed （panel ）
          float fs = uFlowSpeed;
          // ， 
          float n  = fbm3(vPos*2.4 + vec3(uTime*1.1*fs, uTime*0.7*fs, 0.0));
          float n2 = fbm3(vPos*5.0 - vec3(0.0, uTime*1.8*fs, uTime*0.9*fs));
          float n3 = fbm3(vPos*1.2 + vec3(uTime*0.35*fs, 0.0, uTime*0.45*fs));

          // Fresnel rim：  rim=1（ ），  rim=0（ ）
          float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
          float rim    = 1.0 - facing;          // 
          float rim3   = pow(rim, 1.8);         // 

          // ：  progress ， 
          float erode = smoothstep(uProgress*1.05 - n*0.38, uProgress*1.05 + 0.20, 0.5);
          float body  = clamp(erode, 0.0, 1.0);

          // ── （  40% ，  40% ）──────────
          float lateDim = smoothstep(0.40, 0.92, uProgress);  // 0→1 in second half
          float brightness = mix(1.0, 0.18, lateDim);

          // ── ： ， /  ─────────────────────
          vec3 white  = vec3(1.00, 0.95, 0.75);
          vec3 yellow = vec3(1.00, 0.88, 0.05);
          vec3 orange = vec3(1.00, 0.40, 0.00);
          vec3 red    = vec3(0.85, 0.06, 0.00);
          vec3 smoke  = vec3(0.18, 0.08, 0.04);  // 
          vec3 dkred  = vec3(0.45, 0.02, 0.01);

          // ： 
          float fireBand = clamp(n3*0.5 + n*0.35, 0.0, 1.0);

          // ： ， 
          vec3 col = mix(smoke, dkred, n*0.8);
          col = mix(col, red,    fireBand*body*0.85);
          col = mix(col, orange, clamp(fireBand-0.2,0.0,1.0)*body*0.8);

          // ：rim / 
          col = mix(col, orange*1.3, rim3*body*0.85);
          col = mix(col, yellow,     pow(rim,3.5)*body*0.7*(1.0-lateDim*0.6));
          col = mix(col, white,      pow(rim,5.0)*body*0.55*(1.0-lateDim*0.8));

          // （ ）
          float earlyCore = facing*facing*(1.0-lateDim)*0.5;
          col = mix(col, white, earlyCore*body*(1.0-n2*0.4));

          // alpha：rim ， （ ） ， 
          // uAlpha （panel ， ）
          float alpha = body * (0.25 + rim3*0.55) * (1.0 - uProgress*0.88) * uAlpha;
          gl_FragColor = vec4(col * (2.0 + rim3*1.4) * brightness, alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    // SphereGeometry：radius=1，  update  scale
    this.explosionMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 28, 16), this.explosionMat)
    this.explosionMesh.visible = false; this.explosionMesh.renderOrder = 2004
    scene.add(this.explosionMesh)

    // ── （3 ，FBM ， ） ─
    const smokeVert = `
      varying vec2 vUv;
      void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
    const smokeFrag = `
      uniform float uTime,uProgress,uOpacity,uHeight;
      uniform vec2  uSeed;
      varying vec2  vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                   mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){
        float v=0.0,a=0.5;
        for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=0.5;}
        return v;}
      void main(){
        vec2  c    = vUv - 0.5;
        float dist = length(c);
        // ， 
        float rim  = smoothstep(0.50, 0.18, dist);
        if(rim < 0.001) discard;

        // FBM ： 
        vec2 uv1 = vUv * 2.0 + uSeed + uTime * vec2( 0.038, 0.025);
        vec2 uv2 = vUv * 1.5 + uSeed + uTime * vec2(-0.022, 0.040);
        float n1 = fbm(uv1);
        float n2 = fbm(uv2 + vec2(n1*0.4, 0.0));  // domain warp 

        //  n2 ，uProgress 
        float erodeBase = 0.28 + n2 * 0.12;
        float progress  = uProgress;
        float mask = smoothstep(erodeBase + progress * 0.60,
                                erodeBase + progress * 0.60 + 0.22, n1);
        mask *= rim;
        mask *= (1.0 - smoothstep(0.80, 1.05, progress));   // 

        if(mask < 0.005) discard;

        // ： （ ）， （ ）
        // n1 ， 
        vec3 warm = mix(vec3(0.32,0.21,0.14), vec3(0.42,0.30,0.20), n1 * 0.5);
        vec3 cool = mix(vec3(0.12,0.09,0.07), vec3(0.20,0.15,0.10), n1 * 0.4);
        vec3 col  = mix(warm, cool, uHeight + (1.0-rim)*0.3);
        // （ ）
        col *= 0.80 + (0.5 - dist) * 0.40;

        gl_FragColor = vec4(col, mask * uOpacity);}`;

    // 3 ： → ， / /UV / ，
    const layerCfg = [
      { y: 0.02, size: 5.2, opacity: 0.80, seed: [0.00, 0.00] as [number,number] },
      { y: 0.22, size: 4.2, opacity: 0.58, seed: [3.70, 1.20] as [number,number] },
      { y: 0.44, size: 3.2, opacity: 0.36, seed: [1.40, 4.50] as [number,number] },
    ]
    layerCfg.forEach((cfg, idx) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:     { value: 0 },
          uProgress: { value: 0 },
          uOpacity:  { value: cfg.opacity },
          uHeight:   { value: idx / 2 },
          uSeed:     { value: new THREE.Vector2(cfg.seed[0], cfg.seed[1]) },
        },
        vertexShader:   smokeVert,
        fragmentShader: smokeFrag,
        transparent: true, blending: THREE.NormalBlending,
        depthWrite: false, side: THREE.DoubleSide,
      })
      const geo  = new THREE.PlaneGeometry(cfg.size, cfg.size)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2   //
      mesh.visible     = false
      mesh.renderOrder = 2997 - idx    //
      this.smokeLayers.push(mesh)
      this.smokeMats.push(mat)
      scene.add(mesh)
    })

    // ──  ──  CircleGeometry（ ， ）──
    // RingGeometry ， +shader
    this.shockwaveMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c);
          float front=uProgress;

          // ── （ ， ）──────
          float centerCore=exp(-dist*dist*12.0)*(1.0-uProgress*0.8)*0.65;  // 
          float centerWarm=exp(-dist*dist*4.0)*(1.0-uProgress*0.7)*0.55;   // 

          // ── （Gaussian  uProgress）───────────────
          float ring=exp(-pow(dist-front,2.0)*55.0)*(1.0-uProgress);

          // ── （  progress ）──────────────────────
          float fill=smoothstep(front+0.08,front-0.12,dist)*(1.0-uProgress)*0.4;

          // ──  ─────────────────────────────────────────────
          float mask=smoothstep(1.0,0.82,dist);

          // ： → → → ， 
          vec3 white =vec3(1.00,0.97,0.88);
          vec3 yellow=vec3(1.00,0.85,0.28);
          vec3 orange=vec3(1.00,0.42,0.06);
          vec3 dkred =vec3(0.68,0.12,0.01);

          vec3 col=mix(dkred,orange,fill);
          col=mix(col,orange, ring);
          col=mix(col,yellow, ring*0.6+centerWarm*0.4);
          col=mix(col,white,  centerCore);          // 

          float alpha=(centerCore*0.75+centerWarm*0.45+ring*0.85+fill*0.35)*mask;
          gl_FragColor=vec4(col*1.4,alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    // CircleGeometry ，
    const swCircleGeo = new THREE.CircleGeometry(1.0, 64)
    this.shockwaveMesh = new THREE.Mesh(swCircleGeo, this.shockwaveMat)
    this.shockwaveMesh.visible = false
    this.shockwaveMesh.rotation.x = -Math.PI / 2
    this.shockwaveMesh.renderOrder = 3000
    scene.add(this.shockwaveMesh)

    // ──  ──────────────────────────────────────────────────
    this.debrisPositions  = new Float32Array(this.debrisCount * 3)
    this.debrisLifetimes  = new Float32Array(this.debrisCount)
    this.debrisTypeAttrib = new Float32Array(this.debrisCount)
    this.debrisSizeMult   = new Float32Array(this.debrisCount)
    this.debrisRandSeed   = new Float32Array(this.debrisCount)
    const debrisGeo = new THREE.BufferGeometry()
    debrisGeo.setAttribute('position',  new THREE.BufferAttribute(this.debrisPositions,  3))
    debrisGeo.setAttribute('typeRatio', new THREE.BufferAttribute(this.debrisTypeAttrib, 1))
    debrisGeo.setAttribute('sizeMult',  new THREE.BufferAttribute(this.debrisSizeMult,   1))
    debrisGeo.setAttribute('randSeed',  new THREE.BufferAttribute(this.debrisRandSeed,   1))
    this.debrisMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float typeRatio; attribute float sizeMult; attribute float randSeed;
        varying float vType; varying float vSeed;
        void main(){
          vType = typeRatio; vSeed = randSeed;
          vec4 m = modelViewMatrix * vec4(position, 1.0);
          // ， ，sizeMult 
          float szWorld = mix(0.18, 0.45, 1.0 - typeRatio) * sizeMult;
          gl_PointSize  = clamp(szWorld * 350.0 * (1.0 / -m.z), 2.0, 150.0);
          gl_Position   = projectionMatrix * m;}`,
      fragmentShader: `
        varying float vType; varying float vSeed;
        void main(){
          vec2 p = gl_PointCoord - 0.5;

          // ── （vType > 0.72）：  ─────────────────
          if(vType > 0.72){
            float r = length(p) * 2.0; if(r > 1.0) discard;
            float soft = pow(1.0 - r, 1.0);
            vec3  col  = mix(vec3(1.0,0.88,0.25), vec3(1.0,0.97,0.82), soft * 0.6);
            gl_FragColor = vec4(col * 3.0, soft); return;}

          // ── （vType <= 0.72）：  SDF ──────────────
          //  vSeed ， 
          float rot = vSeed * 6.2832;
          float c = cos(rot), s = sin(rot);
          vec2  rp  = vec2(p.x*c - p.y*s, p.x*s + p.y*c);
          float sideF = floor(3.0 + fract(vSeed * 7.31) * 3.0); // 3/4/5 
          float a     = 6.28318 / sideF;
          float ang   = atan(rp.y, rp.x);
          //  SDF：d < R 
          float d   = cos(floor(0.5 + ang/a)*a - ang) * length(rp);
          float R   = 0.38;
          if(d > R) discard;
          // edgeFill: 1=  0= （ ）
          float edgeFill = clamp(d / R, 0.0, 1.0);

          vec3 col; float alpha;
          if(vType < 0.30){
            // ： ， 
            vec3 stone   = mix(vec3(0.22,0.12,0.07), vec3(0.38,0.22,0.13), fract(vSeed*3.7));
            vec3 hotEdge = vec3(0.65, 0.05, 0.00);
            col   = mix(stone, hotEdge, pow(edgeFill, 2.0) * 0.7);
            alpha = mix(1.0, 0.55, edgeFill * edgeFill);
          } else {
            // ： + 
            vec3 dark = vec3(0.18, 0.07, 0.02);
            vec3 hot  = vec3(1.00, 0.40, 0.00);
            col   = mix(dark, hot, edgeFill);
            alpha = mix(0.65, 1.0, edgeFill);
          }
          gl_FragColor = vec4(col * mix(0.9, 2.0, edgeFill), alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.debrisPoints = new THREE.Points(debrisGeo, this.debrisMat)
    this.debrisPoints.visible = false; this.debrisPoints.renderOrder = 2005
    scene.add(this.debrisPoints)
    for (let i = 0; i < this.debrisCount; i++) this.debrisVelocities.push(new THREE.Vector3())

    // ──  ──────────────────────────────────────────────
    this.emberPositions    = new Float32Array(this.emberCount * 3)
    this.emberLifetimes    = new Float32Array(this.emberCount)
    this.emberMaxLifetimes = new Float32Array(this.emberCount)
    const emberGeo = new THREE.BufferGeometry()
    emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3))
    this.emberMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `void main(){vec4 m=modelViewMatrix*vec4(position,1.0);gl_PointSize=5.0*(1.0/-m.z);gl_Position=projectionMatrix*m;}`,
      fragmentShader: `
        void main(){
          float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0)discard;
          vec3 col=mix(vec3(1.0,0.9,0.5),vec3(1.0,0.35,0.02),pow(d,0.5));
          gl_FragColor=vec4(col*2.2,pow(1.0-d,1.8));}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.emberPoints = new THREE.Points(emberGeo, this.emberMat)
    this.emberPoints.visible = false; this.emberPoints.renderOrder = 2002
    scene.add(this.emberPoints)
    for (let i = 0; i < this.emberCount; i++) {
      this.emberVelocities.push(new THREE.Vector3())
      this.emberLifetimes[i] = 0  //
    }

    // ── （  + SDF + ）─────────────
    this.ashPositions  = new Float32Array(this.ashCount * 3)
    this.ashTypeAttrib = new Float32Array(this.ashCount)
    this.ashSizeMult   = new Float32Array(this.ashCount)
    this.ashRandSeed   = new Float32Array(this.ashCount)
    const ashGeo = new THREE.BufferGeometry()
    ashGeo.setAttribute('position',  new THREE.BufferAttribute(this.ashPositions,  3))
    ashGeo.setAttribute('typeRatio', new THREE.BufferAttribute(this.ashTypeAttrib, 1))
    ashGeo.setAttribute('sizeMult',  new THREE.BufferAttribute(this.ashSizeMult,   1))
    ashGeo.setAttribute('randSeed',  new THREE.BufferAttribute(this.ashRandSeed,   1))
    this.ashMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 0.0 } },
      vertexShader: `
        attribute float typeRatio; attribute float sizeMult; attribute float randSeed;
        varying float vType; varying float vSeed;
        void main(){
          vType = typeRatio; vSeed = randSeed;
          vec4 m = modelViewMatrix * vec4(position, 1.0);
          // ， （  10%）
          float szWorld = mix(0.216, 0.360, 1.0 - typeRatio) * sizeMult;
          gl_PointSize  = clamp(szWorld * 350.0 * (1.0 / -m.z), 2.7, 153.0);
          gl_Position   = projectionMatrix * m;}`,
      fragmentShader: `
        uniform float uTime, uFade;
        varying float vType; varying float vSeed;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          //  vSeed ， 
          float phase    = vSeed * 37.2;
          float flicker  = pow(max(0.0, sin(uTime * 5.0 + phase) * 0.5 + 0.5), 2.4);
          float pulse    = sin(uTime * 1.6 + phase * 0.4) * 0.28 + 0.72;

          // ── （vType>0.72）：  ─────────────────────
          if(vType > 0.72){
            float r   = length(p) * 2.0; if(r > 1.0) discard;
            float soft= pow(1.0 - r, 1.0);
            vec3  col = mix(vec3(0.95,0.38,0.05), vec3(1.0,0.90,0.30), flicker * soft);
            float a   = soft * (0.5 + flicker * 0.5) * uFade;
            gl_FragColor = vec4(col * (1.6 + flicker * 1.2), a); return;}

          // ── ：  SDF ────────────────────────────────
          float rot  = vSeed * 6.2832;
          float c    = cos(rot), s = sin(rot);
          vec2  rp   = vec2(p.x*c - p.y*s, p.x*s + p.y*c);
          float sideF= floor(3.0 + fract(vSeed * 7.31) * 3.0);  // 3/4/5 
          float a2   = 6.28318 / sideF;
          float ang  = atan(rp.y, rp.x);
          float d    = cos(floor(0.5 + ang/a2)*a2 - ang) * length(rp);
          float R    = 0.38;
          if(d > R) discard;
          float fill = clamp(d / R, 0.0, 1.0);  // 0=  1= 

          vec3 col; float alpha;
          if(vType < 0.30){
            // ： ， ， 
            vec3 stone   = mix(vec3(0.22,0.12,0.07), vec3(0.40,0.22,0.12), fract(vSeed*3.7));
            vec3 hotEdge = mix(vec3(0.62,0.04,0.00), vec3(0.90,0.22,0.00), flicker * 0.6);
            col   = mix(stone, hotEdge, pow(fill, 1.8) * 0.75 + flicker * 0.18);
            alpha = mix(1.0, 0.50, fill * fill) * pulse;
          } else {
            // ： + ， 
            vec3 dark = vec3(0.18, 0.07, 0.02);
            vec3 hot  = mix(vec3(0.90, 0.35, 0.00), vec3(1.00, 0.65, 0.10), flicker * 0.5);
            col   = mix(dark, hot, fill);
            alpha = mix(0.60, 1.0, fill) * (0.7 + flicker * 0.3);
          }
          gl_FragColor = vec4(col * mix(0.85, 2.0, fill), alpha * uFade);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    })
    this.ashPoints = new THREE.Points(ashGeo, this.ashMat)
    this.ashPoints.visible = false; this.ashPoints.renderOrder = 3001
    scene.add(this.ashPoints)
  }

  fire(startPos: THREE.Vector3, targetPos: THREE.Vector3) {
    this.active = true; this.phase = 'charge'; this.timer = 0
    this.emberSpawnTimer = 0
    this.position.copy(startPos); this.targetPos.copy(targetPos)
    this.velocity.copy(new THREE.Vector3().subVectors(targetPos, startPos).normalize()).multiplyScalar(this.initialSpeed)

    this.chargeMesh.position.copy(startPos)
    this.chargeMesh.visible = true; this.chargeMesh.scale.setScalar(0.2)
    this.chargeParticles.visible = true
    this.heatGlowMesh.position.set(startPos.x, 0.05, startPos.z)
    this.heatGlowMesh.visible = true; this.heatGlowMat.uniforms.uProgress.value = 0
    //
    for (let i = 0; i < this.emberCount; i++) this.emberLifetimes[i] = 0
    this.emberPoints.visible = false
    //
    this.ashTimer = 0
    this.ashPoints.visible = false
  }

  update(dt: number) {
    if (!this.active) return
    this.timer += dt
    const time = performance.now() * 0.001

    this.chargeMat.uniforms.uTime.value         = time
    this.chargeParticleMat.uniforms.uProgress.value = Math.min(this.timer / this.chargeTime, 1)
    this.heatGlowMat.uniforms.uTime.value       = time
    this.fireballMat.uniforms.uTime.value       = time
    this.fireballMat.uniforms.uBrightness.value = this.brightness
    this.fireballMat.uniforms.uHue.value        = this.hue
    this.fireballMat.uniforms.uColorMix.value   = this.colorMix
    this.fireGlowMat.uniforms.uTime.value       = time
    this.trailMat.uniforms.uTime.value          = time
    this.trailMat.uniforms.uBrightness.value    = this.brightness
    this.trailMat.uniforms.uHue.value           = this.hue
    this.trailMat.uniforms.uColorMix.value      = this.colorMix
    this.debrisMat.uniforms.uTime.value         = time

    // ──  ──────────────────────────────────────────────────
    if (this.phase === 'charge') {
      const p = Math.min(this.timer / this.chargeTime, 1)
      this.chargeMat.uniforms.uProgress.value   = p
      this.heatGlowMat.uniforms.uProgress.value = p
      this.chargeMesh.scale.setScalar(0.2 + p * 1.2)
      this.heatGlowMesh.scale.setScalar(0.8 + p * 1.2)

      //  3D （ ），
      for (let i = 0; i < this.chargeParticleCount; i++) {
        const phi   = (i / this.chargeParticleCount) * Math.PI * 4 + time * 2.5
        const theta = (i / this.chargeParticleCount) * Math.PI * 2 * 3.618
        const r     = (2.2 * (1 - p) + 0.35) * (1 + Math.sin(i * 0.3) * 0.15)
        this.chargeParticlePositions[i * 3]     = this.position.x + Math.sin(phi) * Math.cos(theta) * r
        this.chargeParticlePositions[i * 3 + 1] = this.position.y + Math.cos(phi) * r * 0.6
        this.chargeParticlePositions[i * 3 + 2] = this.position.z + Math.sin(phi) * Math.sin(theta) * r
      }
      this.chargeParticles.geometry.attributes.position.needsUpdate = true

      if (p >= 1) {
        this.phase = 'flight'; this.timer = 0
        this.chargeMesh.visible      = false
        this.chargeParticles.visible = false
        this.heatGlowMesh.visible    = false
        this.fireballMesh.visible    = true
        this.fireGlowMesh.visible    = true
        this.trailMesh.visible       = true
        this.cbs.addTrauma?.(0.15)
        this.cbs.triggerFlash?.(255, 200, 100, 80, 0.3)
      }
    }

    // ──  ──────────────────────────────────────────────────
    if (this.phase === 'flight') {
      this.position.add(this.velocity.clone().multiplyScalar(dt))

      // ：2.8（ ， ）
      const fbScale = 2.8
      this.fireballMesh.position.copy(this.position)
      this.fireballMesh.quaternion.copy(this.camera.quaternion)
      this.fireballMesh.scale.setScalar(fbScale)

      // ： ，
      this.fireGlowMesh.position.copy(this.position)
      this.fireGlowMesh.quaternion.copy(this.camera.quaternion)
      this.fireGlowMesh.scale.setScalar(fbScale * 1.6)

      //
      const trailDir = this.velocity.clone().normalize().negate()
      //  4.8，  = 4.8/2 = 2.4
      this.trailMesh.position.copy(this.position).add(trailDir.clone().multiplyScalar(2.4))
      this.trailMesh.lookAt(this.position)
      this.trailMesh.rotateX(Math.PI / 2)

      // ── ：  0.04s  +  ────────────────
      this.emberSpawnTimer += dt
      if (this.emberSpawnTimer > 0.04) {
        this.emberSpawnTimer = 0
        this.emberPoints.visible = true

        // （ ）
        const up   = new THREE.Vector3(0, 1, 0)
        const side = trailDir.clone().cross(up).normalize()
        if (side.lengthSq() < 0.01) side.set(1, 0, 0)  //  up

        const spawnSlot = () => {
          for (let i = 0; i < this.emberCount; i++) {
            if (this.emberLifetimes[i] <= 0) return i
          }
          return -1
        }

        // ① （3 ）：
        for (let k = 0; k < 3; k++) {
          const slot = spawnSlot(); if (slot < 0) break
          const dist = 3.5 + Math.random() * 1.5
          this.emberPositions[slot*3]   = this.position.x + trailDir.x*dist + (Math.random()-0.5)*0.4
          this.emberPositions[slot*3+1] = this.position.y + trailDir.y*dist + (Math.random()-0.5)*0.25
          this.emberPositions[slot*3+2] = this.position.z + trailDir.z*dist + (Math.random()-0.5)*0.4
          this.emberVelocities[slot].set(
            (Math.random()-0.5)*1.2, Math.random()*0.9+0.15, (Math.random()-0.5)*1.2)
          const life = 0.3 + Math.random() * 0.45
          this.emberLifetimes[slot] = this.emberMaxLifetimes[slot] = life
        }

        // ② （4 ）：
        for (let k = 0; k < 4; k++) {
          const slot = spawnSlot(); if (slot < 0) break
          const along = Math.random() * 4.8              //
          const flip  = (Math.random() < 0.5 ? 1 : -1)   //
          const sw    = (0.6 + Math.random() * 0.8) * flip //
          this.emberPositions[slot*3]   = this.position.x + trailDir.x*along + side.x*sw
          this.emberPositions[slot*3+1] = this.position.y + trailDir.y*along + Math.random()*0.3
          this.emberPositions[slot*3+2] = this.position.z + trailDir.z*along + side.z*sw
          //
          this.emberVelocities[slot].set(
            side.x*flip*0.8 + (Math.random()-0.5)*0.5,
            Math.random()*0.6 + 0.1,
            side.z*flip*0.8 + (Math.random()-0.5)*0.5)
          const life = 0.2 + Math.random() * 0.35
          this.emberLifetimes[slot] = this.emberMaxLifetimes[slot] = life
        }
      }
      for (let i = 0; i < this.emberCount; i++) {
        if (this.emberLifetimes[i] <= 0) {
          this.emberPositions[i * 3 + 1] = -9999   //
          continue
        }
        this.emberLifetimes[i] -= dt
        this.emberVelocities[i].y -= 4.0 * dt
        this.emberPositions[i * 3]     += this.emberVelocities[i].x * dt
        this.emberPositions[i * 3 + 1] += this.emberVelocities[i].y * dt
        this.emberPositions[i * 3 + 2] += this.emberVelocities[i].z * dt
      }
      this.emberPoints.geometry.attributes.position.needsUpdate = true

      if (this.position.distanceTo(this.targetPos) < this.hitRadius || this.timer > this.maxLifetime) {
        this.triggerImpact()
      }
    }

    // ──  ──────────────────────────────────────────────────
    if (this.phase === 'impact') {
      const p = Math.min(this.timer / this.impactDuration, 1)
      this.explosionMat.uniforms.uProgress.value  = p
      this.explosionMat.uniforms.uTime.value      = time
      this.explosionMat.uniforms.uFlowSpeed.value = this.flowSpeed
      this.explosionMat.uniforms.uAlpha.value     = this.explosionAlpha
      // ：scale  explosionMaxScale
      this.explosionMesh.scale.setScalar(0.5 + p * (this.explosionMaxScale - 0.5))


      this.shockwaveMat.uniforms.uProgress.value = p
      this.shockwaveMesh.scale.setScalar(1 + p * 4.5)

      this.updateDebris(dt)
      this.updateSmokeRing(dt)
      // impact （p>0.55） ，
      this.ashMat.uniforms.uTime.value = time
      this.ashMat.uniforms.uFade.value = Math.max(0, (p - 0.55) / 0.45)

      if (p >= 1) {
        // （ashPoints ，uFade  embers ）
        this.phase = 'embers'
        this.ashTimer = 0
        this.explosionMesh.visible  = false
        // （smokeLayers）  embers ，  updateSmokeRing
        this.shockwaveMesh.visible  = false
        this.debrisPoints.visible   = false
      }
    }

    // ── （ ）──────────────────────
    if (this.phase === 'embers') {
      this.ashTimer += dt
      this.ashMat.uniforms.uTime.value = time
      //  0.5s （ ）→
      const fade = Math.max(0, 1.0 - Math.max(0, this.ashTimer - 0.5) / (this.ashDuration - 0.5))
      this.ashMat.uniforms.uFade.value = fade
      // （ ）
      this.updateSmokeRing(dt)
      if (this.ashTimer >= this.ashDuration) {
        this.active = false
        this.ashPoints.visible = false
        //  updateSmokeRing ，
      }
    }
  }

  private triggerImpact() {
    this.phase = 'impact'; this.timer = 0
    this.fireballMesh.visible  = false
    this.fireGlowMesh.visible  = false
    this.trailMesh.visible     = false
    this.emberPoints.visible   = false

    // ：y  0.5， ，
    this.explosionMesh.position.set(this.position.x, this.position.y - 0.5, this.position.z)
    this.explosionMesh.visible = true
    // ：
    this.shockwaveMesh.position.set(this.position.x, 0.03, this.position.z)
    this.shockwaveMesh.visible = true; this.shockwaveMesh.scale.setScalar(1)

    // ： ，impact
    const ax = this.position.x, az = this.position.z
    //  hitRadius ，  hitRadius * 1.4，
    const maxR = this.hitRadius * 1.4
    for (let i = 0; i < this.ashCount; i++) {
      const zone = Math.random()
      const r = zone < 0.4 ? Math.random() * maxR * 0.4          //
              : zone < 0.8 ? maxR * 0.4 + Math.random() * maxR * 0.4  //
              :               maxR * 0.7 + Math.random() * maxR * 0.3  // （  maxR）
      const a = Math.random() * Math.PI * 2
      this.ashPositions[i * 3]     = ax + Math.cos(a) * r + (Math.random() - 0.5) * 0.2
      this.ashPositions[i * 3 + 1] = 0.005   // ，
      this.ashPositions[i * 3 + 2] = az + Math.sin(a) * r + (Math.random() - 0.5) * 0.2
      // 30% , 40% , 30% （  debris ）
      const rv = Math.random()
      this.ashTypeAttrib[i] = rv < 0.30 ? Math.random() * 0.25
                            : rv < 0.70 ? 0.35 + Math.random() * 0.35
                            :             0.75 + Math.random() * 0.25
      this.ashSizeMult[i]   = 0.5 + Math.random() * 2.2    //  0.5×~2.7×
      this.ashRandSeed[i]   = Math.random()                 // /
    }
    this.ashPoints.geometry.attributes.position.needsUpdate  = true
    this.ashPoints.geometry.attributes.typeRatio.needsUpdate = true
    this.ashPoints.geometry.attributes.sizeMult.needsUpdate  = true
    this.ashPoints.geometry.attributes.randSeed.needsUpdate  = true
    //  uFade=0，impact
    this.ashMat.uniforms.uFade.value = 0.0
    this.ashPoints.visible = true

    this.debrisPoints.position.set(0, 0, 0); this.debrisPoints.visible = true
    for (let i = 0; i < this.debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const elev  = Math.random() * Math.PI * 0.5 + 0.1
      const speed = 3.5 + Math.random() * 7
      // ，
      const spawnR = Math.random() * 0.9
      const spawnA = Math.random() * Math.PI * 2
      this.debrisPositions[i * 3]     = this.position.x + Math.cos(spawnA) * spawnR
      this.debrisPositions[i * 3 + 1] = this.position.y + Math.random() * 0.5
      this.debrisPositions[i * 3 + 2] = this.position.z + Math.sin(spawnA) * spawnR
      this.debrisVelocities[i].set(
        Math.cos(angle) * Math.cos(elev) * speed,
        Math.sin(elev) * speed * 1.8,
        Math.sin(angle) * Math.cos(elev) * speed,
      )
      this.debrisLifetimes[i] = 0.5 + Math.random() * 0.8
      // 30% , 40% , 30%
      const r = Math.random()
      this.debrisTypeAttrib[i] = r < 0.30 ? Math.random() * 0.25
                                : r < 0.70 ? 0.35 + Math.random() * 0.35
                                :            0.75 + Math.random() * 0.25
      // ，
      this.debrisSizeMult[i] = 0.4 + Math.random() * 2.4
      // ： ，
      this.debrisRandSeed[i] = Math.random()
    }
    this.debrisPoints.geometry.attributes.position.needsUpdate  = true
    this.debrisPoints.geometry.attributes.typeRatio.needsUpdate = true
    this.debrisPoints.geometry.attributes.sizeMult.needsUpdate  = true
    this.debrisPoints.geometry.attributes.randSeed.needsUpdate  = true

    // ── ： ，  ─────────────────
    const cx = this.position.x, cz = this.position.z
    const layerYs = [0.02, 0.22, 0.44]
    for (let i = 0; i < this.smokeLayers.length; i++) {
      this.smokeLayers[i].position.set(cx, layerYs[i], cz)
      this.smokeLayers[i].visible = true
    }
    for (const mat of this.smokeMats) {
      mat.uniforms.uProgress.value = 0
      mat.uniforms.uTime.value     = performance.now() * 0.001
    }
    this.smokeActive = true
    this.smokeTimer  = 0
    this.cbs.addTrauma?.(0.55)
    this.cbs.triggerFlash?.(255, 120, 50, 120, 0.65)
    this.cbs.triggerSlowmo?.(220, 0.28)
  }

  private updateSmokeRing(dt: number) {
    if (!this.smokeActive) return
    this.smokeTimer += dt
    const progress = Math.min(this.smokeTimer / this.smokeDuration, 1.0)
    const t = performance.now() * 0.001
    for (const mat of this.smokeMats) {
      mat.uniforms.uTime.value     = t
      mat.uniforms.uProgress.value = progress
    }
    if (progress >= 1.0) {
      this.smokeActive = false
      for (const m of this.smokeLayers) m.visible = false
    }
  }

  private updateDebris(dt: number) {
    for (let i = 0; i < this.debrisCount; i++) {
      this.debrisLifetimes[i] -= dt
      if (this.debrisLifetimes[i] <= 0) {
        // ：
        this.debrisPositions[i * 3 + 1] = -9999
        continue
      }
      this.debrisVelocities[i].y -= 18 * dt
      this.debrisPositions[i * 3]     += this.debrisVelocities[i].x * dt
      this.debrisPositions[i * 3 + 1] += this.debrisVelocities[i].y * dt
      this.debrisPositions[i * 3 + 2] += this.debrisVelocities[i].z * dt
      if (this.debrisPositions[i * 3 + 1] < 0) {
        this.debrisPositions[i * 3 + 1] = 0
        this.debrisVelocities[i].y *= -0.25
        this.debrisVelocities[i].x *= 0.75
        this.debrisVelocities[i].z *= 0.75
      }
    }
    this.debrisPoints.geometry.attributes.position.needsUpdate = true
  }

  dispose() {
    ;[this.chargeMesh, this.chargeParticles, this.heatGlowMesh, this.fireballMesh,
      this.fireGlowMesh, this.trailMesh, this.explosionMesh,
      this.shockwaveMesh, this.debrisPoints, this.emberPoints, this.ashPoints].forEach(m => this.scene.remove(m))
    this.smokeLayers.forEach(m => this.scene.remove(m))
    ;[this.chargeMat, this.chargeParticleMat, this.heatGlowMat, this.fireballMat,
      this.fireGlowMat, this.trailMat, this.explosionMat,
      this.shockwaveMat, this.debrisMat, this.emberMat, this.ashMat].forEach(m => m.dispose())
    this.smokeMats.forEach(m => m.dispose())
  }
}
