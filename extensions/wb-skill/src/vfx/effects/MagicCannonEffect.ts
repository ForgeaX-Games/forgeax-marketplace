// @source wb-character/src/vfx/effects/MagicCannonEffect.ts
/**
 *  (MagicCannonEffect)
 *  vfx-3d/lib/effects/MagicCannon.ts
 *  →  →  + 
 */

import * as THREE from 'three'

export interface MagicCannonCallbacks {
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
}

export class MagicCannonEffect {
  active = false
  phase: 'charge' | 'fire' | 'impact' = 'charge'
  timer = 0

  chargeTime = 0.6
  fireTime = 0.4
  beamLength = 20
  beamWidth = 0.8

  startPos = new THREE.Vector3()
  targetPos = new THREE.Vector3()
  direction = new THREE.Vector3()

  circleMesh: THREE.Mesh; circleMat: THREE.ShaderMaterial
  coreMesh: THREE.Mesh; coreMat: THREE.ShaderMaterial
  chargeParticles: THREE.Points; chargeParticleMat: THREE.ShaderMaterial
  chargeParticlePositions: Float32Array; chargeParticleCount = 60
  beamMesh: THREE.Mesh; beamMat: THREE.ShaderMaterial
  beamOuterMesh: THREE.Mesh; beamOuterMat: THREE.ShaderMaterial
  explosionMesh: THREE.Mesh; explosionMat: THREE.ShaderMaterial
  waveMesh: THREE.Mesh; waveMat: THREE.ShaderMaterial

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private cbs: MagicCannonCallbacks = {}) {
    //
    const circleGeo = new THREE.PlaneGeometry(3, 3)
    this.circleMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        #define PI 3.14159265
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv),angle=atan(uv.y,uv.x);
          float ring1=smoothstep(0.02,0.0,abs(dist-0.9)),ring2=smoothstep(0.02,0.0,abs(dist-0.7));
          float innerRing=smoothstep(0.02,0.0,abs(dist-0.5));
          float runes=step(0.5,fract((angle+uTime*2.0)/PI*4.0));
          innerRing*=runes*smoothstep(0.6,0.4,dist)*smoothstep(0.3,0.5,dist);
          float star=0.0;
          for(int i=0;i<6;i++){float a=float(i)*PI/3.0+uTime;vec2 dir=vec2(cos(a),sin(a));float d=abs(dot(uv,vec2(-dir.y,dir.x)));star+=smoothstep(0.02,0.0,d)*smoothstep(0.8,0.0,abs(dot(uv,dir)));}
          float core=smoothstep(0.2,0.0,dist);
          vec3 magicBlue=vec3(0.3,0.6,1.0),white=vec3(1.0);
          vec3 color=magicBlue*(ring1+ring2+innerRing+star*0.5)+white*core*2.0;
          gl_FragColor=vec4(color*2.0,(ring1+ring2+innerRing+star*0.3+core)*uProgress);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.circleMesh = new THREE.Mesh(circleGeo, this.circleMat)
    this.circleMesh.visible = false; this.circleMesh.renderOrder = 2000; scene.add(this.circleMesh)

    //
    const coreGeo = new THREE.SphereGeometry(0.5, 32, 32)
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vNormal;void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uProgress,uTime;varying vec3 vNormal;void main(){float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),2.0);vec3 color=mix(vec3(0.4,0.7,1.0),vec3(1.0),fresnel*uProgress);gl_FragColor=vec4(color*(1.0+uProgress),0.5+fresnel*0.5*uProgress);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat)
    this.coreMesh.visible = false; this.coreMesh.renderOrder = 2001; scene.add(this.coreMesh)

    //
    this.chargeParticlePositions = new Float32Array(this.chargeParticleCount * 3)
    const cpGeo = new THREE.BufferGeometry()
    cpGeo.setAttribute('position', new THREE.BufferAttribute(this.chargeParticlePositions, 3))
    this.chargeParticleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `void main(){vec4 m=modelViewMatrix*vec4(position,1.0);gl_PointSize=5.0*(1.0/-m.z);gl_Position=projectionMatrix*m;}`,
      fragmentShader: `void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;gl_FragColor=vec4(vec3(0.5,0.8,1.0)*2.0,1.0-d);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.chargeParticles = new THREE.Points(cpGeo, this.chargeParticleMat)
    this.chargeParticles.visible = false; this.chargeParticles.renderOrder = 2002; scene.add(this.chargeParticles)

    //
    const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 16)
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
      vertexShader: `varying vec2 vUv;varying vec3 vPosition;void main(){vUv=uv;vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uTime,uProgress; varying vec2 vUv,vPosition;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
          float flow=sin(vUv.y*20.0-uTime*15.0)*0.5+0.5,edge=1.0-abs(vUv.x-0.5)*2.0;
          vec3 color=mix(vec3(0.3,0.6,1.0),vec3(1.0),edge*edge); color+=flow*0.3;
          gl_FragColor=vec4(color*2.0,edge*uProgress);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.beamMesh = new THREE.Mesh(beamGeo, this.beamMat)
    this.beamMesh.visible = false; this.beamMesh.renderOrder = 2003; scene.add(this.beamMesh)

    //
    const beamOuterGeo = new THREE.CylinderGeometry(0.6, 0.6, 1, 16)
    this.beamOuterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uTime,uProgress;varying vec2 vUv;void main(){float edge=1.0-abs(vUv.x-0.5)*2.0,pulse=sin(vUv.y*30.0-uTime*20.0)*0.5+0.5;gl_FragColor=vec4(vec3(0.2,0.5,1.0)*1.5,edge*0.3*uProgress*(0.5+pulse*0.5));}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.beamOuterMesh = new THREE.Mesh(beamOuterGeo, this.beamOuterMat)
    this.beamOuterMesh.visible = false; this.beamOuterMesh.renderOrder = 2002; scene.add(this.beamOuterMesh)

    //
    const expGeo = new THREE.PlaneGeometry(6, 6)
    this.explosionMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uProgress,uTime; varying vec2 vUv;
        void main(){
          vec2 uv=vUv*2.0-1.0; float dist=length(uv),angle=atan(uv.y,uv.x);
          float core=smoothstep(0.2*uProgress,0.0,dist);
          float rays=pow(abs(sin(angle*6.0)),4.0);
          float outer=smoothstep(0.8*uProgress,0.1,dist)*rays;
          vec3 color=vec3(1.0)*core*3.0+vec3(0.3,0.6,1.0)*outer*2.0+vec3(0.6,0.3,1.0)*(1.0-core)*outer*0.5;
          float circleMask=smoothstep(1.0,0.82,dist);
          gl_FragColor=vec4(color,(core+outer*0.6)*(1.0-uProgress)*circleMask);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.explosionMesh = new THREE.Mesh(expGeo, this.explosionMat)
    this.explosionMesh.visible = false; this.explosionMesh.renderOrder = 2004; scene.add(this.explosionMesh)

    //
    const waveGeo = new THREE.RingGeometry(0.5, 1, 64)
    this.waveMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uProgress;varying vec2 vUv;void main(){float ring=smoothstep(0.0,0.3,vUv.x)*smoothstep(1.0,0.7,vUv.x);gl_FragColor=vec4(vec3(0.4,0.7,1.0)*2.0,ring*(1.0-uProgress)*0.7);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.waveMesh = new THREE.Mesh(waveGeo, this.waveMat)
    this.waveMesh.visible = false; this.waveMesh.renderOrder = 2003; scene.add(this.waveMesh)
  }

  fire(startPos: THREE.Vector3, targetPos: THREE.Vector3) {
    this.active = true; this.phase = 'charge'; this.timer = 0
    this.startPos.copy(startPos); this.targetPos.copy(targetPos)
    this.direction.subVectors(targetPos, startPos).normalize()
    this.circleMesh.position.copy(startPos); this.circleMesh.lookAt(targetPos); this.circleMesh.visible = true
    this.coreMesh.position.copy(startPos); this.coreMesh.visible = true; this.coreMesh.scale.setScalar(0.3)
    this.chargeParticles.visible = true
  }

  update(dt: number) {
    if (!this.active) return
    this.timer += dt
    const time = performance.now() * 0.001
    this.circleMat.uniforms.uTime.value = time; this.coreMat.uniforms.uTime.value = time
    this.chargeParticleMat.uniforms.uTime.value = time; this.beamMat.uniforms.uTime.value = time
    this.beamOuterMat.uniforms.uTime.value = time; this.explosionMat.uniforms.uTime.value = time

    if (this.phase === 'charge') {
      const p = Math.min(this.timer / this.chargeTime, 1)
      this.circleMat.uniforms.uProgress.value = p; this.coreMat.uniforms.uProgress.value = p
      this.coreMesh.scale.setScalar(0.3 + p * 0.5)
      for (let i = 0; i < this.chargeParticleCount; i++) {
        const angle = (i / this.chargeParticleCount) * Math.PI * 2 + time * 3
        const radius = 2.5 * (1 - p) + 0.3, offset = Math.sin(i * 0.5 + time * 4) * (1 - p)
        const localPos = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, offset)
        const rotAxis = new THREE.Vector3(0, 0, 1), angle2 = rotAxis.angleTo(this.direction)
        const crossAxis = new THREE.Vector3().crossVectors(rotAxis, this.direction).normalize()
        if (crossAxis.length() > 0.001) localPos.applyAxisAngle(crossAxis, angle2)
        this.chargeParticlePositions[i * 3] = this.startPos.x + localPos.x
        this.chargeParticlePositions[i * 3 + 1] = this.startPos.y + localPos.y
        this.chargeParticlePositions[i * 3 + 2] = this.startPos.z + localPos.z
      }
      this.chargeParticles.geometry.attributes.position.needsUpdate = true
      if (p >= 1) {
        this.phase = 'fire'; this.timer = 0
        this.coreMesh.visible = false; this.chargeParticles.visible = false
        const beamLen = this.startPos.distanceTo(this.targetPos)
        this.beamMesh.visible = true; this.beamMesh.scale.set(this.beamWidth, beamLen, this.beamWidth)
        this.beamOuterMesh.visible = true; this.beamOuterMesh.scale.set(this.beamWidth * 1.5, beamLen, this.beamWidth * 1.5)
        const mid = new THREE.Vector3().addVectors(this.startPos, this.targetPos).multiplyScalar(0.5)
        this.beamMesh.position.copy(mid); this.beamMesh.lookAt(this.targetPos); this.beamMesh.rotateX(Math.PI / 2)
        this.beamOuterMesh.position.copy(mid); this.beamOuterMesh.lookAt(this.targetPos); this.beamOuterMesh.rotateX(Math.PI / 2)
        this.cbs.addTrauma?.(0.4); this.cbs.triggerFlash?.(100, 150, 255, 80, 0.5)
      }
    }

    if (this.phase === 'fire') {
      const p = Math.min(this.timer / this.fireTime, 1)
      this.beamMat.uniforms.uProgress.value = 1 - p * 0.5; this.beamOuterMat.uniforms.uProgress.value = 1 - p * 0.5
      const pulse = 1 + Math.sin(time * 20) * 0.1
      this.beamMesh.scale.x = this.beamWidth * pulse; this.beamMesh.scale.z = this.beamWidth * pulse
      if (p >= 1) this.triggerImpact()
    }

    if (this.phase === 'impact') {
      const p = Math.min(this.timer / 0.5, 1)
      this.explosionMat.uniforms.uProgress.value = p; this.explosionMesh.scale.setScalar(1 + p * 3); this.explosionMesh.lookAt(this.startPos)
      this.waveMat.uniforms.uProgress.value = p; this.waveMesh.scale.setScalar(1 + p * 10); this.waveMesh.lookAt(this.startPos)
      if (p >= 1) {
        this.active = false
        this.circleMesh.visible = false; this.beamMesh.visible = false; this.beamOuterMesh.visible = false
        this.explosionMesh.visible = false; this.waveMesh.visible = false
      }
    }
  }

  private triggerImpact() {
    this.phase = 'impact'; this.timer = 0
    this.beamMesh.visible = false; this.beamOuterMesh.visible = false
    this.explosionMesh.position.copy(this.targetPos)
    this.explosionMesh.lookAt(this.startPos)   //  A（ ） ：
    this.explosionMesh.visible = true
    this.waveMesh.position.copy(this.targetPos); this.waveMesh.lookAt(this.startPos); this.waveMesh.visible = true; this.waveMesh.scale.setScalar(1)
    this.cbs.addTrauma?.(0.5); this.cbs.triggerFlash?.(150, 200, 255, 100, 0.6)
  }

  dispose() {
    ;[this.circleMesh, this.coreMesh, this.chargeParticles, this.beamMesh, this.beamOuterMesh, this.explosionMesh, this.waveMesh]
      .forEach(m => this.scene.remove(m))
    ;[this.circleMat, this.coreMat, this.chargeParticleMat, this.beamMat, this.beamOuterMat, this.explosionMat, this.waveMat]
      .forEach(m => m.dispose())
  }
}
