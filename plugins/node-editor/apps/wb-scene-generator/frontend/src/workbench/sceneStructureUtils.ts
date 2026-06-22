import { isDataTreeEntries, peelWireValue } from '@forgeax/node-runtime-react/editor'
import { parseScenePort, type ScenePortValue } from '../../../vendor/shared/types/scene/port.js'
import type { SceneNodeSnapshot } from '../../../vendor/shared/types/scene/types.js'

export interface SceneNodeStats {
  ownVoxels: number
  subtreeVoxels: number
  nodeCount: number
}

export function collectNodeStats(node: SceneNodeSnapshot): SceneNodeStats {
  let ownVoxels = node.cells?.length ?? 0
  let subtreeVoxels = ownVoxels
  let nodeCount = 1
  for (const child of node.children) {
    const childStats = collectNodeStats(child)
    subtreeVoxels += childStats.subtreeVoxels
    nodeCount += childStats.nodeCount
  }
  return { ownVoxels, subtreeVoxels, nodeCount }
}

/**
 * Extract the first valid ScenePortValue from a wire-side port value.
 * Multi-branch / multi-item DataTree inputs only surface the first scene.
 */
export function extractScenePortFromWire(raw: unknown): ScenePortValue | null {
  if (raw === undefined || raw === null) return null

  if (isDataTreeEntries(raw)) {
    const firstItem = raw[0]?.items?.[0]
    return firstItem !== undefined ? parseScenePort(firstItem) : null
  }

  const peeled = peelWireValue(raw)
  return parseScenePort(peeled)
}

/** Collect ancestor paths (inclusive) that should stay expanded to reveal `focus`. */
export function pathsExpandedToFocus(focus: string): Set<string> {
  const expanded = new Set<string>(['/'])
  if (focus === '/' || focus === '') return expanded

  const segments = focus.split('/').filter(Boolean)
  let path = ''
  for (const segment of segments) {
    path += `/${segment}`
    expanded.add(path)
  }
  return expanded
}

export function formatSceneNodeLabel(node: SceneNodeSnapshot): string {
  if (node.path === '/' || node.name === '') return '/'
  return node.name
}

export function readTreeRoot(port: ScenePortValue): SceneNodeSnapshot {
  return port.tree
}
