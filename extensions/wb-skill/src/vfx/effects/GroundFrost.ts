// @source wb-character/src/vfx/effects/GroundFrost.ts
/**
 * 
 *  vfxtex/demo.ts 980-1143 
 * 
 * ：
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { SnowflakeParticleSystem } from '../core/ParticleSystems'

export class GroundFrostEffect {
  active = false
  age = 0
  duration = 4.0
  mesh: THREE.Mesh

  constructor(private scene: THREE.Scene, private snowflakePS?: SnowflakeParticleSystem) {
    const geo = new THREE.PlaneGeometry(20, 20, 128, 128)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
        uCenter:   { value: new THREE.Vector2(0, 0) },
        uRadius:   { value: 6.5 },   //
        uDensity:  { value: 1.0 },   // （ ）
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform vec2  uCenter;
        uniform float uRadius;
        uniform float uDensity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        // （  [-1, 1]）
        float vnoise(vec2 p) {
          vec2 c = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(c,             vec2(127.1, 311.7))) * 43758.5);
          float b = fract(sin(dot(c + vec2(1,0), vec2(127.1, 311.7))) * 43758.5);
          float cv= fract(sin(dot(c + vec2(0,1), vec2(127.1, 311.7))) * 43758.5);
          float dv= fract(sin(dot(c + vec2(1,1), vec2(127.1, 311.7))) * 43758.5);
          return mix(mix(a,b,f.x), mix(cv,dv,f.x), f.y) * 2.0 - 1.0;
        }

        // FBM 3 ： 、 （ ）
        vec2 fbmWarp(vec2 p) {
          float wx = vnoise(p * 1.1)        * 1.00
                   + vnoise(p * 2.4 + 1.7)  * 0.50
                   + vnoise(p * 5.2 + 4.1)  * 0.25;
          float wy = vnoise(p * 1.1 + 5.3)  * 1.00
                   + vnoise(p * 2.4 + 8.6)  * 0.50
                   + vnoise(p * 5.2 + 11.3) * 0.25;
          return vec2(wx, wy);
        }

        // Chebyshev voronoi： ， 
        // ， 
        float crackNet(vec2 p) {
          float d1 = 99.0, d2 = 99.0, d;
          // 10 （ ， ）
          d = max(abs(p.x - 1.0), abs(p.y + 2.6)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x + 2.9), abs(p.y - 0.8)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x - 0.4), abs(p.y - 3.1)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x + 1.2), abs(p.y + 1.5)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x - 3.4), abs(p.y + 0.6)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x + 0.7), abs(p.y - 1.8)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x - 2.1), abs(p.y - 2.3)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x + 3.2), abs(p.y + 2.0)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x - 1.7), abs(p.y + 3.5)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(p.x + 2.4), abs(p.y - 2.9)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          return d2 - d1;
        }

        // （ ）
        float fineCrackNet(vec2 p) {
          vec2 q = p * 1.65;
          float d1 = 99.0, d2 = 99.0, d;
          d = max(abs(q.x - 1.3), abs(q.y + 0.9)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x + 0.6), abs(q.y - 1.6)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x - 2.1), abs(q.y - 0.4)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x + 1.8), abs(q.y + 1.3)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x - 0.5), abs(q.y + 2.2)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x + 2.4), abs(q.y - 0.7)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          d = max(abs(q.x - 1.0), abs(q.y - 2.5)); if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
          return (d2 - d1) / 1.65;
        }

        void main() {
          vec2 offsetPos = vWorldPos.xz - uCenter;
          float dist = length(offsetPos);

          float expProgress = min(1.0, uProgress / 0.2);
          float radius = (1.0 - pow(1.0 - expProgress, 3.0)) * uRadius;
          if (dist > radius + 0.3) discard;

          float fade = 1.0 - smoothstep(0.68, 1.0, uProgress);

          //  FBM （  uDensity ， ）
          vec2 samplePos = offsetPos * uDensity;
          vec2 w1 = fbmWarp(samplePos * 0.7) * (1.6 / uDensity);
          vec2 w2 = fbmWarp((samplePos + w1 * uDensity) * 1.4) * (0.7 / uDensity);
          vec2 warpedPos = offsetPos + w1 + w2;

          //  → （crackNet ）
          float e1 = crackNet(warpedPos * uDensity);
          float e2 = fineCrackNet(warpedPos * uDensity);
          float crack1 = 1.0 - smoothstep(0.0, 0.12, e1);
          float crack2 = (1.0 - smoothstep(0.0, 0.065, e2)) * 0.60;
          float crackTotal = max(crack1, crack2);

          // （ ， ）
          float revealMask = smoothstep(radius, radius - 0.6, dist);
          float alpha = crackTotal * revealMask * fade;

          // ： ， 
          vec3 col = mix(vec3(0.38, 0.68, 1.0), vec3(0.92, 0.98, 1.0), crack1);

          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.position.y = 0.02
    this.mesh.visible = false
    this.mesh.renderOrder = 1000
    scene.add(this.mesh)
  }
  
  trigger(pos: THREE.Vector3) {
    this.mesh.position.set(pos.x, 0.02, pos.z)
    ;(this.mesh.material as THREE.ShaderMaterial).uniforms.uCenter.value.set(pos.x, pos.z)
    this.age = 0
    this.active = true
    this.mesh.visible = true
  }

  update(dt: number) {
    if (!this.active) return
    this.age += dt * 0.001
    const mat = this.mesh.material as THREE.ShaderMaterial
    mat.uniforms.uTime.value += dt * 0.001
    
    const progress = this.age / this.duration
    mat.uniforms.uProgress.value = progress
    
    const expProgress = Math.min(1.0, progress / 0.2)
    const maxR = (this.mesh.material as THREE.ShaderMaterial).uniforms.uRadius.value as number
    const currentRadius = (1.0 - Math.pow(1.0 - expProgress, 3.0)) * maxR
    
    if (this.snowflakePS && progress < 0.8 && currentRadius > 1.0) {
      const spawnCount = Math.floor(Math.random() * 2 + 1) 
      for (let i = 0; i < spawnCount; i++) {
        if (Math.random() < 0.25) {
          const angle = Math.random() * Math.PI * 2
          const r = currentRadius + (Math.random() - 0.5) * 0.4
          const pos = this.mesh.position.clone()
          pos.x += Math.cos(angle) * r
          pos.z += Math.sin(angle) * r
          
          this.snowflakePS.emit({
            position: pos, count: 1,
            speed: [0.8, 1.8], lifetime: [1000, 2000], size: [0.15, 0.3],
            colorFrom: new THREE.Color(1.0, 1.0, 1.0),
            colorTo: new THREE.Color(0.6, 0.8, 1.0),
            direction: new THREE.Vector3(0, 1, 0), spread: 0.8
          })
        }
      }
    }

    if (this.age >= this.duration) {
      this.active = false
      this.mesh.visible = false
    }
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.ShaderMaterial).dispose()
  }
}
