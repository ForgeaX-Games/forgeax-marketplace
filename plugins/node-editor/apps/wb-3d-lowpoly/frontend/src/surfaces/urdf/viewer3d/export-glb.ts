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

export async function exportAnimatedGlbBlob(
  exportRoot: THREE.Object3D,
  spec: UrdfSpec,
): Promise<Blob> {
  const jointNodes = findJointMotionNodes(exportRoot)
  sanitizeExportSceneNames(exportRoot)
  const clip = buildUrdfPreviewAnimationClip(spec, jointNodes, exportRoot)
  const animations = clip ? [clip] : []

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

export function glbExportHasAnimation(spec: UrdfSpec): boolean {
  return previewAnimationDuration(spec) > 0
}
