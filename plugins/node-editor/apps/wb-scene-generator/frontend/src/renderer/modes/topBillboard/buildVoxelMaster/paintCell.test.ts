import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VoxelBbox } from '../../../framework/geometry/topBillboard'
import { getRegisteredAssetUrl, setServerImageResolver } from '../../../framework/asset/imageCache'
import type { CollectedCell, LayerAssetBinding } from './types'
import { objectSpriteGridRect, paintCell } from './paintCell'

type Op =
  | { type: 'drawImage'; args: unknown[] }
  | { type: 'fillRect'; args: number[] }
  | { type: 'strokeRect'; args: number[] }
  | { type: 'save' }
  | { type: 'restore' }

function makeCtx(ops: Op[]): CanvasRenderingContext2D {
  return {
    drawImage: (...args: unknown[]) => { ops.push({ type: 'drawImage', args }) },
    fillRect: (...args: number[]) => { ops.push({ type: 'fillRect', args }) },
    strokeRect: (...args: number[]) => { ops.push({ type: 'strokeRect', args }) },
    save: () => { ops.push({ type: 'save' }) },
    restore: () => { ops.push({ type: 'restore' }) },
  } as unknown as CanvasRenderingContext2D
}

function makeCell(isSelected: boolean): CollectedCell {
  return {
    x: 0,
    y: 0,
    z: 0,
    value: 1,
    layerIdx: 0,
    isSelected,
    isEditorSelected: false,
    isMultiValue: false,
  }
}

function makeBinding(): LayerAssetBinding {
  return {
    match: {
      primary: 'grass',
      variants: ['grass'],
      tileType: 'tilemap',
      ppu: 4,
    },
    rule: null,
    imgUrl: getRegisteredAssetUrl('grass'),
    validVariantIdxs: { top: [], front: [] },
    regions: new Map(),
  }
}

const bbox: VoxelBbox = {
  cols: 1,
  rows: 2,
  worldOffsetX: 0,
  worldOffsetY: -1,
}

describe('topBillboard paintCell asset selection highlight', () => {
  beforeEach(() => {
    setServerImageResolver(() => ({ width: 8, height: 8, naturalWidth: 8, naturalHeight: 8 }))
  })

  afterEach(() => {
    setServerImageResolver(null)
  })

  it('draws a subtle highlight on selected asset cells without replacing the texture', () => {
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(true), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    const fillOps = ops.filter((op) => op.type === 'fillRect')
    const strokeOps = ops.filter((op) => op.type === 'strokeRect')

    expect(drawOps).toHaveLength(2)
    expect(fillOps).toHaveLength(2)
    expect(strokeOps).toHaveLength(2)
    expect(ops.findIndex((op) => op.type === 'fillRect')).toBeGreaterThan(
      ops.findIndex((op) => op.type === 'drawImage'),
    )
  })

  it('does not draw asset highlight strokes for unselected cells', () => {
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    expect(ops.filter((op) => op.type === 'drawImage')).toHaveLength(2)
    expect(ops.some((op) => op.type === 'strokeRect')).toBe(false)
  })

  it('draws object sprites at image pixels divided by global PPU', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const binding = makeBinding()
    binding.match.tileType = undefined
    binding.match.ppu = 4
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(1)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 24])
  })

  it('aligns asymmetric object sprite anchors to the selected cell center', () => {
    const rect = objectSpriteGridRect(
      { ...makeCell(false), x: 10, y: 20 },
      { width: 64, height: 64, naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement,
      { x: 0.75, y: 0.5 },
    )

    expect(rect).toMatchObject({
      x: 7.5,
      y: 18.5,
      w: 4,
      h: 4,
    })
  })

  it('draws tile fallback images at source pixels divided by global PPU', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(2)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 24])
    expect(drawOps[1].args.slice(-2)).toEqual([16, 24])
  })

  it('draws rule sprites at sprite pixels divided by global PPU', () => {
    const ops: Op[] = []
    const binding = makeBinding()
    binding.rule = {
      schemaVersion: 2,
      ppu: 32,
      sprites: [{ x: 0, y: 0, w: 32, h: 16 }],
      faces: { top: { basePieces: 1, map: { '0,0,0,0': 0 } } },
    }
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(1)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 8])
  })

  it('uses subtle selected highlight over the true PPU-sized asset bounds', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const binding = makeBinding()
    binding.match.tileType = undefined
    binding.match.ppu = 4
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(true), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const fillOps = ops.filter((op) => op.type === 'fillRect')
    const strokeOps = ops.filter((op) => op.type === 'strokeRect')
    expect(fillOps).toHaveLength(1)
    expect(fillOps[0].args.slice(-2)).toEqual([16, 24])
    expect(strokeOps).toHaveLength(1)
    expect(strokeOps[0].args.slice(-2)).toEqual([15, 23])
  })
})
