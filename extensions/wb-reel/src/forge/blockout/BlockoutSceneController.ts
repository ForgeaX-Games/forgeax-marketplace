import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Blockout, Transform } from '../../scenario/types'
import {
  buildScene,
  makeThreeCamera,
  readTransform,
  type TexResolver,
} from './blockoutScene'

export type TransformMode = 'translate' | 'rotate' | 'scale'

/**
 * BlockoutSceneController —— 交互式 3D 编辑视图（数据为真源，three 仅投影）。
 *
 * 自己持有一台「编辑视角」相机 + OrbitControls；blockout 里的相机以视锥线框
 * (CameraHelper) 呈现，可「进入」预览。选中物体挂 TransformControls，拖动结束把
 * 新位姿回调出去由 React 写回数据。
 */
export class BlockoutSceneController {
  private mount: HTMLElement
  private texResolve: TexResolver
  private renderer: THREE.WebGLRenderer
  private viewCamera: THREE.PerspectiveCamera
  private orbit: OrbitControls
  private transform: TransformControls
  private root = new THREE.Group()
  private helpersGroup = new THREE.Group()
  private scene = new THREE.Scene()
  private meshById = new Map<string, THREE.Object3D>()
  private camHelpers: THREE.CameraHelper[] = []
  private disposeScene: (() => void) | null = null
  private raf = 0
  private resizeObs: ResizeObserver | null = null
  private selectedId: string | null = null
  private onTransform?: (id: string, t: Transform) => void
  private onSelect?: (id: string | null) => void

  constructor(
    mount: HTMLElement,
    opts: {
      texResolve: TexResolver
      onTransform?: (id: string, t: Transform) => void
      onSelect?: (id: string | null) => void
    },
  ) {
    this.mount = mount
    this.texResolve = opts.texResolve
    this.onTransform = opts.onTransform
    this.onSelect = opts.onSelect

    const w = mount.clientWidth || 640
    const h = mount.clientHeight || 420

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(this.renderer.domElement)

    this.viewCamera = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000)
    this.viewCamera.position.set(4, 3.2, 5)

    this.orbit = new OrbitControls(this.viewCamera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.target.set(0, 1, 0)

    this.transform = new TransformControls(this.viewCamera, this.renderer.domElement)
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value
    })
    this.transform.addEventListener('mouseUp', () => {
      const obj = this.transform.object
      if (obj && this.selectedId && this.onTransform) {
        this.onTransform(this.selectedId, readTransform(obj))
      }
    })

    this.renderer.domElement.addEventListener('pointerdown', this.onPick)

    this.loop()
    this.handleResize()
    window.addEventListener('resize', this.handleResize)
    // 容器尺寸变化（模态打开 / 窗口缩到卡片画布内 / 布局切换）也要重算 ——
    // window resize 听不到「容器自身被 flex/grid 改尺寸」，必须 ResizeObserver。
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.handleResize())
      this.resizeObs.observe(mount)
    }
  }

  /** TransformControls 的可视 helper（r169+ 需单独 add 到 scene）。 */
  private transformHelper(): THREE.Object3D {
    const anyT = this.transform as unknown as { getHelper?: () => THREE.Object3D }
    return typeof anyT.getHelper === 'function'
      ? anyT.getHelper()
      : (this.transform as unknown as THREE.Object3D)
  }

  /** 用新数据重建场景（保留当前选中并重挂 gizmo）。 */
  setBlockout(blockout: Blockout): void {
    const keepSel = this.selectedId
    // 清旧
    this.transform.detach()
    if (this.disposeScene) this.disposeScene()
    this.camHelpers.forEach((hp) => hp.dispose())
    this.camHelpers = []

    const built = buildScene(blockout, this.texResolve)
    this.scene = built.scene
    this.meshById = built.meshById
    this.disposeScene = built.dispose

    // 相机视锥线框
    const aspect = (this.mount.clientWidth || 640) / (this.mount.clientHeight || 420)
    for (const cam of blockout.cameras) {
      const target = cam.targetObjectId
        ? this.meshById.get(cam.targetObjectId)?.position
        : undefined
      const tcam = makeThreeCamera(cam, aspect, target)
      const helper = new THREE.CameraHelper(tcam)
      this.scene.add(helper)
      this.camHelpers.push(helper)
    }

    this.scene.add(this.transformHelper())

    // 重挂选中
    if (keepSel && this.meshById.has(keepSel)) {
      this.transform.attach(this.meshById.get(keepSel)!)
    } else {
      this.selectedId = null
    }
  }

  select(id: string | null): void {
    this.selectedId = id
    if (id && this.meshById.has(id)) this.transform.attach(this.meshById.get(id)!)
    else this.transform.detach()
    this.onSelect?.(id)
  }

  setTransformMode(mode: TransformMode): void {
    this.transform.setMode(mode)
  }

  /** 把编辑视角移动到某 blockout 相机的位姿（预览该机位构图）。 */
  previewCamera(cam: {
    transform: Transform
    targetObjectId?: string
  }): void {
    this.viewCamera.position.set(cam.transform.pos.x, cam.transform.pos.y, cam.transform.pos.z)
    const target = cam.targetObjectId ? this.meshById.get(cam.targetObjectId)?.position : undefined
    if (target) {
      this.orbit.target.copy(target)
    } else {
      // 用相机朝向推一个前方点
      const dir = new THREE.Vector3(0, 0, -1)
      const e = new THREE.Euler(
        (cam.transform.rot.x * Math.PI) / 180,
        (cam.transform.rot.y * Math.PI) / 180,
        (cam.transform.rot.z * Math.PI) / 180,
      )
      dir.applyEuler(e)
      this.orbit.target.copy(this.viewCamera.position.clone().add(dir.multiplyScalar(3)))
    }
    this.orbit.update()
  }

  resetView(): void {
    this.viewCamera.position.set(4, 3.2, 5)
    this.orbit.target.set(0, 1, 0)
    this.orbit.update()
  }

  private onPick = (ev: PointerEvent): void => {
    if (this.transform.dragging) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.viewCamera)
    const meshes = Array.from(this.meshById.values())
    // recursive=true：人形是 Group，命中的是子 Mesh，需向上回溯到带 blockoutId 的根。
    const hit = ray.intersectObjects(meshes, true)[0]
    if (hit) {
      let o: THREE.Object3D | null = hit.object
      while (o && o.userData.blockoutId === undefined) o = o.parent
      this.select((o?.userData.blockoutId as string) ?? null)
    }
  }

  private handleResize = (): void => {
    const w = this.mount.clientWidth || 640
    const h = this.mount.clientHeight || 420
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    this.viewCamera.aspect = w / h
    this.viewCamera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.orbit.update()
    this.renderer.render(this.scene, this.viewCamera)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs?.disconnect()
    this.resizeObs = null
    window.removeEventListener('resize', this.handleResize)
    this.renderer.domElement.removeEventListener('pointerdown', this.onPick)
    this.transform.detach()
    this.transform.dispose()
    this.orbit.dispose()
    if (this.disposeScene) this.disposeScene()
    this.camHelpers.forEach((hp) => hp.dispose())
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.mount) {
      this.mount.removeChild(this.renderer.domElement)
    }
  }
}
