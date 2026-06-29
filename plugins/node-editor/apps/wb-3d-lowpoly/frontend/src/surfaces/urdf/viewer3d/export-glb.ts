// 💡 导出带动画的 GLB：烘焙 URDF 关节预览轨迹为 glTF animation
import * as THREE from 'three'
import type { UrdfSpec } from './urdf-parser'
import {
  buildUrdfPreviewAnimationClip,
  findJointMotionNodes,
  previewAnimationDuration,
} from './urdf-joint-motion'

/** PropertyBinding / glTF 会把 `.` `:` `/` 当作路径分隔符，URDF 节点名需先清洗。 */
const GLTF_RESERVED_IN_NAME_RE = /[\[\]\.:\/\s]/g

export function sanitizeGltfNodeName(name: string): string {
  const cleaned = name.replace(GLTF_RESERVED_IN_NAME_RE, '_').replace(/_+/g, '_')
  return cleaned.replace(/^_|_$/g, '') || 'node'
}

export function sanitizeExportSceneNames(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj.name) obj.name = sanitizeGltfNodeName(obj.name)
  })
}

// 共享的 GLTFExporter 出口：唯一区别是是否带 `animations`。两个 public 导出函数
// （动画版 / 静态版）各自在调用前做好场景名清洗与（可选的）clip 构建。
async function parseToGlbBlob(
  exportRoot: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<Blob> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const glb = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      exportRoot,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, onlyVisible: true, animations },
    )
  })

  return glb instanceof ArrayBuffer
    ? new Blob([glb], { type: 'model/gltf-binary' })
    : new Blob([JSON.stringify(glb)], { type: 'model/gltf+json' })
}

// 带动画的 GLB：把 URDF 关节预览轨迹烘成 glTF animation track。需要 spec 来推导
// 每个关节的运动范围；clip 必须在 sanitize 之后构建，否则 track 的目标节点名对不上。
export async function exportAnimatedGlbBlob(
  exportRoot: THREE.Object3D,
  spec: UrdfSpec,
): Promise<Blob> {
  const jointNodes = findJointMotionNodes(exportRoot)
  sanitizeExportSceneNames(exportRoot)
  const clip = buildUrdfPreviewAnimationClip(spec, jointNodes, exportRoot)
  return parseToGlbBlob(exportRoot, clip ? [clip] : [])
}

// 静态 GLB：只导出几何 + 内嵌材质，**不写任何 animation track**。给那些不需要
// 关节预览动画（或会被引擎里的骨骼/动画系统接管）的消费方用。无需 UrdfSpec。
export async function exportStaticGlbBlob(exportRoot: THREE.Object3D): Promise<Blob> {
  sanitizeExportSceneNames(exportRoot)
  return parseToGlbBlob(exportRoot, [])
}

export function glbExportHasAnimation(spec: UrdfSpec): boolean {
  return previewAnimationDuration(spec) > 0
}
