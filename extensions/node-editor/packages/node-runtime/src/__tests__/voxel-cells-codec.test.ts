import { describe, expect, it } from 'vitest'

import {
  compressPayload,
  compressVoxelCells,
  expandPayload,
  expandVoxelCells,
  type VoxelCellsCompactV1,
} from '../layer1/storage/voxel-cells-codec.js'

const sampleCells = [
  { x: 0, y: 0, z: 0, token: 'ground' },
  { x: 1, y: 0, z: 0, token: 'wall' },
  { x: 2, y: 0, z: 1, token: 'wall' },
] as const

describe('voxel-cells-codec', () => {
  it('round-trips a cell array through compact encoding', () => {
    const compact = compressVoxelCells(sampleCells)
    expect(compact).toMatchObject({ __voxelCells: 1, t: ['ground', 'wall'] })
    expect((compact as VoxelCellsCompactV1).d).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 2, 0, 1, 1])
    expect(expandVoxelCells(compact)).toEqual(sampleCells)
  })

  it('preserves optional cell state', () => {
    const cells = [
      { x: 0, y: 0, z: 0, token: 'obj', state: { instanceId: 'a' } },
      { x: 1, y: 0, z: 0, token: 'obj' },
    ]
    const compact = compressVoxelCells(cells)
    expect(expandVoxelCells(compact)).toEqual(cells)
  })

  it('passes through legacy uncompressed cell arrays', () => {
    expect(expandVoxelCells(sampleCells)).toEqual(sampleCells)
  })

  it('compresses cells inside a scene tree without changing other fields', () => {
    const scene = {
      tree: {
        name: '',
        path: '/',
        version: 1,
        children: [
          {
            name: 'Layer',
            path: '/Layer',
            version: 2,
            schema: 'layer',
            cells: sampleCells,
            children: [],
          },
        ],
      },
      focus: '/Layer',
    }
    const compressed = compressPayload(scene) as typeof scene
    const layer = compressed.tree.children[0] as { cells: VoxelCellsCompactV1 }
    expect(layer.cells.__voxelCells).toBe(1)
    expect(expandPayload(compressed)).toEqual(scene)
  })

  it('shrinks serialized size versus verbose {x,y,z,token} objects', () => {
    const cells = Array.from({ length: 5000 }, (_, i) => ({
      x: i % 100,
      y: (i * 3) % 80,
      z: i % 12,
      token: i % 5 === 0 ? 'ground' : 'wall',
    }))
    const verbose = JSON.stringify(cells)
    const compact = JSON.stringify(compressVoxelCells(cells))
    expect(compact.length).toBeLessThan(verbose.length * 0.45)
  })
})
