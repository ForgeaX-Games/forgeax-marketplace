// @source wb-character/src/vfx/effects/CharDummy.ts
/**
 * 
 *
 * ，T-pose ， 
 * 、  VFX 。
 *
 * ：
 *  -  MeshStandardMaterial flat-shaded（ ）
 *  -  1.65 ， （y=0）
 *  -  group / rootY 
 *  - show() / hide() 
 *  - dispose()  geometry & material
 */

import * as THREE from 'three'

// ──  ────────────────────────────────────────────────────
const C_SKIN   = 0xd4a070   // （ ）
const C_CLOTH  = 0x4a6080   // （ ）
const C_LIMB   = 0x5a7090   // （ ）
const C_PANTS  = 0x3a5060   // （ ）
const C_SHOE   = 0x2a3040   //

// ──  ────────────────────────────────────────────────────
interface PartDef {
  geo:  THREE.BufferGeometry
  color: number
  position: [number, number, number]
  rotation?: [number, number, number]  // Euler XYZ，  rad
}

function makeMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness:    0.82,
    metalness:    0.04,
    flatShading:  true,
  })
}

export class CharDummy {
  readonly group: THREE.Group

  private meshes: THREE.Mesh[]       = []
  private geos:   THREE.BufferGeometry[] = []
  private mats:   THREE.MeshStandardMaterial[] = []

  constructor(private scene: THREE.Scene) {
    this.group = new THREE.Group()

    const parts: PartDef[] = [
      // ──  ──────────────────────────────────────────────────
      {
        geo:      new THREE.SphereGeometry(0.145, 8, 6),
        color:    C_SKIN,
        position: [0, 1.52, 0],
      },

      // ──  ────────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.055, 0.065, 0.12, 6),
        color:    C_SKIN,
        position: [0, 1.36, 0],
      },

      // ── （ ） ───────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.11, 0.135, 0.50, 7),
        color:    C_CLOTH,
        position: [0, 0.995, 0],
      },

      // ──  ────────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.135, 0.12, 0.22, 7),
        color:    C_CLOTH,
        position: [0, 0.71, 0],
      },

      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.052, 0.042, 0.36, 6),
        color:    C_LIMB,
        position: [-0.28, 1.05, 0],
        rotation: [0, 0, Math.PI / 2],
      },
      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.052, 0.042, 0.36, 6),
        color:    C_LIMB,
        position: [0.28, 1.05, 0],
        rotation: [0, 0, -Math.PI / 2],
      },

      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.040, 0.032, 0.32, 6),
        color:    C_LIMB,
        position: [-0.50, 1.05, 0],
        rotation: [0, 0, Math.PI / 2],
      },
      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.040, 0.032, 0.32, 6),
        color:    C_LIMB,
        position: [0.50, 1.05, 0],
        rotation: [0, 0, -Math.PI / 2],
      },

      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.080, 0.068, 0.40, 6),
        color:    C_PANTS,
        position: [-0.095, 0.40, 0],
      },
      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.080, 0.068, 0.40, 6),
        color:    C_PANTS,
        position: [0.095, 0.40, 0],
      },

      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.062, 0.055, 0.38, 6),
        color:    C_PANTS,
        position: [-0.095, 0.10, 0],
      },
      // ──  ───────────────────────────────────────────────
      {
        geo:      new THREE.CylinderGeometry(0.062, 0.055, 0.38, 6),
        color:    C_PANTS,
        position: [0.095, 0.10, 0],
      },

      // ──  ────────────────────────────────────────────────
      {
        geo:      new THREE.BoxGeometry(0.10, 0.06, 0.20),
        color:    C_SHOE,
        position: [-0.095, -0.07, 0.04],
      },
      // ──  ────────────────────────────────────────────────
      {
        geo:      new THREE.BoxGeometry(0.10, 0.06, 0.20),
        color:    C_SHOE,
        position: [0.095, -0.07, 0.04],
      },
    ]

    for (const def of parts) {
      const mat  = makeMat(def.color)
      const mesh = new THREE.Mesh(def.geo, mat)
      mesh.position.set(...def.position)
      if (def.rotation) {
        mesh.rotation.set(...def.rotation)
      }
      mesh.castShadow    = true
      mesh.receiveShadow = true

      this.group.add(mesh)
      this.meshes.push(mesh)
      this.geos.push(def.geo)
      this.mats.push(mat)
    }

    //  group ， （  y=0）
    this.group.position.set(0, 0, 0)
    scene.add(this.group)
  }

  /** （  VFX ） */
  get rootY(): number { return this.group.position.y + 0.67 }

  show(): void { this.group.visible = true }
  hide(): void { this.group.visible = false }

  dispose(): void {
    this.scene.remove(this.group)
    for (const g of this.geos)  g.dispose()
    for (const m of this.mats)  m.dispose()
    this.meshes = []
    this.geos   = []
    this.mats   = []
  }
}
