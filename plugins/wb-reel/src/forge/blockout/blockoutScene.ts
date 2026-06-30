import * as THREE from 'three'
import type {
  Blockout,
  BlockoutCamera,
  BlockoutFigurePose,
  BlockoutObject,
  Transform,
} from '../../scenario/types'
import { mmToFov, horizontalToVerticalFov } from './cameraMath'
import { BLOCKOUT_GROUND_HALF } from './blockoutTypes'

const DEG2RAD = Math.PI / 180

/** 把 Transform 应用到 three Object3D（rot 欧拉角度→弧度）。 */
export function applyTransform(o: THREE.Object3D, t: Transform): void {
  o.position.set(t.pos.x, t.pos.y, t.pos.z)
  o.rotation.set(t.rot.x * DEG2RAD, t.rot.y * DEG2RAD, t.rot.z * DEG2RAD)
  o.scale.set(t.scale.x || 1, t.scale.y || 1, t.scale.z || 1)
}

/** 把 three Object3D 当前位姿读回 Transform（供 TransformControls 拖动后写回数据）。 */
export function readTransform(o: THREE.Object3D): Transform {
  const RAD2DEG = 180 / Math.PI
  return {
    pos: { x: o.position.x, y: o.position.y, z: o.position.z },
    rot: {
      x: o.rotation.x * RAD2DEG,
      y: o.rotation.y * RAD2DEG,
      z: o.rotation.z * RAD2DEG,
    },
    scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
  }
}

export interface TexResolver {
  (mediaId: string | undefined): string | undefined
}

function makeGeometry(
  kind: Exclude<BlockoutObject['kind'], 'figure'>,
): THREE.BufferGeometry {
  switch (kind) {
    case 'capsule':
      return new THREE.CapsuleGeometry(0.3, 1.0, 6, 12)
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.4, 0.4, 1, 16)
    case 'plane':
    case 'billboard':
      return new THREE.PlaneGeometry(1, 1.4)
  }
}

/**
 * 人形姿势预设 —— 每个关节的欧拉角(度) [x,y,z]，未列出的关节归零(直立)。
 *
 * 约定：手臂/腿在 rest 时沿 -Y 下垂。
 *   - 抬手向前 = shoulder x 取负；向两侧平举(T) = shoulder z（左 -90 / 右 +90）。
 *   - 抬腿向前 = hip x 取正；屈膝 = knee x（前摆腿取负回收，后摆腿取正）。
 * 数值为概略摆位，够白模构图/机位参考用；用户可再用 transform 微调整体朝向。
 */
const FIGURE_POSES: Record<
  BlockoutFigurePose,
  Partial<Record<string, [number, number, number]>>
