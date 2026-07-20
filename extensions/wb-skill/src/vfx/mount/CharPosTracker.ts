// @source wb-character/src/vfx/mount/CharPosTracker.ts
/**
 * CharPosTracker — 
 *
 *  sprite mesh ，  VFXManager._mount() 。
 *  Level 0 ：  SpriteAnchor / MountAdapter ，
 *  mesh ， 。
 *
 * ，  pixel-char pipeline / 。
 */
import * as THREE from 'three'

let _mesh: THREE.Mesh | null = null
let _spriteWorldHeight = 1.5

/**  */
export function trackCharSprite(mesh: THREE.Mesh, worldHeight = 1.5): void {
  _mesh = mesh
  _spriteWorldHeight = worldHeight
  //  window，  Vite HMR
  ;(window as any).__trackedMesh = mesh
  ;(window as any).__trackedMeshH = worldHeight
  console.log(`[CharPosTracker]  mesh，pos=(${mesh.position.x.toFixed(2)},${mesh.position.y.toFixed(2)},${mesh.position.z.toFixed(2)})`)
}

/**  */
export function untrackCharSprite(): void {
  _mesh = null
  console.log('[CharPosTracker] mesh deregistered')
}

/**
 * （ ）
 * @param yFrac  0=   0.5=   0.65=   1.0= ，  0.65（ ）
 */
export function getCharWorldPos(yFrac = 0.65): THREE.Vector3 | null {
  // ，  window （  HMR ）
  const mesh = _mesh ?? (window as any).__trackedMesh as THREE.Mesh | undefined
  const h    = _spriteWorldHeight || ((window as any).__trackedMeshH as number | undefined) || 1.5
  if (!mesh) return null
  const cx = mesh.position.x
  const cy = mesh.position.y               // sprite geometry  Y
  const cz = mesh.position.z
  const halfH = h * 0.5
  const footY = cy - halfH                  //  Y
  return new THREE.Vector3(cx, footY + yFrac * h, cz)
}

/**  mesh  */
export function hasTrackedSprite(): boolean {
  return _mesh !== null
}

/**  window  */
if (typeof window !== 'undefined') {
  ;(window as any).__charPosTracker = { trackCharSprite, untrackCharSprite, getCharWorldPos, hasTrackedSprite }
}
