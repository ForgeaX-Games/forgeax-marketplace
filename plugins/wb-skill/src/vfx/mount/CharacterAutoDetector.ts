// @source wb-character/src/vfx/mount/CharacterAutoDetector.ts
/**
 * CharacterAutoDetector —  Three.js 
 *
 * （ ）：
 *  1.  scene  MeshStandardMaterial （CharDummy ）
 *  2.  GridHelper /  /  / 
 *  3.  → 
 *  4.  Y ， " " 
 *  5.  =  / ；  0.5
 *
 * ：
 *  - CharDummy（ ，MeshStandardMaterial）
 *  -  3D （ ）
 *  - Spine ：  3D mesh，  GlobalState 
 */

import * as THREE from 'three'
import type { CharacterDimensions } from './MountPointTypes'
import { dimsFromDummy } from './MountPointResolver'

// ──  ──────────────────────────────────────────────────────────────────

/**  object3D name  */
const EXCLUDE_NAMES = new Set([
  'MountPointVisualizer', //
])

/** （  ShaderMaterial、 ） */
function isCharacterMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  if (!(obj instanceof THREE.Mesh)) return false
  if (!obj.visible) return false

  //
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (EXCLUDE_NAMES.has(cur.name)) return false
    cur = cur.parent
  }

  //  MeshStandardMaterial  MeshBasicMaterial（ /VFX）
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
  return mats.every(m =>
    m instanceof THREE.MeshStandardMaterial ||
    m instanceof THREE.MeshBasicMaterial
  )
}

/** （ ） （ ）  mesh  */
function isOversized(bbox: THREE.Box3): boolean {
  const size = bbox.getSize(new THREE.Vector3())
  //  20  → /
  return size.x > 20 || size.z > 20
}

// ──  ──────────────────────────────────────────────────────────────

export interface DetectionResult {
  dims: CharacterDimensions
  confidence: 'high' | 'medium' | 'low'
  /**  mesh  */
  meshCount: number
  /** （ ） */
  log: string[]
}

/**
 * 
 * @param scene  Three.js 
 * @param searchCenter  （ ），  mesh
 * @param searchRadius  （  scene），  6
 */
export function autoDetectCharacter(
  scene: THREE.Scene,
  searchCenter: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
  searchRadius = 6,
): DetectionResult {
  const log: string[] = []
  const _bbox = new THREE.Box3()
  const _center = new THREE.Vector3()

  // ── Step 1：  mesh ──────────────────────────────────────────────────
  const candidates: THREE.Mesh[] = []
  scene.traverse(obj => {
    if (!isCharacterMesh(obj)) return
    const wb = new THREE.Box3().setFromObject(obj, true)
    if (wb.isEmpty()) return
    if (isOversized(wb)) return

    //
    wb.getCenter(_center)
    if (_center.distanceTo(searchCenter) > searchRadius) return

    candidates.push(obj)
  })

  log.push(`  mesh : ${candidates.length}`)

  if (candidates.length === 0) {
    log.push('no character mesh found, using default')
    return { dims: dimsFromDummy(), confidence: 'low', meshCount: 0, log }
  }

  // ── Step 2：  →  ───────────────────────────────────────────
  const totalBbox = new THREE.Box3()
  for (const m of candidates) {
    totalBbox.union(new THREE.Box3().setFromObject(m, true))
  }

  const size = totalBbox.getSize(new THREE.Vector3())
  const totalHeight = size.y
  const rootY = totalBbox.min.y

  log.push(` : min.y=${rootY.toFixed(3)} max.y=${totalBbox.max.y.toFixed(3)} H=${totalHeight.toFixed(3)}`)

  if (totalHeight < 0.1) {
    log.push('abnormal height, using default')
    return { dims: dimsFromDummy(), confidence: 'low', meshCount: candidates.length, log }
  }

  // ── Step 3：  →  ──────────────────────────────────
  interface Slice {
    yCenter: number
    yTop:    number
    yBot:    number
  }

  const slices: Slice[] = candidates.map(m => {
    const b = new THREE.Box3().setFromObject(m, true)
    return {
      yCenter: (b.min.y + b.max.y) / 2,
      yTop:    b.max.y,
      yBot:    b.min.y,
    }
  }).sort((a, b) => b.yCenter - a.yCenter)  //

  log.push(`  ( ): ${slices.slice(0, 6).map(s => s.yCenter.toFixed(2)).join(', ')}`)

  // （  55%~90% ， ）
  const zoneTop = rootY + totalHeight * 0.90
  const zoneBot = rootY + totalHeight * 0.55

  let maxGap     = 0
  let gapTopY    = totalBbox.max.y   // （  chin）
  let headBotY   = totalBbox.max.y   //

  for (let i = 0; i < slices.length - 1; i++) {
    const upper = slices[i]
    const lower = slices[i + 1]

    // " "
    if (upper.yCenter < zoneBot || lower.yCenter > zoneTop) continue

    //  =
    const gap = upper.yBot - lower.yTop

    if (gap > maxGap) {
      maxGap   = gap
      gapTopY  = upper.yBot   // （ ）
      headBotY = gapTopY
    }
  }

  // ── Step 4：  ──────────────────────────────────────────────
  const headHeight = totalBbox.max.y - headBotY
  log.push(` : ${maxGap.toFixed(3)}   Y=${headBotY.toFixed(3)}  =${headHeight.toFixed(3)}`)

  let bodyRatio: number
  let confidence: 'high' | 'medium' | 'low'

  const headFrac = headHeight / totalHeight

  if (headFrac < 0.06 || headFrac > 0.60 || maxGap < 0.02) {
    // ， ：
    // ： ， ； ，
    const widthHeightRatio = size.x / totalHeight
    bodyRatio = Math.max(2, Math.min(10, Math.round(1 / widthHeightRatio * 2.2 * 2) / 2))
    confidence = 'low'
    log.push(` ，  ratio=${bodyRatio}`)
  } else {
    const rawRatio = totalHeight / headHeight
    bodyRatio = Math.round(rawRatio * 2) / 2  //  0.5
    bodyRatio = Math.max(1.5, Math.min(10, bodyRatio))
    confidence = maxGap > 0.04 ? 'high' : 'medium'
    log.push(` : ${rawRatio.toFixed(2)} →  ${bodyRatio}  : ${confidence}`)
  }

  // ── Step 5： （X/Z） ───────────────────────────────────────────────
  const rootX = (totalBbox.min.x + totalBbox.max.x) / 2
  const rootZ = (totalBbox.min.z + totalBbox.max.z) / 2

  const dims: CharacterDimensions = {
    height:       Math.round(totalHeight * 100) / 100,
    bodyRatio,
    rootX:        Math.round(rootX * 1000) / 1000,
    rootY:        Math.round(rootY * 1000) / 1000,
    rootZ:        Math.round(rootZ * 1000) / 1000,
    weaponLength: 0,
    facingAngle:  0,
  }

  return { dims, confidence, meshCount: candidates.length, log }
}

// ── （UI ）───────────────────────────────────────────────────────

export function confidenceColor(c: DetectionResult['confidence']): string {
  return c === 'high' ? '#00e5cc' : c === 'medium' ? '#ffcc44' : '#ff6644'
}

export function confidenceLabel(c: DetectionResult['confidence']): string {
  return c === 'high' ? 'high' : c === 'medium' ? 'mid' : 'low'
}