> = {
  stand: {
    shoulderL: [-6, 0, -8],
    shoulderR: [-6, 0, 8],
    elbowL: [-10, 0, 0],
    elbowR: [-10, 0, 0],
    head: [3, 0, 0],
  },
  apose: {
    shoulderL: [0, 0, -32],
    shoulderR: [0, 0, 32],
    elbowL: [-6, 0, 0],
    elbowR: [-6, 0, 0],
  },
  tpose: {
    shoulderL: [0, 0, -90],
    shoulderR: [0, 0, 90],
  },
  walk: {
    hipL: [25, 0, 0],
    kneeL: [-15, 0, 0],
    hipR: [-22, 0, 0],
    kneeR: [28, 0, 0],
    shoulderL: [22, 0, -6],
    elbowL: [-20, 0, 0],
    shoulderR: [-22, 0, 6],
    elbowR: [-25, 0, 0],
    spine: [4, 0, 0],
  },
  run: {
    hipL: [48, 0, 0],
    kneeL: [-80, 0, 0],
    hipR: [-32, 0, 0],
    kneeR: [42, 0, 0],
    shoulderL: [-58, 0, -6],
    elbowL: [-95, 0, 0],
    shoulderR: [50, 0, 6],
    elbowR: [-90, 0, 0],
    spine: [16, 0, 0],
    chest: [6, 0, 0],
    head: [-10, 0, 0],
  },
  sit: {
    hipL: [-88, 0, 2],
    hipR: [-88, 0, -2],
    kneeL: [88, 0, 0],
    kneeR: [88, 0, 0],
    shoulderL: [-8, 0, -8],
    shoulderR: [-8, 0, 8],
    elbowL: [-22, 0, 0],
    elbowR: [-22, 0, 0],
    spine: [6, 0, 0],
  },
  crouch: {
    hipL: [-60, 0, 4],
    hipR: [-60, 0, -4],
    kneeL: [105, 0, 0],
    kneeR: [105, 0, 0],
    ankleL: [-30, 0, 0],
    ankleR: [-30, 0, 0],
    spine: [22, 0, 0],
    chest: [8, 0, 0],
    shoulderL: [-35, 0, -8],
    shoulderR: [-35, 0, 8],
    elbowL: [-60, 0, 0],
    elbowR: [-60, 0, 0],
  },
  point: {
    shoulderR: [-92, 0, 6],
    elbowR: [-4, 0, 0],
    shoulderL: [-6, 0, -8],
    elbowL: [-12, 0, 0],
    head: [0, 10, 0],
  },
  wave: {
    shoulderR: [0, 0, 150],
    elbowR: [-10, -30, 0],
    shoulderL: [-6, 0, -8],
    elbowL: [-12, 0, 0],
    head: [-4, 0, 0],
  },
  cross: {
    shoulderL: [-72, 18, -6],
    elbowL: [-96, 0, -30],
    shoulderR: [-72, -18, 6],
    elbowR: [-96, 0, 30],
  },
  fight: {
    spine: [4, 14, 0],
    head: [0, -8, 0],
    hipL: [14, 8, 0],
    kneeL: [-18, 0, 0],
    hipR: [-12, -6, 0],
    kneeR: [-10, 0, 0],
    shoulderL: [-42, 0, -12],
    elbowL: [-105, 0, 0],
    shoulderR: [-58, 0, 10],
    elbowR: [-118, 0, 0],
  },
}

/** 姿势预设的展示顺序与中文名（供编辑器下拉用）。 */
export const FIGURE_POSE_ORDER: BlockoutFigurePose[] = [
  'stand',
  'apose',
  'tpose',
  'walk',
  'run',
  'sit',
  'crouch',
  'point',
  'wave',
  'cross',
  'fight',
]
export const FIGURE_POSE_LABELS: Record<BlockoutFigurePose, string> = {
  stand: '站立',
  apose: 'A 字站姿',
  tpose: 'T 字展臂',
  walk: '行走',
  run: '奔跑',
  sit: '坐姿',
  crouch: '蹲伏',
  point: '指向前方',
  wave: '挥手',
  cross: '抱臂',
  fight: '战斗预备',
}

/** 把姿势预设套到关节表（先全部归零再施加）。 */
function applyPose(
  joints: Record<string, THREE.Object3D>,
  pose: BlockoutFigurePose,
): void {
  for (const k of Object.keys(joints)) joints[k]?.rotation.set(0, 0, 0)
  const def = FIGURE_POSES[pose] ?? FIGURE_POSES.stand
  for (const [name, rot] of Object.entries(def)) {
    const j = joints[name]
    if (!j || !rot) continue
    j.rotation.set(rot[0] * DEG2RAD, rot[1] * DEG2RAD, rot[2] * DEG2RAD, 'XYZ')
  }
}

/**
 * 人形白模占位 —— 带骨骼层级的低模角色，脚底落在 y=0（站地面），约 1.78m 高。
 *
 * 层级：hips → spine → chest →(neck→head) +(双肩→上臂→前臂→手) ；hips →(双髋→大腿→小腿→脚)。
 * 关节是空 Group(枢轴)，骨段是挂在其上的胶囊/球/盒。姿势=在关节上施加欧拉旋转。
 * 整体作为一个 Object3D 选中/移动/旋转/缩放；所有部件共用一个材质，dispose 时 traverse 收。
 */
