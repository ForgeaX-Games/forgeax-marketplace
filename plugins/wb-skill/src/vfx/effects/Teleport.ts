// @source wb-character/src/vfx/effects/Teleport.ts
/**
 * 
 *  vfxtex/demo.ts 5922-6400 ， 
 * 
 * ：
 * - 
 * - 
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem } from '../core/ParticleSystems'

export interface TeleportConfig {
  sparkPS: ParticleSystem
  magicPS: ParticleSystem
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerShockwave?: (pos: THREE.Vector3, color: THREE.Color) => void
}

export class MagicTeleportEffect {
  circleMesh: THREE.Mesh
  circleMat: THREE.ShaderMaterial
  
  runeRing: THREE.Mesh
  runeMat: THREE.ShaderMaterial
  
  pillarMesh: THREE.Mesh
  pillarMat: THREE.ShaderMaterial
  
  active = false
  state: 'idle' | 'disappearing' | 'appearing' = 'idle'
  age = 0
  targetMesh: THREE.Object3D
  /** ， ，  scale */
  targetBaseScale = 1.0
  /**  Y （  VFXManager ）， /  */
  groundY = 0.0
  /** （ ：  →  → ） */
  autoReappearAfterMs = 0
  
  constructor(private scene: THREE.Scene, target: THREE.Object3D, private config: TeleportConfig) {
    this.targetMesh = target
    
    const circleGeo = new THREE.CircleGeometry(1.8, 64)
    this.circleMat = new THREE.ShaderMaterial({
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
        
        #define PI 3.14159265359
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        void main() {
          vec2 c = vUv - 0.5;
          float dist = length(c) * 2.0;
          float angle = atan(c.y, c.x);
          
          float outerRing = smoothstep(0.95, 0.98, dist) * (1.0 - smoothstep(0.98, 1.0, dist));
          float innerRing = smoothstep(0.7, 0.73, dist) * (1.0 - smoothstep(0.73, 0.76, dist));
          float midRing = smoothstep(0.85, 0.87, dist) * (1.0 - smoothstep(0.87, 0.89, dist));
          
          float runeCount = 12.0;
          float runeAngle = mod(angle + uTime * 0.5, PI * 2.0 / runeCount);
          float rune = smoothstep(0.05, 0.08, runeAngle) * (1.0 - smoothstep(0.12, 0.15, runeAngle));
          rune *= smoothstep(0.75, 0.78, dist) * (1.0 - smoothstep(0.82, 0.85, dist));
          
          float starAngle = mod(angle + PI / 6.0, PI / 3.0) - PI / 6.0;
          float starDist = dist / cos(starAngle) * 0.5;
          float star = smoothstep(0.3, 0.32, starDist) * (1.0 - smoothstep(0.32, 0.35, starDist));
          star *= step(dist, 0.65);
          
          float lines = 0.0;
          for (float i = 0.0; i < 6.0; i++) {
            float la = i * PI / 3.0 + uTime * 0.8;
            float ld = abs(dot(c, vec2(cos(la), sin(la))));
            lines += smoothstep(0.015, 0.005, ld) * smoothstep(0.1, 0.3, dist) * (1.0 - smoothstep(0.5, 0.65, dist));
          }
          
          float pattern = outerRing + innerRing + midRing + rune * 0.8 + star * 0.6 + lines * 0.5;
          
          float progressMask = smoothstep(0.0, uProgress * 1.2, 1.0 - dist);
          pattern *= progressMask;
          
          vec3 col1 = vec3(1.0, 0.8, 0.4);
          vec3 col2 = vec3(0.6, 0.2, 1.0);
          vec3 col = mix(col1, col2, dist * 0.6 + sin(uTime * 2.0) * 0.15);
          
          col *= 1.0 + pattern * 0.5;
          
          float alpha = pattern * uAlpha;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    this.circleMesh = new THREE.Mesh(circleGeo, this.circleMat)
    this.circleMesh.rotation.x = -Math.PI / 2
    this.circleMesh.visible = false
    this.circleMesh.renderOrder = 2100
    scene.add(this.circleMesh)
    
    const spiralPoints: THREE.Vector3[] = []
    const spiralSegments = 80
    const spiralTurns = 2.5
    const spiralRadius = 0.9
    
    for (let i = 0; i <= spiralSegments; i++) {
      const t = i / spiralSegments
      const angle = t * Math.PI * 2 * spiralTurns
      const height = t * 3
      const x = Math.cos(angle) * spiralRadius
      const z = Math.sin(angle) * spiralRadius
      spiralPoints.push(new THREE.Vector3(x, height, z))
    }
    
    const spiralCurve = new THREE.CatmullRomCurve3(spiralPoints)
    const spiralGeo = new THREE.TubeGeometry(spiralCurve, 64, 0.04, 8, false)
    
    this.runeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        varying vec2 vUv;
        
        void main() {
          vPos = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uProgress;
        
        varying vec3 vPos;
        varying vec2 vUv;
        
        void main() {
          float flow = fract(vUv.x * 3.0 - uTime * 2.0);
          flow = pow(flow, 0.5) * (1.0 - pow(flow, 2.0)) * 4.0;
          
          float heightFade = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          
          float progressMask = smoothstep(vUv.x - 0.1, vUv.x + 0.1, uProgress);
          
          vec3 col1 = vec3(1.0, 0.8, 0.4);
          vec3 col2 = vec3(0.6, 0.15, 1.0);
          vec3 col = mix(col1, col2, vUv.x);
          
          float sparkle = sin(vUv.x * 50.0 + uTime * 8.0) * 0.3 + 0.7;
          col *= (0.8 + flow * 0.6) * sparkle;
          
          float alpha = heightFade * uAlpha * progressMask * (0.6 + flow * 0.4);
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    this.runeRing = new THREE.Mesh(spiralGeo, this.runeMat)
    this.runeRing.visible = false
    this.runeRing.renderOrder = 2101
    scene.add(this.runeRing)
    
    const pillarGeo = new THREE.CylinderGeometry(0.8, 1.2, 3, 32, 1, true)
    this.pillarMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uProgress;
        
        varying vec2 vUv;
        varying vec3 vPos;
        
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        
        void main() {
          float heightFade = 1.0 - vUv.y;
          
          float flow = sin(vUv.y * 20.0 - uTime * 8.0) * 0.5 + 0.5;
          flow *= sin(vUv.x * 30.0 + uTime * 3.0) * 0.3 + 0.7;
          
          float sparkle = hash(floor(vUv.x * 20.0) + floor(vUv.y * 30.0) + uTime * 2.0);
          sparkle = pow(sparkle, 8.0);
          
          float progressMask = smoothstep(1.0 - uProgress, 1.0 - uProgress + 0.3, vUv.y);
          
          vec3 col1 = vec3(1.0, 0.9, 0.6);
          vec3 col2 = vec3(0.6, 0.3, 1.0);
          vec3 col = mix(col1, col2, vUv.y);
          
          col += vec3(1.0) * sparkle * 0.5;
          
          float alpha = heightFade * flow * uAlpha * progressMask;
          alpha += sparkle * 0.3 * uAlpha * progressMask;
          
          gl_FragColor = vec4(col, alpha * 0.6);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    this.pillarMesh = new THREE.Mesh(pillarGeo, this.pillarMat)
    this.pillarMesh.visible = false
    this.pillarMesh.renderOrder = 2102
    scene.add(this.pillarMesh)
  }
  
  disappear() {
    if (this.state !== 'idle') return
    this.state = 'disappearing'
    this.age = 0
    this.active = true
    
    const pos = this.targetMesh.position.clone()
    pos.y = this.groundY + 0.01   //  VFXManager  Y
    
    this.circleMesh.visible = true
    this.circleMesh.position.copy(pos)
    this.circleMat.uniforms.uProgress.value = 0
    this.circleMat.uniforms.uAlpha.value = 0
    
    this.runeRing.visible = true
    this.runeRing.position.set(pos.x, this.groundY, pos.z)
    
    this.pillarMesh.visible = true
    this.pillarMesh.position.set(pos.x, this.groundY + 1.5, pos.z)
    
    this.config.sparkPS.emit({
      position: pos.clone().add(new THREE.Vector3(0, 0.5, 0)),
      count: 30,
      speed: [2, 5],
      lifetime: [400, 800],
      size: [0.05, 0.12],
      colorFrom: new THREE.Color(1.0, 0.85, 0.5),
      colorTo: new THREE.Color(0.7, 0.4, 1.0),
      spread: 1.5,
    })
    
    this.config.triggerShockwave?.(pos, new THREE.Color(0.8, 0.6, 1.0))
  }
  
  appear() {
    if (this.state !== 'idle') return
    this.state = 'appearing'
    this.age = 0
    this.active = true
    
    const pos = this.targetMesh.position.clone()
    pos.y = this.groundY + 0.01
    
    this.circleMesh.visible = true
    this.circleMesh.position.copy(pos)
    this.circleMat.uniforms.uProgress.value = 1
    this.circleMat.uniforms.uAlpha.value = 1
    
    this.runeRing.visible = true
    this.runeRing.position.set(pos.x, this.groundY + 3, pos.z)
    
    this.pillarMesh.visible = true
    this.pillarMesh.position.set(pos.x, this.groundY + 1.5, pos.z)
    this.pillarMat.uniforms.uProgress.value = 1
    
    this.config.magicPS.emit({
      position: pos.clone().add(new THREE.Vector3(0, 3, 0)),
      count: 25,
      speed: [1, 3],
      lifetime: [500, 900],
      size: [0.04, 0.1],
      colorFrom: new THREE.Color(0.9, 0.7, 1.0),
      colorTo: new THREE.Color(1.0, 0.85, 0.5),
      spread: 1.0,
      gravity: 1,
    })
  }
  
  dismiss() {
    this.state = 'idle'
    this.active = false
    this.circleMesh.visible = false
    this.runeRing.visible = false
    this.pillarMesh.visible = false
  }
  
  update(dt: number) {
    if (!this.active) return
    
    const dtSec = dt * 0.001
    this.age += dtSec
    const time = performance.now() * 0.001
    
    this.circleMat.uniforms.uTime.value = time
    this.runeMat.uniforms.uTime.value = time
    this.pillarMat.uniforms.uTime.value = time
    
    this.runeRing.rotation.y += dtSec * 2.0
    
    const pos = this.targetMesh.position.clone()
    pos.y = this.groundY + 0.01   //
    
    if (this.state === 'disappearing') {
      const duration = 1.5
      const progress = Math.min(this.age / duration, 1)
      
      const circleAppear = Math.min(progress / 0.3, 1)
      this.circleMat.uniforms.uAlpha.value = Easing.easeOutQuad(circleAppear)
      this.circleMat.uniforms.uProgress.value = Easing.easeOutQuad(circleAppear)
      
      this.pillarMat.uniforms.uAlpha.value = circleAppear
      this.pillarMat.uniforms.uProgress.value = Easing.easeOutQuad(progress)
      
      this.runeRing.position.set(pos.x, this.groundY, pos.z)
      this.runeMat.uniforms.uAlpha.value = circleAppear * (1.0 - Math.max(0, (progress - 0.8) / 0.2))
      this.runeMat.uniforms.uProgress.value = Easing.easeOutQuad(progress)
      
      if (circleAppear > 0.2 && Math.random() < 0.4) {
        const angle = Math.random() * Math.PI * 2
        const radius = 0.5 + Math.random() * 1.2
        const pPos = pos.clone().add(new THREE.Vector3(
          Math.cos(angle) * radius,
          0.1,
          Math.sin(angle) * radius
        ))
        
        const isLarge = Math.random() < 0.2
        const pSize: [number, number] = isLarge ? [0.12, 0.22] : [0.04, 0.1]
        
        this.config.magicPS.emit({
          position: pPos,
          count: 1,
          speed: isLarge ? [1.0, 2.5] : [1.5, 3.5],
          lifetime: isLarge ? [700, 1200] : [500, 900],
          size: pSize,
          colorFrom: new THREE.Color(0.9, 0.7, 1.0),
          colorTo: new THREE.Color(0.5, 0.15, 0.9),
          direction: new THREE.Vector3(0, 1, 0),
          spread: 0.15,
        })
      }
      
      if (progress > 0.3) {
        const dissolve = (progress - 0.3) / 0.5
        this.targetMesh.scale.setScalar((1.0 - Easing.easeInQuad(Math.min(dissolve, 1)) * 0.3) * this.targetBaseScale)
        
        if (Math.random() < 0.25) {
          const pPos = pos.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            0.3 + Math.random() * 1.5,
            (Math.random() - 0.5) * 1.2
          ))
          this.config.sparkPS.emit({
            position: pPos,
            count: 1,
            speed: [2, 4],
            lifetime: [300, 600],
            size: [0.03, 0.08],
            colorFrom: new THREE.Color(1.0, 0.85, 0.5),
            colorTo: new THREE.Color(0.6, 0.2, 1.0),
            direction: new THREE.Vector3(0, 1, 0),
            spread: 0.25,
          })
        }
      }
      
      if (progress >= 1) {
        this.targetMesh.visible = false
        this.targetMesh.scale.setScalar(this.targetBaseScale)
        
        this.config.triggerFlash?.(180, 150, 255, 80, 0.3)
        this.config.addTrauma?.(0.2)
        
        this.dismiss()

        // （ ）
        if (this.autoReappearAfterMs > 0) {
          const delay = this.autoReappearAfterMs
          this.autoReappearAfterMs = 0
          setTimeout(() => {
            if (this.state === 'idle') this.appear()
          }, delay)
        }
      }
    }
    
    if (this.state === 'appearing') {
      const duration = 1.5
      const progress = Math.min(this.age / duration, 1)
      
      this.circleMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(Math.max(0, (progress - 0.7) / 0.3))
      
      this.pillarMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(Math.max(0, (progress - 0.6) / 0.4))
      this.pillarMat.uniforms.uProgress.value = 1.0 - Easing.easeOutQuad(progress) * 0.8
      
      this.runeRing.position.set(pos.x, this.groundY, pos.z)
      this.runeMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(Math.max(0, (progress - 0.7) / 0.3))
      this.runeMat.uniforms.uProgress.value = 1.0 - Easing.easeOutQuad(progress) * 0.8
      
      if (progress < 0.8 && Math.random() < 0.35) {
        const angle = Math.random() * Math.PI * 2
        const radius = 0.5 + Math.random() * 1.2
        const pPos = pos.clone().add(new THREE.Vector3(
          Math.cos(angle) * radius,
          0.1,
          Math.sin(angle) * radius
        ))
        
        const isLarge = Math.random() < 0.2
        const pSize: [number, number] = isLarge ? [0.12, 0.22] : [0.04, 0.1]
        
        this.config.magicPS.emit({
          position: pPos,
          count: 1,
          speed: isLarge ? [1.0, 2.5] : [1.5, 3.5],
          lifetime: isLarge ? [700, 1200] : [500, 900],
          size: pSize,
          colorFrom: new THREE.Color(0.9, 0.7, 1.0),
          colorTo: new THREE.Color(0.5, 0.15, 0.9),
          direction: new THREE.Vector3(0, 1, 0),
          spread: 0.15,
        })
      }
      
      if (progress > 0.2 && !this.targetMesh.visible) {
        this.targetMesh.visible = true
        this.targetMesh.scale.setScalar(0.01 * this.targetBaseScale)
        
        this.config.triggerFlash?.(180, 150, 255, 100, 0.4)
        this.config.addTrauma?.(0.3)
        this.config.triggerShockwave?.(pos, new THREE.Color(0.7, 0.5, 1.0))
      }
      
      if (progress > 0.2 && progress < 0.8) {
        const appear = (progress - 0.2) / 0.6
        this.targetMesh.scale.setScalar(Easing.easeOutBack(Math.min(appear, 1)) * this.targetBaseScale)
        
        if (Math.random() < 0.2) {
          const pPos = pos.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            Math.random() * 2,
            (Math.random() - 0.5) * 1.2
          ))
          this.config.sparkPS.emit({
            position: pPos,
            count: 1,
            speed: [1, 3],
            lifetime: [300, 600],
            size: [0.04, 0.1],
            colorFrom: new THREE.Color(1.0, 0.9, 0.6),
            colorTo: new THREE.Color(0.7, 0.4, 1.0),
            spread: 0.5,
          })
        }
      }
      
      if (progress >= 1) {
        this.targetMesh.scale.setScalar(this.targetBaseScale)
        this.dismiss()
      }
    }
  }
  
  dispose() {
    this.dismiss()
    this.scene.remove(this.circleMesh)
    this.scene.remove(this.runeRing)
    this.scene.remove(this.pillarMesh)
    this.circleMat.dispose()
    this.runeMat.dispose()
    this.pillarMat.dispose()
  }
}
