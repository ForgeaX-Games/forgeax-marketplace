import * as THREE from 'three'
import type { SkillMeta, VfxBinding } from '../pipelines/pixel-char/action-lib'

export interface SpriteActionData {
  actionId: string
  actionLabel: string
  directions: Record<string, string[]>
  fps: number
  looping: boolean
  holdLastFrameMs?: number
  skill?: SkillMeta
}

export type FrameCallback = (actionId: string, frameIndex: number, skill?: SkillMeta) => void
export type ActionStartCallback = (actionId: string, direction: string) => void

/**
 * 计算单帧贴图在 canvas 中的绘制尺寸：等比缩放到恰好填满 canvas（长边 === size）。
 *
 * 背景：AI 生成的 sprite sheet 里，不同方向（up/down vs left/right）的原始帧图分辨率
 * 常常不一致 —— 例如 up/down 是 256×256、left/right 是 128×128。若按原始像素尺寸
 * 居中绘制到 max=256 的 canvas，left/right 只占中间 128×128，对应 plane 的
 * 可见内容就比 up/down 小一圈，视觉上「左右动画偏小」。
 *
 * 解决：所有帧都等比缩放到 max(dw, dh) === canvasSize，保持宽高比，
 * 配合 NearestFilter 保留像素风格。
 */
export function computeFrameDrawSize(
  imgW: number, imgH: number, canvasSize: number,
): { dw: number; dh: number } {
  if (imgW <= 0 || imgH <= 0 || canvasSize <= 0) return { dw: 0, dh: 0 }
  const needed = Math.max(imgW, imgH)
  const k = canvasSize / needed
  return {
    dw: Math.max(1, Math.round(imgW * k)),
    dh: Math.max(1, Math.round(imgH * k)),
  }
}

export class SpriteAnimator {
  readonly mesh: THREE.Mesh
  private actions: Map<string, SpriteActionData> = new Map()
  private texCanvas: HTMLCanvasElement
  private texCtx: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture

  /**
   * 受击白闪强度 0–1。
   * VFXManager 在受击时设为 1 并逐帧衰减到 0。
   * drawCurrentFrame() 会在帧图之上用 source-atop 叠加白色覆层，
   * 保留 alpha 轮廓，将所有可见像素（包括深色轮廓）推向白色。
   */
  flashIntensity = 0

  private currentAction: string | null = null
  private currentDirection = 'down'
  private frameIndex = 0
  private elapsed = 0
  private playing = false
  private holdTimer = 0

  private frameImages: Map<string, HTMLImageElement[]> = new Map()
  private onFrameChange: FrameCallback | null = null
  private onActionStart: ActionStartCallback | null = null
  private maxCanvasSize = 128
  private canvasLocked = false
  /**
   * canvas 锁定的 Promise。外部可 await 它，保证 sprite 被添加到场景时
   * canvas 尺寸已经是终态，避免"图片加载完成触发 finalizeLock 导致 sprite
   * 在用户交互瞬间视觉突然放大/清晰度跳变"的体验问题。
   */
  private _lockResolve: (() => void) | null = null
  readonly ready: Promise<void> = new Promise(res => { this._lockResolve = res })

  constructor(actions: SpriteActionData[], size = 1.5) {
    this.texCanvas = document.createElement('canvas')
    this.texCanvas.width = 128
    this.texCanvas.height = 128
    this.texCtx = this.texCanvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.texCanvas)
    this.texture.minFilter = THREE.NearestFilter
    this.texture.magFilter = THREE.NearestFilter
    this.texture.premultiplyAlpha = false
    this.texture.colorSpace = THREE.SRGBColorSpace

