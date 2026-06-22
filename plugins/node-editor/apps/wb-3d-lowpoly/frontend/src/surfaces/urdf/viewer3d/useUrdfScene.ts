// 💡 URDF 场景集成 hook：组合 useThreeScene + URDF 解析 + 场景图构建 + 关节控制 + 自动动画
//    职责：把 URDF 源文本变成 THREE 场景中的 articulated robot，并暴露 spec / joint 控制接口给 UI
import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react'
import * as THREE from 'three'
import { useThreeScene } from './useThreeScene'
import { parseUrdf, rewriteAbsoluteMeshFilenames, type UrdfSpec } from './urdf-parser'
import { buildRobotSceneGraph, type RobotSceneGraph } from './scene-graph-builder'
import { loadGeometryObject } from './geometry-loader'
import { disposeObject3D } from './three-dispose'
import { resolveVisualMaterialSpec } from './materials'
import { useJointController } from './useJointController'
import { computeFit, updateCameraClipping, computeSceneSphere, applyClippingForSphere } from './camera-utils'
import { positionGroundHelpers } from './lighting'
import {
  buildPreviewMotions,
  isPreviewJoint,
  previewJointValue,
  type PreviewJointMotion,
} from './urdf-joint-motion'

export interface UseUrdfSceneOptions {
  source: string
  baseUrl: string
  assetRevisionKey: string | null
  showGrid: boolean
  showAxis: boolean
  showCollisions: boolean
  autoAnimate: boolean
  doubleSided: boolean
  /** 建筑剖切：用水平裁剪面切掉顶部，看进中空建筑内部。 */
  sectionView: boolean
  /** 剖切高度（0..1，模型高度比例）：1=完整，越小切掉越多顶部。 */
  sectionHeight: number
  background?: number | string
}

export interface UrdfSceneStats {
  links: number
  joints: number
  movableJoints: number
  primitiveCount: number
  meshCount: number
  loadedMeshCount: number
  failedMeshCount: number
}

export interface UseUrdfSceneResult {
  spec: UrdfSpec | null
  error: string | null
  jointValues: Map<string, number>
  previewJointValues: Map<string, number>
  setJointValue: (name: string, value: number) => void
  resetAllJoints: () => void
  resetCamera: () => void
  getExportObject: () => THREE.Object3D | null
  /** Live renderer canvas accessor for screenshot capture (see `captureFrame`). */
  getFrameCanvas: () => HTMLCanvasElement | null
  /** Force a synchronous render so a capture reads a fresh frame (see `useThreeScene`). */
  renderFrame: () => void
  /** Render the robot from 4 orthographic views into a labeled 2×2 contact-sheet canvas. */
  captureContactSheet: () => HTMLCanvasElement | null
  invalidate: () => void
  stats: UrdfSceneStats
  loading: boolean
}

const PREVIEW_UI_SYNC_MS = 100

/**
 * 与 articraft 同源：URDF 默认 Z-up（地面=Z=0 平面），THREE 默认 Y-up。
 * 把 spec.root 包到一个外层 Group 里：
 *   1) 绕 X 轴旋转 -90°，将 URDF 的 Z 轴对齐到 THREE 的 Y 轴；
 *   2) 把模型整体落到地面：center 对齐 (x=0, z=0)，box.min.y=0（脚踩网格）。
 * 不做这一步，对 z-up 模型而言，相机可能"看着原点"，而模型实际在视锥外；
 * 也可能模型 footprint 远离原点，导致 fit 之后摄像机飞出 grid 的可视区域。
 */
const ROBOT_GROUP_NAME = '__viewer_robot__'
function normalizeRobotGroupToGroundOrigin(robotGroup: THREE.Group): void {
  robotGroup.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(robotGroup)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  robotGroup.position.x -= center.x
  robotGroup.position.y -= box.min.y
  robotGroup.position.z -= center.z
  robotGroup.updateMatrixWorld(true)
}

