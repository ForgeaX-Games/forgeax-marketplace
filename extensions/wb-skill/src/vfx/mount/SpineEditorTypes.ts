// @source wb-character/src/pipelines/spine/editor/types.ts
/**
 * Minimal EditorSkeleton type snapshot for wb-skill/src/vfx.
 *
 * D-1: wb-skill must not import from wb-character at runtime.
 * SpriteAnchorAdapter.loadStaticSpine() needs EditorSkeleton for Plan A+
 * mount point refinement. This file re-declares only the fields accessed.
 *
 * Source: wb-character/src/pipelines/spine/editor/types.ts (EditorSkeleton)
 */

export interface EditorBone {
  name: string
  parent: string | null
  localX: number
  localY: number
  localRotation: number
  worldX: number
  worldY: number
  length: number
  rotation: number
  children: string[]
}

export interface EditorSkeleton {
  bones: Map<string, EditorBone>
  boneOrder: string[]
  rootBones: string[]
  slots: unknown[]
  ik: unknown[]
  animations: Map<string, unknown>
  skinAttachments: Map<string, Map<string, unknown>>
}
