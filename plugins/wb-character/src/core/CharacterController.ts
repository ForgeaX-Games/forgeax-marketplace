import * as THREE from 'three'
import type { IEngine } from './types'
import type { SpriteAnimator } from './SpriteAnimator'

/* ── Types ────────────────────────────────────────────────────────── */

export interface CharacterControllerConfig {
  moveSpeed: number
  runSpeed: number
  groundOffset: number
  cameraDistance: number
  cameraHeight: number
  cameraLerpSpeed: number
  wallCheckRadius: number
  groundRayHeight: number
}

type CharState = 'idle' | 'walk' | 'run' | 'attack'

const DEFAULT_CONFIG: CharacterControllerConfig = {
  moveSpeed: 3,
  runSpeed: 6,
  groundOffset: 0.01,
  cameraDistance: 5,
  cameraHeight: 2,
  cameraLerpSpeed: 6,
  wallCheckRadius: 0.3,
  groundRayHeight: 10,
}

/**
 * 一次性地把 sprite mesh 对齐到场景地面。
 *
 * 用于"放入场景"这种**非**控制模式的初始摆放：`CharacterController` 还没激活，
 * 但我们希望角色一出生就站在地面上，而不是悬空等待首次 enable() 才落地。
 *
 * 算法与 `probeGround` 一致：从 `mesh.position.y + rayHeight` 向下射线，
 * 命中则 `mesh.position.y = hit.point.y + halfH + offset`。
 * 过滤规则与控制模式相同，跳过 `__vfx_effects__`、`__pixel_sprite` 和 mesh 自身，
 * 避免 VFX 环/拖尾被误识别为地面。
 *
 * @returns 命中地面时返回命中 Y；未命中返回 null（位置保持不变）
 */
export function snapMeshToGround(
  scene: THREE.Scene,
  mesh: THREE.Mesh,
  halfH: number,
  offset = DEFAULT_CONFIG.groundOffset,
  rayHeight = DEFAULT_CONFIG.groundRayHeight,
): number | null {
  const targets: THREE.Mesh[] = []
  const collect = (obj: THREE.Object3D): void => {
    if (obj.name === '__vfx_effects__') return
    if (obj === mesh || obj.name === '__pixel_sprite') return
    if ((obj as THREE.Mesh).isMesh) targets.push(obj as THREE.Mesh)
    for (const child of obj.children) collect(child)
  }
  collect(scene)
  if (targets.length === 0) return null

  const origin = new THREE.Vector3(mesh.position.x, mesh.position.y + rayHeight, mesh.position.z)
  const down = new THREE.Vector3(0, -1, 0)
  const ray = new THREE.Raycaster(origin, down, 0, rayHeight * 2)
  const hits = ray.intersectObjects(targets, false)
  if (hits.length === 0) return null

  const groundY = hits[0].point.y
  mesh.position.y = groundY + halfH + offset
  return groundY
}

/* ── Pure helpers (testable) ───────────────────────────────────────── */

export interface StateInput {
  hasMove: boolean
  shift: boolean
  attack: boolean
  attackLocked: boolean
  animPlaying: boolean
  availableActions: string[]
}

export interface StateOutput {
  state: CharState
  attackLocked: boolean
}

export function nextState(current: CharState, input: StateInput): StateOutput {
  if (input.attackLocked) {
    if (!input.animPlaying) return { state: 'idle', attackLocked: false }
    return { state: current, attackLocked: true }
  }
  if (input.attack && input.availableActions.includes('attack')) {
    return { state: 'attack', attackLocked: true }
  }
  if (input.hasMove) {
    const wantRun = input.shift && input.availableActions.includes('run')
    return { state: wantRun ? 'run' : 'walk', attackLocked: false }
  }
  return { state: 'idle', attackLocked: false }
}

export function calcSpriteDirection(
  moveX: number, moveZ: number,
  forwardX: number, forwardZ: number,
  rightX: number, rightZ: number,
): 'up' | 'down' | 'left' | 'right' {
  // forward points from character TOWARD camera.
  // Positive dot = moving toward camera = front face ('down')
  // Negative dot = moving away from camera = back face ('up')
  const dotFwd = moveX * forwardX + moveZ * forwardZ
  // 注意：_right 向量实际由 cross(_forward, UP) 得到，在 camYaw=0 时等于世界 -X，
  // 因此它指向的是「屏幕左」而非屏幕右。按 D 时 _move = -_right（朝屏幕右），
  // 此时 dotRgt < 0，本该映射到 sprite 'right'。下行已按该实际语义对调。
  const dotRgt = moveX * rightX + moveZ * rightZ
  if (Math.abs(dotFwd) >= Math.abs(dotRgt)) {
    return dotFwd > 0 ? 'down' : 'up'
  }
  return dotRgt > 0 ? 'left' : 'right'
}

