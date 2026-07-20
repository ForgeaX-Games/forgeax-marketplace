import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Engine } from '../core/Engine'
import type { CameraStore } from '../core/CameraStore'
import type { CameraPreset } from '../core/types'

const LOOK_DISTANCE = 10

export class PreviewControls {
  private controls: OrbitControls
  private engine: Engine
  private cameraStore: CameraStore
  private moveSpeed = 8
  private keysDown = new Set<string>()
  private _enabled = false

  private isDragging = false
  private prevMouse = { x: 0, y: 0 }
  private yaw = 0
  private pitch = 0
  private rotateSpeed = 0.003

  constructor(engine: Engine, cameraStore: CameraStore) {
    this.engine = engine
    this.cameraStore = cameraStore

    this.controls = new OrbitControls(engine.camera, engine.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enableRotate = false
    this.controls.enablePan = true
    this.controls.panSpeed = 1.5
    this.controls.zoomSpeed = 1.2
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 500

    this.controls.mouseButtons = {
      LEFT: undefined as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }

    this.controls.enabled = false

    const dom = engine.renderer.domElement
    dom.addEventListener('pointerdown', this.onPointerDown)
    dom.addEventListener('pointermove', this.onPointerMove)
    dom.addEventListener('pointerup', this.onPointerUp)
    dom.addEventListener('pointerleave', this.onPointerUp)

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('ce:char-control', this.onCharControl as EventListener)
    engine.onUpdate(this.update)
  }

  get enabled(): boolean { return this._enabled }

  setEnabled(on: boolean): void {
    this._enabled = on
    this.controls.enabled = on
    if (!on) {
      this.keysDown.clear()
      this.isDragging = false
    }
    document.body.style.cursor = on ? 'grab' : ''
    if (on) this.syncAnglesFromCamera()
  }

  getOrbitControls(): OrbitControls { return this.controls }

  applyPreset(preset: CameraPreset): void {
    this.engine.camera.position.set(...preset.position)
    this.engine.camera.fov = preset.fov
    this.engine.camera.updateProjectionMatrix()

    const pos = new THREE.Vector3(...preset.position)
    const tgt = new THREE.Vector3(...preset.target)
    const dir = tgt.sub(pos).normalize()
    this.controls.target.copy(this.engine.camera.position).addScaledVector(dir, LOOK_DISTANCE)
    this.syncAnglesFromCamera()
    this.controls.update()
  }

  getCurrentPreset(name: string): CameraPreset {
    const pos = this.engine.camera.position
    const dir = new THREE.Vector3()
    this.engine.camera.getWorldDirection(dir)
    const tgt = pos.clone().addScaledVector(dir, LOOK_DISTANCE)
    return {
      name,
      position: [pos.x, pos.y, pos.z],
      target: [tgt.x, tgt.y, tgt.z],
      fov: this.engine.camera.fov,
    }
  }

  private syncAnglesFromCamera(): void {
    const dir = new THREE.Vector3()
    this.engine.camera.getWorldDirection(dir)
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
    this.yaw = Math.atan2(dir.x, dir.z)
  }

  private applyRotation(): void {
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    )
    this.controls.target.copy(this.engine.camera.position).addScaledVector(dir, LOOK_DISTANCE)
    this.controls.update()
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this._enabled || e.button !== 0) return
    this.isDragging = true
    this.prevMouse = { x: e.clientX, y: e.clientY }
    document.body.style.cursor = 'grabbing'
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return
    const dx = e.clientX - this.prevMouse.x
    const dy = e.clientY - this.prevMouse.y
    this.prevMouse = { x: e.clientX, y: e.clientY }

    this.yaw -= dx * this.rotateSpeed
    this.pitch -= dy * this.rotateSpeed
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.49, Math.PI * 0.49)

    this.applyRotation()
  }

  private onPointerUp = (): void => {
    if (this.isDragging) {
      this.isDragging = false
      if (this._enabled) document.body.style.cursor = 'grab'
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this._enabled) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    this.keysDown.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code)
    if (e.code.startsWith('Meta') || e.code.startsWith('Control') || e.code.startsWith('Alt')) {
      this.keysDown.clear()
    }
  }

  private charControlSavedEnabled = false

  private onCharControl = (e: CustomEvent<{ active: boolean }>): void => {
    if (e.detail.active) {
      this.charControlSavedEnabled = this._enabled
      this.setEnabled(false)
    } else {
      this.setEnabled(this.charControlSavedEnabled)
    }
  }

  private update = (dt: number): void => {
    if (!this._enabled) return

    const cam = this.engine.camera
    const flatForward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize()
    const right = new THREE.Vector3().crossVectors(flatForward, new THREE.Vector3(0, 1, 0)).normalize()

    const speed = this.moveSpeed * dt * (this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight') ? 3 : 1)
    const move = new THREE.Vector3()

    if (this.keysDown.has('KeyW')) move.add(flatForward.clone().multiplyScalar(speed))
    if (this.keysDown.has('KeyS')) move.add(flatForward.clone().multiplyScalar(-speed))
    if (this.keysDown.has('KeyA')) move.add(right.clone().multiplyScalar(-speed))
    if (this.keysDown.has('KeyD')) move.add(right.clone().multiplyScalar(speed))
    if (this.keysDown.has('KeyQ') || this.keysDown.has('Space')) move.y += speed
    if (this.keysDown.has('KeyE')) move.y -= speed

    if (move.lengthSq() > 0) {
      cam.position.add(move)
      this.applyRotation()
    }

    this.controls.update()
  }

  dispose(): void {
    this.engine.removeUpdate(this.update)
    const dom = this.engine.renderer.domElement
    dom.removeEventListener('pointerdown', this.onPointerDown)
    dom.removeEventListener('pointermove', this.onPointerMove)
    dom.removeEventListener('pointerup', this.onPointerUp)
    dom.removeEventListener('pointerleave', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('ce:char-control', this.onCharControl as EventListener)
    this.controls.dispose()
  }
}