export function makeFigure(
  color: THREE.Color,
  pose: BlockoutFigurePose = 'stand',
): THREE.Group {
  const root = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04 })
  const joints: Record<string, THREE.Object3D> = {}

  // 枢轴：相对 parent 的局部坐标
  const pivot = (
    name: string,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    parent.add(g)
    if (name) joints[name] = g
    return g
  }
  // 骨段胶囊：dir=-1 从枢轴往下长(四肢)，dir=+1 往上长(躯干/颈)
  const bone = (
    parent: THREE.Object3D,
    len: number,
    radius: number,
    dir: 1 | -1,
  ): void => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 14), mat)
    m.position.y = (dir * len) / 2
    parent.add(m)
  }
  const ball = (parent: THREE.Object3D, r: number, y = 0): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat)
    m.position.y = y
    parent.add(m)
  }

  // 髋根 + 骨盆
  const hips = pivot('hips', root, 0, 0.92, 0)
  ball(hips, 0.135, 0.0)
  // 脊柱 → 胸 → 颈 → 头
  const spine = pivot('spine', hips, 0, 0.07, 0)
  bone(spine, 0.24, 0.125, 1)
  const chest = pivot('chest', spine, 0, 0.3, 0)
  bone(chest, 0.16, 0.15, 1)
  const neck = pivot('neck', chest, 0, 0.18, 0)
  bone(neck, 0.07, 0.045, 1)
  const head = pivot('head', neck, 0, 0.08, 0)
  ball(head, 0.115, 0.115)

  // 手臂（左 side=-1 / 右 side=+1）
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R'
    const sh = pivot('shoulder' + s, chest, side * 0.17, 0.1, 0)
    ball(sh, 0.06)
    bone(sh, 0.27, 0.055, -1)
    const el = pivot('elbow' + s, sh, 0, -0.27, 0)
    bone(el, 0.25, 0.05, -1)
    const wr = pivot('wrist' + s, el, 0, -0.25, 0)
    bone(wr, 0.07, 0.05, -1)
  }
  // 腿
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R'
    const hip = pivot('hip' + s, hips, side * 0.1, 0, 0)
    bone(hip, 0.42, 0.088, -1)
    const knee = pivot('knee' + s, hip, 0, -0.42, 0)
    bone(knee, 0.4, 0.072, -1)
    const ankle = pivot('ankle' + s, knee, 0, -0.4, 0)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), mat)
    foot.position.set(0, -0.05, 0.06)
    ankle.add(foot)
  }

  applyPose(joints, pose)
  return root
}

/**
 * 由 BlockoutObject 造一个可放进场景的 Object3D（基础体 = Mesh，人形 = Group）。
 * 角色占位用 colorRole 着色；billboard 贴锚点图。
 * 返回对象的 userData.blockoutId = obj.id，便于拾取回写（人形需向上回溯到 Group）。
 */
export function makeObjectMesh(
  obj: BlockoutObject,
  texResolve: TexResolver,
): THREE.Object3D {
  if (obj.kind === 'figure') {
    const color = obj.colorRole ? new THREE.Color(obj.colorRole) : new THREE.Color(0xb8b8b8)
    const fig = makeFigure(color, obj.pose ?? 'stand')
    applyTransform(fig, obj.transform)
    fig.userData.blockoutId = obj.id
    return fig
  }

  const geo = makeGeometry(obj.kind)
  let mat: THREE.Material
  if (obj.kind === 'billboard') {
    const url = texResolve(obj.texMediaId)
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: 0xffffff })
    if (url) {
      const tex = new THREE.TextureLoader().load(url)
      tex.colorSpace = THREE.SRGBColorSpace
      m.map = tex
    } else {
      m.color = new THREE.Color(0x8899aa)
    }
    mat = m
  } else {
    const color = obj.colorRole ? new THREE.Color(obj.colorRole) : new THREE.Color(0xb8b8b8)
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.0 })
  }
  const mesh = new THREE.Mesh(geo, mat)
  applyTransform(mesh, obj.transform)
  mesh.userData.blockoutId = obj.id
  // 胶囊默认把底部贴地（几何中心在腰部）
  if (obj.kind === 'capsule') mesh.position.y += 0.8 * (obj.transform.scale.y || 1)
  return mesh
}