export function mapStateToAction(state: CharState, ids: string[]): string | null {
  switch (state) {
    case 'idle': return ids.includes('idle') ? 'idle' : ids[0] ?? null
    case 'walk': return ids.includes('walk') ? 'walk' : ids[0] ?? null
    case 'run': return ids.includes('run') ? 'run' : (ids.includes('walk') ? 'walk' : null)
    case 'attack': return ids.includes('attack') ? 'attack' : null
  }
}

/* ── Singleton ────────────────────────────────────────────────────── */

let _instance: CharacterController | null = null

export function getCharacterController(): CharacterController | null {
  return _instance
}

/* ── Sprite LR-flip 补偿 ──────────────────────────────────────────────
 * 背景：**部分** AI sprite sheet 存在 left/right 贴图互换问题。但并非所有 sheet
 * 都如此 —— 有时 sheet 是正确排布的，此时任何翻转都会把正确的动画搞反。
 *
 * 默认策略：不做任何翻转（`new Set()`）。如果发现某张 sheet 的某些动作左右反了，
 * 在浏览器控制台运行：
 *   __setSpriteLRFlipActions(['walk'])          // 只翻 walk
 *   __setSpriteLRFlipActions(['walk', 'run'])   // walk + run
 *   __setSpriteLRFlipActions(['*'])             // 全翻
 *   __setSpriteLRFlipActions([])                // 关闭所有翻转（默认）
 *
 * `currentDir` 始终保持真实世界朝向（供 VFX / getAimYaw 使用，不被翻译污染），
 * 翻转只发生在向 animator 请求贴图时的 `spriteDirFor()` 环节。
 */
const _lrFlipActions = new Set<string>()
if (typeof window !== 'undefined') {
  (window as unknown as { __setSpriteLRFlipActions?: (ids: string[]) => string[] })
    .__setSpriteLRFlipActions = (ids: string[]): string[] => {
      _lrFlipActions.clear()
      for (const id of ids) _lrFlipActions.add(id)
      return Array.from(_lrFlipActions)
    }
}

/**
 * 把「真实世界朝向」(`currentDir`) 翻译成 animator 需要请求的 direction key。
 * 抽成纯函数便于单元测试，`spriteDirFor()` 内部仅做入口适配。
 *
 * - `actionId === null` 时原样返回
 * - `flipSet` 含 `'*'` 通配符时，所有 action 都翻转 left ↔ right
 * - 否则仅当 `flipSet.has(actionId)` 时翻转
 */
export function resolveSpriteDirection(
  currentDir: string,
  actionId: string | null,
  flipSet: ReadonlySet<string>,
): string {
  if (!actionId) return currentDir
  const shouldFlip = flipSet.has('*') || flipSet.has(actionId)
  if (!shouldFlip) return currentDir
  if (currentDir === 'left') return 'right'
  if (currentDir === 'right') return 'left'
  return currentDir
}

/* ── Controller ───────────────────────────────────────────────────── */

export class CharacterController {
  private engine: IEngine
  private animator: SpriteAnimator | null = null
  private config: CharacterControllerConfig
  private _active = false

  private state: CharState = 'idle'
  private prevState: CharState = 'idle'
  private currentDir = 'down'
  private attackLocked = false

  // Input
  private keys = new Set<string>()
  private mouseDown = false
  private mouseDeltaX = 0
  private mouseDeltaY = 0

  // Camera orbit
  private camYaw = 0
  private camPitch = 0.3
  private camDist: number

  // Saved state for restore
  private savedCamPos = new THREE.Vector3()
  private savedCamTarget = new THREE.Vector3()
  private savedCamFov = 60

  // Collision
  private groundRay = new THREE.Raycaster()
  private wallRay = new THREE.Raycaster()
  private collisionMeshes: THREE.Mesh[] = []
  private groundY = 0
  private spriteHalfH = 0.75

  // HUD
  private hudEl: HTMLElement | null = null

