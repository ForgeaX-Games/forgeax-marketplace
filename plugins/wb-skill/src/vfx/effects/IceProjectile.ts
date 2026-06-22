// @source wb-character/src/vfx/effects/IceProjectile.ts
/**
 * 
 *  vfxtex/demo.ts ， 
 * 
 * ：
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem, SnowflakeParticleSystem } from '../core/ParticleSystems'

export interface IceConfig {
  sparkPS: ParticleSystem
  snowflakePS: SnowflakeParticleSystem
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerFrostScreen?: (duration: number, intensity: number) => void
}

export class FrostTrailEffect {
  particles: { mesh: THREE.Mesh; age: number; lifetime: number; velocity: THREE.Vector3 }[] = []
  mat: THREE.ShaderMaterial

  constructor(private scene: THREE.Scene, private maxCount = 100) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(-vViewPos);
          float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.0);
          vec3 col = mix(vec3(0.5, 0.8, 1.0), vec3(0.9, 0.95, 1.0), fresnel);
          float alpha = 0.3 + fresnel * 0.5;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  }

  emit(pos: THREE.Vector3, velocity: THREE.Vector3) {
    const geo = new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.08, 0)
    const mesh = new THREE.Mesh(geo, this.mat)
    mesh.position.copy(pos)
    mesh.renderOrder = 2010
    this.scene.add(mesh)

    this.particles.push({
      mesh,
      age: 0,
      lifetime: 0.3 + Math.random() * 0.4,
      velocity: velocity.clone().multiplyScalar(-0.2).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        )
      ),
    })

    while (this.particles.length > this.maxCount) {
      const p = this.particles.shift()
      if (p) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
      }
    }
  }

  update(dt: number) {
    const dtSec = dt * 0.001
    this.mat.uniforms.uTime.value = performance.now() * 0.001

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.age += dtSec
      const t = p.age / p.lifetime

      if (t >= 1) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        this.particles.splice(i, 1)
        continue
      }

      p.mesh.position.add(p.velocity.clone().multiplyScalar(dtSec))
      p.velocity.y -= 2 * dtSec
      p.velocity.multiplyScalar(0.95)

      const scale = (1 - t) * 0.8
      p.mesh.scale.setScalar(scale)
    }
  }

  dispose() {
    this.particles.forEach(p => {
      this.scene.remove(p.mesh)
      p.mesh.geometry.dispose()
    })
    this.mat.dispose()
  }
}

export class IceProjectile {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  lifetime = 2.0
  velocity = new THREE.Vector3()
  targetPos = new THREE.Vector3()
  trailTimer = 0
  frostTrail: FrostTrailEffect

  constructor(private scene: THREE.Scene, private config: IceConfig) {
    const geo = new THREE.ConeGeometry(0.15, 0.8, 6)
    geo.rotateX(Math.PI / 2)

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        void main() {
          vec3 viewDir = normalize(-vViewPos);
          float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.5);
          
          vec3 coreColor = vec3(0.4, 0.7, 0.95);
          vec3 edgeColor = vec3(0.85, 0.95, 1.0);
          vec3 col = mix(coreColor, edgeColor, fresnel);
          
          float tipGlow = smoothstep(0.0, 0.4, vLocalPos.z) * 0.5;
          col += vec3(0.3, 0.5, 0.7) * tipGlow;
          
          float alpha = 0.7 + fresnel * 0.3;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: true,
    })

    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2030
    scene.add(this.mesh)

    this.frostTrail = new FrostTrailEffect(scene)
  }

  fire(start: THREE.Vector3, target: THREE.Vector3, speed: number) {
    this.mesh.position.copy(start)
    this.targetPos.copy(target)

    const dir = target.clone().sub(start).normalize()
    this.velocity.copy(dir).multiplyScalar(speed)

    this.mesh.lookAt(target)

    this.age = 0
    this.lifetime = start.distanceTo(target) / speed + 0.5
    this.trailTimer = 0
    this.active = true
    this.mesh.visible = true
  }

  update(dt: number) {
    //  frostTrail：  mesh （  PS），
    //  impact  tick ，
    // ， " "。
    this.frostTrail.update(dt)

    if (!this.active) return

    const dtSec = dt * 0.001
    this.age += dtSec

    this.mat.uniforms.uTime.value = performance.now() * 0.001

    this.mesh.position.add(this.velocity.clone().multiplyScalar(dtSec))

    this.trailTimer += dtSec
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0
      this.frostTrail.emit(this.mesh.position.clone(), this.velocity)

      this.config.snowflakePS.emit({
        position: this.mesh.position.clone(),
        count: 2,
        speed: [0.5, 2],
        lifetime: [200, 400],
        size: [0.08, 0.15],
        colorFrom: new THREE.Color(0.6, 0.85, 1.0),
        colorTo: new THREE.Color(0.3, 0.5, 0.8),
        spread: 0.8,
      })
    }

    if (this.mesh.position.distanceTo(this.targetPos) < 0.5 || this.age >= this.lifetime) {
      this.impact()
    }
  }

  private impact() {
    const impactPos = this.mesh.position.clone()

    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2
      const dir = new THREE.Vector3(
        Math.cos(angle),
        0.3 + Math.random() * 0.3,
        Math.sin(angle)
      ).normalize()

      this.config.sparkPS.emit({
        position: impactPos.clone(),
        count: 2,
        speed: [3, 8],
        lifetime: [200, 400],
        size: [0.08, 0.18],
        colorFrom: new THREE.Color(0.7, 0.9, 1.0),
        colorTo: new THREE.Color(0.4, 0.6, 0.9),
        direction: dir,
        spread: 0.4,
      })
    }

    this.config.snowflakePS.emit({
      position: impactPos,
      count: 15,
      speed: [2, 6],
      lifetime: [400, 800],
      size: [0.15, 0.35],
      colorFrom: new THREE.Color(0.8, 0.95, 1.0),
      colorTo: new THREE.Color(0.5, 0.7, 0.95),
      spread: 1.5,
      gravity: 2,
    })

    this.config.addTrauma?.(0.35)
    this.config.triggerFlash?.(180, 220, 255, 100, 0.5)
    this.config.triggerFrostScreen?.(500, 0.6)

    this.active = false
    this.mesh.visible = false
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
    this.frostTrail.dispose()
  }
}
