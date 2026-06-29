// @source wb-character/src/vfx/effects/VineStrikeEffect.ts
/**
 *  (VineStrikeEffect) — 3D 
 *  vfx-2d VineStrike preset
 *
 * ：
 * 1. warning  (0.5s)  — 
 * 2. growing  (1.8s)  — 8 
 * 3. hold     (0.4s)  — ， 
 * 4. wither   (0.8s)  — 
 */

import * as THREE from 'three'

export interface VineStrikeCallbacks {
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
}

const VINE_COUNT = 8
const THORN_PER_VINE = 5

export class VineStrikeEffect {
  active = false
  phase: 'warning' | 'growing' | 'hold' | 'wither' = 'warning'
  timer = 0

  warningTime = 0.5
  growTime = 1.8
  holdTime = 0.4
  witherTime = 0.8

  vineRadius = 2.2
  vineHeight = 3.0

  targetPos = new THREE.Vector3()

  //  Group（  targetPos）
  private root = new THREE.Group()

  //
  warningMat: THREE.ShaderMaterial
  //
  rootMat: THREE.ShaderMaterial
  //
  vines: { mat: THREE.ShaderMaterial; thornMat: THREE.ShaderMaterial }[] = []
  //
  burstMat: THREE.ShaderMaterial

  constructor(private scene: THREE.Scene, private cbs: VineStrikeCallbacks = {}) {
    scene.add(this.root)
    this.root.visible = false

    //
    const wGeo = new THREE.RingGeometry(0.1, 1, 64)
    wGeo.rotateX(-Math.PI / 2)
    this.warningMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        void main(){
          float pulse=0.6+0.4*sin(uTime*12.0);
          float ring=smoothstep(0.0,0.25,vUv.y)*smoothstep(1.0,0.75,vUv.y);
          vec3 col=mix(vec3(0.02,0.25,0.04),vec3(0.1,0.9,0.15),ring);
          gl_FragColor=vec4(col,ring*pulse*uProgress*0.9);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const wMesh = new THREE.Mesh(wGeo, this.warningMat)
    wMesh.position.y = 0.04; wMesh.renderOrder = 1990
    wMesh.scale.setScalar(this.vineRadius); wMesh.name = 'warning'
    this.root.add(wMesh)

    //
    const rGeo = new THREE.CircleGeometry(1.5, 48)
    rGeo.rotateX(-Math.PI / 2)
    this.rootMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c),angle=atan(c.y,c.x);
          float veins=pow(abs(sin(angle*4.0+uTime*0.8)),6.0);
          float spread=smoothstep(uProgress,0.0,dist);
          float center=smoothstep(0.3,0.0,dist);
          vec3 darkGreen=vec3(0.02,0.18,0.03),brightGreen=vec3(0.08,0.85,0.12);
          vec3 col=mix(darkGreen,brightGreen,veins*spread+center*0.8);
          float alpha=(veins*spread*0.6+center*0.4+spread*0.2)*uProgress*(1.0-dist*0.4);
          gl_FragColor=vec4(col,alpha);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const rMesh = new THREE.Mesh(rGeo, this.rootMat)
    rMesh.position.y = 0.05; rMesh.renderOrder = 1991
    rMesh.scale.setScalar(this.vineRadius); rMesh.name = 'ground'
    this.root.add(rMesh)

    //  × VINE_COUNT
    for (let v = 0; v < VINE_COUNT; v++) {
      const angle = (v / VINE_COUNT) * Math.PI * 2
      const vineX = Math.sin(angle) * this.vineRadius * 0.45
      const vineZ = Math.cos(angle) * this.vineRadius * 0.45

      const vineGeo = new THREE.PlaneGeometry(0.45, this.vineHeight, 1, 24)
      const vineMat = new THREE.ShaderMaterial({
        uniforms: { uProgress: { value: 0 }, uWither: { value: 0 }, uTime: { value: 0 }, uSeed: { value: v * 1.37 + 0.5 } },
        vertexShader: `
          varying vec2 vUv;
          uniform float uSeed,uTime;
          void main(){
            vUv=uv;
            float sway=sin(uv.y*3.0+uTime*1.2+uSeed)*0.04*uv.y;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position+vec3(sway,0.0,0.0),1.0);}`,
        fragmentShader: `
          uniform float uProgress,uWither,uTime,uSeed; varying vec2 vUv;
          void main(){
            if(vUv.y>uProgress) discard;
            float tipFade=smoothstep(uProgress-0.06,uProgress,vUv.y);
            float xc=abs(vUv.x-0.5)*2.0;
            float trunk=smoothstep(0.28,0.04,xc);
            float branchPhase=fract(vUv.y*3.5+uSeed);
            float branchSide=step(0.5,fract(vUv.y*1.8+uSeed))*2.0-1.0;
            float branchX=0.5+branchSide*(0.18+0.12*branchPhase);
            float branch=smoothstep(0.22,0.02,abs(vUv.x-branchX))
                        *smoothstep(0.0,0.25,branchPhase)*smoothstep(0.7,0.25,branchPhase)*0.65;
            float bark=0.75+0.25*sin(vUv.y*18.0+uSeed);
            float shape=max(trunk,branch)*bark;
            if(shape<0.04) discard;
            vec3 darkGreen=vec3(0.02,0.14,0.03),midGreen=vec3(0.05,0.50,0.08),brightGreen=vec3(0.12,0.95,0.18);
            vec3 col=mix(darkGreen,midGreen,trunk*0.7);
            col=mix(col,brightGreen,trunk*trunk*0.5+branch*0.4);
            col+=brightGreen*tipFade*1.2;
            col*=1.0-uWither*0.85;
            gl_FragColor=vec4(col*(1.1+trunk*0.4),shape*(1.0-uWither*0.95));}`,
        transparent: true, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      })
      const vineMesh = new THREE.Mesh(vineGeo, vineMat)
      vineMesh.position.set(vineX, this.vineHeight * 0.5, vineZ)
      vineMesh.rotation.y = -angle + Math.PI * 0.5
      vineMesh.renderOrder = 1995; vineMesh.visible = false
      this.root.add(vineMesh)

      //
      const thornMat = new THREE.ShaderMaterial({
        uniforms: { uWither: { value: 0 } },
        vertexShader: `varying vec3 vNormal;void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform float uWither;varying vec3 vNormal;void main(){float fres=1.0-abs(dot(vNormal,vec3(0,0,1)));vec3 col=mix(vec3(0.02,0.22,0.03),vec3(0.15,1.0,0.2),fres);gl_FragColor=vec4(col,1.0-uWither*0.95);}`,
        transparent: true, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      })

      for (let t = 0; t < THORN_PER_VINE; t++) {
        const ty = ((t + 0.5) / THORN_PER_VINE) * this.vineHeight - this.vineHeight * 0.5
        const side = t % 2 === 0 ? 1 : -1
        const thornGeo = new THREE.ConeGeometry(0.06, 0.3, 4)
        const thorn = new THREE.Mesh(thornGeo, thornMat)
        thorn.position.set(vineX + Math.cos(angle + side * 1.5) * 0.22, ty + this.vineHeight * 0.5, vineZ + Math.sin(angle + side * 1.5) * 0.22)
        thorn.rotation.z = -side * 1.1; thorn.rotation.y = angle
        thorn.renderOrder = 1996; thorn.visible = false; thorn.name = `thorn-${v}-${t}`
        this.root.add(thorn)
      }

      this.vines.push({ mat: vineMat, thornMat })
    }

    //
    const bGeo = new THREE.PlaneGeometry(8, 8)
    this.burstMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv),angle=atan(uv.y,uv.x);
          float rays=pow(abs(sin(angle*4.0+uTime)),3.0);
          float core=smoothstep(0.2*uProgress,0.0,dist);
          float outer=smoothstep(0.9*uProgress,0.2,dist)*rays;
          vec3 col=vec3(0.08,0.9,0.15)*core*2.5+vec3(0.04,0.6,0.08)*outer;
          float circleMask=smoothstep(1.0,0.82,dist);
          gl_FragColor=vec4(col,(core+outer*0.5)*(1.0-uProgress)*circleMask);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    const burstMesh = new THREE.Mesh(bGeo, this.burstMat)
    burstMesh.position.y = 0.1; burstMesh.renderOrder = 1994; burstMesh.visible = false; burstMesh.name = 'burst'
    this.root.add(burstMesh)
  }

  /**  */
  private getChild(name: string): THREE.Object3D | undefined {
    return this.root.children.find(c => c.name === name)
  }
  private getWarning() { return this.getChild('warning') as THREE.Mesh | undefined }
  private getGround() { return this.getChild('ground') as THREE.Mesh | undefined }
  private getBurst() { return this.getChild('burst') as THREE.Mesh | undefined }
  private getVineMesh(v: number): THREE.Mesh | undefined {
    let count = 0
    for (const c of this.root.children) {
      if (c instanceof THREE.Mesh && !(c.name)) {
        if (count === v) return c as THREE.Mesh
        count++
      }
    }
    return undefined
  }
  private getThorn(vineIdx: number, thornIdx: number): THREE.Mesh | undefined {
    return this.root.getObjectByName(`thorn-${vineIdx}-${thornIdx}`) as THREE.Mesh | undefined
  }

  cast(targetPos: THREE.Vector3) {
    this.active = true; this.phase = 'warning'; this.timer = 0
    this.targetPos.copy(targetPos)
    this.root.position.copy(targetPos); this.root.visible = true

    //  uniforms
    this.warningMat.uniforms.uProgress.value = 0
    this.rootMat.uniforms.uProgress.value = 0
    this.burstMat.uniforms.uProgress.value = 0
    this.vines.forEach(v => { v.mat.uniforms.uProgress.value = 0; v.mat.uniforms.uWither.value = 0; v.thornMat.uniforms.uWither.value = 0 })

    // ，
    const warning = this.getWarning(); if (warning) warning.visible = true
    const ground = this.getGround(); if (ground) ground.visible = true
    const burst = this.getBurst(); if (burst) burst.visible = false

    //
    this.root.children.forEach(c => {
      if (c instanceof THREE.Mesh && c.name === '') c.visible = false
      if (c.name.startsWith('thorn-')) (c as THREE.Mesh).visible = false
    })
  }

  update(dt: number) {
    if (!this.active) return
    this.timer += dt
    const time = performance.now() * 0.001
    this.warningMat.uniforms.uTime.value = time
    this.rootMat.uniforms.uTime.value = time

    if (this.phase === 'warning') {
      const p = Math.min(this.timer / this.warningTime, 1)
      this.warningMat.uniforms.uProgress.value = p
      this.rootMat.uniforms.uProgress.value = p * 0.3
      const w = this.getWarning()
      if (w) w.scale.setScalar(this.vineRadius * (0.85 + Math.sin(time * 10) * 0.08))
      if (p >= 1) {
        this.phase = 'growing'; this.timer = 0
        if (w) w.visible = false
        //
        this.root.children.forEach(c => {
          if (c instanceof THREE.Mesh && c.name === '') c.visible = true
        })
        this.cbs.addTrauma?.(0.15)
      }
    }

    if (this.phase === 'growing') {
      const p = Math.min(this.timer / this.growTime, 1)
      this.rootMat.uniforms.uProgress.value = 0.3 + p * 0.7
      this.vines.forEach((v, i) => {
        const delay = (i / VINE_COUNT) * 0.3
        const localP = Math.max(0, Math.min((this.timer - delay) / (this.growTime - delay), 1))
        v.mat.uniforms.uProgress.value = localP; v.mat.uniforms.uTime.value = time
        for (let t = 0; t < THORN_PER_VINE; t++) {
          const thornNorm = ((t + 0.5) / THORN_PER_VINE)
          const thorn = this.getThorn(i, t)
          if (thorn) thorn.visible = localP > thornNorm * 0.85
        }
      })
      if (p >= 1) {
        this.phase = 'hold'; this.timer = 0
        this.cbs.addTrauma?.(0.3); this.cbs.triggerFlash?.(30, 200, 50, 100, 0.4)
        const burst = this.getBurst(); if (burst) burst.visible = true
        this.burstMat.uniforms.uProgress.value = 0
      }
    }

    if (this.phase === 'hold') {
      const p = Math.min(this.timer / this.holdTime, 1)
      this.burstMat.uniforms.uProgress.value = p; this.burstMat.uniforms.uTime.value = time
      const burst = this.getBurst(); if (burst) burst.scale.setScalar(1 + p * 1.5)
      this.vines.forEach(v => { v.mat.uniforms.uTime.value = time })
      if (p >= 1) {
        this.phase = 'wither'; this.timer = 0
        const b = this.getBurst(); if (b) b.visible = false
      }
    }

    if (this.phase === 'wither') {
      const p = Math.min(this.timer / this.witherTime, 1)
      this.rootMat.uniforms.uProgress.value = 1 - p * 0.8
      this.vines.forEach(v => {
        v.mat.uniforms.uWither.value = p; v.mat.uniforms.uTime.value = time
        v.thornMat.uniforms.uWither.value = p
      })
      if (p >= 1) {
        this.active = false; this.root.visible = false
      }
    }
  }

  dispose() {
    this.scene.remove(this.root)
    this.warningMat.dispose(); this.rootMat.dispose(); this.burstMat.dispose()
    this.vines.forEach(v => { v.mat.dispose(); v.thornMat.dispose() })
  }
}