export function useUrdfScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseUrdfSceneOptions,
): UseUrdfSceneResult {
  const scene = useThreeScene(containerRef, {
    background: options.background,
    continuousRender: false,
  })

  const [spec, setSpec] = useState<UrdfSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [jointNodes, setJointNodes] = useState<Map<string, THREE.Object3D> | null>(null)
  const [stats, setStats] = useState<UrdfSceneStats>({
    links: 0, joints: 0, movableJoints: 0, primitiveCount: 0, meshCount: 0,
    loadedMeshCount: 0, failedMeshCount: 0,
  })

  const robotGraphRef = useRef<RobotSceneGraph | null>(null)
  const robotRootRef = useRef<THREE.Group | null>(null)
  // 建筑剖切用的世界空间水平裁剪面。法线 (0,-1,0)：保留 worldY <= constant 的部分
  // （即切掉 constant 以上的顶部）。constant 在下方 effect 里按模型高度实时更新。
  const sectionPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0))
  const getExportObject = useCallback(() => robotRootRef.current, [])
  /**
   * 是否已经针对当前的 viewer 实例做过一次自动相机 fit。
   *
   * 只在"第一次"加载 URDF 时把相机自适应到模型——后续的所有 URDF 更新（拖滑条触发的
   * 增量重算 / 关节变化 / 几何重生成）都保留用户当下的视角，不要默默把相机弹回去。
   * 用户要重新 fit 时点侧边栏的"重置相机"（resetCamera）即可，那里仍然走 computeFit。
   */
  const hasFitInitiallyRef = useRef(false)
  /**
   * 上次自动 fit 时模型的尺寸（包围盒 size）。用来区分"实时调参"（尺寸基本不变，
   * 保持用户视角）和"切换到另一个模型/节点"（尺寸显著变化，需要重新 fit）——后者
   * 若不重新 fit，从大模型切到小模型时小模型会被框在远距相机里、看起来一片空白。
   */
  const lastFitSizeRef = useRef<THREE.Vector3 | null>(null)

  // useThreeScene 内部把 scene/camera/... 都用 useRef 持有，返回值里读 *Ref.current；
  // 因此 scene.scene / scene.camera / scene.invalidate 这些字段在多次 render 之间是稳定引用，
  // 直接进 effect 依赖列表是安全的（与 articraft 的 useUrdfLoader 一致）。
  const { scene: sceneObj3d, camera, controls, gridGroup, axisGroup, invalidate, getFrameCanvas, renderFrame, captureContactSheet: captureContactSheetRaw, sceneReady } = scene

  // Capture the contact sheet framed to the current robot root (falls back to
  // the whole scene inside useThreeScene when no robot is loaded yet).
  const captureContactSheet = useCallback<() => HTMLCanvasElement | null>(
    () => captureContactSheetRaw(robotRootRef.current),
    [captureContactSheetRaw],
  )

  // 解析 URDF 源 + 构建场景图（每次 source 变化都触发）
  useEffect(() => {
    if (!sceneReady || !sceneObj3d) return
    const sceneObj = sceneObj3d

    // 清理上一棵机器人
    if (robotRootRef.current) {
      sceneObj.remove(robotRootRef.current)
      disposeObject3D(robotRootRef.current)
      robotRootRef.current = null
      robotGraphRef.current = null
    }
    setJointNodes(null)
    setSpec(null)
    setError(null)
    setStats({ links: 0, joints: 0, movableJoints: 0, primitiveCount: 0, meshCount: 0, loadedMeshCount: 0, failedMeshCount: 0 })

    const src = options.source.trim()
    if (!src) {
      invalidate()
      return
    }

    let parsed: UrdfSpec
    const parseT0 = performance.now()
    try {
      parsed = rewriteAbsoluteMeshFilenames(parseUrdf(src))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[viewer/useUrdfScene] parseUrdf failed', { msg })
      setError(msg)
      invalidate()
      return
    }
    const parseMs = performance.now() - parseT0

    let graph: RobotSceneGraph
    const buildT0 = performance.now()
    try {
      graph = buildRobotSceneGraph(parsed, {
        showVisuals: true,
        showCollisions: options.showCollisions,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[viewer/useUrdfScene] buildRobotSceneGraph failed', { msg })
      setError(`Scene build failed: ${msg}`)
      invalidate()
      return
    }
    const sceneBuildMs = performance.now() - buildT0

    // 关键：URDF Z-up → THREE Y-up 的坐标系换算 + 落地居中。
    // 不做包裹，box(1,1,1) 会以 [-0.5,0.5]³ 居中在原点（非 Z-up 也"恰好"显示），但
    // 一旦 URDF 用了 origin xyz/rpy 或多 link 关节链路，模型就会以 Z-up 视角散开，
    // 与 THREE 默认 Y-up 视角错位，造成视觉上"看不到模型"。articraft 同款修复。
    const robotGroup = new THREE.Group()
    robotGroup.name = ROBOT_GROUP_NAME
    robotGroup.rotation.x = -Math.PI / 2
    robotGroup.add(graph.root)
    sceneObj.add(robotGroup)
    normalizeRobotGroupToGroundOrigin(robotGroup)
    robotGraphRef.current = graph
    robotRootRef.current = robotGroup

    // 决定本次加载是否要自动 fit：首次必 fit；之后只有当模型尺寸显著变化（切换到
    // 另一个模型/节点）才重新 fit，实时调参（尺寸基本不变）保持用户视角。
    const shouldFitFor = (robot: THREE.Group): boolean => {
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty()) return false
      const size = box.getSize(new THREE.Vector3())
      let doFit = false
      if (!hasFitInitiallyRef.current) {
        doFit = true
      } else {
        const prev = lastFitSizeRef.current
        const maxNow = Math.max(size.x, size.y, size.z)
        const maxPrev = prev ? Math.max(prev.x, prev.y, prev.z) : 0
        const ratio = maxNow / Math.max(1e-3, maxPrev)
        if (ratio < 0.6 || ratio > 1.66) doFit = true
      }
      if (doFit) {
        lastFitSizeRef.current = size
        hasFitInitiallyRef.current = true
      }
      return doFit
    }
    const fitCameraTo = (robot: THREE.Group): void => {
      if (!camera || !controls) return
      const fit = computeFit(camera, robot)
      camera.position.copy(fit.position)
      camera.near = fit.near
      camera.far = fit.far
      camera.updateProjectionMatrix()
      controls.target.copy(fit.target)
      controls.update()
      if (gridGroup && axisGroup) positionGroundHelpers(gridGroup, axisGroup, robot)
    }

    if (options.doubleSided) {
      robotGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach((m) => { m.side = THREE.DoubleSide })
          else if (mat) (mat as THREE.Material).side = THREE.DoubleSide
        }
      })
    }

    // 全部 visual 都是异步 mesh 时，此刻 link group 还是空的（mesh 在下方 async 块里
    // 才 add 进来）。对这种装配体，bbox 此刻为空 → 同步 fit 会把相机停在默认位置且
    // 永不重新 fit，中空模型（房间/建筑外壳）相机会落在内部、单面剔除后什么都看不到。
    // 因此：有待加载 mesh 时，把"首次落地居中 + 自动 fit"推迟到 mesh 加载完成后。
    const willLoadMeshes = graph.pendingMeshVisuals.length > 0 && !!options.baseUrl
    if (camera && controls && !willLoadMeshes) {
      // 纯 primitive（无异步 mesh）：bbox 此刻已完整，按需 fit / 仅刷新裁剪面。
      if (shouldFitFor(robotGroup)) fitCameraTo(robotGroup)
      else updateCameraClipping(camera, robotGroup)
    }
    // （首次 + 有待加载 mesh）：bbox 此刻为空，把 fit 推迟到 async 加载块结束后。
    if (gridGroup && axisGroup) {
      positionGroundHelpers(gridGroup, axisGroup, robotGroup)
    }

    setSpec(parsed)
    setJointNodes(graph.jointNodes)

    // 诊断：robot 进 scene 后，把 bbox / 相机姿态 / scene 子节点都打一份快照，
    // 用来判断"画布显示但模型不可见"是模型尺寸异常还是 fit/camera 跳飞。
    {
      const box = new THREE.Box3().setFromObject(robotGroup)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      console.log('[viewer/useUrdfScene] robot attached', {
        links: parsed.links.length,
        joints: parsed.joints.length,
        parseMs: +parseMs.toFixed(1),
        sceneBuildMs: +sceneBuildMs.toFixed(1),
        bboxMin: box.min.toArray().map((v) => +v.toFixed(3)),
        bboxMax: box.max.toArray().map((v) => +v.toFixed(3)),
        bboxSize: size.toArray().map((v) => +v.toFixed(3)),
        bboxCenter: center.toArray().map((v) => +v.toFixed(3)),
        cameraPos: camera?.position.toArray().map((v) => +v.toFixed(3)),
        cameraTarget: controls?.target.toArray().map((v) => +v.toFixed(3)),
        cameraNearFar: camera ? [camera.near, camera.far] : null,
        sceneChildren: sceneObj.children.map((c) => c.name || c.type),
      })
    }

    // 统计
    let primitiveCount = 0
    let meshCount = 0
    for (const link of parsed.links) {
      for (const v of link.visuals) {
        if (v.geometry.type === 'mesh') meshCount += 1
        else primitiveCount += 1
      }
    }
    setStats((prev) => ({
      ...prev,
      links: parsed.links.length,
      joints: parsed.joints.length,
      movableJoints: parsed.joints.filter(isPreviewJoint).length,
      primitiveCount,
      meshCount,
      loadedMeshCount: 0,
      failedMeshCount: 0,
    }))

    // 异步加载 mesh 资源（如配置了 baseUrl）
    let cancelled = false
    if (graph.pendingMeshVisuals.length > 0) {
      if (!options.baseUrl) {
        setStats((prev) => ({ ...prev, failedMeshCount: graph.pendingMeshVisuals.length }))
        invalidate()
      } else {
        setLoading(true)
        const baseUrl = options.baseUrl
        const assetRevisionKey = options.assetRevisionKey
        ;(async () => {
          const meshBatchT0 = performance.now()
          const loadTasks = graph.pendingMeshVisuals.map(async (pending) => {
            if (cancelled) return
            const linkSpec = parsed.links.find((l) => l.name === pending.link)
            const visual = linkSpec?.visuals[pending.visualIndex]
            if (!linkSpec || !visual) return
            const meshLoadT0 = performance.now()
            try {
              const materialSpec = resolveVisualMaterialSpec(visual)
              const group = await loadGeometryObject(visual.geometry, baseUrl, {
                kind: 'visual',
                materialSpec,
                doubleSided: options.doubleSided,
                assetRevisionKey,
              })
              if (cancelled) {
                disposeObject3D(group)
                return
              }
              if (visual.origin) {
                const m = new THREE.Matrix4()
                m.identity()
                const xyz = visual.origin.xyz ?? [0, 0, 0]
                const rpy = visual.origin.rpy ?? [0, 0, 0]
                m.makeRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))
                m.setPosition(xyz[0], xyz[1], xyz[2])
                group.applyMatrix4(m)
              }
              pending.parent.add(group)
              setStats((prev) => ({ ...prev, loadedMeshCount: prev.loadedMeshCount + 1 }))
              if (camera) updateCameraClipping(camera, robotRootRef.current ?? group)
              invalidate()
              console.debug('[viewer/useUrdfScene] mesh loaded', {
                link: linkSpec.name,
                filename: pending.geometryFilename,
                loadMs: +(performance.now() - meshLoadT0).toFixed(1),
              })
            } catch (err) {
              console.warn(`[viewer] mesh load failed for ${linkSpec.name}/${pending.geometryFilename}:`, err)
              setStats((prev) => ({ ...prev, failedMeshCount: prev.failedMeshCount + 1 }))
            }
          })
          await Promise.all(loadTasks)
          if (!cancelled) {
            // mesh 全部就位 → 装配体此刻才有真实 bbox。先落地居中（同步阶段对全-mesh
            // 装配体 bbox 为空、normalize 是 no-op），再按需 fit：不 fit 中空的房间 /
            // 建筑外壳相机会停在默认/旧位置，看起来一片空白。
            const robot = robotRootRef.current
            if (robot) {
              normalizeRobotGroupToGroundOrigin(robot)
              if (shouldFitFor(robot)) fitCameraTo(robot)
              else if (camera) updateCameraClipping(camera, robot)
            }
            invalidate()
            console.debug('[viewer/useUrdfScene] mesh batch loaded', {
              meshCount: graph.pendingMeshVisuals.length,
              loadMs: +(performance.now() - meshBatchT0).toFixed(1),
            })
            setLoading(false)
          }
        })().catch(() => { if (!cancelled) setLoading(false) })
      }
    }

    invalidate()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, options.source, options.baseUrl, options.assetRevisionKey, options.showCollisions, options.doubleSided])

  useEffect(() => {
    if (gridGroup) gridGroup.visible = options.showGrid
    if (axisGroup) axisGroup.visible = options.showAxis
    invalidate()
  }, [gridGroup, axisGroup, invalidate, options.showGrid, options.showAxis])

  // 用户拖动 / 缩放后动态重算 near/far：初始 fit 算出的近裁剪面只适用于初始相机位置，
  // 相机一旦靠近模型，固定的 near 就会从前侧切进几何体（典型表现：盒子下半边被斜切成尖角）。
  // 关键修复：以前只在 'end' 上重算，于是从远处连续拉近（滚轮 zoom）时，整个手势期间 near
  // 一直停留在"远视角"算出的大值，把已经贴近的模型整片切掉 → 放大出现黑边甚至黑屏，松手才恢复。
  // 现在缓存一次场景包围球（几何静态），在每帧 'change' 上用相机当前距离廉价地重算 near/far，
  // 'end' 与异步 mesh 加载完成（loading 变化）时再重建包围球。
  useEffect(() => {
    if (!camera || !controls) return
    const robot = robotRootRef.current
    if (!robot || !spec) return
    const targets: THREE.Object3D[] = [robot]
    if (gridGroup) targets.push(gridGroup)
    if (axisGroup) targets.push(axisGroup)

    let sphere = computeSceneSphere(targets)
    // 重建包围球（几何/网格可能刚变化），随后立即按当前相机修正裁剪面。
    const rebuild = () => {
      sphere = computeSceneSphere(targets) ?? sphere
      if (sphere) applyClippingForSphere(camera, sphere)
      invalidate()
    }
    // 相机每次移动（orbit / zoom）都跑：仅用缓存包围球做廉价 near/far 修正，保证当前帧不被错误裁剪。
    const onChange = () => {
      if (sphere) applyClippingForSphere(camera, sphere)
    }

    rebuild()
    controls.addEventListener('change', onChange)
    controls.addEventListener('end', rebuild)
    return () => {
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('end', rebuild)
    }
  }, [camera, controls, gridGroup, axisGroup, invalidate, spec, loading])

  // 建筑剖切：把一个世界空间水平裁剪面挂到机器人所有 mesh 材质上，切掉顶部以看进
  // 中空建筑（房间 / 多层楼）。依赖 loading 以便 mesh 异步加载完后对新材质重新应用；
  // 依赖 spec 以便换模型后重算高度。开启时同时强制双面，避免剖切口看到背面镂空。
  useEffect(() => {
    const robot = robotRootRef.current
    if (!robot) return
    const enabled = options.sectionView
    const plane = sectionPlaneRef.current

    robot.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(robot)
    if (!box.isEmpty()) {
      const minY = box.min.y
      const height = Math.max(1e-3, box.max.y - minY)
      const frac = Math.min(1, Math.max(0, options.sectionHeight))
      // frac=1 时把裁剪面抬到模型顶部之上一点，确保"完整"状态不误切。
      plane.constant = frac >= 1 ? box.max.y + height : minY + frac * height
    }

    const wantDoubleSide = enabled || options.doubleSided
    robot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of mats) {
        if (!m) continue
        const mat = m as THREE.Material
        mat.clippingPlanes = enabled ? [plane] : null
        mat.clipShadows = enabled
        mat.side = wantDoubleSide ? THREE.DoubleSide : THREE.FrontSide
        mat.needsUpdate = true
      }
    })
    invalidate()
  }, [spec, loading, options.sectionView, options.sectionHeight, options.doubleSided, invalidate])

  // 关节控制器
  const { jointValues, setJointValue, applyJointValues, resetAll } = useJointController(jointNodes, spec)
  const jointValuesRef = useRef<Map<string, number>>(new Map())
  useEffect(() => { jointValuesRef.current = jointValues }, [jointValues])

  const [previewJointValues, setPreviewJointValues] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!spec || !options.autoAnimate) {
      setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
      applyJointValues(jointValuesRef.current)
      invalidate()
      return
    }
    const motions: PreviewJointMotion[] = buildPreviewMotions(spec)
    if (motions.length === 0) {
      setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }

    let frameId = 0
    let lastUiSync = 0
    const tick = (now: number) => {
      const t = now / 1000
      const nextValues = new Map<string, number>()
      for (const m of motions) {
        const phase = THREE.MathUtils.euclideanModulo((t / m.cycleSeconds) + m.phaseOffset, 1)
        nextValues.set(m.joint.name, previewJointValue(m.joint, phase))
      }
      if (now - lastUiSync >= PREVIEW_UI_SYNC_MS) {
        lastUiSync = now
        startTransition(() => setPreviewJointValues(new Map(nextValues)))
      }
      applyJointValues(nextValues)
      invalidate()
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frameId)
      setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
      applyJointValues(jointValuesRef.current)
      invalidate()
    }
  }, [spec, options.autoAnimate, applyJointValues, invalidate])

  const wrappedSetJointValue = useCallback((name: string, value: number) => {
    setJointValue(name, value)
    invalidate()
  }, [setJointValue, invalidate])

  const wrappedResetAll = useCallback(() => {
    resetAll()
    invalidate()
  }, [resetAll, invalidate])

  const resetCamera = useCallback(() => {
    const robot = robotRootRef.current
    if (!camera || !controls || !robot) return
    const fit = computeFit(camera, robot)
    camera.position.copy(fit.position)
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    controls.target.copy(fit.target)
    controls.update()
    if (gridGroup && axisGroup) {
      positionGroundHelpers(gridGroup, axisGroup, robot)
    }
    invalidate()
  }, [camera, controls, gridGroup, axisGroup, invalidate])

  const result = useMemo<UseUrdfSceneResult>(() => ({
    spec,
    error,
    jointValues,
    previewJointValues,
    setJointValue: wrappedSetJointValue,
    resetAllJoints: wrappedResetAll,
    resetCamera,
    getExportObject,
    getFrameCanvas,
    renderFrame,
    captureContactSheet,
    invalidate,
    stats,
    loading,
  }), [spec, error, jointValues, previewJointValues, wrappedSetJointValue, wrappedResetAll, resetCamera, getExportObject, getFrameCanvas, renderFrame, captureContactSheet, invalidate, stats, loading])

  return result
}
