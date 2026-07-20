// @source wb-character/src/vfx/effects/LightningEffect.ts
/**
 * 
 *  vfxtex/demo.ts 2698-3805 ， 
 * 
 * ：
 * - ChargingOrbEffect: 
 * - TindalRaysEffect: 
 * - LightningOrbProjectile: 
 * - WideStrikeLightning: 
 * - LightningImpactEffect: 
 * - LightningTarget: （ ）
 * - LightningAttackSystem: 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem } from '../core/ParticleSystems'

export interface LightningConfig {
  sparkPS: ParticleSystem
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerShockwave?: (pos: THREE.Vector3, color: THREE.Color) => void
}

export class ChargingOrbEffect {
  coreMesh: THREE.Mesh
  coreMat: THREE.ShaderMaterial
  glowMesh: THREE.Mesh
  glowMat: THREE.ShaderMaterial
  innerLightnings: THREE.Mesh[] = []
  active = false
  particleTimer = 0

  constructor(private scene: THREE.Scene, private config: LightningConfig, private camera: THREE.Camera) {
    const coreGeo = new THREE.PlaneGeometry(1.6, 1.6)
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i); float b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        
        void main() {
          vec2 c = vUv - 0.5;
          float dist = length(c);
          
          float turb = noise(c * 8.0 + uTime * 3.0) * 0.15;
          float core = smoothstep(0.35 + turb, 0.0, dist);
          
          float darkCore = smoothstep(0.15, 0.0, dist);
          core = max(core - darkCore * 0.7, 0.0);
          
          float pulse = 0.8 + 0.2 * sin(uTime * 8.0 + dist * 15.0);
          
          vec3 coreColor = vec3(0.02, 0.04, 0.12);
          vec3 midColor = vec3(0.3, 0.45, 1.0);
          vec3 edgeColor = vec3(0.65, 0.8, 1.0);
          
          vec3 col = mix(coreColor, midColor, smoothstep(0.0, 0.15, dist));
          col = mix(col, edgeColor, smoothstep(0.15, 0.35, dist));
          
          float alpha = core * uIntensity * pulse;
          alpha += darkCore * uIntensity * 0.95;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat)
    this.coreMesh.visible = false
    this.coreMesh.renderOrder = 2021
    scene.add(this.coreMesh)

    const glowGeo = new THREE.PlaneGeometry(3.0, 3.0)
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        
        void main() {
          vec2 c = vUv - 0.5;
          float dist = length(c);
          float glow = smoothstep(0.5, 0.0, dist) * 0.4;
          float pulse = 0.7 + 0.3 * sin(uTime * 6.0);
          vec3 col = vec3(0.35, 0.5, 1.0);
          float alpha = glow * uIntensity * pulse;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.glowMesh = new THREE.Mesh(glowGeo, this.glowMat)
    this.glowMesh.visible = false
    this.glowMesh.renderOrder = 2020
    scene.add(this.glowMesh)

    for (let i = 0; i < 4; i++) {
      const lightGeo = new THREE.PlaneGeometry(0.08, 0.8, 1, 12)
      lightGeo.translate(0, 0.4, 0)
      const lightMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          uniform float uTime;
          varying float vUvY;
          float hash(float n) { return fract(sin(n) * 43758.5453); }
          void main() {
            vUvY = uv.y;
            float n = (hash(uv.y * 10.0 + uTime * 5.0) - 0.5) * 0.15;
            vec3 pos = position + vec3(n, 0.0, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          varying float vUvY;
          void main() {
            float alpha = smoothstep(0.0, 0.2, vUvY) * smoothstep(1.0, 0.7, vUvY);
            vec3 col = vec3(0.7, 0.85, 1.0);
            gl_FragColor = vec4(col, alpha * 0.8);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(lightGeo, lightMat)
      mesh.visible = false
      mesh.renderOrder = 2022
      scene.add(mesh)
      this.innerLightnings.push(mesh)
    }
  }

  setPosition(pos: THREE.Vector3) {
    this.coreMesh.position.copy(pos)
    this.glowMesh.position.copy(pos)
    this.innerLightnings.forEach(l => l.position.copy(pos))
  }

  setIntensity(intensity: number) {
    this.coreMat.uniforms.uIntensity.value = intensity
    this.glowMat.uniforms.uIntensity.value = intensity
    const baseScale = 0.5 + intensity * 0.8
    this.coreMesh.scale.setScalar(baseScale)
    this.glowMesh.scale.setScalar(baseScale * 1.3)
  }

  setVisible(v: boolean) {
    this.coreMesh.visible = v
    this.glowMesh.visible = v
    this.innerLightnings.forEach(l => l.visible = v)
    this.active = v
  }

  update(dt: number) {
    if (!this.active) return
    const t = performance.now() * 0.001
    this.coreMat.uniforms.uTime.value = t
    this.glowMat.uniforms.uTime.value = t

    this.coreMesh.quaternion.copy(this.camera.quaternion)
    this.glowMesh.quaternion.copy(this.camera.quaternion)

    this.innerLightnings.forEach((l, i) => {
      const mat = l.material as THREE.ShaderMaterial
      mat.uniforms.uTime.value = t
      l.rotation.x += dt * (0.3 + i * 0.2) * (i % 2 === 0 ? 1 : -1)
      l.rotation.y += dt * (0.4 + i * 0.15)
      l.rotation.z += dt * (0.5 + i * 0.25) * (i % 3 === 0 ? 1 : -1)
    })

    this.particleTimer += dt
    if (this.particleTimer > 0.06) {
      this.particleTimer = 0
      const intensity = this.coreMat.uniforms.uIntensity.value
      if (intensity > 0.3) {
        const pos = this.coreMesh.position.clone()
        const angle = Math.random() * Math.PI * 2
        const radius = 0.8 + Math.random() * 0.6
        pos.x += Math.cos(angle) * radius
        pos.y += (Math.random() - 0.5) * 1.2
        pos.z += Math.sin(angle) * radius
        this.config.sparkPS.emit({
          position: pos,
          count: 3,
          speed: [2, 6],
          lifetime: [200, 450],
          size: [0.5, 1.2],
          colorFrom: new THREE.Color(0.75, 0.88, 1.0),
          colorTo: new THREE.Color(0.35, 0.55, 1.0),
          spread: 1.8,
        })
      }
    }
  }

  dispose() {
    this.scene.remove(this.coreMesh)
    this.scene.remove(this.glowMesh)
    this.innerLightnings.forEach(l => this.scene.remove(l))
  }
}

export class TindalRaysEffect {
  rays: THREE.Mesh[] = []
  active = false

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(0.4, 3.0, 1, 1)
      geo.translate(0, 1.5, 0)
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uIntensity: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uIntensity;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float fade = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.3, vUv.y);
            float center = 1.0 - abs(vUv.x - 0.5) * 2.0;
            center = pow(max(center, 0.0), 1.5);
            float flicker = 0.9 + 0.1 * sin(uTime * 15.0 + float(gl_FragCoord.x) * 0.1);
            vec3 coreCol = vec3(0.5, 0.6, 1.0);
            vec3 edgeCol = vec3(0.4, 0.5, 0.9);
            vec3 col = mix(edgeCol, coreCol, center);
            float alpha = fade * center * uIntensity * flicker * 0.6;
            gl_FragColor = vec4(col * 1.1, alpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.renderOrder = 2019
      const angle = (i / 8) * Math.PI * 2
      mesh.rotation.z = angle
      scene.add(mesh)
      this.rays.push(mesh)
    }
  }

  setPosition(pos: THREE.Vector3) {
    this.rays.forEach(r => r.position.copy(pos))
  }

  setIntensity(intensity: number) {
    this.rays.forEach(r => {
      const mat = r.material as THREE.ShaderMaterial
      mat.uniforms.uIntensity.value = intensity
      r.scale.setScalar(0.5 + intensity * 0.8)
    })
  }

  setVisible(v: boolean) {
    this.rays.forEach(r => r.visible = v)
    this.active = v
  }

  update(dt: number) {
    if (!this.active) return
    const t = performance.now() * 0.001
    this.rays.forEach((r, i) => {
      r.rotation.z += dt * 0.3 * (i % 2 === 0 ? 1 : -1)
      const mat = r.material as THREE.ShaderMaterial
      mat.uniforms.uTime.value = t
    })
  }

  dispose() {
    this.rays.forEach(r => this.scene.remove(r))
  }
}

export class LightningOrbProjectile {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  arcLightnings: THREE.Mesh[] = []
  arcSeeds: number[] = []
  active = false
  velocity = new THREE.Vector3()
  targetPos = new THREE.Vector3()

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.4, 24, 24)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
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
          float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.5);
          float flicker = 0.85 + 0.15 * sin(uTime * 30.0);
          vec3 coreColor = vec3(0.01, 0.015, 0.06);
          vec3 edgeColor = vec3(0.45, 0.7, 1.0) * 2.5;
          vec3 col = mix(coreColor, edgeColor, fresnel);
          float alpha = mix(0.98, 1.0, fresnel) * flicker;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2025
    scene.add(this.mesh)

    for (let i = 0; i < 8; i++) {
      const arcGeo = new THREE.PlaneGeometry(0.025, 0.28, 1, 8)
      const arcMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: Math.random() * 100 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying float vUvY;
          varying float vUvX;
          float hash(float n) { return fract(sin(n) * 43758.5453); }
          float noise(float t) {
            float i = floor(t); float f = fract(t);
            return mix(hash(i), hash(i + 1.0), f);
          }
          void main() {
            vUvY = uv.y;
            vUvX = uv.x;
            float n = (noise(uv.y * 8.0 + uTime * 15.0 + uSeed) - 0.5) * 0.12;
            float n2 = (noise(uv.y * 12.0 + uTime * 20.0 + uSeed + 30.0) - 0.5) * 0.08;
            vec3 pos = position + vec3(n + n2, 0.0, (n - n2) * 0.5);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          varying float vUvY;
          varying float vUvX;
          void main() {
            float edge = smoothstep(0.0, 0.15, vUvY) * smoothstep(1.0, 0.85, vUvY);
            float center = 1.0 - abs(vUvX - 0.5) * 2.0;
            vec3 col = vec3(0.85, 0.95, 1.0);
            gl_FragColor = vec4(col, edge * center * 0.9);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const arcMesh = new THREE.Mesh(arcGeo, arcMat)
      arcMesh.visible = false
      arcMesh.renderOrder = 2026
      scene.add(arcMesh)
      this.arcLightnings.push(arcMesh)
      this.arcSeeds.push(Math.random() * 1000)
    }
  }

  fire(start: THREE.Vector3, target: THREE.Vector3, speed: number) {
    this.mesh.position.copy(start)
    this.targetPos.copy(target)
    this.velocity.copy(target).sub(start).normalize().multiplyScalar(speed)
    this.active = true
    this.mesh.visible = true
    this.arcLightnings.forEach(a => a.visible = true)
  }

  update(dt: number): boolean {
    if (!this.active) return false
    const t = performance.now() * 0.001
    this.mat.uniforms.uTime.value = t

    this.mesh.position.add(this.velocity.clone().multiplyScalar(dt))

    this.arcLightnings.forEach((arc, i) => {
      const seed = this.arcSeeds[i]
      const phi = (Math.sin(seed + t * 3) * 0.5 + 0.5) * Math.PI
      const theta = (seed * 0.1 + t * 2.5 + i * 0.8) * Math.PI * 2
      const r = 0.48
      const offset = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * r,
        Math.cos(phi) * r,
        Math.sin(phi) * Math.sin(theta) * r
      )
      arc.position.copy(this.mesh.position).add(offset)
      arc.lookAt(this.mesh.position)
      arc.rotateX(Math.PI / 2)
      const mat = arc.material as THREE.ShaderMaterial
      mat.uniforms.uTime.value = t
    })

    if (this.mesh.position.distanceTo(this.targetPos) < 0.5) {
      this.active = false
      this.mesh.visible = false
      this.arcLightnings.forEach(a => a.visible = false)
      return true
    }
    return false
  }

  hide() {
    this.active = false
    this.mesh.visible = false
    this.arcLightnings.forEach(a => a.visible = false)
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.arcLightnings.forEach(a => this.scene.remove(a))
  }
}

export class WideStrikeLightning {
  mainBolt: THREE.Mesh
  mainMat: THREE.ShaderMaterial
  glowMesh: THREE.Mesh
  glowMat: THREE.ShaderMaterial
  branches: THREE.Mesh[] = []
  branchMats: THREE.ShaderMaterial[] = []
  active = false
  age = 0
  duration = 0.6
  startPos = new THREE.Vector3()
  endPos = new THREE.Vector3()

  constructor(private scene: THREE.Scene, private config: LightningConfig) {
    const mainGeo = new THREE.PlaneGeometry(0.08, 1, 1, 48)
    mainGeo.translate(0, 0.5, 0)

    this.mainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uBottomGlow: { value: 0 },
        uSeed: { value: Math.random() * 1000 },
      },
      vertexShader: `
        uniform float uSeed;
        uniform float uTime;
        varying float vUvY;
        varying float vUvX;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float t) {
          float i = floor(t); float f = fract(t);
          return mix(hash(i), hash(i + 1.0), f);
        }
        void main() {
          vUvY = uv.y;
          vUvX = uv.x;
          float n1 = (noise(uv.y * 6.0 + uSeed) - 0.5) * 0.35;
          float n2 = (noise(uv.y * 10.0 + uSeed + 7.0) - 0.5) * 0.18;
          float jitter = (noise(uv.y * 30.0 + uTime * 6.0 + uSeed) - 0.5) * 0.03;
          vec3 pos = position + vec3(n1 + n2 + jitter, 0.0, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform float uBottomGlow;
        uniform float uTime;
        uniform float uSeed;
        varying float vUvY;
        varying float vUvX;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float t) {
          float i = floor(t); float f = fract(t);
          return mix(hash(i), hash(i + 1.0), f);
        }
        void main() {
          float core = 1.0 - smoothstep(0.0, 0.5, abs(vUvX - 0.5));
          float along = smoothstep(0.0, 0.02, vUvY) * smoothstep(1.0, 0.98, vUvY);
          float flicker = 0.75 + 0.25 * step(0.35, fract(uTime * 45.0 + vUvY * 3.0));
          float segmentVar = noise(vUvY * 8.0 + uSeed) * 0.4 + noise(vUvY * 15.0 + uTime * 3.0) * 0.3;
          float preGlow = (1.0 - uBottomGlow) * segmentVar;
          float bottomBoost = smoothstep(0.6, 1.0, vUvY) * uBottomGlow * 2.0;
          float alpha = along * core * (uAlpha * (0.7 + preGlow) + bottomBoost) * flicker;
          vec3 col = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 1.0, 1.0), 0.5 + bottomBoost * 0.5 + preGlow * 0.3);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.mainBolt = new THREE.Mesh(mainGeo, this.mainMat)
    this.mainBolt.visible = false
    this.mainBolt.renderOrder = 2042
    scene.add(this.mainBolt)

    const glowGeo = new THREE.PlaneGeometry(0.25, 1, 1, 48)
    glowGeo.translate(0, 0.5, 0)
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uSeed: { value: Math.random() * 1000 },
      },
      vertexShader: `
        uniform float uSeed;
        varying float vUvY;
        varying float vUvX;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float t) {
          float i = floor(t); float f = fract(t);
          return mix(hash(i), hash(i + 1.0), f);
        }
        void main() {
          vUvY = uv.y;
          vUvX = uv.x;
          float n1 = (noise(uv.y * 6.0 + uSeed) - 0.5) * 0.35;
          float n2 = (noise(uv.y * 10.0 + uSeed + 7.0) - 0.5) * 0.18;
          vec3 pos = position + vec3(n1 + n2, 0.0, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        varying float vUvY;
        varying float vUvX;
        void main() {
          float glow = smoothstep(0.5, 0.0, abs(vUvX - 0.5));
          float along = smoothstep(0.0, 0.05, vUvY) * smoothstep(1.0, 0.95, vUvY);
          vec3 col = vec3(0.4, 0.55, 1.0);
          float alpha = glow * along * uAlpha * 0.5;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.glowMesh = new THREE.Mesh(glowGeo, this.glowMat)
    this.glowMesh.visible = false
    this.glowMesh.renderOrder = 2041
    scene.add(this.glowMesh)

    // ── （4 ）： 、 、  ─────────────────────────
    for (let i = 0; i < 4; i++) {
      const bGeo = new THREE.PlaneGeometry(0.03, 1, 1, 32)
      bGeo.translate(0, 0.5, 0)
      const bMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:  { value: 0 },
          uAlpha: { value: 0 },
          uSeed:  { value: Math.random() * 1000 },
        },
        vertexShader: `
          uniform float uSeed, uTime;
          varying float vUvY, vUvX;
          float hash(float n){ return fract(sin(n) * 43758.5453); }
          float noise(float t){ float i=floor(t); float f=fract(t); return mix(hash(i), hash(i+1.0), f); }
          void main(){
            vUvY = uv.y; vUvX = uv.x;
            float n1 = (noise(uv.y * 10.0 + uSeed) - 0.5) * 0.65;
            float n2 = (noise(uv.y * 18.0 + uSeed + 5.0) - 0.5) * 0.30;
            float jitter = (noise(uv.y * 30.0 + uTime * 9.0 + uSeed) - 0.5) * 0.06;
            vec3 pos = position + vec3(n1 + n2 + jitter, 0.0, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uAlpha;
          varying float vUvY, vUvX;
          void main(){
            float core  = 1.0 - smoothstep(0.0, 0.5, abs(vUvX - 0.5));
            float along = smoothstep(0.0, 0.06, vUvY) * smoothstep(1.0, 0.75, vUvY);
            vec3 col = vec3(0.78, 0.90, 1.0);
            gl_FragColor = vec4(col, along * core * uAlpha * 0.65);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const bMesh = new THREE.Mesh(bGeo, bMat)
      bMesh.visible = false
      bMesh.renderOrder = 2040
      scene.add(bMesh)
      this.branches.push(bMesh)
      this.branchMats.push(bMat)
    }
  }

  strike(startPos: THREE.Vector3, endPos: THREE.Vector3, camera: THREE.Camera) {
    this.startPos.copy(startPos)
    this.endPos.copy(endPos)
    this.age = 0
    this.active = true

    const dir = endPos.clone().sub(startPos)
    const length = dir.length()
    dir.normalize()

    this.mainBolt.position.copy(startPos)
    this.mainBolt.scale.set(1, length, 1)
    this.mainBolt.lookAt(endPos)
    this.mainBolt.rotateX(Math.PI / 2)
    this.mainBolt.visible = true

    this.glowMesh.position.copy(startPos)
    this.glowMesh.scale.set(1, length, 1)
    this.glowMesh.lookAt(endPos)
    this.glowMesh.rotateX(Math.PI / 2)
    this.glowMesh.visible = true

    this.mainMat.uniforms.uSeed.value = Math.random() * 1000
    this.glowMat.uniforms.uSeed.value = this.mainMat.uniforms.uSeed.value

    // ，
    this.branches.forEach((b, i) => {
      const lateralAngle = (i / this.branches.length) * Math.PI * 2
      const lateral = 0.4 + i * 0.18
      const bStart = startPos.clone().add(new THREE.Vector3(
        Math.cos(lateralAngle) * lateral * 0.3,
        0,
        Math.sin(lateralAngle) * lateral * 0.3,
      ))
      const bEnd = endPos.clone().add(new THREE.Vector3(
        Math.cos(lateralAngle) * lateral,
        0,
        Math.sin(lateralAngle) * lateral,
      ))
      const bLen = length * (0.55 + Math.random() * 0.3)   // 55-85%
      b.position.copy(bStart)
      b.scale.set(1, bLen, 1)
      b.lookAt(bEnd)
      b.rotateX(Math.PI / 2)
      b.visible = true
      this.branchMats[i].uniforms.uSeed.value  = Math.random() * 1000
      this.branchMats[i].uniforms.uAlpha.value = 1.0
    })

    this.config.addTrauma?.(0.5)
    this.config.triggerFlash?.(200, 220, 255, 120, 0.7)
  }

  update(dt: number) {
    if (!this.active) return

    this.age += dt * 0.001
    const progress = Math.min(this.age / this.duration, 1)
    const t = performance.now() * 0.001

    this.mainMat.uniforms.uTime.value = t
    this.glowMat.uniforms.uTime.value = t

    let alpha: number
    if (progress < 0.15) {
      alpha = Easing.easeOutQuad(progress / 0.15)
    } else if (progress < 0.5) {
      alpha = 1.0
    } else {
      alpha = 1.0 - Easing.easeInQuad((progress - 0.5) / 0.5)
    }

    this.mainMat.uniforms.uAlpha.value = alpha
    this.glowMat.uniforms.uAlpha.value = alpha
    this.mainMat.uniforms.uBottomGlow.value = progress < 0.3 ? progress / 0.3 : 1.0

    // （ ， ）
    this.branches.forEach((b, i) => {
      this.branchMats[i].uniforms.uTime.value  = t
      this.branchMats[i].uniforms.uAlpha.value = alpha * 0.75
      if (progress >= 1) b.visible = false
    })

    if (progress >= 1) {
      this.active = false
      this.mainBolt.visible = false
      this.glowMesh.visible = false
    }
  }

  dispose() {
    this.scene.remove(this.mainBolt)
    this.scene.remove(this.glowMesh)
    this.branches.forEach(b => this.scene.remove(b))
    this.branchMats.forEach(m => m.dispose())
  }
}

export class LightningImpactEffect {
  groundFlash: THREE.Mesh
  groundMat: THREE.ShaderMaterial
  active = false
  age = 0
  duration = 0.5

  constructor(private scene: THREE.Scene, private config: LightningConfig) {
    const geo = new THREE.CircleGeometry(2, 32)
    geo.rotateX(-Math.PI / 2)

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uProgress;
        varying vec2 vUv;
        
        void main() {
          vec2 c = vUv - 0.5;
          float dist = length(c) * 2.0;
          
          float ring = smoothstep(uProgress - 0.2, uProgress, dist) * 
                       smoothstep(uProgress + 0.3, uProgress, dist);
          
          float center = smoothstep(0.5, 0.0, dist);
          
          vec3 col = vec3(0.5, 0.7, 1.0) * (ring + center * 0.5);
          
          float alpha = (ring + center * 0.3) * uAlpha;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.groundFlash = new THREE.Mesh(geo, this.groundMat)
    this.groundFlash.visible = false
    this.groundFlash.renderOrder = 2040
    scene.add(this.groundFlash)
  }

  trigger(pos: THREE.Vector3) {
    this.groundFlash.position.copy(pos)
    this.groundFlash.position.y = 0.02
    this.age = 0
    this.active = true
    this.groundFlash.visible = true

    this.config.sparkPS.emit({
      position: pos,
      count: 25,
      speed: [5, 15],
      lifetime: [200, 500],
      size: [0.3, 0.8],
      colorFrom: new THREE.Color(0.7, 0.85, 1.0),
      colorTo: new THREE.Color(0.3, 0.5, 1.0),
      spread: 1.5,
    })

    this.config.triggerShockwave?.(pos, new THREE.Color(0.5, 0.7, 1.0))
    this.config.addTrauma?.(0.4)
  }

  update(dt: number) {
    if (!this.active) return

    this.age += dt * 0.001
    const progress = Math.min(this.age / this.duration, 1)
    const t = performance.now() * 0.001

    this.groundMat.uniforms.uTime.value = t
    this.groundMat.uniforms.uProgress.value = Easing.easeOutQuad(progress)
    this.groundMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(progress)

    this.groundFlash.scale.setScalar(1 + progress * 0.5)

    if (progress >= 1) {
      this.active = false
      this.groundFlash.visible = false
    }
  }

  dispose() {
    this.scene.remove(this.groundFlash)
    this.groundMat.dispose()
  }
}

export class LightningAttackSystem {
  chargingOrb: ChargingOrbEffect
  tindalRays: TindalRaysEffect
  orbProjectile: LightningOrbProjectile
  strikeLightning: WideStrikeLightning
  impactEffect: LightningImpactEffect

  state: 'idle' | 'charging' | 'firing' | 'striking' | 'impact' = 'idle'
  chargeTime = 0
  maxChargeTime = 1.5
  targetPos = new THREE.Vector3()
  sourcePos = new THREE.Vector3()

  constructor(private scene: THREE.Scene, private config: LightningConfig, private camera: THREE.Camera) {
    this.chargingOrb = new ChargingOrbEffect(scene, config, camera)
    this.tindalRays = new TindalRaysEffect(scene)
    this.orbProjectile = new LightningOrbProjectile(scene)
    this.strikeLightning = new WideStrikeLightning(scene, config)
    this.impactEffect = new LightningImpactEffect(scene, config)
  }

  startCharging(sourcePos: THREE.Vector3, targetPos: THREE.Vector3) {
    this.state = 'charging'
    this.chargeTime = 0
    this.sourcePos.copy(sourcePos)
    this.targetPos.copy(targetPos)

    this.chargingOrb.setPosition(sourcePos)
    this.chargingOrb.setVisible(true)
    this.chargingOrb.setIntensity(0)

    this.tindalRays.setPosition(sourcePos)
    this.tindalRays.setVisible(true)
    this.tindalRays.setIntensity(0)
  }

  fire() {
    if (this.state !== 'charging') return

    this.state = 'firing'
    this.chargingOrb.setVisible(false)
    this.tindalRays.setVisible(false)

    this.orbProjectile.fire(this.sourcePos.clone(), this.targetPos.clone(), 0.02)
  }

  update(dt: number) {
    this.chargingOrb.update(dt)
    this.tindalRays.update(dt)
    this.strikeLightning.update(dt)
    this.impactEffect.update(dt)

    switch (this.state) {
      case 'charging':
        this.chargeTime += dt * 0.001
        const intensity = Math.min(this.chargeTime / this.maxChargeTime, 1)
        this.chargingOrb.setIntensity(intensity)
        this.tindalRays.setIntensity(intensity)

        if (this.chargeTime >= this.maxChargeTime) {
          this.fire()
        }
        break

      case 'firing':
        const hit = this.orbProjectile.update(dt)
        if (hit) {
          this.state = 'striking'
          const skyPos = this.targetPos.clone()
          skyPos.y += 15

          this.strikeLightning.strike(skyPos, this.targetPos.clone(), this.camera)
          this.impactEffect.trigger(this.targetPos.clone())
        }
        break

      case 'striking':
        if (!this.strikeLightning.active && !this.impactEffect.active) {
          this.state = 'idle'
        }
        break
    }
  }

  reset() {
    this.state = 'idle'
    this.chargingOrb.setVisible(false)
    this.tindalRays.setVisible(false)
    this.orbProjectile.hide()
  }

  dispose() {
    this.chargingOrb.dispose()
    this.tindalRays.dispose()
    this.orbProjectile.dispose()
    this.strikeLightning.dispose()
    this.impactEffect.dispose()
  }
}
