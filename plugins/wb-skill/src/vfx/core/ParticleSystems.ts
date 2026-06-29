// @source wb-character/src/vfx/core/ParticleSystems.ts
/**
 * VFX Particle System Library
 *  vfxtex/demo.ts 
 */

import * as THREE from 'three'

// ============================================================
// Easing
// ============================================================
export const Easing = {
  linear: (t: number) => t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInQuad: (t: number) => t * t,
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutBack: (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) },
  easeOutElastic: (t: number) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
}

// ============================================================
//
// ============================================================
interface Particle {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  r: number; g: number; b: number; a: number
  size: number; lifetime: number; elapsed: number
  active: boolean
}

interface FireParticle extends Particle {
  seed: number
}

// ============================================================
//
// ============================================================
export interface EmitConfig {
  position: THREE.Vector3
  count: number
  speed: [number, number]
  lifetime: [number, number]
  size: [number, number]
  colorFrom: THREE.Color
  colorTo: THREE.Color
  gravity?: number
  spreadAngle?: number
  direction?: THREE.Vector3
  spread?: number
}

// ============================================================
//  ( 、 )
// ============================================================
export class ParticleSystem {
  geo: THREE.BufferGeometry
  mat: THREE.ShaderMaterial
  points: THREE.Points
  particles: Particle[]
  maxCount: number