  // Reusable vectors
  private _forward = new THREE.Vector3()
  private _right = new THREE.Vector3()
  private _move = new THREE.Vector3()
  private _down = new THREE.Vector3(0, -1, 0)
  private _rayOrigin = new THREE.Vector3()
  private _camTarget = new THREE.Vector3()
  private _camDesired = new THREE.Vector3()
  /**
   * 最近一次"有效移动"的世界水平方向（归一化），用作角色面朝方向 / 攻击方向的来源。
   * 初值为零向量 —— 玩家未按过 WASD 时 getAimYaw() 走相机反向 fallback，
   * 避免误用一个固定世界轴作默认方向（会让第一击朝错误方位）。
   */
  private _lastFaceDir = new THREE.Vector3(0, 0, 0)

  constructor(engine: IEngine, config?: Partial<CharacterControllerConfig>) {
    this.engine = engine
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.camDist = this.config.cameraDistance
    _instance = this
  }

  get isActive(): boolean { return this._active }

  /**
   * 返回角色"攻击朝向"的 yaw（绕世界 +Y，0 对应世界 +Z）。
   * 未激活返回 null，让调用方自行回退。
   * 规则：
   *   1. 若玩家曾按过 WASD（_lastFaceDir 有效），使用该方向 —— 与 sprite 当前朝向完全吻合；
   *   2. 否则朝"屏幕远方"（-_forward，即远离相机一侧），避免默认朝相机打。
   */
  /** 当前 sprite 朝向（'up'|'down'|'left'|'right'），供 VFX 判断渲染层级 */
  getSpriteDirection(): string {
    return this.currentDir
  }

