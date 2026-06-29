// @source wb-character/src/vfx/mount/MountPointVisualizer.ts
/**
 * MountPointVisualizer — 
 *
 * ：
 *  - 
 *  - （canvas ）
 *  -  show/hide 
 *  - updateDimensions() 
 *
 * ：
 *   const viz = new MountPointVisualizer(scene)
 *   viz.updateDimensions({ height: 1.65, bodyRatio: 7.5 })
 *   viz.show()
 *
 *   // ： ，  dims 
 *   viz.updateDimensions(newDims)   // 
 *
 *   viz.dispose()  // 
 */

import * as THREE from 'three'
import { MountPointId, MOUNT_META, CharacterDimensions } from './MountPointTypes'
import { MountPointResolver } from './MountPointResolver'

// ── （Canvas ）──────────────────────────────────────────────────

function makeLabel(text: string, color: number): THREE.Sprite {
  const w = 128, h = 32
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  //
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.roundRect(0, 0, w, h, 6)
  ctx.fill()

  //
  const r = (color >> 16) & 0xff
  const g = (color >> 8)  & 0xff
  const b = color & 0xff
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.font = 'bold 14px sans-serif'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.38, 0.095, 1)
  return sprite
}

// ──  ─────────────────────────────────────────────────────────

interface MountNode {
  id: MountPointId
  sphere: THREE.Mesh
  label: THREE.Sprite
  group: THREE.Group
}

// ── MountPointVisualizer ───────────────────────────────────────────────────

const SPHERE_RADIUS = 0.030
const LABEL_OFFSET  = 0.065   //  Y

export class MountPointVisualizer {

  private nodes:    Map<MountPointId, MountNode> = new Map()
  private root:     THREE.Group
  private visible:  boolean = false

  private sphereGeo: THREE.SphereGeometry

  constructor(private scene: THREE.Scene) {
    this.root = new THREE.Group()
    this.root.name = 'MountPointVisualizer'
    this.root.visible = false

    this.sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 8, 6)

    //
    for (const meta of MOUNT_META) {
      const mat    = new THREE.MeshBasicMaterial({ color: meta.color, depthTest: false })
      const sphere = new THREE.Mesh(this.sphereGeo, mat)
      const label  = makeLabel(meta.label, meta.color)
      label.position.y = LABEL_OFFSET

      const group = new THREE.Group()
      group.name  = `mp_${meta.id}`
      group.add(sphere)
      group.add(label)

      this.root.add(group)
      this.nodes.set(meta.id, { id: meta.id, sphere, label, group })
    }

    scene.add(this.root)
  }

  // ──  API ────────────────────────────────────────────────────────────

  show(): void {
    this.root.visible = true
    this.visible = true
  }

  hide(): void {
    this.root.visible = false
    this.visible = false
  }

  toggle(): void {
    this.visible ? this.hide() : this.show()
  }

  isVisible(): boolean { return this.visible }

  /**
   * （dims ）
   */
  updateDimensions(dims: CharacterDimensions): void {
    const all = MountPointResolver.resolveAll(dims)
    for (const [id, pos] of all) {
      const node = this.nodes.get(id)
      if (node) {
        node.group.position.copy(pos)
      }
    }
  }

  /**
   * （ + ）
   */
  highlight(ids: MountPointId[]): void {
    for (const [id, node] of this.nodes) {
      const active = ids.includes(id)
      node.sphere.scale.setScalar(active ? 2.2 : 1.0)
      ;(node.sphere.material as THREE.MeshBasicMaterial).opacity = active ? 1.0 : 0.45
      ;(node.sphere.material as THREE.MeshBasicMaterial).transparent = !active
    }
  }

  clearHighlight(): void {
    for (const [, node] of this.nodes) {
      node.sphere.scale.setScalar(1.0)
      ;(node.sphere.material as THREE.MeshBasicMaterial).opacity = 1.0
      ;(node.sphere.material as THREE.MeshBasicMaterial).transparent = false
    }
  }

  dispose(): void {
    this.sphereGeo.dispose()
    for (const [, node] of this.nodes) {
      ;(node.sphere.material as THREE.Material).dispose()
      ;(node.label.material as THREE.SpriteMaterial).map?.dispose()
      ;(node.label.material as THREE.SpriteMaterial).dispose()
    }
    this.scene.remove(this.root)
    this.nodes.clear()
  }
}
