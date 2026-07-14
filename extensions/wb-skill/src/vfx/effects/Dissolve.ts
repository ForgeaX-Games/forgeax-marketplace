// @source wb-character/src/vfx/effects/Dissolve.ts
/**
 * 
 *  vfxtex/demo.ts 1768-1793 
 * 
 * ：
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'

export class DissolveEffect {
  active = false
  dissolving = false
  material: THREE.ShaderMaterial
  private originalMaterial: THREE.Material | null = null
  private targetMesh: THREE.Mesh | null = null
  private tweens: Array<{ elapsed: number; duration: number; from: number; to: number; onComplete?: () => void }> = []

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uDissolve: { value: 0.0 },
        uEdgeColor: { value: new THREE.Color(0.2, 0.5, 1.0) },
        uBaseColor: { value: new THREE.Color(0.2, 0.33, 0.8) },
        uTime: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld;
        void main(){
          vUv = uv; vPos = position;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uDissolve, uTime; uniform vec3 uEdgeColor, uBaseColor;
        varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld;
        float rand(vec2 co){ return fract(sin(dot(co,vec2(12.98,78.23)))*43758.54); }
        float noise(vec2 p){
          vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(rand(i),rand(i+vec2(1,0)),f.x),mix(rand(i+vec2(0,1)),rand(i+vec2(1,1)),f.x),f.y);
        }
        void main(){
          // ： ， 
          vec2 wCoord = vWorld.xz * 2.2 + vec2(vWorld.y * 0.4, uTime * 0.35);
          float n = noise(wCoord) * 0.6 + noise(wCoord * 2.3 + vec2(1.7, 3.1)) * 0.4;
          if(n < uDissolve) discard;
          float edge = smoothstep(uDissolve, uDissolve + 0.12, n);
          vec3 color = mix(uEdgeColor * 2.5, uBaseColor, edge);
          gl_FragColor = vec4(color, 1.0);
        }`,
      transparent: true, depthWrite: false,
    })
  }

  trigger(mesh: THREE.Mesh, onComplete?: () => void) {
    if (this.dissolving) return
    this.dissolving = true
    this.targetMesh = mesh
    this.originalMaterial = mesh.material as THREE.Material
    mesh.material = this.material
    this.material.uniforms.uDissolve.value = 0

    this.animateTo(0, 1.0, 1500, () => {
      setTimeout(() => {
        this.material.uniforms.uEdgeColor.value.set(0.15, 1, 0.4)
        this.animateTo(1.0, 0.0, 1000, () => {
          if (this.targetMesh && this.originalMaterial) {
            this.targetMesh.material = this.originalMaterial
          }
          this.material.uniforms.uEdgeColor.value.set(0.2, 0.5, 1.0)
          this.dissolving = false
          if (onComplete) onComplete()
        })
      }, 400)
    })
  }

  /** （0 → 1），  */
  triggerOut(mesh: THREE.Mesh, duration = 1500, onComplete?: () => void) {
    if (this.dissolving) return
    this.dissolving = true
    this.tweens = []
    this.targetMesh = mesh
    this.originalMaterial = mesh.material as THREE.Material
    mesh.material = this.material
    this.material.uniforms.uDissolve.value = 0
    this.material.uniforms.uEdgeColor.value.set(0.2, 0.5, 1.0)

    this.animateTo(0, 1.0, duration, () => {
      if (this.targetMesh && this.originalMaterial) {
        this.targetMesh.material = this.originalMaterial
      }
      this.material.uniforms.uDissolve.value = 0
      this.dissolving = false
      onComplete?.()
    })
  }

  /** （1 → 0），  */
  triggerIn(mesh: THREE.Mesh, duration = 1200, onComplete?: () => void) {
    if (this.dissolving) return
    this.dissolving = true
    this.tweens = []
    this.targetMesh = mesh
    this.originalMaterial = mesh.material as THREE.Material
    mesh.visible = true
    mesh.material = this.material
    this.material.uniforms.uEdgeColor.value.set(0.15, 1.0, 0.4)
    this.material.uniforms.uDissolve.value = 1.0

    this.animateTo(1.0, 0.0, duration, () => {
      if (this.targetMesh && this.originalMaterial) {
        this.targetMesh.material = this.originalMaterial
      }
      this.material.uniforms.uEdgeColor.value.set(0.2, 0.5, 1.0)
      this.dissolving = false
      onComplete?.()
    })
  }

  // ── Group ：  Mesh  THREE.Group ─────────────

  private groupSaved: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = []

  private _applyToGroup(group: THREE.Group): void {
    this.groupSaved = []
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        this.groupSaved.push({ mesh: obj, mat: obj.material })
        obj.material = this.material
      }
    })
  }

  private _restoreGroup(): void {
    for (const { mesh, mat } of this.groupSaved) mesh.material = mat
    this.groupSaved = []
  }

  /** （0→1），  group  */
  triggerGroupOut(group: THREE.Group, duration = 1500, onComplete?: () => void): void {
    if (this.dissolving) return
    this.dissolving = true
    this.tweens = []
    this._applyToGroup(group)
    this.material.uniforms.uDissolve.value = 0
    this.material.uniforms.uEdgeColor.value.set(0.2, 0.5, 1.0)

    this.animateTo(0, 1.0, duration, () => {
      this._restoreGroup()
      group.visible = false
      this.material.uniforms.uDissolve.value = 0
      this.dissolving = false
      onComplete?.()
    })
  }

  /** （1→0），  group，  */
  triggerGroupIn(group: THREE.Group, duration = 1200, onComplete?: () => void): void {
    if (this.dissolving) return
    this.dissolving = true
    this.tweens = []
    group.visible = true
    this._applyToGroup(group)
    this.material.uniforms.uDissolve.value = 1.0
    this.material.uniforms.uEdgeColor.value.set(0.15, 1.0, 0.4)

    this.animateTo(1.0, 0.0, duration, () => {
      this._restoreGroup()
      this.material.uniforms.uEdgeColor.value.set(0.2, 0.5, 1.0)
      this.dissolving = false
      onComplete?.()
    })
  }

  private animateTo(from: number, to: number, duration: number, onComplete?: () => void) {
    this.tweens.push({ elapsed: 0, duration, from, to, onComplete })
  }

  update(dt: number) {
    this.material.uniforms.uTime.value += dt * 0.001

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      tw.elapsed += dt
      const t = Math.min(tw.elapsed / tw.duration, 1)
      const eased = tw.to > tw.from ? Easing.easeInExpo(t) : Easing.easeOutExpo(t)
      this.material.uniforms.uDissolve.value = tw.from + (tw.to - tw.from) * eased
      if (t >= 1) {
        if (tw.onComplete) tw.onComplete()
        this.tweens.splice(i, 1)
      }
    }
  }
}
