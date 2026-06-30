// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { emptyTree, upsertCells } from '../../../../vendor/shared/types/scene/tree.js'
import { makeScenePort } from '../../../../vendor/shared/types/scene/port.js'
import { collectNodeStats, extractScenePortFromWire, pathsExpandedToFocus } from '../sceneStructureUtils.js'

describe('sceneStructureUtils', () => {
  it('collectNodeStats aggregates own and subtree voxel counts', () => {
    let root = emptyTree()
    root = upsertCells(root, '/a', { schema: 'layer', cells: [{ x: 0, y: 0, z: 0, token: 'g' }] }, 1)
    root = upsertCells(root, '/a/b', { schema: 'layer', cells: [{ x: 1, y: 0, z: 0, token: 'g' }, { x: 2, y: 0, z: 0, token: 'g' }] }, 2)

    const stats = collectNodeStats(root)
    expect(stats.ownVoxels).toBe(0)
    expect(stats.subtreeVoxels).toBe(3)
    expect(stats.nodeCount).toBe(3)
  })

  it('extractScenePortFromWire reads a direct ScenePortValue', () => {
    const root = emptyTree()
    const port = makeScenePort(root, '/')
    expect(extractScenePortFromWire(port)?.focus).toBe('/')
  })

  it('extractScenePortFromWire reads DataTree wire shape', () => {
    const root = emptyTree()
    const port = makeScenePort(root, '/child')
    const wire = [{ path: [0], items: [port] }]
    expect(extractScenePortFromWire(wire)?.focus).toBe('/child')
  })

  it('extractScenePortFromWire uses only the first scene in a multi-item DataTree', () => {
    let rootA = emptyTree()
    rootA = upsertCells(rootA, '/a', { schema: 'layer', cells: [{ x: 0, y: 0, z: 0, token: 'g' }] }, 1)
    let rootB = emptyTree()
    rootB = upsertCells(rootB, '/b', { schema: 'layer', cells: [{ x: 1, y: 0, z: 0, token: 'g' }] }, 1)

    const wire = [
      {
        path: [0],
        items: [makeScenePort(rootA, '/a'), makeScenePort(rootB, '/b')],
      },
      {
        path: [1],
        items: [makeScenePort(rootB, '/b')],
      },
    ]

    expect(extractScenePortFromWire(wire)?.focus).toBe('/a')
  })

  it('pathsExpandedToFocus includes ancestors', () => {
    const expanded = pathsExpandedToFocus('/a/b/c')
    expect(expanded.has('/')).toBe(true)
    expect(expanded.has('/a')).toBe(true)
    expect(expanded.has('/a/b')).toBe(true)
    expect(expanded.has('/a/b/c')).toBe(true)
    expect(expanded.has('/a/b/c/d')).toBe(false)
  })
})