/** 由 BlockoutCamera 造一台 three 透视相机（含 lookAt / 朝向解析）。 */
export function makeThreeCamera(
  cam: BlockoutCamera,
  aspect: number,
  lookAtTarget?: THREE.Vector3,
): THREE.PerspectiveCamera {
  const vFov = horizontalToVerticalFov(mmToFov(cam.fovMm), aspect)
  const c = new THREE.PerspectiveCamera(vFov, aspect, 0.05, 1000)
  c.position.set(cam.transform.pos.x, cam.transform.pos.y, cam.transform.pos.z)
  if (lookAtTarget) {
    c.lookAt(lookAtTarget)
  } else {
    c.rotation.set(
      cam.transform.rot.x * DEG2RAD,
      cam.transform.rot.y * DEG2RAD,
      cam.transform.rot.z * DEG2RAD,
    )
  }
  return c
}

export interface BuiltScene {
  scene: THREE.Scene
  /** 基础体是 Mesh，人形(figure)是 Group —— 统一存 Object3D */
  meshById: Map<string, THREE.Object3D>
  dispose: () => void
}

/** 网格地面 + 半球光的基础环境。 */
function addEnvironment(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x14161c)
  const grid = new THREE.GridHelper(BLOCKOUT_GROUND_HALF * 2, BLOCKOUT_GROUND_HALF * 2, 0x4a5160, 0x2a2e38)
  scene.add(grid)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.1)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(3, 6, 4)
  scene.add(key)
}

/** 由 Blockout 装配 three 场景（不含相机/渲染器）。 */
export function buildScene(blockout: Blockout, texResolve: TexResolver): BuiltScene {
  const scene = new THREE.Scene()
  addEnvironment(scene)
  const meshById = new Map<string, THREE.Object3D>()
  for (const obj of blockout.objects) {
    const mesh = makeObjectMesh(obj, texResolve)
    meshById.set(obj.id, mesh)
    scene.add(mesh)
  }
  const dispose = () => {
    for (const obj of meshById.values()) {
      // 人形是 Group，需 traverse 收每个子 Mesh 的几何/材质（共用材质重复 dispose 无害）
      obj.traverse((n) => {
        const m = n as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else if (mat) mat.dispose()
      })
    }
  }
  return { scene, meshById, dispose }
}

/** 预加载 billboard 贴图（离屏出图前等待，避免渲到空白）。 */
async function preloadTextures(blockout: Blockout, texResolve: TexResolver): Promise<void> {
  const loader = new THREE.TextureLoader()
  const urls = blockout.objects
    .filter((o) => o.kind === 'billboard')
    .map((o) => texResolve(o.texMediaId))
    .filter((u): u is string => !!u)
  await Promise.all(
    urls.map(
      (u) =>
        new Promise<void>((resolve) => {
          loader.load(u, () => resolve(), undefined, () => resolve())
        }),
    ),
  )
}

/**
 * 离屏渲染某机位白模构图静帧 → PNG dataURL。
 * 需在浏览器环境（WebGL）调用；happy-dom/CI 不可用。
 */
export async function renderStillFromBlockout(args: {
  blockout: Blockout
  cameraId: string
  texResolve: TexResolver
  width: number
  height: number
}): Promise<string> {
  const { blockout, cameraId, texResolve, width, height } = args
  const cam = blockout.cameras.find((c) => c.id === cameraId)
  if (!cam) throw new Error(`blockout 无机位 ${cameraId}`)

  await preloadTextures(blockout, texResolve)

  const { scene, meshById, dispose } = buildScene(blockout, texResolve)
  const aspect = width / height
  const target = cam.targetObjectId ? meshById.get(cam.targetObjectId)?.position : undefined
  const camera = makeThreeCamera(cam, aspect, target)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  dispose()
  renderer.dispose()
  return dataUrl
}
