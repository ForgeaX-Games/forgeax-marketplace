// @source wb-character/src/vfx/effects/Shield.ts
/**
 * 
 *  vfxtex/demo.ts 4951-5914 ， 
 * 
 * ：
 * - 
 * - 
 * - 
 * - 
 * - 
 * - 
 */

import * as THREE from 'three'
import { Easing } from '../core/Easing'
import { ParticleSystem } from '../core/ParticleSystems'

export interface ShieldConfig {
  sparkPS: ParticleSystem
  magicPS: ParticleSystem
  camera: THREE.Camera
  addTrauma?: (amount: number) => void
  triggerFlash?: (r: number, g: number, b: number, duration: number, intensity: number) => void
  triggerShockwave?: (pos: THREE.Vector3, color: THREE.Color) => void
}

export class ShieldEffect {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  active = false
  state: 'idle' | 'appearing' | 'active' | 'hit' | 'breaking' = 'idle'
  age = 0
  hitAge = 0
  hitPos = new THREE.Vector3()
  targetMesh: THREE.Mesh
  
  floatingTriangles: THREE.Mesh[] = []
  floatMat: THREE.ShaderMaterial
  
  shardMeshes: THREE.Mesh[] = []
  shardMat: THREE.ShaderMaterial
  shardData: { velocity: THREE.Vector3; rotAxis: THREE.Vector3; rotSpeed: number; isCameraShard?: boolean }[] = []
  
  lightBeams: THREE.Mesh[] = []
  beamMat: THREE.ShaderMaterial
  
