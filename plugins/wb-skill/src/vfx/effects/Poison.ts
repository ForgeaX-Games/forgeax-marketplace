// @source wb-character/src/vfx/effects/Poison.ts
/**
 * 
 *  vfxtex/demo.ts 4226-4945 ， 
 * 
 * ：
 * - PoisonProjectile: （ ）
 * - PoisonBubble: 3D （ ）
 * - PoisonPoolEffect: （ + ）
 * - PoisonDebuffEffect: （ + ）
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem, MistParticleSystem } from '../core/ParticleSystems'

export interface PoisonConfig {
  magicPS: ParticleSystem
  smokePS: MistParticleSystem
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
}

export class PoisonProjectile {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  lifetime = 1.2
  velocity = new THREE.Vector3()
  impactTriggered = false
  trailTimer = 0
  
  constructor(
    private scene: THREE.Scene,
    private config: PoisonConfig,
    private poisonPool: PoisonPoolEffect,
    private onImpact?: (pos: THREE.Vector3) => void,
  ) {
    const geo = new THREE.SphereGeometry(0.35, 24, 18)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float t) {
          float i = floor(t); float f = fract(t);
          return mix(hash(i), hash(i + 1.0), f);
        }
        
        void main() {
          vLocalPos = position;
          float turbulence = 0.0;
          turbulence += sin(position.x * 8.0 + uTime * 6.0) * 0.03;
          turbulence += sin(position.y * 10.0 + uTime * 8.0) * 0.025;
          turbulence += sin(position.z * 9.0 + uTime * 7.0) * 0.02;
          turbulence += noise(position.x * 5.0 + uTime * 4.0) * 0.04;
          turbulence += noise(position.y * 6.0 + uTime * 5.0) * 0.035;
          vec3 pos = position + normal * turbulence;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          vViewPos = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        
        void main() {
          vec3 viewDir = normalize(-vViewPos);
          float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.5);
          vec3 deepColor = vec3(0.1, 0.4, 0.08);
          vec3 surfaceColor = vec3(0.35, 0.9, 0.25);
          vec3 edgeColor = vec3(0.5, 1.0, 0.4);
          vec3 col = mix(deepColor, surfaceColor, 0.4 + fresnel * 0.3);
          col = mix(col, edgeColor, fresnel * 0.7);
          float bubble = hash(vLocalPos * 10.0 + uTime * 2.0);
          bubble = smoothstep(0.85, 0.95, bubble);
          col += vec3(0.3, 0.5, 0.2) * bubble;
          float alpha = 0.85 + fresnel * 0.15;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2030
    scene.add(this.mesh)
  }
  
  fire(start: THREE.Vector3, target: THREE.Vector3, speed: number) {
    this.mesh.position.copy(start)
    const dir = target.clone().sub(start)
    const dist = dir.length()
    dir.normalize()
    const arcHeight = dist * 0.4 + 1.0
    this.velocity.copy(dir).multiplyScalar(speed)
    this.velocity.y += arcHeight * 2.5
    this.age = 0
    this.lifetime = dist / speed + 0.8
    this.impactTriggered = false
    this.trailTimer = 0
    this.active = true
    this.mesh.visible = true
    this.mesh.scale.setScalar(1)
  }
  
  update(dt: number) {
    if (!this.active) return
    
    const dtSec = dt * 0.001
    this.age += dtSec
    
    this.mat.uniforms.uTime.value = performance.now() * 0.001
    
    this.velocity.y -= 12 * dtSec
    this.mesh.position.add(this.velocity.clone().multiplyScalar(dtSec))
    
    this.trailTimer += dtSec
    if (this.trailTimer > 0.03) {
      this.trailTimer = 0
      this.config.magicPS.emit({
        position: this.mesh.position.clone(),
        count: 3,
        speed: [0.8, 2.5],
        lifetime: [180, 350],
        size: [0.05, 0.12],
        colorFrom: new THREE.Color(0.35, 0.95, 0.3),
        colorTo: new THREE.Color(0.15, 0.55, 0.1),
        gravity: 4,
      })
    }
    
    if ((this.age >= this.lifetime || this.mesh.position.y < 0.1) && !this.impactTriggered) {
      this.impactTriggered = true
      const impactPos = this.mesh.position.clone()
      impactPos.y = Math.max(impactPos.y, 0.08)
      
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.3
        const dir = new THREE.Vector3(Math.cos(angle), 0.15 + Math.random() * 0.2, Math.sin(angle))
        this.config.magicPS.emit({
          position: impactPos.clone(),
          count: 2,
          speed: [4, 8],
          lifetime: [250, 450],
          size: [0.08, 0.18],
          colorFrom: new THREE.Color(0.5, 1.0, 0.35),
          colorTo: new THREE.Color(0.2, 0.65, 0.15),
          direction: dir,
          spread: 0.25,
          gravity: 6,
        })
      }
      
      this.config.magicPS.emit({
        position: impactPos, count: 5,
        speed: [0.5, 1.5], lifetime: [80, 150], size: [0.4, 0.7],
        colorFrom: new THREE.Color(0.7, 1.0, 0.5),
        colorTo: new THREE.Color(0.4, 0.8, 0.3),
      })
      
      this.config.addTrauma?.(0.4)
      this.config.triggerFlash?.(80, 200, 60, 80, 0.4)
      
      setTimeout(() => {
        for (let i = 0; i < 8; i++) {
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * 0.3
          const spawnPos = impactPos.clone()
          spawnPos.x += Math.cos(angle) * r
          spawnPos.z += Math.sin(angle) * r
          
          this.config.magicPS.emit({
            position: spawnPos, count: 3,
            speed: [6, 14], lifetime: [400, 700], size: [0.06, 0.14],
            colorFrom: new THREE.Color(0.45, 0.95, 0.35),
            colorTo: new THREE.Color(0.2, 0.6, 0.15),
            direction: new THREE.Vector3(0, 1, 0),
            spread: 0.35,
            gravity: 8,
          })
        }
        
        this.config.smokePS.emit({
          position: impactPos, count: 6,
          speed: [1, 3], lifetime: [500, 900], size: [0.5, 1.0],
          colorFrom: new THREE.Color(0.35, 0.65, 0.25),
          colorTo: new THREE.Color(0.15, 0.35, 0.1),
          direction: new THREE.Vector3(0, 1, 0), spread: 0.5,
        })
        
        this.config.addTrauma?.(0.25)
      }, 60)
      
      setTimeout(() => {
        for (let i = 0; i < 12; i++) {
          const angle = Math.random() * Math.PI * 2
          const r = 0.5 + Math.random() * 1.0
          const dropPos = impactPos.clone()
          dropPos.x += Math.cos(angle) * r
          dropPos.z += Math.sin(angle) * r
          dropPos.y = 0.05
          
          this.config.magicPS.emit({
            position: dropPos, count: 2,
            speed: [0.5, 2], lifetime: [200, 400], size: [0.04, 0.1],
            colorFrom: new THREE.Color(0.4, 0.9, 0.3),
            colorTo: new THREE.Color(0.15, 0.5, 0.1),
            spread: 0.8, gravity: 3,
          })
        }
      }, 350)
      
      const poolPos = new THREE.Vector3(impactPos.x, 0.02, impactPos.z)
      this.poisonPool.trigger(poolPos)
      this.onImpact?.(new THREE.Vector3(impactPos.x, 0, impactPos.z))
    }
    
    if (this.impactTriggered && this.age > this.lifetime + 0.1) {
      this.active = false
      this.mesh.visible = false
    }
  }
  
  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
  }
}

export class PoisonBubble {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  lifetime = 0
  maxScale = 0
  basePos = new THREE.Vector3()
  
  constructor(private scene: THREE.Scene, private config: PoisonConfig) {
    const geo = new THREE.SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: `
        uniform float uProgress;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vPosition;
        
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uProgress;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vPosition;
        
        void main() {
          vec3 viewDir = normalize(vViewPos);
          float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);
          
          float heightFactor = smoothstep(0.0, 0.15, vPosition.y);
          
          vec3 baseColor = vec3(0.12, 0.45, 0.1);
          vec3 topColor = vec3(0.35, 0.85, 0.3);
          vec3 edgeColor = vec3(0.55, 1.0, 0.45);
          
          vec3 col = mix(baseColor, topColor, heightFactor);
          col = mix(col, edgeColor, fresnel * 0.7);
          
          float burst = smoothstep(0.75, 1.0, uProgress);
          col += vec3(0.35, 0.55, 0.25) * burst;
          
          float topHighlight = smoothstep(0.12, 0.15, vPosition.y) * fresnel * 0.6;
          col += vec3(0.5, 0.7, 0.4) * topHighlight;
          
          float rimLight = smoothstep(0.7, 0.95, fresnel) * 0.7;
          col += vec3(0.4, 0.6, 0.35) * rimLight;
          
          float alpha = 0.7 + fresnel * 0.2 - burst * 0.4;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2010
    scene.add(this.mesh)
  }
  
  spawn(pos: THREE.Vector3, maxScale: number, lifetime: number) {
    this.basePos.copy(pos)
    this.mesh.position.copy(pos)
    this.mesh.position.y = pos.y
    this.maxScale = maxScale
    this.lifetime = lifetime
    this.age = 0
    this.active = true
    this.mesh.visible = true
    this.mesh.scale.set(0.01, 0.01, 0.01)
  }
  
  update(dt: number): boolean {
    if (!this.active) return false
    this.age += dt * 0.001
    const progress = Math.min(this.age / this.lifetime, 1)
    
    this.mat.uniforms.uTime.value = performance.now() * 0.001
    this.mat.uniforms.uProgress.value = progress
    
    let scaleXZ: number, scaleY: number
    if (progress < 0.85) {
      const p = progress / 0.85
      const ease = Easing.easeOutQuad(p)
      scaleXZ = ease * this.maxScale
      scaleY = ease * this.maxScale * 1.2
    } else {
      const p = (progress - 0.85) / 0.15
      scaleXZ = this.maxScale * (1 + p * 0.4)
      scaleY = this.maxScale * 1.2 * (1 - p * 0.6)
    }
    
    this.mesh.scale.set(scaleXZ, scaleY, scaleXZ)
    
    this.mesh.position.y = this.basePos.y
    
    if (progress >= 1) {
      this.active = false
      this.mesh.visible = false
      
      const burstPos = this.mesh.position.clone()
      burstPos.y += 0.05
      this.config.magicPS.emit({
        position: burstPos,
        count: 5,
        speed: [0.8, 2.5],
        lifetime: [120, 280],
        size: [0.025, 0.07],
        colorFrom: new THREE.Color(0.5, 1.0, 0.4),
        colorTo: new THREE.Color(0.2, 0.6, 0.15),
        spread: 1.8,
        gravity: 5,
      })
      return true
    }
    return false
  }
  
  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
  }
}

export class PoisonPoolEffect {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  duration = 5.0
  bubbles: PoisonBubble[] = []
  bubbleSpawnTimer = 0
  poolPos = new THREE.Vector3()
  seed = 0

  constructor(private scene: THREE.Scene, private config: PoisonConfig) {
    const geo = new THREE.CircleGeometry(2.5, 64)
    geo.rotateX(-Math.PI / 2)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uRadius: { value: 0 },
        uSeed: { value: 0 },
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
        uniform float uRadius;
        uniform float uSeed;
        varying vec2 vUv;
        
        float hash(vec2 p) {
          return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i); float b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        
        float fbm(vec2 p) {
          float f = 0.0;
          f += 0.5 * noise(p); p *= 2.1;
          f += 0.25 * noise(p); p *= 2.2;
          f += 0.125 * noise(p); p *= 2.3;
          f += 0.0625 * noise(p);
          return f;
        }
        
        void main() {
          vec2 c = vUv - 0.5;
          float dist = length(c) * 2.0;
          
          float shape1 = fbm(c * 2.0 + uSeed) * 0.7;
          float shape2 = noise(c * 4.5 + uSeed * 2.3) * 0.4;
          float shape3 = noise(c * 8.0 + uSeed * 1.1) * 0.2;
          
          vec2 dir = normalize(c + 0.001);
          float dirNoise = noise(dir * 3.0 + uSeed * 0.7) * 0.5;
          
          float totalNoise = shape1 + shape2 + shape3 + dirNoise;
          
          float distortedDist = dist - totalNoise * 0.35;
          
          float boundary = uRadius * 0.65;
          
          float innerMask = smoothstep(boundary + 0.3, boundary - 0.1, distortedDist);
          float outerFade = smoothstep(boundary + 0.5, boundary - 0.2, distortedDist);
          float edge = innerMask * outerFade;
          
          float edgeAlphaFade = pow(smoothstep(boundary + 0.4, boundary - 0.3, distortedDist), 2.0);
          
          float flowN1 = noise(c * 4.0 + uTime * 0.3);
          float flowN2 = noise(c * 9.0 - uTime * 0.45);
          float flow = flowN1 * 0.6 + flowN2 * 0.4;
          
          vec3 deepColor = vec3(0.03, 0.18, 0.02);
          vec3 midColor = vec3(0.1, 0.4, 0.06);
          vec3 brightColor = vec3(0.3, 0.68, 0.18);
          
          vec3 col = mix(deepColor, midColor, flow);
          col = mix(col, brightColor, smoothstep(0.45, 0.7, flow) * 0.45);
          
          float centerDark = 1.0 - smoothstep(0.0, 0.5, dist);
          col = mix(col, deepColor, centerDark * 0.25);
          
          float nearEdge = 1.0 - innerMask;
          col = mix(col, midColor * 0.7, nearEdge * 0.4);
          
          float alpha = edge * edgeAlphaFade * uAlpha * (0.5 + flow * 0.2);
          
          alpha *= smoothstep(boundary + 0.35, boundary - 0.15, distortedDist);
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 9020
    scene.add(this.mesh)
    
    for (let i = 0; i < 12; i++) {
      this.bubbles.push(new PoisonBubble(scene, config))
    }
  }

  trigger(pos: THREE.Vector3) {
    this.poolPos.copy(pos)
    this.mesh.position.copy(pos)
    this.active = true
    this.age = 0
    this.mesh.visible = true
    this.bubbleSpawnTimer = 0
    this.seed = Math.random() * 100
    this.mat.uniforms.uSeed.value = this.seed
  }

  update(dt: number) {
    if (!this.active) return
    const dtSec = dt * 0.001
    this.age += dtSec
    const progress = this.age / this.duration
    
    this.mat.uniforms.uTime.value = performance.now() * 0.001
    
    let alpha: number, radius: number
    if (progress < 0.12) {
      const p = progress / 0.12
      alpha = Easing.easeOutQuad(p)
      radius = 0.2 + Easing.easeOutBack(p) * 0.8
    } else if (progress < 0.85) {
      alpha = 1.0
      radius = 1.0
    } else {
      const p = (progress - 0.85) / 0.15
      alpha = 1.0 - Easing.easeInQuad(p)
      radius = 1.0 - p * 0.25
    }
    
    this.mat.uniforms.uAlpha.value = alpha * 0.88
    this.mat.uniforms.uRadius.value = radius
    
    if (progress > 0.15 && progress < 0.8) {
      this.bubbleSpawnTimer += dtSec
      const spawnInterval = 0.25 + Math.random() * 0.35
      if (this.bubbleSpawnTimer > spawnInterval) {
        this.bubbleSpawnTimer = 0
        const bubble = this.bubbles.find(b => !b.active)
        if (bubble) {
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * 1.6
          const bubblePos = this.poolPos.clone()
          bubblePos.x += Math.cos(angle) * r
          bubblePos.z += Math.sin(angle) * r
          bubblePos.y = 0.06
          
          const maxScale = 0.4 + Math.random() * 0.8
          const lifetime = 0.6 + Math.random() * 0.8
          bubble.spawn(bubblePos, maxScale, lifetime)
        }
      }
    }
    
    this.bubbles.forEach(b => b.update(dt))
    
    if (Math.random() < 0.08 && progress < 0.82) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 1.5
      const spawnPos = this.poolPos.clone()
      spawnPos.x += Math.cos(angle) * r
      spawnPos.z += Math.sin(angle) * r
      spawnPos.y += 0.15
      
      this.config.smokePS.emit({
        position: spawnPos, count: 1,
        speed: [0.4, 1.0], lifetime: [600, 1100], size: [0.3, 0.65],
        colorFrom: new THREE.Color(0.28, 0.65, 0.2),
        colorTo: new THREE.Color(0.12, 0.35, 0.08),
        direction: new THREE.Vector3(0, 1, 0), spread: 0.35,
      })
    }
    
    if (this.age >= this.duration) {
      this.active = false
      this.mesh.visible = false
    }
  }
  
  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
    this.bubbles.forEach(b => b.dispose())
  }
}

// ─────────────────────────────────────────────────────────────
// ：
// ─────────────────────────────────────────────────────────────
export class PoisonCloudEffect {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  age = 0
  duration = 5.0

  private cloudPos = new THREE.Vector3()

  //
  private rBubbles: Array<{
    mesh: THREE.Mesh
    mat:  THREE.MeshBasicMaterial
    offX: number; offZ: number
    vy:   number
    age:  number; lifetime: number
  }> = []

  private bubbleTimer  = 0
  private particleTimer = 0
  private smokeTimer   = 0

  constructor(private scene: THREE.Scene, private config?: PoisonConfig) {
    //  y=1.5m，  2.9m → (y=0)  ≈ 2.48m，  PoisonPoolEffect(r=2.5)
    const geo = new THREE.SphereGeometry(2.9, 32, 16)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uAlpha: { value: 0 },
        uClipY: { value: 0 },  // ，  0
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uClipY;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float f  = 0.500 * noise(p); p *= 2.13;
                 f += 0.250 * noise(p); p *= 2.17;
                 f += 0.125 * noise(p); p *= 2.23;
                 f += 0.063 * noise(p);
          return f;
        }

        void main() {
          // ── ： ，  ────────────────────────
          float bottomFade = smoothstep(0.0, 0.9, vWorldPos.y);
          float topFade    = 1.0 - smoothstep(2.2, 3.9, vWorldPos.y);
          // ：uClipY ， 
          float growMask   = 1.0 - smoothstep(uClipY - 0.1, uClipY + 0.5, vWorldPos.y);
          float heightAlpha = bottomFade * topFade * growMask;

          // ── Domain Warping： （ ） ──────────────
          vec2 q = vec2(
            fbm(vUv * 2.5 + vec2(uTime * 0.07, 0.0)),
            fbm(vUv * 2.5 + vec2(5.2, 1.7) + vec2(0.0, uTime * 0.06))
          );
          vec2 r = vec2(
            fbm(vUv * 4.0 + 4.0 * q + vec2(1.7, 9.2) + uTime * 0.04),
            fbm(vUv * 4.0 + 4.0 * q + vec2(8.3, 2.8) - uTime * 0.04)
          );
          vec2 wUv = vUv + 0.32 * r;

          // ── ，  ─────────────────────
          float f1 = fbm(wUv * 2.6 + vec2( uTime * 0.09,  uTime * 0.05));  // / 
          float f2 = noise(wUv * 6.5 + vec2(-uTime * 0.08, uTime * 0.06)); // 
          float f3 = noise(vUv  * 13.0 + vec2(0.0, -uTime * 0.18));         // 
          float cloud = f1 * 0.52 + f2 * 0.30 + f3 * 0.18;

          // ── 5  ────────────────────────────────────────────
          vec3 c0 = vec3(0.02, 0.12, 0.01);
          vec3 c1 = vec3(0.07, 0.28, 0.04);
          vec3 c2 = vec3(0.16, 0.52, 0.09);
          vec3 c3 = vec3(0.33, 0.80, 0.17);
          vec3 c4 = vec3(0.52, 1.00, 0.30);

          vec3 col = mix(c0, c1, smoothstep(0.12, 0.32, cloud));
          col = mix(col, c2, smoothstep(0.32, 0.52, cloud));
          col = mix(col, c3, smoothstep(0.52, 0.73, cloud));
          col = mix(col, c4, smoothstep(0.73, 0.90, cloud));

          // ── Fresnel （ ， ） ──────────────
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.2);
          col += vec3(0.18, 0.50, 0.10) * fresnel * 0.45;

          float alpha = cloud * 0.62 * heightAlpha * uAlpha;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 9050
    scene.add(this.mesh)

    // ── （8 ）──────────────────────────────────────
    for (let i = 0; i < 8; i++) {
      const r    = 0.05 + Math.random() * 0.07
      const bGeo = new THREE.SphereGeometry(r, 8, 6)
      const mat  = new THREE.MeshBasicMaterial({
        color:      new THREE.Color(0.28, 0.88, 0.20),
        transparent: true,
        opacity:    0,
        depthWrite: false,
        depthTest:  false,
      })
      const mesh = new THREE.Mesh(bGeo, mat)
      mesh.visible = false
      mesh.renderOrder = 9055
      scene.add(mesh)
      this.rBubbles.push({ mesh, mat, offX: 0, offZ: 0, vy: 0, age: 0, lifetime: 0 })
    }
  }

  trigger(pos: THREE.Vector3, duration = 5.0) {
    this.cloudPos.set(pos.x, 0, pos.z)
    this.duration = duration
    this.mesh.position.set(pos.x, 1.5, pos.z)
    this.mesh.scale.setScalar(1.0)   // ，  uClipY
    this.age = 0
    this.active = true
    this.mesh.visible = true
    this.mat.uniforms.uClipY.value = 0  //
    this.mat.uniforms.uAlpha.value = 0
    this.bubbleTimer  = 0
    this.particleTimer = 0
    this.smokeTimer   = 0
    for (const b of this.rBubbles) { b.mesh.visible = false; b.age = b.lifetime + 1 }
  }

  update(dt: number) {
    if (!this.active) return
    const dtSec = dt * 0.001
    this.age += dtSec
    const progress = this.age / this.duration

    this.mat.uniforms.uTime.value = performance.now() * 0.001

    //  y ≈ 4.4m（ 1.5 + 2.9）， 0.6
    const CLOUD_TOP = 5.0

    let alpha: number, clipY: number
    if (progress < 0.18) {
      // ：  0 ，
      const p = progress / 0.18
      clipY = p * CLOUD_TOP
      alpha = Math.min(p * 1.5, 1.0)  //
    } else if (progress < 0.80) {
      clipY = CLOUD_TOP
      alpha = 1.0
    } else {
      // ： ，
      const p = (progress - 0.80) / 0.20
      clipY = CLOUD_TOP
      alpha = 1.0 - p
    }
    this.mat.uniforms.uClipY.value = clipY
    this.mat.uniforms.uAlpha.value = alpha * 0.75

    // ──  ────────────────────────────────────────────────
    if (progress > 0.08 && progress < 0.90) {
      this.bubbleTimer += dtSec
      if (this.bubbleTimer > 0.38 + Math.random() * 0.45) {
        this.bubbleTimer = 0
        const b = this.rBubbles.find(x => x.age > x.lifetime)
        if (b) {
          const angle = Math.random() * Math.PI * 2
          const rad   = 0.3 + Math.random() * 1.8
          b.offX = Math.cos(angle) * rad
          b.offZ = Math.sin(angle) * rad
          b.vy   = 0.5 + Math.random() * 0.9
          b.age  = 0
          b.lifetime = 1.2 + Math.random() * 1.2
          b.mesh.position.set(this.cloudPos.x + b.offX, 0.15, this.cloudPos.z + b.offZ)
          b.mat.opacity = 0.5
          b.mesh.visible = true
        }
      }
    }

    for (const b of this.rBubbles) {
      if (b.age > b.lifetime) continue
      b.age += dtSec
      const bp = b.age / b.lifetime
      b.mesh.position.y += b.vy * dtSec
      //
      b.mesh.scale.setScalar(Math.max(Math.sin(Math.PI * Math.min(bp, 1.0)), 0.01))
      b.mat.opacity = (1.0 - bp) * 0.55
      if (b.age >= b.lifetime) b.mesh.visible = false
    }

    // ──  ──────────────────────────────────────────────────
    if (this.config && progress > 0.08 && progress < 0.88) {
      this.particleTimer += dtSec
      if (this.particleTimer > 0.10) {
        this.particleTimer = 0
        const angle = Math.random() * Math.PI * 2
        const rad   = Math.random() * 2.0
        this.config.magicPS.emit({
          position: new THREE.Vector3(
            this.cloudPos.x + Math.cos(angle) * rad,
            0.1 + Math.random() * 0.5,
            this.cloudPos.z + Math.sin(angle) * rad,
          ),
          count: 1,
          speed:    [0.25, 1.0],
          lifetime: [500, 1100],
          size:     [0.03, 0.10],
          colorFrom: new THREE.Color(0.38, 1.0, 0.28),
          colorTo:   new THREE.Color(0.12, 0.45, 0.08),
          direction: new THREE.Vector3(0, 1, 0),
          spread:    0.5,
        })
      }

      // ──  ─────────────────────────────────────────────────
      this.smokeTimer += dtSec
      if (this.smokeTimer > 0.45 + Math.random() * 0.35) {
        this.smokeTimer = 0
        const angle = Math.random() * Math.PI * 2
        const rad   = Math.random() * 1.5
        this.config.smokePS.emit({
          position: new THREE.Vector3(
            this.cloudPos.x + Math.cos(angle) * rad,
            0.3 + Math.random() * 0.6,
            this.cloudPos.z + Math.sin(angle) * rad,
          ),
          count: 1,
          speed:    [0.20, 0.65],
          lifetime: [800, 1800],
          size:     [0.30, 0.62],
          colorFrom: new THREE.Color(0.26, 0.62, 0.16),
          colorTo:   new THREE.Color(0.08, 0.28, 0.04),
          direction: new THREE.Vector3(0, 1, 0),
          spread:    0.35,
        })
      }
    }

    if (progress >= 1) {
      this.active = false
      this.mesh.visible = false
      for (const b of this.rBubbles) { b.mesh.visible = false; b.age = b.lifetime + 1 }
    }
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mat.dispose()
    for (const b of this.rBubbles) {
      this.scene.remove(b.mesh)
      b.mesh.geometry.dispose()
      b.mat.dispose()
    }
  }
}

// ─────────────────────────────────────────────────────────────

export class PoisonDebuffEffect {
  active = false
  timer = 0
  duration = 3.0
  targetMesh: THREE.Mesh
  originalEmissive: THREE.Color
  pulsePhase = 0

  constructor(target: THREE.Mesh, private config: PoisonConfig) {
    this.targetMesh = target
    this.originalEmissive = (target.material as THREE.MeshStandardMaterial).emissive.clone()
  }

  trigger(dur = 3.0) {
    this.active = true
    this.timer = 0
    this.duration = dur
    this.pulsePhase = 0
  }

  update(dt: number) {
    if (!this.active) return
    this.timer += dt * 0.001
    this.pulsePhase += dt * 0.006
    
    const mat = this.targetMesh.material as THREE.MeshStandardMaterial
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(this.pulsePhase * 3))
    mat.emissive.setRGB(
      this.originalEmissive.r * (1 - pulse * 0.5) + 0.1 * pulse,
      this.originalEmissive.g * (1 - pulse * 0.3) + 0.6 * pulse,
      this.originalEmissive.b * (1 - pulse * 0.5) + 0.1 * pulse
    )
    mat.emissiveIntensity = 0.4 + pulse * 0.4
    
    if (Math.random() < 0.15) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 1.2
      )
      const spawnPos = this.targetMesh.position.clone().add(offset)
      
      this.config.magicPS.emit({
        position: spawnPos, count: 1,
        speed: [0.5, 1.5], lifetime: [300, 600], size: [0.08, 0.18],
        colorFrom: new THREE.Color(0.4, 1.0, 0.3),
        colorTo: new THREE.Color(0.2, 0.6, 0.15),
        direction: new THREE.Vector3(0, 1, 0), spread: 0.3,
      })
    }
    
    if (this.timer >= this.duration) {
      this.active = false
      mat.emissive.copy(this.originalEmissive)
      mat.emissiveIntensity = 0.4
    }
  }
}
