// @source wb-character/src/vfx/effects/HitExplosionEffect.ts
/**
 * 
 *  vfxtex/demo.ts 292-480 ， 
 * 
 * ：
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem, MistParticleSystem, EmitConfig } from '../core/ParticleSystems'

export interface HitExplosionConfig {
  sparkPS: ParticleSystem
  smokePS: MistParticleSystem
  addTrauma?: (amount: number) => void
}

export class HitExplosion {
  active: boolean = false
  age: number = 0
  duration: number = 400

  private flashMesh: THREE.Mesh
  private flashMat: THREE.ShaderMaterial
  private coreMesh: THREE.Mesh
  private coreMat: THREE.ShaderMaterial
  private ringMesh: THREE.Mesh
  private ringMat: THREE.ShaderMaterial

  position: THREE.Vector3 = new THREE.Vector3()
  sparkColor: THREE.Color = new THREE.Color(1, 0.5, 0.1)
  smokeColor: THREE.Color = new THREE.Color(0.3, 0.3, 0.3)

  constructor(private scene: THREE.Scene, private config: HitExplosionConfig) {
    const flashGeo = new THREE.PlaneGeometry(2.5, 2.5)
    //  MeshBasicMaterial（ ） ，
    this.flashMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 1.0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float opacity; varying vec2 vUv;
        void main(){
          vec2 c=vUv*2.0-1.0; float dist=length(c);
          float glow=exp(-dist*dist*3.5);
          gl_FragColor=vec4(vec3(1.0,0.97,0.88),glow*opacity);}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.flashMesh = new THREE.Mesh(flashGeo, this.flashMat)
    this.flashMesh.visible = false
    this.flashMesh.renderOrder = 2020
    scene.add(this.flashMesh)

    const coreGeo = new THREE.SphereGeometry(0.15, 32, 16)
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1, 0.85, 0.5) },
        uAlpha: { value: 1 },
        uProgress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        uniform float uProgress;
        void main(){
          vec3 pos = position * (1.0 + uProgress * 2.5);
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uProgress;
        varying vec3 vNormal;
        void main(){
          float rim = 1.0 - abs(dot(vNormal, vec3(0, 0, 1)));
          float pulse = 0.5 + 0.5 * sin(uTime * 25.0);
          vec3 col = uColor * (1.0 + rim * 2.0 + pulse * 0.3);
          float a = uAlpha * (1.0 - uProgress) * (0.8 + rim * 0.4);
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat)
    this.coreMesh.visible = false
    this.coreMesh.renderOrder = 2025
    scene.add(this.coreMesh)

    const ringGeo = new THREE.RingGeometry(0.4, 0.6, 32)
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(1, 0.7, 0.3) },
        uAlpha: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uProgress;
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec2 vUv;
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          float a = uAlpha * (1.0 - uProgress) * edge;
          vec3 c = uColor * (1.0 + uProgress * 0.5);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat)
    this.ringMesh.visible = false
    this.ringMesh.renderOrder = 2021
    scene.add(this.ringMesh)
  }

  trigger(pos: THREE.Vector3, camera: THREE.Camera) {
    this.position.copy(pos)
    this.age = 0
    this.active = true

    this.flashMesh.position.copy(pos)
    this.flashMesh.lookAt(camera.position)
    this.flashMesh.visible = true
    this.flashMat.uniforms.opacity.value = 1

    this.coreMesh.position.copy(pos)
    this.coreMesh.visible = true
    this.coreMat.uniforms.uAlpha.value = 1

    this.ringMesh.position.copy(pos)
    this.ringMesh.lookAt(camera.position)
    this.ringMesh.visible = true
    this.ringMat.uniforms.uAlpha.value = 1
    this.ringMesh.scale.setScalar(1)

    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.config.sparkPS.emit({
          position: pos.clone(),
          count: 6 + i * 4,
          speed: [4 + i * 2, 10 + i * 3] as [number, number],
          lifetime: [180, 350] as [number, number],
          size: [0.1, 0.25] as [number, number],
          colorFrom: this.sparkColor,
          colorTo: new THREE.Color(0.3, 0.15, 0.05),
        })
      }, i * 40)
    }

    this.config.smokePS.emit({
      position: pos.clone(),
      count: 8,
      speed: [1.5, 4] as [number, number],
      lifetime: [400, 800] as [number, number],
      size: [0.6, 1.2] as [number, number],
      colorFrom: this.smokeColor,
      colorTo: new THREE.Color(0.1, 0.1, 0.1),
    })

    this.config.addTrauma?.(0.35)
  }

  update(dt: number, camera: THREE.Camera, time: number) {
    if (!this.active) return

    this.age += dt
    const t = Math.min(this.age / this.duration, 1)

    this.flashMesh.lookAt(camera.position)
    const flashT = Easing.easeOutExpo(Math.min(t * 2, 1))
    this.flashMat.uniforms.opacity.value = 1 - flashT
    this.flashMesh.scale.setScalar(1 + flashT * 2.5)

    this.coreMat.uniforms.uTime.value = time
    this.coreMat.uniforms.uProgress.value = Easing.easeOutQuad(t)
    this.coreMat.uniforms.uAlpha.value = 1 - Easing.easeInQuad(t)

    const ringT = Easing.easeOutCubic(t)
    this.ringMesh.scale.setScalar(1 + ringT * 3.5)
    this.ringMat.uniforms.uProgress.value = t
    this.ringMat.uniforms.uAlpha.value = 1 - Easing.easeInQuad(t)
    this.ringMesh.lookAt(camera.position)

    if (t >= 1) {
      this.active = false
      this.flashMesh.visible = false
      this.coreMesh.visible = false
      this.ringMesh.visible = false
    }
  }

  dispose() {
    this.scene.remove(this.flashMesh)
    this.scene.remove(this.coreMesh)
    this.scene.remove(this.ringMesh)
    this.flashMat.dispose()
    this.coreMat.dispose()
    this.ringMat.dispose()
  }
}

export function createHitExplosionPool(scene: THREE.Scene, config: HitExplosionConfig, count: number = 6): HitExplosion[] {
  return Array.from({ length: count }, () => new HitExplosion(scene, config))
}