  constructor(private scene: THREE.Scene, target: THREE.Mesh, private config: ShieldConfig) {
    this.targetMesh = target
    
    const geo = new THREE.IcosahedronGeometry(1.56, 4)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uScale: { value: 0 },
        uHitProgress: { value: 0 },
        uHitPos: { value: new THREE.Vector3() },
        uBreakProgress: { value: 0 },
        uPulse: { value: 0 },
        uSeed: { value: Math.random() * 100 },
        uAppearProgress: { value: 1 },
        uInnerGlow: { value: 0 },
        //  uniform（  VFXManager.update ）
        uGridScale:  { value: 3.5 },
        uBrightness: { value: 1.0 },
        uFlowSpeed:  { value: 1.0 },
        uHue:        { value: 0.0 },
        uDistortion: { value: 1.0 },
      },
      vertexShader: `
        uniform float uScale;
        uniform float uSeed;
        uniform float uAppearProgress;
        uniform float uTime;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        flat varying float vFaceRand;
        flat varying vec3 vFaceWorldPos;
        
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vLocalPos = position;
          
          vFaceRand = hash(dot(position, vec3(12.9898, 78.233, 45.164)) + uSeed);
          
          float appearThreshold = vFaceRand;
          float triAppear = smoothstep(appearThreshold - 0.3, appearThreshold, uAppearProgress);
          
          float outwardOffset = (1.0 - triAppear) * 0.5;
          vec3 offsetDir = normalize(position);
          
          vec3 pos = position * uScale;
          pos += offsetDir * outwardOffset * (1.0 - uAppearProgress);
          
          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vFaceWorldPos = worldPos.xyz;
          
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform float uHitProgress;
        uniform vec3 uHitPos;
        uniform float uBreakProgress;
        uniform float uPulse;
        uniform float uAppearProgress;
        uniform float uInnerGlow;
        uniform float uGridScale;
        uniform float uBrightness;
        uniform float uFlowSpeed;
        uniform float uHue;
        uniform float uDistortion;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        flat varying float vFaceRand;
        flat varying vec3 vFaceWorldPos;

        // Rodrigues （k = normalize(1,1,1)，angle = uHue * 2π）
        vec3 hueShift(vec3 rgb, float h) {
          float ang = h * 6.28318;
          vec3 k = vec3(0.57735);
          return rgb * cos(ang) + cross(k, rgb) * sin(ang) + k * dot(k, rgb) * (1.0 - cos(ang));
        }
        
        void main() {
          float appearThreshold = vFaceRand;
          float triAppear = smoothstep(appearThreshold - 0.2, appearThreshold + 0.1, uAppearProgress);
          
          if (triAppear < 0.01 && uAppearProgress < 0.99) {
            discard;
          }
          
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - max(dot(vNormal, viewDir), 0.0);
          float fresnelPow = pow(fresnel, 2.0);
          
          vec3 centerColor = vec3(0.5, 0.7, 0.7);
          vec3 transitionColor = vec3(0.5, 1.3, 1.2);
          vec3 edgeColor = vec3(0.2, 0.7, 0.7);
          vec3 brightColor = vec3(0.8, 1.5, 1.4);
          vec3 darkColor = vec3(0.1, 0.4, 0.4);
          vec3 saturatedColor = vec3(0.4, 1.2, 1.0);
          vec3 glowColor = vec3(0.4, 1.0, 0.95);
          
          vec3 col;
          float t1 = smoothstep(0.0, 0.35, fresnel);
          float t2 = smoothstep(0.35, 0.7, fresnel);
          
          col = mix(centerColor, transitionColor, t1);
          col = mix(col, edgeColor, t2 * 0.6);
          
          float dissolveEdge = smoothstep(0.0, 0.3, triAppear) * (1.0 - smoothstep(0.7, 1.0, triAppear));
          if (uAppearProgress < 0.95) {
            vec3 dissolveGlow = vec3(1.0, 0.9, 0.7) * dissolveEdge * 1.5;
            col += dissolveGlow * (1.0 - uAppearProgress);
          }
          
          if (uInnerGlow > 0.0) {
            vec3 innerGlowColor = vec3(1.0, 0.95, 0.85);
            float innerFade = 1.0 - fresnel;
            col += innerGlowColor * uInnerGlow * innerFade * 0.8;
            col += glowColor * uInnerGlow * 0.3;
          }
          
          float inTransitionZone = smoothstep(0.25, 0.4, fresnel) * (1.0 - smoothstep(0.85, 1.0, fresnel));
          
          if (inTransitionZone > 0.1) {
            if (vFaceRand < 0.15) {
              col = mix(col, brightColor, inTransitionZone * 0.6);
            } else if (vFaceRand < 0.30) {
              col = mix(col, darkColor, inTransitionZone * 0.5);
            } else if (vFaceRand < 0.50) {
              col = mix(col, saturatedColor, inTransitionZone * 0.5);
            }
          }
          
          float edgeBright = smoothstep(0.45, 0.65, fresnel) * (1.0 - smoothstep(0.65, 0.85, fresnel));
          col = mix(col, transitionColor * 1.15, edgeBright * 0.35);
          
          float edgeGlow = pow(fresnel, 2.5);
          col += glowColor * edgeGlow * 0.5;
          
          float rimGlow = pow(fresnel, 4.0);
          vec3 rimColor = vec3(1.0, 1.0, 1.0);
          col += rimColor * rimGlow * 0.15;
          
          if (uHitProgress > 0.0 && uHitProgress < 1.0) {
            float distToHit = length(vFaceWorldPos - uHitPos);
            
            float hitFade = smoothstep(0.0, 0.08, uHitProgress) * smoothstep(1.0, 0.3, uHitProgress);
            
            float coreZone = step(distToHit, 0.35);
            
            float inRange = step(distToHit, 1.0);
            float selectChance = (1.0 - distToHit / 1.0) * 0.6;
            float isSelected = step(1.0 - selectChance, vFaceRand) * inRange;
            
            float inHitZone = max(coreZone, isSelected);
            
            vec3 hitColor = vec3(1.5, 1.1, 0.35);
            vec3 coreColor = vec3(2.0, 1.8, 1.0);
            
            vec3 finalHitColor = mix(hitColor, coreColor, coreZone);
            
            col = mix(col, finalHitColor, inHitZone * hitFade);
            
            col += coreColor * coreZone * hitFade * 0.8;
            
            col += hitColor * isSelected * hitFade * 0.4;
          }
          
          col += transitionColor * uPulse * 0.25;
          
          if (uBreakProgress > 0.0) {
            col = mix(col, vec3(1.0), uBreakProgress * 0.4);
          }
          
          float centerAlpha = 0.055;
          float edgeAlpha = 0.5;
          float baseAlpha = mix(centerAlpha, edgeAlpha, fresnelPow);
          
          float alpha = baseAlpha * uAlpha;
          
          alpha *= 1.0 - uBreakProgress * 0.6;

          // ：  + 
          col = hueShift(col, uHue);
          col *= uBrightness;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: true,
      side: THREE.FrontSide,
    })
    
    geo.computeVertexNormals()
    
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.visible = false
    this.mesh.renderOrder = 2020
    scene.add(this.mesh)
    
    this.floatMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - max(dot(vNormal, viewDir), 0.0);
          
          vec3 col = mix(vec3(0.3, 0.8, 0.75), vec3(0.5, 1.2, 1.1), fresnel);
          
          col += vec3(0.3, 0.8, 0.75) * pow(fresnel, 2.0) * 0.5;
          
          float alpha = mix(0.3, 0.6, fresnel) * uAlpha;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    const posAttr = geo.getAttribute('position')
    const faceCount = posAttr.count / 3
    
    const selectedFaces: number[] = []
    const targetCount = 10
    const allFaces = Array.from({ length: faceCount }, (_, i) => i)
    
    for (let i = allFaces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[allFaces[i], allFaces[j]] = [allFaces[j], allFaces[i]]
    }
    selectedFaces.push(...allFaces.slice(0, targetCount))
    
    const floatOffset = 0.12
    
    selectedFaces.forEach(faceIdx => {
      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3)
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 1)
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 2)
      
      const edge1 = v1.clone().sub(v0)
      const edge2 = v2.clone().sub(v0)
      const faceNormal = edge1.cross(edge2).normalize()
      
      const triGeo = new THREE.BufferGeometry()
      const vertices = new Float32Array([
        v0.x, v0.y, v0.z,
        v1.x, v1.y, v1.z,
        v2.x, v2.y, v2.z,
      ])
      triGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      triGeo.computeVertexNormals()
      
      const triMesh = new THREE.Mesh(triGeo, this.floatMat)
      
      triMesh.position.copy(faceNormal.clone().multiplyScalar(floatOffset))
      
      ;(triMesh as any).faceNormal = faceNormal.clone()
      ;(triMesh as any).floatOffset = floatOffset
      
      triMesh.visible = false
      triMesh.renderOrder = 2021
      scene.add(triMesh)
      this.floatingTriangles.push(triMesh)
    })
    
    this.shardMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: { value: 1 },
        uTime: { value: 0 },
        uBreakProgress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform float uBreakProgress;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - max(dot(vNormal, viewDir), 0.0);
          
          vec3 baseColor = vec3(0.4, 0.9, 1.0);
          vec3 breakColor = vec3(0.8, 0.95, 1.0);
          vec3 col = mix(baseColor, breakColor, uBreakProgress);
          
          col += vec3(0.5, 0.8, 1.0) * pow(fresnel, 2.0) * (0.5 + uBreakProgress * 0.5);
          
          float alpha = mix(0.5, 0.8, fresnel) * uAlpha;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: { value: 0 },
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
        uniform float uAlpha;
        uniform float uTime;
        
        varying vec2 vUv;
        
        void main() {
          float centerFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
          centerFade = pow(centerFade, 1.5);
          
          float lengthFade = 1.0 - vUv.y;
          lengthFade = pow(lengthFade, 0.8);
          
          float flicker = 0.8 + 0.2 * sin(uTime * 15.0 + vUv.y * 10.0);
          
          vec3 col = vec3(0.7, 0.9, 1.0) * 1.5;
          float alpha = centerFade * lengthFade * uAlpha * flicker;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    
    for (let i = 0; i < 8; i++) {
      const beamGeo = new THREE.PlaneGeometry(0.15, 2.5)
      beamGeo.translate(0, 1.25, 0)
      const beamMesh = new THREE.Mesh(beamGeo, this.beamMat)
      beamMesh.visible = false
      beamMesh.renderOrder = 2025
      scene.add(beamMesh)
      this.lightBeams.push(beamMesh)
    }
  }
  
  appear() {
    if (this.state !== 'idle') return
    this.state = 'appearing'
    this.age = 0
    this.mesh.visible = true
    this.mesh.position.x = this.targetMesh.position.x
    this.mesh.position.z = this.targetMesh.position.z
    this.mesh.position.y = 0.67
    
    this.mat.uniforms.uScale.value = 1.0
    this.mat.uniforms.uAlpha.value = 0.8
    this.mat.uniforms.uBreakProgress.value = 0
    this.mat.uniforms.uAppearProgress.value = 0
    this.mat.uniforms.uInnerGlow.value = 0
    this.active = true
    
    const center = this.mesh.position.clone()
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const dist = 2.5 + Math.random() * 1.0
      const pos = center.clone().add(new THREE.Vector3(
        Math.cos(angle) * dist,
        (Math.random() - 0.5) * 2,
        Math.sin(angle) * dist
      ))
      
      this.config.sparkPS.emit({
        position: pos,
        count: 2,
        speed: [4, 8],
        lifetime: [400, 700],
        size: [0.06, 0.15],
        colorFrom: new THREE.Color(0.5, 0.9, 1.0),
        colorTo: new THREE.Color(0.3, 0.7, 0.9),
        direction: center.clone().sub(pos).normalize(),
        spread: 0.3,
      })
    }
    
    this.config.sparkPS.emit({
      position: this.targetMesh.position.clone(),
      count: 20,
      speed: [3, 8],
      lifetime: [300, 600],
      size: [0.05, 0.12],
      colorFrom: new THREE.Color(0.4, 0.85, 1.0),
      colorTo: new THREE.Color(0.2, 0.5, 0.8),
      spread: 2.0,
    })
    
    this.floatingTriangles.forEach(tri => {
      tri.visible = true
    })
  }
  
  hit(worldPos?: THREE.Vector3) {
    if (this.state !== 'active') return
    this.state = 'hit'
    this.hitAge = 0
    this.hitPos.copy(worldPos || this.mesh.position.clone().add(new THREE.Vector3(1, 0.5, 0)))
    this.mat.uniforms.uHitPos.value.copy(this.hitPos)
    
    this.mat.uniforms.uPulse.value = 1.0
    
    this.config.sparkPS.emit({
      position: this.hitPos,
      count: 12,
      speed: [4, 10],
      lifetime: [150, 350],
      size: [0.04, 0.1],
      colorFrom: new THREE.Color(0.5, 0.9, 1.0),
      colorTo: new THREE.Color(0.2, 0.6, 0.9),
      spread: 1.2,
    })
    
    this.config.addTrauma?.(0.2)
  }
  
  break() {
    if (this.state === 'idle' || this.state === 'breaking') return
    this.state = 'breaking'
    this.age = 0
    
    const center = this.mesh.position.clone()
    const camera = this.config.camera
    
    this.shardMeshes.forEach(m => this.scene.remove(m))
    this.shardMeshes = []
    this.shardData = []
    
    const geo = this.mesh.geometry as THREE.IcosahedronGeometry
    const posAttr = geo.getAttribute('position')
    const faceCount = posAttr.count / 3
    
    const shardCount = 35
    const allFaces = Array.from({ length: faceCount }, (_, i) => i)
    for (let i = allFaces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[allFaces[i], allFaces[j]] = [allFaces[j], allFaces[i]]
    }
    
    for (let i = 0; i < Math.min(shardCount, faceCount); i++) {
      const faceIdx = allFaces[i]
      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3)
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 1)
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 2)
      
      const faceCenter = v0.clone().add(v1).add(v2).divideScalar(3)
      const edge1 = v1.clone().sub(v0)
      const edge2 = v2.clone().sub(v0)
      const faceNormal = edge1.cross(edge2).normalize()
      
      const shardGeo = new THREE.BufferGeometry()
      const vertices = new Float32Array([
        v0.x - faceCenter.x, v0.y - faceCenter.y, v0.z - faceCenter.z,
        v1.x - faceCenter.x, v1.y - faceCenter.y, v1.z - faceCenter.z,
        v2.x - faceCenter.x, v2.y - faceCenter.y, v2.z - faceCenter.z,
      ])
      shardGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      shardGeo.computeVertexNormals()
      
      const shardMesh = new THREE.Mesh(shardGeo, this.shardMat)
      shardMesh.position.copy(center).add(faceCenter)
      shardMesh.renderOrder = 2022
      this.scene.add(shardMesh)
      this.shardMeshes.push(shardMesh)
      
      const velocity = faceNormal.clone()
        .multiplyScalar(3.3 + Math.random() * 4.4)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 2.2,
          Math.random() * 2.2,
          (Math.random() - 0.5) * 2.2
        ))
      
      this.shardData.push({
        velocity,
        rotAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        rotSpeed: (Math.random() - 0.5) * 15,
        isCameraShard: false,
      })
    }
    
    const cameraDir = camera.position.clone().sub(center).normalize()
    
    for (let i = 0; i < 2; i++) {
      const faceIdx = allFaces[shardCount + i] || allFaces[i]
      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3)
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 1)
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, faceIdx * 3 + 2)
      
      const faceCenter = v0.clone().add(v1).add(v2).divideScalar(3)
      
      const scale = 1.5 + Math.random() * 0.5
      const shardGeo = new THREE.BufferGeometry()
      const vertices = new Float32Array([
        (v0.x - faceCenter.x) * scale, (v0.y - faceCenter.y) * scale, (v0.z - faceCenter.z) * scale,
        (v1.x - faceCenter.x) * scale, (v1.y - faceCenter.y) * scale, (v1.z - faceCenter.z) * scale,
        (v2.x - faceCenter.x) * scale, (v2.y - faceCenter.y) * scale, (v2.z - faceCenter.z) * scale,
      ])
      shardGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      shardGeo.computeVertexNormals()
      
      const shardMesh = new THREE.Mesh(shardGeo, this.shardMat)
      shardMesh.position.copy(center).add(faceCenter).add(cameraDir.clone().multiplyScalar(0.3))
      shardMesh.renderOrder = 2030
      this.scene.add(shardMesh)
      this.shardMeshes.push(shardMesh)
      
      const velocity = cameraDir.clone()
        .multiplyScalar(9.2 + Math.random() * 4.6)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 2.3,
          (Math.random() - 0.3) * 2.3,
          (Math.random() - 0.5) * 2.3
        ))
      
      this.shardData.push({
        velocity,
        rotAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        rotSpeed: (Math.random() - 0.5) * 20,
        isCameraShard: true,
      })
    }
    
    this.lightBeams.forEach((beam, i) => {
      beam.visible = true
      beam.position.copy(center)
      
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3
      const tilt = 0.3 + Math.random() * 0.4
      
      beam.rotation.set(0, 0, 0)
      beam.lookAt(
        center.x + Math.sin(angle) * tilt,
        center.y + 1,
        center.z + Math.cos(angle) * tilt
      )
      beam.rotateX(-Math.PI / 2)
      
      beam.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.5, 1)
    })
    this.beamMat.uniforms.uAlpha.value = 1.0
    
    for (let i = 0; i < 36; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8,
        Math.random() - 0.5
      ).normalize()
      const pos = center.clone().add(dir.clone().multiplyScalar(1.2))
      
      this.config.sparkPS.emit({
        position: pos,
        count: 3,
        speed: [6, 15],
        lifetime: [400, 800],
        size: [0.1, 0.25],
        colorFrom: new THREE.Color(0.6, 0.95, 1.0),
        colorTo: new THREE.Color(0.2, 0.5, 0.9),
        direction: dir,
        spread: 0.5,
        gravity: 3,
      })
    }
    
    this.config.triggerFlash?.(150, 220, 255, 150, 0.7)
    this.config.addTrauma?.(0.6)
    
    this.config.triggerShockwave?.(center, new THREE.Color(0.6, 0.9, 1.0))
    setTimeout(() => {
      this.config.triggerShockwave?.(center.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Color(0.4, 0.7, 1.0))
    }, 80)
  }
  
  dismiss() {
    this.state = 'idle'
    this.active = false
    this.mesh.visible = false
    
    this.floatingTriangles.forEach(tri => {
      tri.visible = false
    })
    
    this.shardMeshes.forEach(shard => {
      this.scene.remove(shard)
      shard.geometry.dispose()
    })
    this.shardMeshes = []
    this.shardData = []
    
    this.lightBeams.forEach(beam => {
      beam.visible = false
    })
  }
  
  update(dt: number) {
    if (!this.active) return
    
    const dtSec = dt * 0.001
    this.age += dtSec
    this.mat.uniforms.uTime.value = performance.now() * 0.001
    
    this.mesh.position.x = this.targetMesh.position.x
    this.mesh.position.z = this.targetMesh.position.z
    this.mesh.position.y = 0.67
    
    switch (this.state) {
      case 'appearing': {
        const totalDuration = 1.5
        const progress = Math.min(this.age / totalDuration, 1)
        
        const dissolvePhase = Math.min(progress / 0.7, 1)
        this.mat.uniforms.uAppearProgress.value = Easing.easeOutQuad(dissolvePhase)
        this.mat.uniforms.uAlpha.value = 0.6 + dissolvePhase * 0.4
        
        if (progress > 0.7 && progress <= 0.85) {
          const glowPhase = (progress - 0.7) / 0.15
          this.mat.uniforms.uInnerGlow.value = Easing.easeOutQuad(glowPhase) * 1.2
          
          if (glowPhase < 0.1) {
            this.config.triggerShockwave?.(this.mesh.position.clone(), new THREE.Color(0.5, 0.85, 1.0))
            this.config.addTrauma?.(0.35)
            this.config.triggerFlash?.(120, 200, 255, 80, 0.4)
          }
        }
        
        if (progress > 0.85) {
          const stabilizePhase = (progress - 0.85) / 0.15
          this.mat.uniforms.uInnerGlow.value = 1.2 * (1.0 - Easing.easeOutQuad(stabilizePhase))
        }
        
        if (progress < 0.7 && Math.random() < 0.15) {
          const center = this.mesh.position.clone()
          const angle = Math.random() * Math.PI * 2
          const dist = 2.0 + Math.random() * 1.5
          const pos = center.clone().add(new THREE.Vector3(
            Math.cos(angle) * dist,
            (Math.random() - 0.5) * 2.5,
            Math.sin(angle) * dist
          ))
          
          this.config.sparkPS.emit({
            position: pos,
            count: 1,
            speed: [5, 10],
            lifetime: [200, 400],
            size: [0.05, 0.12],
            colorFrom: new THREE.Color(0.6, 0.95, 1.0),
            colorTo: new THREE.Color(0.3, 0.7, 0.9),
            direction: center.clone().sub(pos).normalize(),
            spread: 0.2,
          })
        }
        
        if (progress >= 1) {
          this.state = 'active'
          this.mat.uniforms.uAppearProgress.value = 1.0
          this.mat.uniforms.uInnerGlow.value = 0
          this.mat.uniforms.uAlpha.value = 1.0
        }
        break
      }
      
      case 'active': {
        this.mat.uniforms.uScale.value = 1.0
        this.mat.uniforms.uAlpha.value = 1.0
        this.mat.uniforms.uAppearProgress.value = 1.0
        this.mat.uniforms.uInnerGlow.value = 0
        
        this.mat.uniforms.uPulse.value *= 0.92
        
        if (Math.random() < 0.03) {
          const angle = Math.random() * Math.PI * 2
          const y = (Math.random() - 0.5) * 2
          const r = 1.3
          const pos = this.mesh.position.clone().add(
            new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r)
          )
          this.config.magicPS.emit({
            position: pos, count: 1,
            speed: [0.5, 1.5], lifetime: [300, 600], size: [0.04, 0.08],
            colorFrom: new THREE.Color(0.4, 0.85, 1.0),
            colorTo: new THREE.Color(0.2, 0.5, 0.8),
          })
        }
        break
      }
      
      case 'hit': {
        this.hitAge += dtSec
        const hitProgress = Math.min(this.hitAge / 0.5, 1)
        this.mat.uniforms.uHitProgress.value = hitProgress
        
        let hitScale: number
        if (hitProgress < 0.15) {
          hitScale = 1.0 - Easing.easeOutQuad(hitProgress / 0.15) * 0.12
        } else if (hitProgress < 0.5) {
          const p = (hitProgress - 0.15) / 0.35
          hitScale = 0.88 + Easing.easeOutBack(p) * 0.15
        } else {
          const p = (hitProgress - 0.5) / 0.5
          hitScale = 1.03 - Easing.easeOutQuad(p) * 0.03
        }
        this.mat.uniforms.uScale.value = hitScale
        
        this.mat.uniforms.uPulse.value *= 0.88
        
        if (hitProgress >= 1) {
          this.state = 'active'
          this.mat.uniforms.uHitProgress.value = 0
          this.mat.uniforms.uScale.value = 1.0
        }
        break
      }
      
      case 'breaking': {
        const breakDuration = 1.2
        const progress = Math.min(this.age / breakDuration, 1)
        
        const mainFade = Math.min(this.age / 0.3, 1)
        this.mat.uniforms.uBreakProgress.value = Easing.easeOutQuad(mainFade)
        this.mat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(mainFade)
        this.mat.uniforms.uScale.value = 1.0 + mainFade * 0.2
        
        this.floatMat.uniforms.uAlpha.value = 1.0 - mainFade
        
        this.shardMat.uniforms.uBreakProgress.value = progress
        this.shardMat.uniforms.uAlpha.value = 1.0 - Easing.easeInQuad(Math.max(0, (progress - 0.4) / 0.6))
        
        this.shardMeshes.forEach((shard, i) => {
          const data = this.shardData[i]
          if (!data) return
          
          shard.position.add(data.velocity.clone().multiplyScalar(dtSec))
          
          if (data.isCameraShard) {
            data.velocity.y -= 3 * dtSec
            data.velocity.multiplyScalar(0.96)
            
            let camShardScale: number
            if (progress < 0.3) {
              camShardScale = 1.0 + Easing.easeOutQuad(progress / 0.3) * 2.5
            } else if (progress < 0.7) {
              camShardScale = 3.5
            } else {
              camShardScale = 3.5 * (1.0 - Easing.easeInQuad((progress - 0.7) / 0.3))
            }
            shard.scale.setScalar(camShardScale)
          } else {
            data.velocity.y -= 8 * dtSec
            data.velocity.multiplyScalar(0.98)
            
            const shrink = 1.0 - Easing.easeInQuad(Math.max(0, (progress - 0.5) / 0.5)) * 0.8
            shard.scale.setScalar(shrink)
          }
          
          shard.rotateOnAxis(data.rotAxis, data.rotSpeed * dtSec)
        })
        
        const beamFade = progress < 0.3 
          ? Easing.easeOutQuad(progress / 0.3)
          : 1.0 - Easing.easeInQuad((progress - 0.3) / 0.7)
        this.beamMat.uniforms.uAlpha.value = beamFade * 0.8
        this.beamMat.uniforms.uTime.value = performance.now() * 0.001
        
        const beamScale = 0.5 + Easing.easeOutQuad(Math.min(progress / 0.4, 1)) * 0.8
        this.lightBeams.forEach(beam => {
          beam.scale.y = beamScale
        })
        
        if (progress >= 1) {
          this.dismiss()
        }
        break
      }
    }
    
    const time = performance.now() * 0.001
    this.floatMat.uniforms.uTime.value = time
    
    let floatAlpha = 0
    if (this.state === 'appearing') {
      floatAlpha = Math.min(this.age / 0.5, 1) * 0.8
    } else if (this.state === 'active' || this.state === 'hit') {
      floatAlpha = 0.8
    }
    
    if (this.state !== 'breaking') {
      this.floatMat.uniforms.uAlpha.value = floatAlpha
    }
    
    const shieldScale = this.mat.uniforms.uScale.value
    this.floatingTriangles.forEach(tri => {
      const faceNormal = (tri as any).faceNormal as THREE.Vector3
      const floatOffset = (tri as any).floatOffset as number
      
      tri.position.copy(this.mesh.position)
        .add(faceNormal.clone().multiplyScalar(floatOffset * shieldScale))
      
      tri.scale.setScalar(shieldScale)
    })
  }
  
  dispose() {
    this.dismiss()
    this.scene.remove(this.mesh)
    this.mat.dispose()
    this.floatMat.dispose()
    this.shardMat.dispose()
    this.beamMat.dispose()
    this.floatingTriangles.forEach(tri => {
      this.scene.remove(tri)
      tri.geometry.dispose()
    })
    this.lightBeams.forEach(beam => {
      this.scene.remove(beam)
      beam.geometry.dispose()
    })
  }
}
