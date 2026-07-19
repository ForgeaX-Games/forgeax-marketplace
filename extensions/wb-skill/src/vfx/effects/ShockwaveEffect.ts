// @source wb-character/src/vfx/effects/ShockwaveEffect.ts
/**
 * 
 *  vfxtex/demo.ts 950-1050 ， 
 * 
 * ：
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'

export class Shockwave {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active: boolean = false
  age: number = 0
  duration: number = 600

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.RingGeometry(0.1, 1, 64)
    geo.rotateX(-Math.PI / 2)

    this.mat = new THREE.ShaderMaterial({
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
          float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          float distort = sin(vUv.x * 50.0 + uProgress * 10.0) * 0.05;
          float a = uAlpha * (1.0 - uProgress) * edge * (1.0 + distort);
          vec3 c = uColor * (1.0 + uProgress * 0.8);
          gl_FragColor = vec4(c, a * 0.85);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2022
    scene.add(this.mesh)
  }

  trigger(pos: THREE.Vector3, color?: THREE.Color) {
    this.mesh.position.copy(pos)
    this.mesh.position.y = Math.max(pos.y, 0.05)
    this.age = 0
    this.active = true
    this.mesh.visible = true
    this.mesh.scale.setScalar(0.1)

    if (color) {
      this.mat.uniforms.uColor.value.copy(color)
    } else {
      this.mat.uniforms.uColor.value.setRGB(1, 0.7, 0.3)
    }
  }

  update(dt: number) {
    if (!this.active) return

    this.age += dt
    const t = Math.min(this.age / this.duration, 1)
    const progress = Easing.easeOutQuad(t)

    this.mat.uniforms.uProgress.value = progress
    this.mat.uniforms.uAlpha.value = 1 - Easing.easeInQuad(t)
    this.mesh.scale.setScalar(0.1 + progress * 4)

    if (t >= 1) {
      this.active = false
      this.mesh.visible = false
    }
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
  }
}

export function createShockwavePool(scene: THREE.Scene, count: number = 4): Shockwave[] {
  return Array.from({ length: count }, () => new Shockwave(scene))
}
