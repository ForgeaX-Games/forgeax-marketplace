import * as THREE from 'three'
import type { Engine } from './Engine'
import type { ISceneManager, SceneManifest } from './types'

const GROUND_ID = 'ground'

/**
 * Minimal scene host: a flat ground plane + grid + two basic lights.
 * The character editor only needs a neutral stage for movement and skill VFX
 * debugging; full 3D scenes / scene-kit / post-process were removed.
 */
export class SceneManager implements ISceneManager {
  private engine: Engine
  private root: THREE.Group

  constructor(engine: Engine) {
    this.engine = engine
    this.root = this.buildGround()
    this.engine.world.scene.add(this.root)
    this.engine.world.scene.background = new THREE.Color(0x1a1a22)
  }

  async loadScene(_id: string): Promise<void> { /* single static scene */ }
  getCurrentSceneId(): string | null { return GROUND_ID }
  getManifest(): SceneManifest | null { return null }

  private buildGround(): THREE.Group {
    const group = new THREE.Group()
    group.name = '__ground_root'

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0x444444 }),
    )
    plane.rotation.x = -Math.PI / 2
    plane.receiveShadow = true
    group.add(plane)

    const grid = new THREE.GridHelper(40, 40, 0x666666, 0x333333)
    grid.position.y = 0.001
    group.add(grid)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    group.add(ambient)

    const sun = new THREE.DirectionalLight(0xffffff, 0.8)
    sun.position.set(10, 20, 10)
    group.add(sun)

    return group
  }
}
