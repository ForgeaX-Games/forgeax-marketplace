// @source wb-character/src/vfx/effects/MeteorEffect.ts
/**
 *  (MeteorEffect) — 
 * （ 65% ）→  →  +  +  + 
 *
 * （ ）：
 *   effect.trailBrightness  — ，  0.60（  0.4–1.2）
 *   effect.trailAlpha       — ，  0.65（  0.4–0.9）
 *   effect.trailHeight      — ，  1.20（  0.8–2.0）
 *   effect.trailTurbulence  — ，  0.85（  0.3–1.5）
 */

import * as THREE from 'three'

export interface MeteorCallbacks {
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerSlowmo?: (duration: number, scale: number) => void
  /**  */
  emitAsh?: (pos: THREE.Vector3) => void
}

const uvVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

export class MeteorEffect {
  active = false
  phase: 'warning' | 'falling' | 'impact' = 'warning'
  timer = 0

  warningTime  = 1.2
  fallHeight   = 30
  fallSpeed    = 35
  impactRadius = 2.2

  targetPos = new THREE.Vector3()
  meteorPos = new THREE.Vector3()

  warningMesh:   THREE.Mesh;   warningMat:   THREE.ShaderMaterial
  meteorMesh:    THREE.Mesh;   meteorMat:    THREE.ShaderMaterial
  trailMesh:     THREE.Mesh;   trailMat:     THREE.ShaderMaterial
  explosionMesh: THREE.Mesh;   explosionMat: THREE.ShaderMaterial
  shockwaveMesh: THREE.Mesh;   shockwaveMat: THREE.ShaderMaterial
  crackMesh:     THREE.Mesh;   crackMat:     THREE.ShaderMaterial
  rockPoints:    THREE.Points; rockMat:      THREE.ShaderMaterial
  rockPositions: Float32Array; rockVelocities: THREE.Vector3[] = []; rockLifetimes: Float32Array
  rockMaxLifetimes: Float32Array
  rockRandSeed:  Float32Array; rockSizeMult:  Float32Array; rockLifeRatio: Float32Array
  rockCount = 4
  smokeMesh:     THREE.Mesh;   smokeMat:     THREE.ShaderMaterial
  burnDecalMesh: THREE.Mesh;   burnDecalMat: THREE.ShaderMaterial
  private burnDecalTimer = 0
  burnDecalDuration = 5.0
  // （  burnDecal ，impact ）
  private crackTimer = 0
  private crackActive = false

  // ──  ─────────────────────────────────────────────────────
  explosionScale = 1.2   //
  shockwaveScale = 5.5   //
  smokeScale     = 0.5   //
  traumaAmount   = 0.5   //  0-1
  flashIntensity = 0.6   //  0-1

