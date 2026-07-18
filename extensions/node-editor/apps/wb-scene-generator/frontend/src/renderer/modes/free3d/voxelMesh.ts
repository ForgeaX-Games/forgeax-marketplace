// 💡 Three.js voxel mesh builder: turn a RendererVoxelLayer (from the SceneOutput
// sink projection) into a single InstancedMesh (one instance per cell).
//
//   - cells are Point3D[] (sparse voxels with explicit z height)
//   - each cell occupies one world-unit cube; X kept, Y flipped to match the
//     2D top/iso world coordinate system, Z used as vertical height
//   - golden-angle hue hash off layer.value for stable per-value coloring
//   - no nameList height derivation / multi-value / asset binding (the
//     projection has already flattened to a node-level layer)

import * as THREE from 'three'
import type { RendererVoxelLayer } from '../../types'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'

function valueHue(value: number): number { return (value * 137.508) % 360 }

function applyHSL(out: THREE.Color, h: number, s: number, l: number): void {
  out.setHSL((h % 360) / 360, s / 100, l / 100)
}

export interface VoxelBuildOptions {
  layer: RendererVoxelLayer
  /** Envelope bbox info (shared world coords, axis centered on the grid). */
  maxRows: number
  maxCols: number
  /** Vertical scale factor. */
  heightScale: number
  isSelected: boolean
  colorMode: boolean
  wireframe: boolean
}

/**
 * Compile one voxel layer into a single InstancedMesh (one instance per cell).
 *
 * World coords (aligned with the 2D gridToWorld):
 *   X = (cell.x + 0.5 - maxCols/2) * BASE_CELL_SIZE
 *   Y = (maxRows/2 - cell.y - 0.5) * BASE_CELL_SIZE   // Y flipped
 *   Z = (cell.z + 0.5) * BASE_CELL_SIZE * heightScale
 *
 * Each cube edge = BASE_CELL_SIZE. Returns null when there are no cells.
 */
export function buildVoxelMesh(opts: VoxelBuildOptions): THREE.InstancedMesh | null {
  const { layer, maxRows, maxCols, heightScale, isSelected, colorMode, wireframe } = opts
  const cells = layer.cells
  if (!cells || cells.length === 0) return null

  const geom = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshLambertMaterial({
    flatShading: true,
    transparent: wireframe,
    opacity: wireframe ? 0.25 : 1,
    wireframe,
  })

  const mesh = new THREE.InstancedMesh(geom, mat, cells.length)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const cell = BASE_CELL_SIZE
  const halfCols = maxCols / 2
  const halfRows = maxRows / 2

  const hue = valueHue(layer.value)
  let sat: number, lig: number
  if (colorMode) {
    sat = isSelected ? 95 : 85
    lig = isSelected ? 62 : 55
  } else {
    sat = isSelected ? 88 : 72
    lig = isSelected ? 60 : 50
  }
  applyHSL(color, hue, sat, lig)

  const heightWorld = cell * heightScale

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const wx = (c.x + 0.5 - halfCols) * cell
    const wy = (halfRows - c.y - 0.5) * cell
    const wz = (c.z + 0.5) * heightWorld

    dummy.position.set(wx, wy, wz)
    dummy.scale.set(cell, cell, heightWorld)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, color)
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}

/** Dispose an InstancedMesh's geometry + material(s). */
export function disposeMesh(mesh: THREE.InstancedMesh): void {
  mesh.geometry.dispose()
  const mat = mesh.material
  if (Array.isArray(mat)) mat.forEach(m => m.dispose())
  else mat.dispose()
}
