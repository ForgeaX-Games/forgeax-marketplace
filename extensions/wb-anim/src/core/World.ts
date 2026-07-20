import * as THREE from 'three'

export interface GameObject {
  mesh: THREE.Object3D
  update?(dt: number): void
  destroy?(): void
}

export class World {
  public scene: THREE.Scene
  private objects = new Map<string, GameObject>()
  private nextId = 1

  constructor() {
    this.scene = new THREE.Scene()
  }

  add(obj: THREE.Object3D, updateFn?: (dt: number) => void): string {
    const id = `obj_${this.nextId++}`
    this.scene.add(obj)
    this.objects.set(id, { mesh: obj, update: updateFn })
    return id
  }

  remove(id: string): void {
    const obj = this.objects.get(id)
    if (obj) {
      this.scene.remove(obj.mesh)
      obj.destroy?.()
      this.objects.delete(id)
    }
  }

  get(id: string): GameObject | undefined {
    return this.objects.get(id)
  }

  update(dt: number): void {
    for (const obj of this.objects.values()) obj.update?.(dt)
  }

  clear(): void {
    for (const [id] of this.objects) this.remove(id)
    while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0])
  }
}
