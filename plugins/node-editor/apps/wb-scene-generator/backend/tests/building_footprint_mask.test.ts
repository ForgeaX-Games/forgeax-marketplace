import { describe, it, expect } from 'vitest'

import {
  emptyTree,
  makeScenePort,
  upsertCells,
} from '../../vendor/dist/shared/types/index.js'

import { buildingFootprintMask } from '../../batteries/scene/query/building_footprint_mask/index.js'

function makeBuildingScene(): ReturnType<typeof makeScenePort> {
  let root = emptyTree()
  root = upsertCells(
    root,
    '/bldg',
    {
      schema: 'building',
      cells: [
        { x: 1, y: 1, z: 0, token: 'wall' },
        { x: 2, y: 1, z: 0, token: 'wall' },
        { x: 3, y: 1, z: 0, token: 'wall' },
      ],
      bounds: { width: 20, height: 20 },
    },
    1,
  )
  root = upsertCells(
    root,
    '/bldg/outer_door',
    {
      schema: 'door',
      cells: [{ x: 2, y: 0, z: 0, token: 'door' }],
    },
    2,
  )
  return makeScenePort(root, '/bldg')
}

describe('building_footprint_mask', () => {
  it('extracts bbox-cropped 0/1/2 grid with door overwriting occupied', () => {
    const scene = makeBuildingScene()
    const out = buildingFootprintMask({ scene })

    expect(out.error).toBeUndefined()
    expect(out.exists).toBe(true)
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(out.originX).toBe(1)
    expect(out.originY).toBe(0)
    expect(out.grid).toEqual([
      [0, 2, 0],
      [1, 1, 1],
    ])
    expect(out.doorCount).toBe(1)
    expect(out.cellCount).toBe(4)
  })

  it('does not use node bounds canvas size', () => {
    const scene = makeBuildingScene()
    const out = buildingFootprintMask({ scene })
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
  })

  it('filters by z when provided', () => {
    let root = emptyTree()
    root = upsertCells(
      root,
      '/bldg',
      {
        schema: 'building',
        cells: [
          { x: 0, y: 0, z: 0, token: 'floor' },
          { x: 1, y: 0, z: 1, token: 'wall' },
        ],
      },
      1,
    )
    const scene = makeScenePort(root, '/bldg')

    const allZ = buildingFootprintMask({ scene })
    expect(allZ.grid).toEqual([[1, 1]])

    const z0 = buildingFootprintMask({ scene, z: 0 })
    expect(z0.grid).toEqual([[1]])

    const z1 = buildingFootprintMask({ scene, z: 1 })
    expect(z1.grid).toEqual([[1]])
  })

  it('returns empty when focus subtree has no voxels', () => {
    const root = emptyTree()
    const scene = makeScenePort(root, '/')
    const out = buildingFootprintMask({ scene })
    expect(out.exists).toBe(false)
    expect(out.grid).toEqual([])
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })

  it('supports custom door child names', () => {
    let root = emptyTree()
    root = upsertCells(root, '/bldg', {
      schema: 'building',
      cells: [{ x: 0, y: 0, z: 0, token: 'wall' }],
    }, 1)
    root = upsertCells(root, '/bldg/entry', {
      schema: 'door',
      cells: [{ x: 1, y: 0, z: 0, token: 'door' }],
    }, 2)
    const scene = makeScenePort(root, '/bldg')
    const out = buildingFootprintMask({ scene, doorNames: 'entry' })
    expect(out.grid).toEqual([
      [1, 2],
    ])
  })
})