  getAimYaw(): number | null {
    if (!this._active) return null
    if (this._lastFaceDir.lengthSq() > 1e-6) {
      return Math.atan2(this._lastFaceDir.x, this._lastFaceDir.z)
    }
    // Fallback: 朝场景深处（-_forward）。_forward = 从角色指向相机
    this._forward.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw))
    return Math.atan2(-this._forward.x, -this._forward.z)
  }

  /* ── Enable / Disable ──────────────────────────────────────── */

  enable(animator: SpriteAnimator): void {
    if (this._active) return
    this.animator = animator
    this._active = true

    const mesh = animator.mesh

    // Compute sprite half-height for ground offset (bottom of sprite sits on ground)
    const geo = mesh.geometry as THREE.PlaneGeometry
    const baseH = geo.parameters?.height ?? 1.5
    const scaleY = mesh.scale.y
    this.spriteHalfH = (baseH * scaleY) / 2

    // Keep sprite in overlayScene — bypasses post-processing (pixelate, bloom, etc.)
    // Collision raycasts still work against world.scene meshes.

    this.collectCollisionMeshes()

    // Save camera
    const cam = this.engine.camera
    this.savedCamPos.copy(cam.position)
    const dir = new THREE.Vector3()
    cam.getWorldDirection(dir)
    this.savedCamTarget.copy(cam.position).addScaledVector(dir, 10)
    this.savedCamFov = cam.fov

    // Init camera angles from current camera direction relative to character
    const charPos = mesh.position
    const toCam = cam.position.clone().sub(charPos)
    this.camYaw = Math.atan2(toCam.x, toCam.z)
    this.camPitch = Math.atan2(toCam.y, Math.sqrt(toCam.x * toCam.x + toCam.z * toCam.z))
    this.camPitch = THREE.MathUtils.clamp(this.camPitch, 0.05, Math.PI * 0.45)
    this.camDist = THREE.MathUtils.clamp(toCam.length(), 2, 15)

    // Snap ground
    this.groundY = mesh.position.y
    this.probeGround(mesh.position)
    // 立即将角色 Y 对齐到真实地面，防止激活首帧漂浮
    mesh.position.y = this.groundY + this.spriteHalfH + this.config.groundOffset

    // State
    this.state = 'idle'
    this.prevState = 'idle'
    this.attackLocked = false
    if (animator.getActionIds().includes('idle')) {
      animator.playAction('idle', 'down')
    }

    // Listeners
    this.addListeners()
    this.engine.onUpdate(this.tick)

    // HUD
    this.showHud()

    // Dispatch event so external systems (PreviewControls) can react
    window.dispatchEvent(new CustomEvent('ce:char-control', { detail: { active: true } }))
  }

  disable(): void {
    if (!this._active || !this.animator) return
    this._active = false

    // Restore camera
    const cam = this.engine.camera
    cam.position.copy(this.savedCamPos)
    cam.lookAt(this.savedCamTarget)
    cam.fov = this.savedCamFov
    cam.updateProjectionMatrix()

    // Cleanup
    this.removeListeners()
    this.engine.removeUpdate(this.tick)
    this.hideHud()
    this.collisionMeshes = []

    window.dispatchEvent(new CustomEvent('ce:char-control', { detail: { active: false } }))
  }

  toggle(animator: SpriteAnimator): void {
    if (this._active) this.disable()
    else this.enable(animator)
  }

  dispose(): void {
    this.disable()
    _instance = null
  }

  /* ── Main loop ─────────────────────────────────────────────── */

  private tick = (dt: number): void => {
    if (!this._active || !this.animator) return

    this.updateState()
    this.applyMovement(dt)
    this.updateAnimation()
    this.animator.update(dt)
    this.updateCamera(dt)

    // Consume mouse delta
    this.mouseDeltaX = 0
    this.mouseDeltaY = 0
  }

  /* ── State machine ─────────────────────────────────────────── */

  private updateState(): void {
    const result = nextState(this.state, {
      hasMove: this.keys.has('KeyW') || this.keys.has('KeyS') ||
               this.keys.has('KeyA') || this.keys.has('KeyD'),
      shift: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      attack: this.keys.has('KeyJ') || this.mouseDown,
      attackLocked: this.attackLocked,
      animPlaying: this.animator!.isPlaying(),
      availableActions: this.animator!.getActionIds(),
    })
    this.state = result.state
    this.attackLocked = result.attackLocked
  }

  /* ── Movement + collision ──────────────────────────────────── */

  private applyMovement(dt: number): void {
    if (!this.animator) return
    const mesh = this.animator.mesh

    if (this.state === 'idle' || this.state === 'attack') {
      this.probeGround(mesh.position)
      mesh.position.y = this.groundY + this.spriteHalfH + this.config.groundOffset
      return
    }

    const speed = this.state === 'run' ? this.config.runSpeed : this.config.moveSpeed

    // Camera-relative directions (flat on XZ plane)
    this._forward.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).normalize()
    this._right.crossVectors(this._forward, THREE.Object3D.DEFAULT_UP).normalize()

    // _forward points from character TOWARD camera; negate for movement
    this._move.set(0, 0, 0)
    if (this.keys.has('KeyW')) this._move.sub(this._forward)
    if (this.keys.has('KeyS')) this._move.add(this._forward)
    if (this.keys.has('KeyA')) this._move.add(this._right)
    if (this.keys.has('KeyD')) this._move.sub(this._right)

    if (this._move.lengthSq() < 0.001) return
    this._move.normalize().multiplyScalar(speed * dt)

    // 记录面朝方向（归一化的水平分量）供 VFX / getAimYaw 使用
    const mlen = Math.hypot(this._move.x, this._move.z)
    if (mlen > 1e-6) {
      this._lastFaceDir.set(this._move.x / mlen, 0, this._move.z / mlen)
    }

    // Wall collision — check before applying
    const blocked = this.checkWall(mesh.position, this._move)
    if (!blocked) {
      mesh.position.x += this._move.x
      mesh.position.z += this._move.z
    }

    // Ground collision — sprite center = groundY + half sprite height
    this.probeGround(mesh.position)
    mesh.position.y = this.groundY + this.spriteHalfH + this.config.groundOffset

    // Determine sprite direction from movement vector relative to camera
    this.updateSpriteDirection()
  }

  private updateSpriteDirection(): void {
    const dir = calcSpriteDirection(
      this._move.x, this._move.z,
      this._forward.x, this._forward.z,
      this._right.x, this._right.z,
    )
    const available = this.animator!.getDirections()
    if (available.includes(dir) && dir !== this.currentDir) {
      this.currentDir = dir
    }
  }

  /* ── Animation ─────────────────────────────────────────────── */

  /**
   * 把角色"真实朝向(currentDir)"翻译成 animator 需要请求的 direction key。
   * 见 `resolveSpriteDirection` 的文档。
   */
  private spriteDirFor(actionId: string | null): string {
    return resolveSpriteDirection(this.currentDir, actionId, _lrFlipActions)
  }

  private updateAnimation(): void {
    if (!this.animator) return

    if (this.state !== this.prevState) {
      const actionId = mapStateToAction(this.state, this.animator.getActionIds())
      if (actionId) {
        this.animator.playAction(actionId, this.spriteDirFor(actionId))
      }
      this.prevState = this.state
    } else if (this.state === 'walk' || this.state === 'run') {
      const actionId = this.animator.getCurrentActionId()
      const wanted = this.spriteDirFor(actionId)
      if (this.animator.getCurrentDirection() !== wanted) {
        this.animator.setDirection(wanted)
      }
    }
  }

  /* ── Follow camera ─────────────────────────────────────────── */

  private updateCamera(dt: number): void {
    if (!this.animator) return
    const cam = this.engine.camera
    const charPos = this.animator.mesh.position

    // Apply mouse delta to orbit angles
    this.camYaw -= this.mouseDeltaX * 0.003
    this.camPitch -= this.mouseDeltaY * 0.003
    this.camPitch = THREE.MathUtils.clamp(this.camPitch, 0.05, Math.PI * 0.45)

    // Desired camera position in spherical coords around character
    const d = this.camDist
    this._camDesired.set(
      charPos.x + d * Math.sin(this.camYaw) * Math.cos(this.camPitch),
      charPos.y + d * Math.sin(this.camPitch) + this.config.cameraHeight * 0.5,
      charPos.z + d * Math.cos(this.camYaw) * Math.cos(this.camPitch),
    )

    // Lerp camera position
    const t = Math.min(1, this.config.cameraLerpSpeed * dt)
    cam.position.lerp(this._camDesired, t)

    // Look at character center
    this._camTarget.set(charPos.x, charPos.y + 0.5, charPos.z)
    cam.lookAt(this._camTarget)

    // Billboard — sprite always faces camera
    this.animator.mesh.quaternion.copy(cam.quaternion)
  }

  /* ── Collision helpers ─────────────────────────────────────── */

  private collectCollisionMeshes(): void {
    this.collisionMeshes = []
    this._gatherMeshes(this.engine.scene)
  }

  /**
   * 递归收集碰撞网格，支持提前跳过整个子树。
   * Three.js traverse 不支持子树剪枝，所以用手动递归实现。
   */
  private _gatherMeshes(obj: THREE.Object3D): void {
    // 跳过 VFX 特效组及其所有子节点——环形/拖尾网格不能干扰地面射线检测
    if (obj.name === '__vfx_effects__') return
    if (obj === this.animator?.mesh || obj.name === '__pixel_sprite') return

    if ((obj as THREE.Mesh).isMesh) {
      this.collisionMeshes.push(obj as THREE.Mesh)
    }
    for (const child of obj.children) {
      this._gatherMeshes(child)
    }
  }

  /**
   * 向下射线探测脚下地面。
   *
   * 关键约束：
   *  1. 起点不能设得过高——如果从 `pos.y + 10` 开始，走进屋顶/二层楼板下方时，
   *     向下射线会最先命中上方结构的底面（法线朝下），被误判为"地面"，把角色吸上去。
   *  2. 必须过滤出"朝上"的面（worldNormal.y > 0.25），屋顶/天花板底面的法线朝下，跳过。
   *
   * 起点选择：角色腰部高度（脚上方 ~0.5m）。既避开头顶结构，又足够高以承载台阶下落。
   */
  private probeGround(pos: THREE.Vector3): void {
    const feetY = pos.y - this.spriteHalfH
    const rayStartY = feetY + 0.5 // 腰部附近：低于天花板/屋顶，高于脚
    this._rayOrigin.set(pos.x, rayStartY, pos.z)
    this.groundRay.set(this._rayOrigin, this._down)
    this.groundRay.far = this.config.groundRayHeight

    const hits = this.groundRay.intersectObjects(this.collisionMeshes, false)
    if (hits.length === 0) return

    // 取第一个"朝上面"的命中点作为地面——排除天花板等朝下面
    const worldNormal = new THREE.Vector3()
    for (const hit of hits) {
      if (!hit.face) continue
      worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
      if (worldNormal.y > 0.25) {
        this.groundY = hit.point.y
        return
      }
    }
  }

  private checkWall(pos: THREE.Vector3, moveVec: THREE.Vector3): boolean {
    const dir2d = new THREE.Vector3(moveVec.x, 0, moveVec.z)
    const moveDist = dir2d.length()
    if (moveDist < 0.0001) return false
    dir2d.normalize()

    // Wall rays at 30% and 80% of sprite height above ground
    const baseY = this.groundY
    const h = this.spriteHalfH * 2
    const origins = [
      new THREE.Vector3(pos.x, baseY + h * 0.3, pos.z),
      new THREE.Vector3(pos.x, baseY + h * 0.8, pos.z),
    ]

    for (const origin of origins) {
      this.wallRay.set(origin, dir2d)
      this.wallRay.far = this.config.wallCheckRadius + moveDist
      const hits = this.wallRay.intersectObjects(this.collisionMeshes, false)
      if (hits.length > 0 && hits[0].distance < this.config.wallCheckRadius) {
        return true
      }
    }
    return false
  }

  /* ── Input listeners ───────────────────────────────────────── */

  private addListeners(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    const dom = this.engine.renderer.domElement
    dom.addEventListener('pointerdown', this.onPointerDown)
    dom.addEventListener('pointermove', this.onPointerMove)
    dom.addEventListener('pointerup', this.onPointerUp)
    dom.addEventListener('wheel', this.onWheel, { passive: true })
    dom.addEventListener('contextmenu', this.onContextMenu)
  }

  private removeListeners(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    const dom = this.engine.renderer.domElement
    dom.removeEventListener('pointerdown', this.onPointerDown)
    dom.removeEventListener('pointermove', this.onPointerMove)
    dom.removeEventListener('pointerup', this.onPointerUp)
    dom.removeEventListener('wheel', this.onWheel)
    dom.removeEventListener('contextmenu', this.onContextMenu)
    this.keys.clear()
    this.mouseDown = false
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this._active) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (e.code === 'Tab') {
      e.preventDefault()
      this.disable()
      return
    }
    this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private isDragging = false
  private prevPointer = { x: 0, y: 0 }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this._active) return
    if (e.button === 0) {
      // Left click — attack trigger (consumed in state machine) and camera drag
      this.mouseDown = true
      this.isDragging = true
      this.prevPointer = { x: e.clientX, y: e.clientY }
    } else if (e.button === 2) {
      this.isDragging = true
      this.prevPointer = { x: e.clientX, y: e.clientY }
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return
    this.mouseDeltaX += e.clientX - this.prevPointer.x
    this.mouseDeltaY += e.clientY - this.prevPointer.y
    this.prevPointer = { x: e.clientX, y: e.clientY }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.mouseDown = false
    this.isDragging = false
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this._active) return
    this.camDist += e.deltaY * 0.005
    this.camDist = THREE.MathUtils.clamp(this.camDist, 2, 15)
  }

  private onContextMenu = (e: Event): void => {
    if (this._active) e.preventDefault()
  }

  /* ── HUD ───────────────────────────────────────────────────── */

  private showHud(): void {
    this.hideHud()
    const hud = document.getElementById('game-hud')
    if (!hud) return

    const el = document.createElement('div')
    el.className = 'ce-cc-hud'
    el.innerHTML = `
      <span>WASD 移动</span>
      <span>Shift 奔跑</span>
      <span>J / 左键 攻击</span>
      <span>鼠标拖拽 旋转视角</span>
      <span>滚轮 缩放</span>
      <span class="ce-cc-hud-exit">Tab 退出控制</span>
    `
    hud.appendChild(el)
    this.hudEl = el

    this.injectStyles()
  }

  private hideHud(): void {
    this.hudEl?.remove()
    this.hudEl = null
  }

  /* ── Styles ────────────────────────────────────────────────── */

  private static stylesInjected = false

  private injectStyles(): void {
    if (CharacterController.stylesInjected) return
    CharacterController.stylesInjected = true

    const s = document.createElement('style')
    s.textContent = `
.ce-cc-hud {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: center;
  padding: 6px 14px; border-radius: 6px;
  background: rgba(12,10,8,0.85); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,215,100,0.15);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 11px; color: rgba(255,255,255,0.6);
  pointer-events: none; user-select: none; z-index: 10;
  white-space: nowrap;
}
.ce-cc-hud span {
  padding: 2px 6px; border-radius: 3px;
  background: rgba(255,215,100,0.06);
  border: 1px solid rgba(255,215,100,0.1);
}
.ce-cc-hud-exit {
  color: #ff6b35 !important;
  border-color: rgba(255,107,53,0.3) !important;
  background: rgba(255,107,53,0.1) !important;
}
`
    document.head.appendChild(s)
  }
}
