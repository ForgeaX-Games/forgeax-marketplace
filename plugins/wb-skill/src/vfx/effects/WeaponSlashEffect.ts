// @source wb-character/src/vfx/effects/WeaponSlashEffect.ts
/**
 * WeaponSlashEffect —  (Enhanced)
 *
 * ：
 *   L1       /  
 *   L2a   ×2    
 *   L2b   ×2    
 *   L3       → →   
 *   L4       /  +   
 *   L5         /   
 *   L6  
 */

import * as THREE from 'three'

const uvVert = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

const DEBRIS_COUNT = 20

// ─────────────────────────────────────────────────────────────────────────────
export class WeaponSlashEffect {
  active   = false
  private timer = 0

  ringRadius  = 1.2
  slashLength = 1.0
  vortexSize  = 1.0
  duration    = 0.60

  // L1
  private groundRingMesh!: THREE.Mesh
  private groundRingMat!:  THREE.ShaderMaterial
  // L2a
  private slashMesh1!: THREE.Mesh; private slashMat1!: THREE.ShaderMaterial
  private slashMesh2!: THREE.Mesh; private slashMat2!: THREE.ShaderMaterial
  // L2b （ ）
  private perpMesh1!: THREE.Mesh; private perpMat1!: THREE.ShaderMaterial
  private perpMesh2!: THREE.Mesh; private perpMat2!: THREE.ShaderMaterial
  // L3
  private vortexMesh!: THREE.Mesh; private vortexMat!: THREE.ShaderMaterial
  // L4
  private tendrilMesh!: THREE.Mesh; private tendrilMat!: THREE.ShaderMaterial
  // L6
  private debrisPoints!:       THREE.Points
  private debrisMat!:          THREE.ShaderMaterial
  private debrisPositions!:    Float32Array
  private debrisVelocities:    THREE.Vector3[] = []
  private debrisLifetimes!:    Float32Array
  private debrisMaxLifetimes!: Float32Array
  private debrisRandSeed!:     Float32Array
  private debrisSizeMult!:     Float32Array
  private debrisLifeRatio!:    Float32Array