    const geo = new THREE.PlaneGeometry(size, size)
    // depthWrite=true：在 `selective` 渲染模式下 pass 2b 必须能把 sprite 的不透明
    // 像素深度写入缓冲，否则后续 pass 3 的 depthTest 会让 sprite 恒被 VFX 盖住。
    // alphaTest=0.01 保证透明像素被直接丢弃（不写色也不写深度），轮廓外不遮挡 VFX。
    // `overlay` 模式下 sprite 独立在 overlayScene 渲染，depthWrite 对最终画面无影响，
    // 所以 true 是全模式都安全的默认值。
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.FrontSide,
      depthWrite: true,
      premultipliedAlpha: false,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.name = '__pixel_sprite'
    this.mesh.renderOrder = 100

    for (const a of actions) {
      this.actions.set(a.actionId, a)
    }

    this.preloadImages(actions)
    this.lockCanvasSize()
  }

  /**
   * 事件驱动地锁定 canvas 最终尺寸，全程只变一次（从初始 128 → 最终 maxSize）。
   * 核心策略：等所有 Image 的 load 事件完成后，一次性计算 maxSize 并锁定；
   * 之后 canvas 永远不再变化，避免用户交互瞬间触发扩容带来的"角色突然放大"。
   */
  private lockCanvasSize(): void {
    this.canvasLocked = false
    this.maxCanvasSize = 128
    this.texCanvas.width = 128
    this.texCanvas.height = 128

    const allImgs: HTMLImageElement[] = []
    for (const imgs of this.frameImages.values()) allImgs.push(...imgs)

    const pending = allImgs.filter(img => !img.complete)
    if (pending.length === 0) {
      this.finalizeLock()
      return
    }

    let done = 0
    const handler = (): void => {
      done++
      if (done === pending.length && !this.canvasLocked) this.finalizeLock()
    }
    for (const img of pending) {
      img.addEventListener('load', handler, { once: true })
      img.addEventListener('error', handler, { once: true })
    }
    // 保险丝：避免某张图长时间失败卡住锁定
    setTimeout(() => { if (!this.canvasLocked) this.finalizeLock() }, 3000)
  }

  /** 所有图片加载完毕后调用，一次性设最终 canvas 尺寸并锁定。 */
  private finalizeLock(): void {
    if (this.canvasLocked) return
    let max = 128
    for (const imgs of this.frameImages.values()) {
      for (const img of imgs) {
        if (img.complete && img.width > 0) {
          max = Math.max(max, img.width, img.height)
        }
      }
    }
    this.maxCanvasSize = max
    this.texCanvas.width = max
    this.texCanvas.height = max
    this.canvasLocked = true
    this._lockResolve?.()
    this._lockResolve = null
    this.drawCurrentFrame()
  }

  setFrameCallback(cb: FrameCallback | null): void {
    this.onFrameChange = cb
  }

  /**
   * 注册动作开始回调。每次 playAction 切换到新 actionId（或同 id 重新播放）时触发。
   * 用于桥接 VFX 系统：例如进入 attack 动作时自动触发基础连斩。
   */
  setActionStartCallback(cb: ActionStartCallback | null): void {
    this.onActionStart = cb
  }

  getActionIds(): string[] {
    return [...this.actions.keys()]
  }

  getAction(id: string): SpriteActionData | undefined {
    return this.actions.get(id)
  }

  getDirections(): string[] {
    const a = this.currentAction ? this.actions.get(this.currentAction) : null
    return a ? Object.keys(a.directions) : []
  }

  getCurrentActionId(): string | null { return this.currentAction }
  getCurrentDirection(): string { return this.currentDirection }
  getCurrentFrame(): number { return this.frameIndex }
  isPlaying(): boolean { return this.playing }

  playAction(actionId: string, direction?: string): void {
    if (!this.actions.has(actionId)) return
    const isSwitch = this.currentAction !== actionId
    this.currentAction = actionId
    if (direction) this.currentDirection = direction
    this.frameIndex = 0
    this.elapsed = 0
    this.holdTimer = 0
    this.playing = true
    this.drawCurrentFrame()
    if (isSwitch) {
      try { this.onActionStart?.(actionId, this.currentDirection) }
      catch (e) { console.warn('[SpriteAnimator] onActionStart callback error:', e) }
    }
  }

  setDirection(dir: string): void {
    this.currentDirection = dir
    this.frameIndex = 0
    this.elapsed = 0
    this.holdTimer = 0
    this.drawCurrentFrame()
  }

  stop(): void {
    this.playing = false
  }

  resume(): void {
    this.playing = true
  }

  update(dt: number): void {
    if (!this.playing || !this.currentAction) return

    const action = this.actions.get(this.currentAction)
    if (!action) return

    const frames = this.getFrameImages()
    if (!frames || frames.length === 0) return

    const frameDuration = 1 / action.fps

    if (this.holdTimer > 0) {
      this.holdTimer -= dt
      if (this.holdTimer <= 0) {
        this.frameIndex = 0
        this.elapsed = 0
        this.holdTimer = 0
        this.drawCurrentFrame()
      }
      return
    }

    this.elapsed += dt
    if (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration
      const nextFrame = this.frameIndex + 1

      if (nextFrame >= frames.length) {
        if (action.looping) {
          this.frameIndex = 0
        } else if (action.holdLastFrameMs && action.holdLastFrameMs > 0) {
          this.holdTimer = action.holdLastFrameMs / 1000
          return
        } else {
          this.playing = false
          return
        }
      } else {
        this.frameIndex = nextFrame
      }
      this.drawCurrentFrame()
      this.onFrameChange?.(this.currentAction!, this.frameIndex, action.skill)
    }
  }

  dispose(): void {
    this.texture.dispose()
    ;(this.mesh.material as THREE.MeshBasicMaterial).dispose()
    this.mesh.geometry.dispose()
    this.frameImages.clear()
  }

  private getFrameImages(): HTMLImageElement[] | null {
    const key = `${this.currentAction}:${this.currentDirection}`
    return this.frameImages.get(key) ?? null
  }

  private drawCurrentFrame(): void {
    const imgs = this.getFrameImages()
    if (!imgs || !imgs[this.frameIndex]) return

    const img = imgs[this.frameIndex]
    if (!img.complete || img.width === 0) return

    // canvas 大小完全由 lockCanvasSize / finalizeLock 控制，这里绝不修改。
    // 所有帧按等比缩放至长边填满 canvas —— 避免不同方向原始分辨率差异
    // 导致 left/right 方向在 sprite plane 上显得偏小（见 computeFrameDrawSize 注释）。
    const size = this.maxCanvasSize
    const { dw, dh } = computeFrameDrawSize(img.width, img.height, size)

    this.texCtx.clearRect(0, 0, size, size)
    this.texCtx.imageSmoothingEnabled = false
    const dx = Math.floor((size - dw) / 2)
    const dy = Math.floor((size - dh) / 2)
    this.texCtx.drawImage(img, dx, dy, dw, dh)

    // 受击白闪：source-atop 仅覆盖有颜色的像素（含深色轮廓），保留透明区域不变
    if (this.flashIntensity > 0) {
      this.texCtx.save()
      this.texCtx.globalCompositeOperation = 'source-atop'
      this.texCtx.globalAlpha = Math.min(1, this.flashIntensity)
      this.texCtx.fillStyle = '#ffffff'
      this.texCtx.fillRect(0, 0, size, size)
      this.texCtx.restore()
    }

    this.texture.needsUpdate = true
  }

  /**
   * 外部可调用以在不切换帧的情况下重绘当前帧（例如 flashIntensity 发生变化时）。
   */
  redrawCurrentFrame(): void {
    this.drawCurrentFrame()
  }

  private preloadImages(actions: SpriteActionData[]): void {
    for (const a of actions) {
      for (const [dir, urls] of Object.entries(a.directions)) {
        const key = `${a.actionId}:${dir}`
        const imgs: HTMLImageElement[] = []
        for (const url of urls) {
          const img = new Image()
          img.src = url
          imgs.push(img)
        }
        this.frameImages.set(key, imgs)
      }
    }
  }
}