  // ── （getter/setter  uniform）──────────────────────
  get trailBrightness()          { return this.trailMat.uniforms.uBrightness.value }
  set trailBrightness(v: number) { this.trailMat.uniforms.uBrightness.value = v }
  get trailAlpha()               { return this.trailMat.uniforms.uAlpha.value }
  set trailAlpha(v: number)      { this.trailMat.uniforms.uAlpha.value = v }
  get trailHeight()              { return this.trailMat.uniforms.uHeight.value }
  set trailHeight(v: number)     { this.trailMat.uniforms.uHeight.value = v }
  get trailTurbulence()          { return this.trailMat.uniforms.uTurbulence.value }
  set trailTurbulence(v: number) { this.trailMat.uniforms.uTurbulence.value = v }

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private cbs: MeteorCallbacks = {}) {

    // ──  ─────────────────────────────────────────────────────────────
    const warnGeo = new THREE.RingGeometry(0.5, 1, 64)
    this.warningMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        void main(){
          float pulse=sin(uTime*8.0)*0.3+0.7;
          float ring=smoothstep(0.0,0.2,vUv.x)*smoothstep(1.0,0.8,vUv.x);
          gl_FragColor=vec4(vec3(1.0,0.2,0.05)*2.0,ring*pulse*uProgress*0.8);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.warningMesh = new THREE.Mesh(warnGeo, this.warningMat)
    this.warningMesh.visible = false; this.warningMesh.rotation.x = -Math.PI / 2; this.warningMesh.renderOrder = 1998
    scene.add(this.warningMesh)

    // ── （  +  + FBM  +  Fresnel ）────────
    const metGeo = new THREE.IcosahedronGeometry(1.2, 1)
    this.meteorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        uClipY:  { value: -9999 },   //  Y ；y < uClipY
      },
      vertexShader: `
        varying vec3 vNormal, vPosition, vViewDir, vWorldPos;
        float hv(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        void main(){
          float d = hv(position*3.4)*0.20 + hv(position*7.8)*0.09 - 0.14;
          vec3 disp = position + normal * d;
          vNormal   = normalize(normalMatrix * normal);
          vPosition = disp;
          vec4 worldPos = modelMatrix * vec4(disp, 1.0);
          vWorldPos = worldPos.xyz;
          vViewDir  = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(disp, 1.0);}`,
      fragmentShader: `
        uniform float uTime, uClipY; varying vec3 vNormal, vPosition, vViewDir, vWorldPos;
        float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float noise3(vec3 p){
          vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          float a=hash(i),b=hash(i+vec3(1,0,0)),c=hash(i+vec3(0,1,0)),d=hash(i+vec3(1,1,0));
          float e=hash(i+vec3(0,0,1)),ff=hash(i+vec3(1,0,1)),g=hash(i+vec3(0,1,1)),h=hash(i+vec3(1,1,1));
          return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,ff,f.x),mix(g,h,f.x),f.y),f.z);}
        float fbm3(vec3 p){float v=0.,a=0.5;for(int i=0;i<4;i++){v+=a*noise3(p);p*=2.1;a*=0.5;}return v;}
        void main(){
          // （ ）
          if (vWorldPos.y < uClipY) discard;
          float facing = dot(vNormal, normalize(vec3(0.5,1.0,0.3)));
          float facet  = facing*0.5+0.5;
          float rough = hash(floor(vPosition*4.0));
          float hot1 = fbm3(vPosition*2.0);
          float hot2 = fbm3(vPosition*4.6 + vec3(uTime*0.18, 0., uTime*0.13));
          float lavaI = smoothstep(0.52, 0.80, hot1*0.50 + hot2*0.50);
          vec3 darkrock  = vec3(0.05, 0.03, 0.01);
          vec3 midrock   = vec3(0.16, 0.11, 0.07);
          vec3 highrock  = vec3(0.28, 0.20, 0.13);
          vec3 rock = mix(darkrock, midrock, facet*0.65 + rough*0.35);
          rock = mix(rock, highrock, pow(max(facing,0.), 3.0)*0.38);
          vec3 lavaDk  = vec3(0.62, 0.06, 0.01);
          vec3 lavaOrg = vec3(0.92, 0.34, 0.02);
          vec3 lavaAmb = vec3(0.98, 0.68, 0.14);
          vec3 lava = mix(lavaDk, lavaOrg, lavaI);
          lava = mix(lava, lavaAmb, pow(lavaI, 3.0));
          float NdotV   = max(dot(vNormal, vViewDir), 0.0);
          float fresnel = pow(1.0-NdotV, 3.5);
          vec3 fresnelCol = mix(vec3(0.78, 0.16, 0.01), vec3(0.92, 0.55, 0.08), fresnel);
          vec3 lDir = normalize(vec3(0.4, 1.0, 0.3));
          float spec = pow(max(dot(reflect(-lDir,vNormal),vViewDir),0.),18.)*0.18*lavaI;
          vec3 col = mix(rock, lava, lavaI*0.62);
          col = mix(col, fresnelCol, fresnel*0.45);
          col += vec3(1.0, 0.52, 0.12)*spec;
          gl_FragColor = vec4(col, 1.0);}`,
      transparent: true, blending: THREE.NormalBlending, depthWrite: false, depthTest: true,
    })
    this.meteorMesh = new THREE.Mesh(metGeo, this.meteorMat)
    this.meteorMesh.visible = false; this.meteorMesh.renderOrder = 2000
    scene.add(this.meteorMesh)

    // ── （FBM +  + ）───────────────────────────────────────
    const trailGeo = new THREE.PlaneGeometry(2.5, 12, 1, 32)
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:        { value: 0 },
        uBrightness:  { value: 0.60 },
        uAlpha:       { value: 0.65 },
        uHeight:      { value: 1.20 },
        uTurbulence:  { value: 0.85 },
        uColor1:      { value: new THREE.Vector3(0.42, 0.03, 0.00) },
        uColor2:      { value: new THREE.Vector3(0.88, 0.26, 0.02) },
        uColor3:      { value: new THREE.Vector3(0.92, 0.52, 0.06) },
      },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uTime, uBrightness, uAlpha, uHeight, uTurbulence;
        uniform vec3  uColor1, uColor2, uColor3;
        varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.,a=0.5;for(int i=0;i<6;i++){v+=a*noise(p);p*=2.;a*=0.5;}return v;}
        vec3 fireRamp(float t){
          t=clamp(t,0.,1.);
          if(t<0.20)return mix(vec3(0.),uColor1*0.65,t/0.20);
          if(t<0.38)return mix(uColor1*0.65,uColor1,(t-0.20)/0.18);
          if(t<0.56)return mix(uColor1,uColor2,(t-0.38)/0.18);
          if(t<0.74)return mix(uColor2,uColor3,(t-0.56)/0.18);
          return uColor3*(1.0+(t-0.74)/0.26*0.30);}
        void main(){
          float T=uTime;
          float xn   = (vUv.x - 0.5) * 2.0;
          float h    = vUv.y;
          float taper= max(1.0 - h * 0.65, 0.22);
          float side  = xn;
          float maxH  = uHeight * taper;
          float dx=uTurbulence*(0.038*sin(h*6.8+T*2.2+side*1.2)
                               +0.020*sin(h*14.0-T*3.3+side*2.6)
                               +0.010*sin(h*28.0+T*1.8-side*4.0));
          float dy=uTurbulence*0.014*sin(vUv.x*9.0+T*1.4);
          vec2 sUV=vec2(vUv.x+dx, h+dy-T*0.68);
          float n1=fbm(sUV*vec2(2.6,2.1));
          float n2=fbm(sUV*vec2(5.2,4.1)+vec2(4.3,0.));
          float n3=fbm(sUV*vec2(10.5,8.5)+vec2(0.,2.0));
          float n=n1*0.55+n2*0.30+n3*0.15;
          float fire=n - h/max(maxH,0.01);
          fire=clamp(fire*2.6,0.,1.); fire=pow(fire,1.1);
          vec3 col=fireRamp(fire)*uBrightness;
          float core=pow(fire,4.0)*pow(max(1.0-h*2.8,0.0),1.5);
          col+=uColor2*core*0.42*uBrightness;
          vec2 eUV=vec2(vUv.x+dx*0.5, h-T*0.48);
          float eid =hash(floor(eUV*vec2(18.,28.)));
          float eid2=hash(floor(eUV*vec2(18.,28.))+vec2(1.,0.));
          float ember=step(0.995,eid);
          col+=(uColor3*1.1+vec3(0.10,0.02,0.))*ember*eid2*(1.-h)
               *smoothstep(0.02,0.28,fire)*uBrightness;
          float kFocus = 2.4 + (1.0-h)*2.8;
          float radial = exp(-xn*xn * kFocus / max(taper,0.01));
          float xnN   = xn + (n-0.5)*0.55*taper;
          float edgeF  = smoothstep(1.30, 0.08, abs(xnN));
          float spine  = exp(-xn*xn*18.0);
          float alpha = radial * edgeF * clamp(fire*3.8,0.,1.) * uAlpha;
          if(alpha<0.005)discard;
          gl_FragColor=vec4(col*(1.0+spine*(1.0-h)*0.6), alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.trailMesh = new THREE.Mesh(trailGeo, this.trailMat)
    this.trailMesh.visible = false; this.trailMesh.renderOrder = 1999
    scene.add(this.trailMesh)

    // ── （3D  +  +  + ）──────────────────
    this.explosionMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal, vPos, vViewDir;
        void main(){
          vNormal  = normalize(normalMatrix * normal);
          vPos     = position;
          vec4 wp  = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,
      fragmentShader: `
        uniform float uProgress, uTime; varying vec3 vNormal, vPos, vViewDir;
        float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          float a=hash3(i),b=hash3(i+vec3(1,0,0)),c=hash3(i+vec3(0,1,0)),d=hash3(i+vec3(1,1,0));
          float e=hash3(i+vec3(0,0,1)),ff=hash3(i+vec3(1,0,1)),g=hash3(i+vec3(0,1,1)),h=hash3(i+vec3(1,1,1));
          vec3 u=f*f*(3.0-2.0*f);
          return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,ff,u.x),mix(g,h,u.x),u.y),u.z);}
        float fbm3(vec3 p){float v=0.,a=0.5;for(int i=0;i<5;i++){v+=a*n3(p);p*=2.2;a*=0.5;}return v;}
        vec3 fireRamp(float t){
          t=clamp(t,0.,1.);
          vec3 coal=vec3(0.06,0.02,0.005),dkred=vec3(0.55,0.05,0.005),red=vec3(0.88,0.12,0.01),orange=vec3(1.0,0.40,0.02),amber=vec3(1.0,0.78,0.14);
          if(t<0.2)return mix(coal,dkred,t/0.2);
          if(t<0.4)return mix(dkred,red,(t-0.2)/0.2);
          if(t<0.6)return mix(red,orange,(t-0.4)/0.2);
          if(t<0.8)return mix(orange,amber,(t-0.6)/0.2);
          return amber;}
        void main(){
          vec3 N = normalize(vNormal); vec3 V = normalize(vViewDir);
          float facing = max(dot(N, V), 0.0);
          float rim    = pow(1.0 - facing, 2.8);
          float scroll = uTime * 0.55;
          vec3 p1 = vPos*2.0 + vec3(uTime*0.7,  -scroll,      uTime*0.10);
          vec3 p2 = vPos*4.5 + vec3(uTime*0.22, -scroll*1.2,  uTime*0.35);
          vec3 p3 = vPos*9.0 + vec3(uTime*0.14, -scroll*0.8, -uTime*0.28);
          float noiseV = fbm3(p1)*0.52 + fbm3(p2)*0.35 + fbm3(p3)*0.13;
          float upBias = clamp(vPos.y * 0.55, 0.0, 0.45);
          float erode  = smoothstep(uProgress*1.05 - noiseV*0.45 + upBias*0.2,
                                    uProgress*1.05 + 0.16, 0.5);
          float body   = clamp(erode, 0.0, 1.0);
          float coreDist= 1.0 - length(vPos);
          float coreHeat= clamp(coreDist*1.4 - uProgress*1.2, 0.0, 1.0);
          float lateDim  = smoothstep(0.32, 0.88, uProgress);
          float brightness= mix(1.0, 0.08, lateDim);
          float fireI = clamp(noiseV*0.48 + rim*0.22 + coreHeat*0.32 - uProgress*0.50 - upBias, 0.0, 1.0);
          vec3 col    = fireRamp(fireI * body) * body;
          vec3 rimCol = mix(vec3(1.0,0.42,0.06), vec3(1.0,0.82,0.20), rim);
          col = mix(col, rimCol*1.8, pow(rim,2.8)*body*0.48*(1.0-lateDim*0.75));
          col += vec3(1.0,0.90,0.60)*pow(coreHeat, 2.5)*body*(1.0-lateDim)*0.55;
          float alpha = body*(0.18 + rim*rim*0.58 + coreHeat*0.20)*(1.0-uProgress*0.92)*0.80;
          if(alpha < 0.005) discard;
          gl_FragColor = vec4(col*brightness, alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.explosionMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 14), this.explosionMat)
    this.explosionMesh.visible = false; this.explosionMesh.renderOrder = 2002
    scene.add(this.explosionMesh)

    // ── （ 5 ：AdditiveBlending ）────────────
    //  AdditiveBlending： ，
    this.burnDecalMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0.0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uFade, uTime; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec2 uv = vUv*2.0-1.0; float dist = length(uv);
          if(dist > 1.0) discard;
          float fadeIn  = smoothstep(0.0, 0.08, uFade);
          float fadeOut = 1.0 - smoothstep(0.40, 1.0, uFade);
          float tf      = fadeIn * fadeOut;
          if(tf < 0.002) discard;
          // ： ，  uFade 
          float edgeGlow = exp(-pow(dist - 0.78, 2.0) * 20.0) * (1.0 - smoothstep(0.0, 0.55, uFade));
          // ： 
          float n1 = noise(uv*3.5 + uTime*0.08);
          float centerGlow = exp(-dist*dist*5.5) * (0.18 + n1*0.12) * (1.0 - smoothstep(0.0, 0.85, uFade));
          float glow = edgeGlow * 0.55 + centerGlow;
          if(glow < 0.002) discard;
          // 、 ， 
          vec3 col = mix(vec3(0.85,0.22,0.02), vec3(0.70,0.12,0.01), dist);
          // AdditiveBlending ：result = src_color * src_alpha + dst
          //  alpha，color 
          gl_FragColor = vec4(col, glow * tf);}`,
      // AdditiveBlending： ，
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.burnDecalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), this.burnDecalMat)
    this.burnDecalMesh.rotation.x = -Math.PI / 2
    this.burnDecalMesh.visible     = false
    this.burnDecalMesh.renderOrder = 1995
    scene.add(this.burnDecalMesh)

    // ── （  + ）────────────────────────────────────
    this.shockwaveMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress; varying vec2 vUv;
        float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c);
          float front=uProgress;
          float angle=atan(c.y,c.x);
          float nEdge=noise2(vec2(angle*2.8,front*6.0))*0.048 - 0.024;
          float distN=dist+nEdge;
          float ring=exp(-pow(distN-front,2.0)*80.0)*(1.0-uProgress);
          float fill=smoothstep(front+0.05,front-0.12,distN)*(1.0-uProgress)*0.30;
          float ring2=exp(-pow(distN-(front-0.08),2.0)*200.0)*(1.0-uProgress)*0.45;
          float core=exp(-dist*dist*18.0)*(1.0-uProgress*1.4)*0.50;
          float mask=smoothstep(1.02,0.72,dist);
          vec3 dkred=vec3(0.60,0.08,0.01),orange=vec3(1.0,0.38,0.04),amber=vec3(1.0,0.78,0.18);
          vec3 col=mix(dkred,orange,clamp(fill*2.0+ring*0.4,0.,1.));
          col=mix(col,amber,ring*0.65+ring2*0.55+core*0.8);
          float hotEdge=exp(-pow(distN-front,2.0)*400.0)*(1.0-uProgress)*0.60;
          col=mix(col,vec3(1.0,0.92,0.62),hotEdge);
          float alpha=(ring*0.82+fill*0.28+ring2*0.38+core*0.50+hotEdge*0.55)*mask;
          if(alpha<0.005)discard;
          gl_FragColor=vec4(col*1.4,alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.shockwaveMesh = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64), this.shockwaveMat)
    this.shockwaveMesh.visible = false; this.shockwaveMesh.rotation.x = -Math.PI / 2; this.shockwaveMesh.renderOrder = 1997
    scene.add(this.shockwaveMesh)

    // ── （ ：NormalBlending  + ）──────
    const crackGeo = new THREE.PlaneGeometry(10, 10)
    this.crackMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv);
          float crackLen=0.90*min(uProgress*2.5,1.0); // 40% ， 
          float cracks=0.0;
          for(int i=0;i<10;i++){
            float fi=float(i);
            float a=fi*0.6283+hash(vec2(fi,0.0))*0.72;
            vec2 dir=vec2(cos(a),sin(a));
            vec2 perp=vec2(-dir.y,dir.x);
            float len=dot(uv,dir);
            if(len>0.0&&len<crackLen){
              float t=len/max(crackLen,0.001);
              //  kink
              float kt1=0.25+hash(vec2(fi,8.0))*0.22;
              float kt2=0.54+hash(vec2(fi,9.0))*0.20;
              float kd1=(hash(vec2(fi,10.0))-0.5)*0.58;
              float kd2=(hash(vec2(fi,11.0))-0.5)*0.42;
              float bend=0.0;
              if(t>kt1) bend+=(t-kt1)*kd1*crackLen*0.60;
              if(t>kt2) bend+=(t-kt2)*kd2*crackLen*0.42;
              bend+=(noise(vec2(len*7.0+a,1.4))*2.0-1.0)*0.016;
              float d=abs(dot(uv,perp)-bend);
              float w=0.009+hash(vec2(a,len*2.0))*0.007+len*0.002;
              float cr=smoothstep(w,0.0,d)*(1.0-t*0.25);
              cracks+=cr;
              // 
              if(t>kt1+0.05){
                float ba=a+(hash(vec2(a*2.1,3.7))-0.5)*1.1;
                vec2 bdir=vec2(cos(ba),sin(ba));
                vec2 bbase=dir*crackLen*kt1;
                float blen=dot(uv-bbase,bdir);
                if(blen>0.0&&blen<crackLen*0.32){
                  float bt=blen/max(crackLen*0.32,0.001);
                  float bbend=(bt>0.4)?(bt-0.4)*(hash(vec2(ba,7.0))-0.5)*0.3*crackLen*0.32*0.5:0.0;
                  bbend+=(noise(vec2(blen*5.0+ba,2.8))*2.0-1.0)*0.010;
                  float bd=abs(dot(uv-bbase,vec2(-bdir.y,bdir.x))-bbend);
                  cracks+=smoothstep(0.007,0.0,bd)*(1.0-bt)*0.55;
                }
              }
            }
          }
          cracks=clamp(cracks,0.0,1.0);
          if(cracks<0.01) discard;

          // ： ，  uProgress=0.15， 
          float hotFade=smoothstep(0.15,0.02,uProgress);
          // ： ， 
          vec3 stone=vec3(0.12,0.07,0.03);
          // ， 
          vec3 hot=vec3(0.55,0.10,0.01)*hotFade*0.6;
          vec3 col=stone+hot*cracks;

          // ：  uProgress=1.0
          float fadeOut=1.0-smoothstep(0.72,1.0,uProgress);
          float alpha=cracks*(0.55+hotFade*0.10)*fadeOut*(1.0-dist*0.22);
          if(alpha<0.005)discard;
          gl_FragColor=vec4(col,alpha);}`,
      // NormalBlending： （ ），
      transparent: true, blending: THREE.NormalBlending, depthWrite: false,
      depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    })
    this.crackMesh = new THREE.Mesh(crackGeo, this.crackMat)
    this.crackMesh.visible = false; this.crackMesh.rotation.x = -Math.PI / 2; this.crackMesh.renderOrder = 1996
    scene.add(this.crackMesh)

    // ── （ SDF +  + ）──────────────────────────
    this.rockPositions   = new Float32Array(this.rockCount * 3)
    this.rockLifetimes   = new Float32Array(this.rockCount)
    this.rockMaxLifetimes= new Float32Array(this.rockCount)
    this.rockRandSeed    = new Float32Array(this.rockCount)
    this.rockSizeMult    = new Float32Array(this.rockCount)
    this.rockLifeRatio   = new Float32Array(this.rockCount)
    const rockGeo = new THREE.BufferGeometry()
    rockGeo.setAttribute('position',  new THREE.BufferAttribute(this.rockPositions,  3))
    rockGeo.setAttribute('randSeed',  new THREE.BufferAttribute(this.rockRandSeed,   1))
    rockGeo.setAttribute('sizeMult',  new THREE.BufferAttribute(this.rockSizeMult,   1))
    rockGeo.setAttribute('lifeRatio', new THREE.BufferAttribute(this.rockLifeRatio,  1))
    this.rockMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float randSeed; attribute float sizeMult; attribute float lifeRatio;
        varying float vSeed; varying float vLife;
        void main(){
          vSeed = randSeed; vLife = lifeRatio;
          vec4 m = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(sizeMult * 0.38 * 350.0 * (1.0 / -m.z), 4.0, 72.0);
          gl_Position  = projectionMatrix * m;}`,
      fragmentShader: `
        varying float vSeed; varying float vLife;
        void main(){
          vec2  p   = gl_PointCoord - 0.5;
          float rot = vSeed * 6.2832;
          float c = cos(rot), s = sin(rot);
          vec2  rp  = vec2(p.x*c - p.y*s, p.x*s + p.y*c);
          float sides = floor(3.0 + fract(vSeed*7.31)*3.0);
          float ang2  = 6.28318 / sides;
          float ang   = atan(rp.y, rp.x);
          float poly  = cos(floor(0.5 + ang/ang2)*ang2 - ang) * length(rp) * 2.0;
          if(poly > 0.95) discard;
          float edge  = clamp(poly / 0.95, 0.0, 1.0);
          vec3 stone = mix(vec3(0.22,0.14,0.08), vec3(0.45,0.30,0.18), fract(vSeed*3.7));
          vec3 hot   = mix(vec3(0.82,0.22,0.02), vec3(1.00,0.58,0.10), fract(vSeed*5.1));
          vec3 col   = mix(stone, hot, pow(edge, 1.6)*0.85);
          float fade  = 1.0 - smoothstep(0.6, 1.0, vLife);
          float alpha = mix(1.0, 0.45, edge*edge) * fade;
          if(alpha < 0.01) discard;
          gl_FragColor = vec4(col * mix(0.9, 2.4, edge), alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    })
    this.rockPoints = new THREE.Points(rockGeo, this.rockMat)
    this.rockPoints.visible = false; this.rockPoints.renderOrder = 2003
    scene.add(this.rockPoints)
    for (let i = 0; i < this.rockCount; i++) this.rockVelocities.push(new THREE.Vector3())

    // ──  ────────────────────────────────────────────────────────────────
    const smokeGeo = new THREE.PlaneGeometry(10, 10)
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv);
          float n=noise(uv*2.5+uTime*0.4);
          float n2=noise(uv*5.0-uTime*0.3);
          float circleMask=smoothstep(1.0,0.45,dist);
          float smoke=smoothstep(0.95,0.0,dist)*(0.45+n*0.38+n2*0.17);
          // AdditiveBlending： ， 
          // （ash）， 
          float alpha=smoke*uProgress*(1.0-uProgress)*0.55*circleMask;
          gl_FragColor=vec4(vec3(0.38,0.28,0.20)*alpha,alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.smokeMesh = new THREE.Mesh(smokeGeo, this.smokeMat)
    this.smokeMesh.visible = false; this.smokeMesh.renderOrder = 2001
    scene.add(this.smokeMesh)
  }

  cast(targetPos: THREE.Vector3) {
    this.active = true; this.phase = 'warning'; this.timer = 0
    this.targetPos.copy(targetPos)
    this.meteorPos.set(targetPos.x, this.fallHeight, targetPos.z)
    //  Y（ ， ）
    this.meteorMat.uniforms.uClipY.value = targetPos.y
    this.warningMesh.position.copy(targetPos); this.warningMesh.position.y = targetPos.y + 0.22
    this.warningMesh.visible = true; this.warningMesh.scale.setScalar(this.impactRadius)
    this.meteorMesh.visible = false; this.trailMesh.visible = false
    this.burnDecalMesh.visible = false; this.burnDecalTimer = 0
    this.crackMesh.visible = false; this.crackTimer = 0; this.crackActive = false
    for (let i = 0; i < this.rockCount; i++) {
      this.rockLifetimes[i] = 0; this.rockLifeRatio[i] = 1
      this.rockPositions[i * 3 + 1] = targetPos.y - 100
    }
    this.rockPoints.geometry.attributes.position.needsUpdate = true
  }

  update(dt: number) {
    if (!this.active) return
    this.timer += dt
    const time = performance.now() * 0.001
    this.warningMat.uniforms.uTime.value = time
    this.meteorMat.uniforms.uTime.value  = time
    this.trailMat.uniforms.uTime.value   = time
    this.crackMat.uniforms.uTime.value   = time
    this.smokeMat.uniforms.uTime.value   = time

    // ──  ────────────────────────────────────────────────────────────
    if (this.phase === 'warning') {
      const p = Math.min(this.timer / this.warningTime, 1)
      const APPEAR_IN   = 0.08
      const FADE_START  = 0.65

      const warnAlpha = p < APPEAR_IN
        ? p / APPEAR_IN
        : p < FADE_START ? 1.0
        : Math.max(0, 1.0 - (p - FADE_START) / (1.0 - FADE_START))
      this.warningMat.uniforms.uProgress.value = warnAlpha
      this.warningMesh.scale.setScalar(this.impactRadius * (0.8 + Math.sin(time * 10) * 0.1))

      if (p >= FADE_START) {
        this.meteorMesh.visible = true
        this.trailMesh.visible  = true
        const earlyT = (p - FADE_START) / (1.0 - FADE_START)
        this.meteorPos.y = this.fallHeight - earlyT * this.fallHeight * 0.38
        this.meteorMesh.position.copy(this.meteorPos)
        this.meteorMesh.rotation.x += dt * 3
        this.meteorMesh.rotation.z += dt * 2
        this.trailMesh.position.copy(this.meteorPos); this.trailMesh.position.y += 6
        this.trailMesh.quaternion.copy(this.camera.quaternion)
      }

      if (p >= 1) {
        this.phase = 'falling'; this.timer = 0
        this.warningMesh.visible = false
      }
    }

    // ──  ────────────────────────────────────────────────────────────
    if (this.phase === 'falling') {
      this.meteorPos.y -= this.fallSpeed * dt
      this.meteorMesh.position.copy(this.meteorPos)
      this.meteorMesh.rotation.x += dt * 3; this.meteorMesh.rotation.z += dt * 2
      this.trailMesh.position.copy(this.meteorPos); this.trailMesh.position.y += 6
      this.trailMesh.quaternion.copy(this.camera.quaternion)
      if (this.meteorPos.y <= this.targetPos.y + 0.5) this.triggerImpact()
    }

    // ──  ────────────────────────────────────────────────────────────
    if (this.phase === 'impact') {
      const p = Math.min(this.timer / 0.9, 1)
      this.explosionMat.uniforms.uProgress.value = p
      this.explosionMat.uniforms.uTime.value     = time
      this.explosionMesh.scale.setScalar(1 + p * this.explosionScale)
      this.shockwaveMat.uniforms.uProgress.value = p
      this.shockwaveMesh.scale.setScalar(1 + p * this.shockwaveScale)
      this.crackMat.uniforms.uProgress.value = Math.min(p * 2, 1)
      this.smokeMat.uniforms.uProgress.value = p
      this.smokeMesh.scale.setScalar(1 + p * this.smokeScale)
      this.smokeMesh.position.y = this.targetPos.y + p * 1.8
      this.smokeMesh.quaternion.copy(this.camera.quaternion)
      this.updateRocks(dt)
      if (p >= 1) {
        ;[this.explosionMesh, this.shockwaveMesh, this.smokeMesh].forEach(m => { m.visible = false })
        this.active = false
        this.rockPoints.visible = false
        // crackMesh  crackTimer ，
      }
    }

    // ──  ────────────────────────────────────────────────────────
    if (this.burnDecalMesh.visible) {
      this.burnDecalTimer += dt
      const fadeVal = Math.min(this.burnDecalTimer / this.burnDecalDuration, 1.0)
      this.burnDecalMat.uniforms.uFade.value = fadeVal
      this.burnDecalMat.uniforms.uTime.value = time
      if (fadeVal >= 1.0) this.burnDecalMesh.visible = false
    }

    // ── （ ，  burnDecal ）─────────────────────────────
    if (this.crackActive && this.crackMesh.visible) {
      this.crackTimer += dt
      // uProgress  0-1 ： 0.4s ，
      const crackP = Math.min(this.crackTimer / (this.burnDecalDuration * 0.95), 1.0)
      this.crackMat.uniforms.uProgress.value = crackP
      this.crackMat.uniforms.uTime.value     = time
      if (crackP >= 1.0) {
        this.crackMesh.visible = false
        this.crackActive = false
      }
    }
  }

  private triggerImpact() {
    this.phase = 'impact'; this.timer = 0
    this.meteorMesh.visible = false; this.trailMesh.visible = false

    this.explosionMesh.position.set(this.targetPos.x, this.targetPos.y - 0.4, this.targetPos.z)
    this.explosionMesh.visible = true
    this.shockwaveMesh.position.copy(this.targetPos)
    this.shockwaveMesh.position.y = this.targetPos.y + 0.22; this.shockwaveMesh.visible = true; this.shockwaveMesh.scale.setScalar(1)
    // crackMesh （NormalBlending ）
    this.crackMesh.visible = false
    this.smokeMesh.position.copy(this.targetPos); this.smokeMesh.visible = true

    this.rockPoints.position.set(0, 0, 0); this.rockPoints.visible = true
    for (let i = 0; i < this.rockCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const elev  = Math.random() * Math.PI * 0.25 + 0.05
      const speed = 4 + Math.random() * 7
      this.rockPositions[i * 3]     = this.targetPos.x + (Math.random() - 0.5) * 0.4
      this.rockPositions[i * 3 + 1] = this.targetPos.y + 0.1
      this.rockPositions[i * 3 + 2] = this.targetPos.z + (Math.random() - 0.5) * 0.4
      this.rockVelocities[i].set(
        Math.cos(angle) * Math.cos(elev) * speed,
        Math.sin(elev) * speed * 1.2,
        Math.sin(angle) * Math.cos(elev) * speed,
      )
      const life = 0.5 + Math.random() * 0.5
      this.rockLifetimes[i]    = life
      this.rockMaxLifetimes[i] = life
      this.rockLifeRatio[i]    = 0
      this.rockRandSeed[i]  = Math.random()
      this.rockSizeMult[i]  = 0.6 + Math.random() * 1.4
    }
    this.rockPoints.geometry.attributes.position.needsUpdate  = true
    this.rockPoints.geometry.attributes.randSeed.needsUpdate  = true
    this.rockPoints.geometry.attributes.sizeMult.needsUpdate  = true
    this.rockPoints.geometry.attributes.lifeRatio.needsUpdate = true

    // burnDecalMesh （ ）
    this.burnDecalMesh.visible = false
    this.burnDecalTimer = 0
    //  timer
    this.crackTimer = 0
    this.crackActive = true

    this.cbs.addTrauma?.(this.traumaAmount)
    this.cbs.triggerFlash?.(255, 100, 30, 100, this.flashIntensity)
    this.cbs.triggerSlowmo?.(200, 0.25)
    this.cbs.emitAsh?.(this.targetPos.clone())
  }

  private updateRocks(dt: number) {
    for (let i = 0; i < this.rockCount; i++) {
      if (this.rockLifetimes[i] <= 0) {
        this.rockLifeRatio[i] = 1.0
        continue
      }
      this.rockLifetimes[i] -= dt
      const maxL = this.rockMaxLifetimes[i] > 0 ? this.rockMaxLifetimes[i] : 1.0
      this.rockLifeRatio[i] = Math.max(0, 1.0 - this.rockLifetimes[i] / maxL)
      if (this.rockLifetimes[i] <= 0) {
        this.rockLifeRatio[i] = 1.0
        continue
      }
      this.rockVelocities[i].y -= 22 * dt
      this.rockPositions[i * 3]     += this.rockVelocities[i].x * dt
      this.rockPositions[i * 3 + 1] += this.rockVelocities[i].y * dt
      this.rockPositions[i * 3 + 2] += this.rockVelocities[i].z * dt
      if (this.rockPositions[i * 3 + 1] < this.targetPos.y) {
        this.rockPositions[i * 3 + 1] = this.targetPos.y
        this.rockVelocities[i].y *= -0.18
        this.rockVelocities[i].x *= 0.55
        this.rockVelocities[i].z *= 0.55
      }
    }
    this.rockPoints.geometry.attributes.position.needsUpdate  = true
    this.rockPoints.geometry.attributes.lifeRatio.needsUpdate = true
  }

  dispose() {
    ;[this.warningMesh, this.meteorMesh, this.trailMesh, this.explosionMesh,
      this.shockwaveMesh, this.crackMesh, this.rockPoints, this.smokeMesh, this.burnDecalMesh,
    ].forEach(m => this.scene.remove(m))
    ;[this.warningMat, this.meteorMat, this.trailMat, this.explosionMat,
      this.shockwaveMat, this.crackMat, this.rockMat, this.smokeMat, this.burnDecalMat,
    ].forEach(m => m.dispose())
  }
}