  private targetPos = new THREE.Vector3()

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    this.buildGroundRing()
    this.buildHorizSlashes()
    this.buildPerpSlashes()
    this.buildVortex()
    this.buildTendrils()
    this.buildDebris()
  }

  // ── L1 （ ， ） ──────────────────────────
  private buildGroundRing() {
    this.groundRingMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uSweep: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uSweep; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        // ：  n>thr ，pow → 
        float spike(float n,float thr,float sharp){
          float v=max(0.0,(n-thr)/(1.0-thr)); return pow(v,sharp);}
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c);
          if(dist>1.50)discard;
          float PI=3.14159265;
          float ang=atan(c.x,-c.y);
          float angNorm=(ang+PI)/(2.0*PI);
          float leadSoft=smoothstep(uSweep,uSweep-0.05,angNorm);
          if(angNorm>uSweep+0.001)discard;
          float fadeOut=1.0-smoothstep(0.52,1.0,uProgress);
          if(fadeOut<0.002)discard;

          // ── （ ）──
          float nW1=noise(vec2(angNorm*2.3,0.50));
          float nW2=noise(vec2(angNorm*5.1,1.90));
          float widthMod=nW1*0.32+nW2*0.14; // 0~0.46， 

          // ── （ ）──
          //  0.62，  2.8 → 
          float sO1=spike(noise(vec2(angNorm*7.1,3.10)),0.62,2.8)*0.30;
          float sO2=spike(noise(vec2(angNorm*11.4,5.50)),0.65,3.5)*0.20;
          float sO3=spike(noise(vec2(angNorm*18.7,8.20)),0.70,2.5)*0.12;
          float outerSpike=sO1+sO2+sO3; //  ~0.62， 

          // ── （ ）──
          float sI1=spike(noise(vec2(angNorm*6.3+0.41,4.20)),0.60,3.0)*0.26;
          float sI2=spike(noise(vec2(angNorm*10.9+0.73,6.70)),0.65,2.8)*0.16;
          float innerSpike=sI1+sI2;

          // ──  &  ──
          float baseOuter=0.82;
          float outerR=baseOuter+outerSpike; //  ~1.44（  PlaneGeometry ）
          float innerR=baseOuter-0.07-widthMod-innerSpike;
          innerR=clamp(innerR,0.20,outerR-0.03);

          //  mask（ ）
          float outerMask=smoothstep(outerR+0.02,outerR-0.01,dist);
          //  mask（ ）
          float innerMask=smoothstep(innerR-0.01,innerR+0.03,dist);
          float ringMask=outerMask*innerMask;
          if(ringMask<0.005)discard;

          // ──  ──
          float t=clamp((dist-innerR)/(outerR-innerR),0.0,1.0);
          vec3 col=vec3(0.06,0.01,0.00);
          col=mix(col,vec3(0.26,0.02,0.00),smoothstep(0.85,0.50,t));
          col=mix(col,vec3(0.46,0.03,0.00),smoothstep(0.45,0.08,t));
          // ── / ：  2D  ──
          // ： 
          float pA=noise(c*2.2+vec2(0.31,0.74));
          float pB=noise(c*4.5+vec2(1.15,2.10));
          float pC=noise(c*7.0+vec2(3.40,0.60));
          //  =  + 
          float warmStrong=smoothstep(0.50,0.80,pA)*0.80+smoothstep(0.60,0.85,pB)*0.45;
          float warmFine  =smoothstep(0.55,0.78,pC)*0.30;
          // （ ）
          float warmMask=ringMask*smoothstep(0.92,0.70,t); // 
          // ：+10% / 
          col=mix(col,vec3(0.53,0.22,0.01),warmMask*warmStrong*1.00);
          // ：+10% / 
          col=mix(col,vec3(0.42,0.31,0.01),warmMask*warmFine*0.94);
          // （ ）
          float tipDark=smoothstep(outerR-0.06,outerR,dist);
          col=mix(col,vec3(0.02,0.00,0.00),tipDark*0.96);

          float alpha=ringMask*0.93*fadeOut*leadSoft;
          alpha=clamp(alpha,0.0,1.0);
          if(alpha<0.01)discard;
          gl_FragColor=vec4(col,alpha);}`,
      transparent: true, blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    // PlaneGeometry：UV ，
    this.groundRingMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), this.groundRingMat)
    this.groundRingMesh.rotation.x = -Math.PI / 2
    this.groundRingMesh.visible = false; this.groundRingMesh.renderOrder = 1994
    this.scene.add(this.groundRingMesh)
  }

  // ── L2a  ──────────────────────────────────────────────────────
  private buildHorizSlashes() {
    // ： ，
    const frag = `
      uniform float uAlpha; varying vec2 vUv;
      void main(){
        float cx=abs(vUv.x-0.5)*2.0; // 0=  1= 
        float cy=abs(vUv.y-0.5)*2.0; // 0=  1= 
        if(cx>0.999)discard;
        //  cx ：cx=0 ，cx=1  0（ ）
        float taper=pow(1.0-pow(cx,1.2),0.55);
        float halfW=taper;
        float widFade=exp(-cy*cy/(max(halfW*halfW*0.22,0.0001)));
        // ： ， （ ）
        float lenBright=pow(1.0-pow(cx,2.0),0.5);
        float glow=lenBright*widFade;
        if(glow<0.006)discard;
        float hotness=pow(glow,1.4);
        vec3 col=mix(vec3(1.0,0.04,0.01),vec3(1.0,0.85,0.80),hotness);
        gl_FragColor=vec4(col*1.8,glow*uAlpha);}`
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 1.0 } },
        vertexShader: uvVert, fragmentShader: frag,
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.12), mat)
      mesh.visible = false; mesh.renderOrder = 2008   //
      this.scene.add(mesh)
      if (i === 0) { this.slashMesh1 = mesh; this.slashMat1 = mat }
      else          { this.slashMesh2 = mesh; this.slashMat2 = mat }
    }
  }

  // ── L2b （ ， ， ） ───────────────────
  private buildPerpSlashes() {
    //  L2a ，  cy （ ）
    const frag = `
      uniform float uAlpha; varying vec2 vUv;
      void main(){
        float cy=abs(vUv.y-0.5)*2.0; // 0=  1= （ ）
        float cx=abs(vUv.x-0.5)*2.0; // 0=  1= 
        if(cy>0.999)discard;
        float taper=pow(1.0-pow(cy,1.2),0.55);
        float halfW=taper;
        float widFade=exp(-cx*cx/(max(halfW*halfW*0.22,0.0001)));
        float lenBright=pow(1.0-pow(cy,2.0),0.5);
        float glow=lenBright*widFade;
        if(glow<0.006)discard;
        float hotness=pow(glow,1.4);
        // （glow  alpha  1）， 
        // NormalBlending 
        float alpha=min(pow(glow,0.6)*1.2,1.0)*uAlpha;
        vec3 col=mix(vec3(0.90,0.03,0.01),vec3(1.0,0.60,0.55),hotness);
        gl_FragColor=vec4(col,alpha);}`
    const tilts = [0.38, -0.38]   // ，  X
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 1.0 } },
        vertexShader: uvVert, fragmentShader: frag,
        transparent: true, blending: THREE.NormalBlending,  // ，
        depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 3.2), mat)
      mesh.visible = false; mesh.renderOrder = 2011   //
      this.scene.add(mesh)
      if (i === 0) { this.perpMesh1 = mesh; this.perpMat1 = mat; (mesh as any).__tilt = tilts[0] }
      else          { this.perpMesh2 = mesh; this.perpMat2 = mat; (mesh as any).__tilt = tilts[1] }
    }
  }

  // ── L3 （ → →  ） ───────────────────────────────
  private buildVortex() {
    this.vortexMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.,a=0.5;for(int i=0;i<6;i++){v+=a*noise(p);p*=2.3;a*=0.5;}return v;}
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv);
          if(dist>1.05)discard;
          float ang=atan(uv.y,uv.x);
          float swirl=ang-dist*7.0+uTime*4.0;
          vec2 sw=vec2(cos(swirl),sin(swirl))*dist;
          float n1=fbm(sw*3.0+uTime*0.4);
          float n2=fbm(sw*6.5-uTime*0.6);
          float nv=n1*0.55+n2*0.45;
          // → 
          float expand  =smoothstep(0.0,0.20,uProgress);
          float contract=1.0-smoothstep(0.55,1.0,uProgress);
          float scale=expand*contract;
          float outerR=scale*0.90;
          float innerR=outerR*0.82;  // ， 
          // （ ）
          float edgeNoise=nv*0.18;
          float outerMask=smoothstep(outerR+0.07+edgeNoise,outerR-0.10,dist);
          // （ ）
          float innerNoise=nv*0.12;
          float innerCut=smoothstep(innerR-0.06+innerNoise,innerR+0.10,dist);
          float ringMask=outerMask*innerCut;
          if(ringMask<0.005)discard;
          // 
          float rim=exp(-pow(dist-outerR*0.97,2.0)*40.0)*nv;
          float fadeIn =smoothstep(0.0,0.08,uProgress);
          float fadeOut=1.0-smoothstep(0.62,1.0,uProgress);
          float alpha=(ringMask*0.95+rim*0.50)*fadeIn*fadeOut;
          alpha=clamp(alpha,0.0,1.0);
          if(alpha<0.004)discard;
          // ： → → （ /  Bloom）
          vec3 nearBlack=vec3(0.05,0.01,0.00);
          vec3 darkBrown=vec3(0.20,0.05,0.01);
          vec3 darkRed  =vec3(0.45,0.03,0.00);
          // t=0 ，t=1 
          float t=clamp((dist-innerR)/(outerR-innerR),0.0,1.0);
          vec3 col=nearBlack;
          col=mix(col,darkBrown,smoothstep(0.5,0.2,t));
          col=mix(col,darkRed,  smoothstep(0.2,0.0,t));
          col=mix(col,darkBrown,smoothstep(0.1,0.45,nv));
          gl_FragColor=vec4(col,alpha);}`,
      transparent: true, blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.vortexMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.vortexMat)
    this.vortexMesh.rotation.x = -Math.PI / 2  //
    this.vortexMesh.visible = false; this.vortexMesh.renderOrder = 2005
    this.scene.add(this.vortexMesh)
  }

  // ── L4 （  / + ） ─────────────────────────
  private buildTendrils() {
    this.tendrilMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: uvVert,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        float hash(float n){return fract(sin(n)*43758.5453);}
        float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv);
          if(dist>1.15)discard;
          float ang=atan(uv.y,uv.x);
          float fadeIn =smoothstep(0.0,0.12,uProgress);
          float fadeOut=1.0-smoothstep(0.40,1.0,uProgress);
          float tf=fadeIn*fadeOut; if(tf<0.002)discard;
          float front=smoothstep(0.0,0.55,uProgress)*0.92;
          float tendrils=0.0;
          float vivid=0.0;
          for(int i=0;i<9;i++){
            float fi=float(i);
            float baseAng=fi*(6.28318/9.0)+hash(fi)*1.1+uTime*0.15;
            float curl=6.0+hash(fi+0.5)*7.0-3.5;
            float len=0.28+hash(fi+1.0)*0.60;
            float wid=0.030+hash(fi+2.0)*0.020;
            float expAng=baseAng+dist*curl;
            float da=ang-expAng;
            da=mod(da+3.14159,6.28318)-3.14159;
            float lineD=abs(da)*dist/wid;
            float line=exp(-lineD*lineD*0.5);
            float inLen=smoothstep(min(len,front)+0.05,min(len,front)*0.20,dist);
            float gap=smoothstep(0.0,0.07,dist);
            float contrib=line*inLen*gap;
            tendrils+=contrib;
            //  3 
            if(mod(fi,3.0)<1.0) vivid+=contrib*1.4;
          }
          tendrils=clamp(tendrils,0.0,1.0);
          vivid=clamp(vivid,0.0,1.0);
          if(tendrils<0.008)discard;
          // ：  step 
          // （NormalBlending  alpha）
          float inkLayer=step(0.25,tendrils)*0.55+step(0.55,tendrils)*0.35+step(0.80,tendrils)*0.10;
          float bright=1.4-dist*0.5;
          vec3 darkBrown=vec3(0.22,0.07,0.02);
          vec3 darkRed  =vec3(0.50,0.03,0.00);
          vec3 vividRed =vec3(0.98,0.04,0.01);
          vec3 col=mix(darkBrown,darkRed,dist*1.1);
          col=mix(col,vividRed,vivid*0.85*(1.0-dist*0.8));
          // alpha ， 
          float finalAlpha=clamp((inkLayer*0.80+tendrils*0.20)*tf,0.0,1.0);
          if(finalAlpha<0.01)discard;
          gl_FragColor=vec4(col*bright,finalAlpha);}`,
      transparent: true, blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    this.tendrilMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), this.tendrilMat)
    this.tendrilMesh.visible = false; this.tendrilMesh.renderOrder = 2004
    this.scene.add(this.tendrilMesh)
  }

  // ── L6  ──────────────────────────────────────────────────────────
  private buildDebris() {
    const n = DEBRIS_COUNT
    this.debrisPositions    = new Float32Array(n * 3)
    this.debrisLifetimes    = new Float32Array(n)
    this.debrisMaxLifetimes = new Float32Array(n)
    this.debrisRandSeed     = new Float32Array(n)
    this.debrisSizeMult     = new Float32Array(n)
    this.debrisLifeRatio    = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.debrisVelocities.push(new THREE.Vector3())
      this.debrisLifetimes[i] = 0
      this.debrisLifeRatio[i] = 1
      this.debrisPositions[i * 3 + 1] = -9999
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position',  new THREE.BufferAttribute(this.debrisPositions,  3))
    geo.setAttribute('randSeed',  new THREE.BufferAttribute(this.debrisRandSeed,   1))
    geo.setAttribute('sizeMult',  new THREE.BufferAttribute(this.debrisSizeMult,   1))
    geo.setAttribute('lifeRatio', new THREE.BufferAttribute(this.debrisLifeRatio,  1))
    this.debrisMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float randSeed; attribute float sizeMult; attribute float lifeRatio;
        varying float vSeed; varying float vLife;
        void main(){
          vSeed=randSeed; vLife=lifeRatio;
          vec4 m=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=clamp(sizeMult*0.28*350.0*(1.0/-m.z),2.0,26.0);
          gl_Position=projectionMatrix*m;}`,
      fragmentShader: `
        varying float vSeed; varying float vLife;
        float hash(float n){return fract(sin(n)*43758.5453);}
        void main(){
          vec2 p=gl_PointCoord-0.5;
          float sides=floor(3.0+fract(vSeed*7.31)*2.0);
          float ang2=6.28318/sides;
          float ang=atan(p.y,p.x);
          float poly=cos(floor(0.5+ang/ang2)*ang2-ang)*length(p)*2.0;
          if(poly>0.90)discard;
          float fade=1.0-smoothstep(0.50,1.0,vLife);
          vec3 stoneA=vec3(0.16,0.07,0.04);
          vec3 stoneB=vec3(0.28,0.14,0.08);
          vec3 col=mix(stoneA,stoneB,fract(vSeed*3.7));
          float alpha=mix(1.0,0.2,poly*poly)*fade;
          if(alpha<0.01)discard;
          gl_FragColor=vec4(col,alpha);}`,
      transparent: true, blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false,
    })
    this.debrisPoints = new THREE.Points(geo, this.debrisMat)
    this.debrisPoints.visible = false; this.debrisPoints.renderOrder = 2006
    this.scene.add(this.debrisPoints)
  }

  // ──  ────────────────────────────────────────────────────────────────
  cast(pos: THREE.Vector3, slashAngleDeg = 0) {
    this.active = true; this.timer = 0
    this.targetPos.copy(pos)
    const baseAngle = (slashAngleDeg * Math.PI) / 180

    // L1
    this.groundRingMesh.position.set(pos.x, pos.y + 0.04, pos.z)
    this.groundRingMesh.scale.setScalar(this.ringRadius)
    this.groundRingMat.uniforms.uProgress.value = 0
    this.groundRingMat.uniforms.uSweep.value = 0
    this.groundRingMesh.visible = true

    // L2a ： ，
    const setupHoriz = (mesh: THREE.Mesh, mat: THREE.ShaderMaterial, tilt: number, yOff: number) => {
      mesh.position.copy(pos); mesh.position.y += yOff
      mesh.scale.set(this.slashLength, 1, 1)
      mesh.quaternion.copy(this.camera.quaternion)
      mesh.rotateZ(baseAngle + tilt)
      mat.uniforms.uAlpha.value = 0.0
      mesh.visible = false
    }
    setupHoriz(this.slashMesh1, this.slashMat1, +0.16, 0.55)
    setupHoriz(this.slashMesh2, this.slashMat2, -0.13, 0.28)

    // L2b ：  +
    const setupPerp = (mesh: THREE.Mesh, mat: THREE.ShaderMaterial) => {
      mesh.position.copy(pos); mesh.position.y += 0.55
      mesh.scale.set(1, this.slashLength * 0.9, 1)
      mesh.quaternion.copy(this.camera.quaternion)
      mesh.rotateZ((mesh as any).__tilt ?? 0)
      mat.uniforms.uAlpha.value = 0.0
      mesh.visible = false
    }
    setupPerp(this.perpMesh1, this.perpMat1)
    setupPerp(this.perpMesh2, this.perpMat2)

    // L3 （ ，  0.75x  L1 ）
    this.vortexMesh.position.copy(pos); this.vortexMesh.position.y += 0.05
    this.vortexMesh.scale.setScalar(this.vortexSize * 0.75)
    this.vortexMat.uniforms.uProgress.value = 0
    this.vortexMesh.visible = true

    // L4
    this.tendrilMesh.position.copy(pos); this.tendrilMesh.position.y += 0.42
    this.tendrilMesh.scale.setScalar(this.vortexSize * 0.75)
    this.tendrilMesh.quaternion.copy(this.camera.quaternion)
    this.tendrilMat.uniforms.uProgress.value = 0
    this.tendrilMesh.visible = true

    // L6
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1.8 + Math.random() * 3.5
      this.debrisPositions[i * 3]     = pos.x + (Math.random() - 0.5) * 0.5
      this.debrisPositions[i * 3 + 1] = pos.y + 0.08
      this.debrisPositions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.5
      this.debrisVelocities[i].set(Math.cos(angle) * speed, 0.6 + Math.random() * 2.0, Math.sin(angle) * speed)
      const life = 0.22 + Math.random() * 0.28
      this.debrisLifetimes[i]    = life
      this.debrisMaxLifetimes[i] = life
      this.debrisRandSeed[i]     = Math.random()
      this.debrisSizeMult[i]     = 0.35 + Math.random() * 0.85
      this.debrisLifeRatio[i]    = 0
    }
    this.debrisPoints.position.set(0, 0, 0)
    const g = this.debrisPoints.geometry
    g.attributes.position.needsUpdate  = true
    g.attributes.randSeed.needsUpdate  = true
    g.attributes.sizeMult.needsUpdate  = true
    g.attributes.lifeRatio.needsUpdate = true
    this.debrisPoints.visible = true
  }

  // ──  ─────────────────────────────────────────────────────────────
  update(dt: number) {
    if (!this.active) return
    this.timer += dt
    const p    = Math.min(this.timer / this.duration, 1.0)
    const time = performance.now() * 0.001

    if (p >= 1.0) {
      this.active = false
      ;[this.groundRingMesh, this.slashMesh1, this.slashMesh2,
        this.perpMesh1, this.perpMesh2,
        this.vortexMesh, this.tendrilMesh, this.debrisPoints
      ].forEach(m => { m.visible = false })
      return
    }

    // L1 ：uSweep  20% ，  1.0
    this.groundRingMat.uniforms.uProgress.value = p
    this.groundRingMat.uniforms.uSweep.value = Math.min(this.timer / (0.20 * this.duration), 1.0)

    // （  20% ）
    const sweepDone = 0.20 * this.duration

    // L2b ： ，  0.28s（ 、 ）
    const perpT    = this.timer - sweepDone
    const perpFade = perpT < 0 ? 0 : Math.max(0, 1.0 - perpT / 0.28)
    if (perpT >= 0 && perpFade > 0) {
      this.perpMesh1.visible = true; this.perpMesh2.visible = true
    }
    this.perpMat1.uniforms.uAlpha.value = perpFade
    this.perpMat2.uniforms.uAlpha.value = perpFade
    if (perpFade > 0) {
      this.perpMesh1.quaternion.copy(this.camera.quaternion); this.perpMesh1.rotateZ((this.perpMesh1 as any).__tilt ?? 0)
      this.perpMesh2.quaternion.copy(this.camera.quaternion); this.perpMesh2.rotateZ((this.perpMesh2 as any).__tilt ?? 0)
    }
    if (perpFade <= 0 && perpT > 0) { this.perpMesh1.visible = false; this.perpMesh2.visible = false }

    // L2a ：  L2b  0.08s ，  0.14s（ 、 ）
    const slashDelay = sweepDone + 0.08
    const slashT     = this.timer - slashDelay
    const slashFade  = slashT < 0 ? 0 : Math.max(0, 1.0 - slashT / 0.14)
    if (slashT >= 0 && slashFade > 0) {
      this.slashMesh1.visible = true; this.slashMesh2.visible = true
    }
    this.slashMat1.uniforms.uAlpha.value = slashFade
    this.slashMat2.uniforms.uAlpha.value = slashFade
    if (slashFade <= 0 && slashT > 0) { this.slashMesh1.visible = false; this.slashMesh2.visible = false }

    // L3 （ ， ）
    this.vortexMat.uniforms.uProgress.value = p
    this.vortexMat.uniforms.uTime.value     = time

    // L4 （  0.48s ）
    const tendrilP = Math.min(this.timer / 0.48, 1.0)
    this.tendrilMat.uniforms.uProgress.value = tendrilP
    this.tendrilMat.uniforms.uTime.value     = time
    this.tendrilMesh.quaternion.copy(this.camera.quaternion)

    // L6
    let anyAlive = false
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      if (this.debrisLifetimes[i] <= 0) {
        this.debrisLifeRatio[i] = 1.0
        this.debrisPositions[i * 3 + 1] = -9999
        continue
      }
      anyAlive = true
      this.debrisLifetimes[i] -= dt
      const maxL = this.debrisMaxLifetimes[i] || 1
      this.debrisLifeRatio[i] = Math.max(0, 1.0 - this.debrisLifetimes[i] / maxL)
      if (this.debrisLifetimes[i] <= 0) {
        this.debrisLifeRatio[i] = 1.0; this.debrisPositions[i * 3 + 1] = -9999; continue
      }
      this.debrisVelocities[i].y -= 18 * dt
      this.debrisPositions[i * 3]     += this.debrisVelocities[i].x * dt
      this.debrisPositions[i * 3 + 1] += this.debrisVelocities[i].y * dt
      this.debrisPositions[i * 3 + 2] += this.debrisVelocities[i].z * dt
      if (this.debrisPositions[i * 3 + 1] < this.targetPos.y) {
        this.debrisPositions[i * 3 + 1] = this.targetPos.y
        this.debrisVelocities[i].set(0, 0, 0)
      }
    }
    if (!anyAlive) this.debrisPoints.visible = false
    const g = this.debrisPoints.geometry
    g.attributes.position.needsUpdate  = true
    g.attributes.lifeRatio.needsUpdate = true
  }

  dispose() {
    ;[this.groundRingMesh, this.slashMesh1, this.slashMesh2,
      this.perpMesh1, this.perpMesh2,
      this.vortexMesh, this.tendrilMesh, this.debrisPoints
    ].forEach(obj => this.scene.remove(obj))
    ;[this.groundRingMat, this.slashMat1, this.slashMat2,
      this.perpMat1, this.perpMat2,
      this.vortexMat, this.tendrilMat, this.debrisMat
    ].forEach(m => m.dispose())
  }
}