  constructor(scene: THREE.Scene, maxCount: number = 500, blendMode: THREE.Blending = THREE.AdditiveBlending, renderOrder = 2010) {
    this.maxCount = maxCount
    this.particles = Array.from({ length: maxCount }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      r: 1, g: 1, b: 1, a: 0, size: 1, lifetime: 1, elapsed: 0, active: false,
    }))

    this.geo = new THREE.BufferGeometry()
    const pos = new Float32Array(maxCount * 3)
    const col = new Float32Array(maxCount * 4)
    const sz = new Float32Array(maxCount)
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
    this.geo.setDrawRange(0, maxCount)

    this.mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vColor;
        void main(){
          vColor = aColor;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (280.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }`,
      fragmentShader: `
        varying vec4 vColor;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          if(d > 0.5) discard;
          float alpha = vColor.a * smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(vColor.rgb, alpha);
        }`,
      transparent: true, blending: blendMode, depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = renderOrder
    scene.add(this.points)
  }

  emit(cfg: EmitConfig) {
    let emitted = 0
    for (let i = 0; i < this.particles.length && emitted < cfg.count; i++) {
      const p = this.particles[i]
      if (p.active) continue
      emitted++

      const speed = cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0])
      let vx = 0, vy = 0, vz = 0

      if (cfg.direction) {
        const spread = cfg.spread ?? Math.PI / 6
        const randAngle = Math.random() * spread
        const randRot = Math.random() * Math.PI * 2
        const perp1 = new THREE.Vector3(cfg.direction.z + 0.01, 0, -cfg.direction.x).normalize()
        const perp2 = cfg.direction.clone().cross(perp1).normalize()
        const dir = cfg.direction.clone()
          .addScaledVector(perp1, Math.sin(randAngle) * Math.cos(randRot))
          .addScaledVector(perp2, Math.sin(randAngle) * Math.sin(randRot))
          .normalize()
        vx = dir.x * speed; vy = dir.y * speed; vz = dir.z * speed
      } else {
        const sa = cfg.spreadAngle ?? Math.PI * 2
        const theta = (Math.random() * 2 - 1) * sa
        const phi = Math.random() * Math.PI * 2
        vx = Math.sin(theta) * Math.cos(phi) * speed
        vy = Math.cos(theta) * speed
        vz = Math.sin(theta) * Math.sin(phi) * speed
      }

      p.x = cfg.position.x + (Math.random() - 0.5) * 0.2
      p.y = cfg.position.y + (Math.random() - 0.5) * 0.2
      p.z = cfg.position.z + (Math.random() - 0.5) * 0.2
      p.vx = vx; p.vy = vy; p.vz = vz
      p.r = cfg.colorFrom.r; p.g = cfg.colorFrom.g; p.b = cfg.colorFrom.b
      p.a = 0.9 + Math.random() * 0.1
      p.size = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0])
      p.lifetime = cfg.lifetime[0] + Math.random() * (cfg.lifetime[1] - cfg.lifetime[0])
      p.elapsed = 0
      p.active = true
    }
  }

  update(dt: number, gravity: number = 0) {
    const posArr = (this.geo.attributes.position as THREE.BufferAttribute).array as Float32Array
    const colArr = (this.geo.attributes.aColor as THREE.BufferAttribute).array as Float32Array
    const szArr = (this.geo.attributes.aSize as THREE.BufferAttribute).array as Float32Array

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (!p.active) {
        //  size  alpha 。
        //  size  GPU/  gl_PointSize=0  1px，
        //  AdditiveBlending + SnowflakeParticleSystem  RGB×1.5 。
        szArr[i] = 0
        colArr[i * 4 + 3] = 0
        continue
      }

      p.elapsed += dt
      const t = Math.min(p.elapsed / p.lifetime, 1)
      if (t >= 1) {
        p.active = false
        szArr[i] = 0
        colArr[i * 4 + 3] = 0
        continue
      }

      p.vy += gravity * dt * 0.00098
      p.vx *= 0.985; p.vz *= 0.985
      p.x += p.vx * dt * 0.001
      p.y += p.vy * dt * 0.001
      p.z += p.vz * dt * 0.001
      p.a = Easing.easeOutQuad(1 - t)

      const base3 = i * 3, base4 = i * 4
      posArr[base3] = p.x; posArr[base3+1] = p.y; posArr[base3+2] = p.z
      colArr[base4] = p.r; colArr[base4+1] = p.g; colArr[base4+2] = p.b; colArr[base4+3] = p.a
      szArr[i] = p.size * (1 - t * 0.3)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

// ============================================================
// /  (FBM )
// ============================================================
export class MistParticleSystem extends ParticleSystem {
  constructor(scene: THREE.Scene, maxCount: number = 200, blendMode: THREE.Blending = THREE.NormalBlending, renderOrder = 2005) {
    super(scene, maxCount, blendMode, renderOrder)
    
    this.mat.fragmentShader = `
      varying vec4 vColor;
      
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }
      float fbm(vec2 p){
        float v=0.0; float a=0.5;
        for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v;
      }
      
      void main(){
        vec2 p = gl_PointCoord - vec2(0.5);
        float r = length(p);
        if (r > 0.5) discard;
        
        float edge = smoothstep(0.5, 0.1, r);
        vec2 uv = gl_PointCoord * 2.5 + vec2(vColor.r * 13.0, vColor.g * 17.0);
        float n = fbm(uv);
        float shape = edge * (0.3 + 0.9 * n);
        
        float alpha = vColor.a * shape * 1.5;
        if (alpha < 0.01) discard;
        
        gl_FragColor = vec4(vColor.rgb, alpha);
      }
    `
    this.mat.needsUpdate = true
  }
}

// ============================================================
//  (  + UV  + )
// ============================================================
export class FireParticleSystem {
  geo: THREE.BufferGeometry
  mat: THREE.ShaderMaterial
  points: THREE.Points
  particles: FireParticle[]
  maxCount: number
  time: number = 0

  constructor(scene: THREE.Scene, maxCount: number = 200) {
    this.maxCount = maxCount
    this.particles = Array.from({ length: maxCount }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      r: 1, g: 0.5, b: 0.1, a: 0, size: 1, lifetime: 1, elapsed: 0, active: false, seed: Math.random(),
    }))

    this.geo = new THREE.BufferGeometry()
    const pos = new Float32Array(maxCount * 3)
    const col = new Float32Array(maxCount * 4)
    const sz = new Float32Array(maxCount)
    const vel = new Float32Array(maxCount * 3)
    const seed = new Float32Array(maxCount)
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
    this.geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3))
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.geo.setDrawRange(0, maxCount)

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec4 aColor;
        attribute float aSize;
        attribute vec3 aVelocity;
        attribute float aSeed;
        varying vec4 vColor;
        varying vec2 vVelDir;
        varying float vSeed;
        varying float vSpeed;
        void main(){
          vColor = aColor;
          vSeed = aSeed;
          
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vec3 velView = mat3(modelViewMatrix) * aVelocity;
          vSpeed = length(velView);
          vVelDir = vSpeed > 0.1 ? normalize(velView.xy) : vec2(0.0, 1.0);
          
          float stretchFactor = 1.0 + min(vSpeed * 0.08, 2.0);
          gl_PointSize = aSize * stretchFactor * (280.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec4 vColor;
        varying vec2 vVelDir;
        varying float vSeed;
        varying float vSpeed;
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        
        void main(){
          vec2 uv = gl_PointCoord - vec2(0.5);
          
          float angle = atan(vVelDir.y, vVelDir.x) - 1.5708;
          float cosA = cos(angle);
          float sinA = sin(angle);
          vec2 rotUv = vec2(
            uv.x * cosA - uv.y * sinA,
            uv.x * sinA + uv.y * cosA
          );
          
          float stretchAmount = 1.0 + min(vSpeed * 0.06, 1.5);
          rotUv.y *= stretchAmount;
          
          float noiseTime = uTime * 8.0 + vSeed * 100.0;
          vec2 noiseUv = rotUv * 3.0 + vec2(noiseTime * 0.5, noiseTime * 0.7);
          float distortion = noise(noiseUv) * 0.15;
          rotUv += vec2(
            noise(noiseUv + vec2(50.0, 0.0)) - 0.5,
            noise(noiseUv + vec2(0.0, 50.0)) - 0.5
          ) * distortion;
          
          float d = length(rotUv);
          float edgeNoise = noise(rotUv * 5.0 + vec2(noiseTime * 0.3)) * 0.15;
          float flameShape = smoothstep(0.5 + edgeNoise, 0.1, d);
          
          float core = smoothstep(0.3, 0.0, d) * 0.5;
          
          if(flameShape < 0.01) discard;
          float alpha = vColor.a * flameShape;
          vec3 col = vColor.rgb + core;
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 2016
    scene.add(this.points)
  }

  emit(cfg: EmitConfig) {
    let emitted = 0
    for (let i = 0; i < this.particles.length && emitted < cfg.count; i++) {
      const p = this.particles[i]
      if (p.active) continue
      emitted++

      const speed = cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0])
      let vx = 0, vy = 0, vz = 0

      if (cfg.direction) {
        const spread = cfg.spread ?? Math.PI / 6
        const randAngle = Math.random() * spread
        const randRot = Math.random() * Math.PI * 2
        const perp1 = new THREE.Vector3(cfg.direction.z + 0.01, 0, -cfg.direction.x).normalize()
        const perp2 = cfg.direction.clone().cross(perp1).normalize()
        const dir = cfg.direction.clone()
          .addScaledVector(perp1, Math.sin(randAngle) * Math.cos(randRot))
          .addScaledVector(perp2, Math.sin(randAngle) * Math.sin(randRot))
          .normalize()
        vx = dir.x * speed; vy = dir.y * speed; vz = dir.z * speed
      } else {
        const theta = (Math.random() * 2 - 1) * Math.PI
        const phi = Math.random() * Math.PI * 2
        vx = Math.sin(theta) * Math.cos(phi) * speed
        vy = Math.cos(theta) * speed
        vz = Math.sin(theta) * Math.sin(phi) * speed
      }

      p.x = cfg.position.x + (Math.random() - 0.5) * 0.3
      p.y = cfg.position.y + (Math.random() - 0.5) * 0.3
      p.z = cfg.position.z + (Math.random() - 0.5) * 0.3
      p.vx = vx; p.vy = vy; p.vz = vz
      p.r = cfg.colorFrom.r; p.g = cfg.colorFrom.g; p.b = cfg.colorFrom.b
      p.a = 0.85 + Math.random() * 0.15
      p.size = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0])
      p.lifetime = cfg.lifetime[0] + Math.random() * (cfg.lifetime[1] - cfg.lifetime[0])
      p.elapsed = 0
      p.active = true
      p.seed = Math.random()
    }
  }

  update(dt: number, gravity: number = 0) {
    this.time += dt * 0.001
    this.mat.uniforms.uTime.value = this.time

    const posArr = (this.geo.attributes.position as THREE.BufferAttribute).array as Float32Array
    const colArr = (this.geo.attributes.aColor as THREE.BufferAttribute).array as Float32Array
    const szArr = (this.geo.attributes.aSize as THREE.BufferAttribute).array as Float32Array
    const velArr = (this.geo.attributes.aVelocity as THREE.BufferAttribute).array as Float32Array
    const seedArr = (this.geo.attributes.aSeed as THREE.BufferAttribute).array as Float32Array

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (!p.active) {
        szArr[i] = 0
        colArr[i * 4 + 3] = 0
        continue
      }

      p.elapsed += dt
      const t = Math.min(p.elapsed / p.lifetime, 1)
      if (t >= 1) {
        p.active = false
        szArr[i] = 0
        colArr[i * 4 + 3] = 0
        continue
      }

      p.vy += gravity * dt * 0.00098
      p.vx *= 0.98; p.vz *= 0.98; p.vy *= 0.99
      p.x += p.vx * dt * 0.001
      p.y += p.vy * dt * 0.001
      p.z += p.vz * dt * 0.001
      p.a = Easing.easeOutQuad(1 - t)

      const base3 = i * 3, base4 = i * 4
      posArr[base3] = p.x; posArr[base3+1] = p.y; posArr[base3+2] = p.z
      colArr[base4] = p.r; colArr[base4+1] = p.g; colArr[base4+2] = p.b; colArr[base4+3] = p.a
      szArr[i] = p.size * (1 - t * 0.4)
      velArr[base3] = p.vx; velArr[base3+1] = p.vy; velArr[base3+2] = p.vz
      seedArr[i] = p.seed
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
    this.geo.attributes.aVelocity.needsUpdate = true
    this.geo.attributes.aSeed.needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

// ============================================================
// /  ( )
// ============================================================
export class SnowflakeParticleSystem extends ParticleSystem {
  constructor(scene: THREE.Scene, maxCount: number = 100, blendMode: THREE.Blending = THREE.AdditiveBlending, renderOrder = 2015) {
    super(scene, maxCount, blendMode, renderOrder)
    
    this.mat.fragmentShader = `
      varying vec4 vColor;
      
      void main(){
        vec2 p = gl_PointCoord - vec2(0.5);
        float r = length(p);
        float a = atan(p.y, p.x);
        
        // 
        float f = abs(cos(a * 3.0));
        f = smoothstep(0.8, 1.0, f) * 0.5 + 0.1;
        // 
        float f2 = abs(cos(a * 6.0));
        f += smoothstep(0.9, 1.0, f2) * 0.3 * step(0.15, r);
        
        // 
        float h = max(abs(p.x)*0.866025 + abs(p.y)*0.5, abs(p.y));
        float core = smoothstep(0.2, 0.05, h);
        
        float shape = smoothstep(f, f - 0.05, r);
        float finalAlpha = vColor.a * max(shape, core);
        if (finalAlpha < 0.05) discard;
        
        gl_FragColor = vec4(vColor.rgb * 1.5, finalAlpha);
      }
    `
    this.mat.needsUpdate = true
  }
}

// ============================================================
//  -
// ============================================================
export interface ParticleSystems {
  sparkPS: ParticleSystem
  smokePS: MistParticleSystem
  magicPS: ParticleSystem
  envPS: ParticleSystem
  firePS: FireParticleSystem
  snowflakePS: SnowflakeParticleSystem
  updateAll: (dt: number) => void
  dispose: () => void
}

export function createParticleSystems(scene: THREE.Scene): ParticleSystems {
  const sparkPS = new ParticleSystem(scene, 400, THREE.AdditiveBlending, 2015)
  const smokePS = new MistParticleSystem(scene, 400, THREE.NormalBlending, 2005)
  const magicPS = new ParticleSystem(scene, 300, THREE.AdditiveBlending, 2012)
  const envPS = new ParticleSystem(scene, 600, THREE.AdditiveBlending, 2002)
  const firePS = new FireParticleSystem(scene, 250)
  const snowflakePS = new SnowflakeParticleSystem(scene, 150, THREE.AdditiveBlending, 2015)

  return {
    sparkPS,
    smokePS,
    magicPS,
    envPS,
    firePS,
    snowflakePS,
    updateAll(dt: number) {
      sparkPS.update(dt)
      smokePS.update(dt)
      magicPS.update(dt)
      envPS.update(dt)
      firePS.update(dt)
      snowflakePS.update(dt)
    },
    dispose() {
      sparkPS.dispose()
      smokePS.dispose()
      magicPS.dispose()
      envPS.dispose()
      firePS.dispose()
      snowflakePS.dispose()
    }
  }
}
