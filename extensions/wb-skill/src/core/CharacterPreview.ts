// @source wb-character/src/core/CharacterPreview.ts
import * as THREE from 'three'
import type { ICharacterPreview, ModelHandle } from './types'
import type { Engine } from './Engine'

interface SpriteHandle {
  mesh: THREE.Mesh
  update(dt: number): void
  dispose(): void
}

export class CharacterPreview implements ICharacterPreview {
  private engine: Engine
  private currentHandle: ModelHandle | null = null
  private currentSprite: SpriteHandle | null = null
  private turntable: THREE.Group
  private usesOverlay = false

  constructor(engine: Engine) {
    this.engine = engine
    this.turntable = new THREE.Group()
    this.turntable.name = '__character_turntable'
  }

  showModel(handle: ModelHandle): void {
    this.clear()
    this.currentHandle = handle

    const box = new THREE.Box3().setFromObject(handle.root)
    const center = box.getCenter(new THREE.Vector3())
    handle.root.position.sub(center)
    handle.root.position.y -= box.min.y - center.y

    this.turntable.add(handle.root)
    this.engine.world.scene.add(this.turntable)
    this.usesOverlay = false

    if (handle.animations.length > 0) {
      handle.mixer = new THREE.AnimationMixer(handle.root)
      const action = handle.mixer.clipAction(handle.animations[0])
      action.play()
    }

    this.engine.onUpdate(this.update)
  }

  showSprite(sprite: SpriteHandle): void {
    this.clear()
    this.currentSprite = sprite

    sprite.mesh.position.set(0, 0.75, 0)
    this.turntable.add(sprite.mesh)
    this.engine.overlayScene.add(this.turntable)
    this.usesOverlay = true
    this.engine.onUpdate(this.update)
  }

  clear(): void {
    if (this.currentHandle) {
      this.currentHandle.mixer?.stopAllAction()
      this.turntable.remove(this.currentHandle.root)
      this.currentHandle = null
    }
    if (this.currentSprite) {
      this.turntable.remove(this.currentSprite.mesh)
      this.currentSprite.dispose()
      this.currentSprite = null
    }
    this.engine.removeUpdate(this.update)
    const targetScene = this.usesOverlay
      ? this.engine.overlayScene
      : this.engine.world.scene
    targetScene.remove(this.turntable)
    this.usesOverlay = false
  }

  private update = (dt: number): void => {
    this.currentHandle?.mixer?.update(dt)
    if (this.currentSprite) {
      this.currentSprite.update(dt)
      this.currentSprite.mesh.quaternion.copy(this.engine.camera.quaternion)
    }
  }
}
