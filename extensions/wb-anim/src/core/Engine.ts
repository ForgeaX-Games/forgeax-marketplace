import * as THREE from 'three'
import { World } from './World'
import { Input } from './Input'
import type { IEngine } from './types'

export class Engine implements IEngine {
  public renderer: THREE.WebGLRenderer
  public camera: THREE.PerspectiveCamera
  public world: World
  public input: Input
  public overlayScene: THREE.Scene

  public isRunning = false
  public fps = 0

  private canvas: HTMLCanvasElement
  private clock = new THREE.Clock()
  private animationId: number | null = null
  private frameCount = 0
  private lastFpsUpdate = 0
  private updateCallbacks: Array<(dt: number) => void> = []
  private pausedByVisibility = false

  get scene(): THREE.Scene { return this.world.scene }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const parent = canvas.parentElement!

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(parent.clientWidth, parent.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0

    this.camera = new THREE.PerspectiveCamera(60, parent.clientWidth / parent.clientHeight, 0.1, 2000)
    this.camera.position.set(0, 5, 10)
    this.camera.lookAt(0, 0, 0)

    this.world = new World()
    this.overlayScene = new THREE.Scene()
    this.input = new Input()

    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  onUpdate(cb: (dt: number) => void): void { this.updateCallbacks.push(cb) }
  removeUpdate(cb: (dt: number) => void): void {
    this.updateCallbacks = this.updateCallbacks.filter(c => c !== cb)
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.clock.start()
    this.animate()
  }

  pause(): void {
    this.isRunning = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  resume(): void {
    if (!this.isRunning) {
      this.isRunning = true
      this.clock.start()
      this.animate()
    }
  }

  dispose(): void {
    this.pause()
    this.world.clear()
    this.renderer.dispose()
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  private animate = (): void => {
    if (!this.isRunning) return
    this.animationId = requestAnimationFrame(this.animate)

    const dt = Math.min(this.clock.getDelta(), 1 / 15)
    this.world.update(dt)
    for (const cb of this.updateCallbacks) cb(dt)

    this.renderer.render(this.world.scene, this.camera)

    if (this.overlayScene.children.length > 0) {
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.overlayScene, this.camera)
      this.renderer.autoClear = true
    }

    this.frameCount++
    const now = performance.now()
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.lastFpsUpdate = now
    }
    this.input.update()
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.isRunning) {
        this.pausedByVisibility = true
        this.pause()
      }
    } else if (this.pausedByVisibility) {
      this.pausedByVisibility = false
      this.resume()
    }
  }

  private onResize = (): void => {
    const parent = this.canvas.parentElement!
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }
}
