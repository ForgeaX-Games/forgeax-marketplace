import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import { setRulesDir } from '../src/scene-export/tileRules.js'
import type { BakedLayer } from '../src/baked/store.js'

function baseLayer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return {
    value: 1,
    schema: 'tile',
    assetName: '',
    cells: [],
    attributes: {},
    ...partial,
  }
}

describe('cookBakedScene', () => {
  it('projects terrain cells into reference terrain and config payloads', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Ground',
          nodeName: 'Ground',
          value: 1,
          schema: 'tile',
          assetName: 'Grass',
          assetAlias: 'grass-alias',
          assetType: 'tile',
          cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
          attributes: {
            asset_name: 'Grass',
            asset_alias: 'grass-alias',
            asset_type: 'tile',
            export_role: 'terrain',
            template_id: 'grass',
            terrain_type: 'base',
            region: 'default',
            area_L0: 'Demo',
            area_L1: 'Meadow',
          },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    expect(result.terrain).toMatchObject({
      version: '2.0',
      cols: 2,
      rows: 1,
    })
    expect(result.terrain.cells['0']).toHaveLength(2)
    expect(result.terrain.cells['0']![0]).toMatchObject({
      x: 0,
      y: 0,
      height: 0,
      template_id: ['grass'],
      areaTags: { area_L0: ['Demo'], area_L1: ['Meadow'] },
    })
    expect(result.terrainConfig.templates.grass).toMatchObject({
      terrain_type: 'base',
      region: 'default',
    })
    expect(result.terrainConfig.schemaVersion).toBe('3.0')
    expect(result.terrainConfig.templates.grass!.graphic_id).toHaveLength(1)
    expect(result.terrain.cells['0']![0]!.graphic_index).toEqual([0])
  })

  it('records every painted layer on a shared cell in draw order', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Ground',
          nodeName: 'Ground',
          assetName: 'Grass',
          assetType: 'tile',
          cells: [{ x: 2, y: 2, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'grass' },
        }),
        baseLayer({
          nodePath: '/World/Wall',
          nodeName: 'Wall',
          assetName: 'Wall',
          assetType: 'tile',
          cells: [{ x: 2, y: 2, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'wall' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // BILLBOARD: a z=0 voxel's (only) top cap projects to screen row y-z-1 = 1.
    // Both layers share that screen cell, recorded bottom→top (paint order).
    const cell = result.terrain.cells['0']!.find((c) => c.x === 2 && c.y === 1)!
    expect(cell.template_id).toEqual(['grass', 'wall'])
    expect(cell.graphic_index).toEqual([0, 0])
  })

  it('emits one object for a grouped instance using its anchor cell', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Tree',
          nodeName: 'Tree',
          assetName: 'Tree',
          assetAlias: 'tree-alias',
          assetType: 'object',
          cells: [
            { x: 4, y: 5, z: 1, state: { instanceId: 'tree-1', role: 'column' } },
            { x: 3, y: 5, z: 0, state: { instanceId: 'tree-1', role: 'anchor' } },
          ],
          attributes: {
            export_role: 'object',
            object_type_id: 'oak',
          },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // The object now rides the terrain stack (ppu===16 sprite) so higher terrain
    // can occlude it; it is NOT emitted through objects[]. The anchor pick still
    // mirrors the renderer: anchor (x=3,y=5,z=0) → terrain cell (x=3, screenRow=5,
    // elevation/height=0).
    expect(result.terrain.objects).toEqual([])
    const oakCells = Object.values(result.terrain.cells).flat()
      .filter((c) => c.template_id.some((t) => t.startsWith('obj__')))
    expect(oakCells).toHaveLength(1)
    expect(oakCells[0]).toMatchObject({ x: 3, y: 5, height: 0 })
  })

  it('chooses the anchor of an unmarked group like the renderer (min z, then FRONT row)', () => {
    // No cell carries role:'anchor', so the cook must mirror the renderer's
    // chooseObjectAnchor: columnDz/z ASC, then footprintDy/y DESC (front-most
    // row), then x ASC. A z=0 group spanning y∈{5,7} must anchor on y=7 (front),
    // projecting the object to the same screen row (y-z=7) the renderer draws.
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Hut',
          nodeName: 'Hut',
          assetName: 'Hut',
          assetAlias: 'hut-alias',
          assetType: 'object',
          cells: [
            { x: 4, y: 5, z: 1, state: { instanceId: 'hut-1' } },
            { x: 4, y: 5, z: 0, state: { instanceId: 'hut-1' } },
            { x: 4, y: 7, z: 0, state: { instanceId: 'hut-1' } },
          ],
          attributes: { export_role: 'object', object_type_id: 'hut' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // Anchor = (x=4, y=7, z=0) → terrain cell (x=4, screenRow=7-0=7, height=0). A
    // naive z,y,x-all-ASC pick would have chosen y=5 and misplaced it two rows back.
    // The object rides the terrain stack now, so it is not in objects[].
    expect(result.terrain.objects).toEqual([])
    const hutCells = Object.values(result.terrain.cells).flat()
      .filter((c) => c.template_id.some((t) => t.startsWith('obj__')))
    expect(hutCells).toHaveLength(1)
    expect(hutCells[0]).toMatchObject({ x: 4, y: 7, height: 0 })
  })

  it('emits legacy object cells as separate object instances', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Rocks',
          nodeName: 'Rocks',
          assetName: 'Rock',
          assetType: 'object',
          cells: [{ x: 1, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    expect(result.terrain.objects).toMatchObject([
      { instanceId: '/World/Rocks:1,2,0', typeId: 'rock', x: 1, y: 2, height: 0 },
      { instanceId: '/World/Rocks:2,2,0', typeId: 'rock', x: 2, y: 2, height: 0 },
    ])
  })

  // ── Object↔terrain occlusion via terrain-stack encoding ───────────────────
  // The shipped viewer paints the per-cell terrain stack ELEVATION-ASCENDING then
  // all objects[] strictly last, so objects[] can never be occluded by terrain.
  // To let higher walls occlude an object (the ambulance-in-pocket, IMAGE 2), a
  // resolvable ppu=16 object is emitted as a whole-sheet TERRAIN tile on its anchor
  // cell at its footprint elevation: a wall voxel at a higher elevation paints in a
  // later group and overdraws it — pure cook data, no viewer change.
  it('emits a resolvable object into the terrain stack at its elevation so higher terrain occludes it', () => {
    const result = cookBakedScene({
      bundleId: 'occ',
      sceneName: 'Occlusion',
      layers: [
        // A wall column rising to z=2 directly in front of the object.
        baseLayer({
          nodePath: '/World/Wall', nodeName: 'Wall', assetName: 'Wall', assetAlias: 'wall-alias', assetType: 'tile',
          cells: [
            { x: 5, y: 6, z: 0 }, { x: 5, y: 6, z: 1 }, { x: 5, y: 6, z: 2 },
          ],
          attributes: { export_role: 'terrain', template_id: 'wall', terrain_type: 'base' },
        }),
        // A multi-voxel object seated at z=1 behind the wall.
        baseLayer({
          nodePath: '/World/Ambulance', nodeName: 'Ambulance', assetName: 'Ambulance', assetAlias: 'amb-alias', assetType: 'object',
          cells: [
            { x: 5, y: 5, z: 1, state: { instanceId: 'amb-1', role: 'anchor' } },
            { x: 6, y: 5, z: 1, state: { instanceId: 'amb-1', role: 'column' } },
          ],
          attributes: { export_role: 'object', object_type_id: 'ambulance' },
        }),
      ],
      aliases: [
        { alias: 'amb-alias', anchorX: 0.5, anchorY: 0.3, widthPx: 65, heightPx: 48, ppu: 16 },
      ],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // Object rode the terrain stack — NOT objects[].
    expect(result.terrain.objects).toEqual([])
    // A carrier template was registered + atlas tile emitted into the TERRAIN atlas.
    const objTemplateId = Object.keys(result.terrainConfig.templates).find((t) => t.startsWith('obj__'))
    expect(objTemplateId).toBeDefined()
    expect(result.terrainAtlasInputs.some((i) => i.role === 'terrain' && i.alias === 'amb-alias')).toBe(true)

    // The object slice landed in the terrain stack at the object's elevation (z=1),
    // on its anchor cell (anchor (5,5,1) → screenRow 5-1=4, height group 1).
    const cellsByElev = result.terrain.cells
    const objCell = (cellsByElev['1'] ?? []).find((c) => c.template_id.includes(objTemplateId!))
    expect(objCell).toBeDefined()
    expect(objCell).toMatchObject({ height: 1 })

    // Occlusion: a higher wall voxel exists at elevation 2 (a later paint group),
    // so the unmodified viewer's elevation-ascending paint draws it OVER the object.
    const hasHigherTerrain = Object.entries(cellsByElev)
      .some(([elev, cells]) => Number(elev) > 1 && cells.some((c) => c.template_id.some((t) => !t.startsWith('obj__'))))
    expect(hasHigherTerrain).toBe(true)
  })

  // ── Object↔object occlusion (draw order) ──────────────────────────────────
  // The shipped viewer paints objects in terrain.json.objects[] ARRAY ORDER, on
  // top of all terrain. The renderer interleaves objects by the SHARED billboard
  // painter key compareBillboardDrawOrder using footprint depth (max cell y) and
  // column top (max cell z). The cook must emit objects in THAT painter order so
  // the viewer's array-order paint reproduces the editor's object stacking.
  it('emits objects in renderer painter order (deeper footprint row drawn later)', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Rocks',
          nodeName: 'Rocks',
          assetName: 'Rock',
          assetType: 'object',
          // Cell iteration deliberately lists the FAR (small y) cell first, then
          // the NEAR (large y) cell. Painter order must put the near (y=9) object
          // AFTER the far (y=3) object so it paints over it.
          cells: [{ x: 5, y: 3, z: 0 }, { x: 5, y: 9, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(result.terrain.objects.map((o) => o.instanceId)).toEqual([
      '/World/Rocks:5,3,0',
      '/World/Rocks:5,9,0',
    ])
  })

  it('orders a grouped object by its FOOTPRINT DEPTH (max cell y), not its anchor y', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Objs',
          nodeName: 'Objs',
          assetName: 'Obj',
          assetType: 'object',
          cells: [
            // A single rock at row y=7.
            { x: 2, y: 7, z: 0 },
            // A 2-tall building whose ANCHOR is at y=5 but whose footprint reaches
            // y=8 (a deeper column cell). Footprint depth 8 > 7 ⇒ it must draw
            // AFTER the rock even though its anchor row (5) is shallower.
            { x: 4, y: 5, z: 0, state: { instanceId: 'bld-1', role: 'anchor' } },
            { x: 4, y: 8, z: 0, state: { instanceId: 'bld-1', role: 'column' } },
          ],
          attributes: { export_role: 'object', object_type_id: 'thing' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    const ids = result.terrain.objects.map((o) => o.instanceId)
    expect(ids).toEqual(['/World/Objs:2,7,0', 'bld-1'])
    // The building still anchors at its anchor cell (x=4, y-z=5), unaffected by
    // the ordering key.
    expect(result.terrain.objects.find((o) => o.instanceId === 'bld-1')).toMatchObject({ x: 4, y: 5, height: 0 })
  })

  it('interleaves objects ACROSS layers by painter order, not layer iteration order', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        // Layer A (renderer layerIdx 0) holds a NEAR object (y=9).
        baseLayer({
          nodePath: '/World/A',
          nodeName: 'A',
          assetName: 'Rock',
          assetType: 'object',
          cells: [{ x: 1, y: 9, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
        // Layer B (renderer layerIdx 1) holds a FAR object (y=2).
        baseLayer({
          nodePath: '/World/B',
          nodeName: 'B',
          assetName: 'Rock',
          assetType: 'object',
          cells: [{ x: 1, y: 2, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    // Painter order sorts by footprint depth first: B's far object (y=2) draws
    // before A's near object (y=9), regardless of layer order.
    expect(result.terrain.objects.map((o) => o.instanceId)).toEqual([
      '/World/B:1,2,0',
      '/World/A:1,9,0',
    ])
  })

  it('breaks an exact painter-key tie by renderer layer index then collection order', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        // Same (y,z) for both layers ⇒ tie broken by renderer layerIdx (0 before 1).
        baseLayer({
          nodePath: '/World/Lo',
          nodeName: 'Lo',
          assetName: 'Rock',
          assetType: 'object',
          cells: [{ x: 1, y: 4, z: 0 }, { x: 2, y: 4, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
        baseLayer({
          nodePath: '/World/Hi',
          nodeName: 'Hi',
          assetName: 'Rock',
          assetType: 'object',
          cells: [{ x: 3, y: 4, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'rock' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(result.terrain.objects.map((o) => o.instanceId)).toEqual([
      // layerIdx 0, collection order within layer (x=1 cell then x=2 cell)
      '/World/Lo:1,4,0',
      '/World/Lo:2,4,0',
      // layerIdx 1 last
      '/World/Hi:3,4,0',
    ])
  })

  // ── Defect #2: global offset (negative coordinates) ───────────────────────
  it('translates negative cell/object coordinates into a positive in-bounds grid', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Ground',
          nodeName: 'Ground',
          assetName: 'Grass',
          assetType: 'tile',
          // min cell at (-9, -23); max terrain cell at (3, -23)
          cells: [{ x: -9, y: -23, z: 0 }, { x: 3, y: -23, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'grass' },
        }),
        baseLayer({
          nodePath: '/World/Tree',
          nodeName: 'Tree',
          assetName: 'Tree',
          assetType: 'object',
          // object even further left/up than terrain
          cells: [{ x: -10, y: -25, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'oak' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // Every cell + object must be non-negative and within cols/rows.
    const allCells = Object.values(result.terrain.cells).flat()
    const xs = [...allCells.map((c) => c.x), ...result.terrain.objects.map((o) => o.x)]
    const ys = [...allCells.map((c) => c.y), ...result.terrain.objects.map((o) => o.y)]
    expect(Math.min(...xs)).toBe(0)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...xs)).toBeLessThan(result.terrain.cols)
    expect(Math.max(...ys)).toBeLessThan(result.terrain.rows)
    // offset = (+10, +25). BILLBOARD: terrain z=0 top caps project to row y-1
    // (−24), object anchors to row y−z (−25). After offset: object (−10,−25) →
    // (0,0); terrain (−9,−24) → (1,1).
    expect(result.terrain.objects[0]).toMatchObject({ x: 0, y: 0 })
    const terrainCell = allCells.find((c) => c.x === 1)!
    expect(terrainCell).toMatchObject({ x: 1, y: 1 })
    expect(result.terrain.cols).toBe(14) // x range [-10..3] → width 14
    expect(result.terrain.rows).toBe(2) // projected y range [-25..-24] → height 2
  })
})

// ── Defect #3: tile-group slicing + autotile graphic_index ──────────────────
describe('cookBakedScene tile-group slicing', () => {
  let rulesDir: string

  afterEach(() => setRulesDir(undefined))

  function withRule(): void {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-rules-'))
    // Minimal 4-sprite common rule: distinct sprite per occupancy pattern.
    const rule = {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
        { x: 32, y: 0, w: 16, h: 16 },
        { x: 48, y: 0, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 4,
          // key = up,down,left,right occupancy
          map: { '0,0,0,0': 0, '0,0,0,1': 1, '0,0,1,0': 2, '0,0,1,1': 3, '*,*,*,*': 0 },
        },
      },
    }
    writeFileSync(join(rulesDir, 'common_test.json'), JSON.stringify(rule))
    setRulesDir(rulesDir)
  }

  it('slices a tile-group sheet into per-sub-tile atlas inputs and picks graphic_index by neighbours', () => {
    withRule()
    try {
      const result = cookBakedScene({
        bundleId: 'demo-bundle',
        sceneName: 'Demo Scene',
        layers: [
          baseLayer({
            nodePath: '/World/Ground',
            nodeName: 'Ground',
            assetName: 'Grass',
            assetAlias: 'grass-sheet',
            assetType: 'tile',
            // a horizontal pair: left cell has a right-neighbour, right cell a left-neighbour
            cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
            attributes: { export_role: 'terrain', template_id: 'grass' },
          }),
        ],
        aliases: [{ alias: 'grass-sheet', tileType: 'common_test' }],
        generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      })

      // graphic_id is the full sliced set (4 sub-tiles), each its own atlas id.
      const gid = result.terrainConfig.templates.grass!.graphic_id
      expect(gid).toHaveLength(4)

      // Atlas inputs carry per-sprite source sub-rects (slicing, not whole sheet).
      const terrainInputs = result.terrainAtlasInputs.filter((i) => gid.includes(i.id))
      expect(terrainInputs).toHaveLength(4)
      expect(terrainInputs.every((i) => i.srcRect)).toBe(true)
      expect(terrainInputs.map((i) => i.srcRect!.x).sort((a, b) => a - b)).toEqual([0, 16, 32, 48])

      // Cells reference the correct sub-tile (NOT all index 0): the left cell
      // has a right neighbour → key 0,0,0,1 → sprite 1; right cell key 0,0,1,0 → 2.
      const cells = result.terrain.cells['0']!
      const left = cells.find((c) => c.x === 0)!
      const right = cells.find((c) => c.x === 1)!
      expect(left.graphic_index).toEqual([1])
      expect(right.graphic_index).toEqual([2])
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
    }
  })
})

// ── BILLBOARD projection: top cap (y-z-1) + front wall (y-z), z-occlusion ────
describe('cookBakedScene billboard projection', () => {
  let rulesDir: string
  afterEach(() => setRulesDir(undefined))

  // Wall rule with BOTH faces. top.map/front.map both static (single key) so the
  // test isolates geometry/face recording from autotile neighbour logic.
  function withWallRule(): void {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-bb-rules-'))
    const rule = {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // 0: top sprite
        { x: 16, y: 0, w: 16, h: 16 },  // 1: front sprite
      ],
      faces: {
        top: { basePieces: 2, map: { '*,*,*,*': 0 } },
        front: { basePieces: 2, map: { '*,*,*,*': 1 } },
      },
    }
    writeFileSync(join(rulesDir, 'wall_test.json'), JSON.stringify(rule))
    setRulesDir(rulesDir)
  }

  it('projects a z>0 voxel to a top cap at y-z-1 and a front wall at y-z', () => {
    withWallRule()
    try {
      const result = cookBakedScene({
        bundleId: 'demo-bundle',
        sceneName: 'Demo Scene',
        layers: [
          baseLayer({
            nodePath: '/World/Wall',
            nodeName: 'Wall',
            assetName: 'Wall',
            assetAlias: 'wall-sheet',
            assetType: 'tile',
            cells: [{ x: 5, y: 10, z: 2 }],
            attributes: { export_role: 'terrain', template_id: 'wall' },
          }),
        ],
        aliases: [{ alias: 'wall-sheet', tileType: 'wall_test' }],
        generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      })

      // The voxel groups under its elevation z=2 (terrain.json group key).
      const group = result.terrain.cells['2']!
      // All content here is at positive screen rows, so no offset is applied.
      // top cap at world row y-z-1 = 7; front wall at world row y-z = 8.
      const cap = group.find((c) => c.graphic_index[0] === 0)!
      const wall = group.find((c) => c.graphic_index[0] === 1)!
      expect(cap).toMatchObject({ x: 5, y: 7, height: 2 })   // top cap row y-z-1
      expect(wall).toMatchObject({ x: 5, y: 8, height: 2 })  // front wall row y-z
      // Distinct sprites: cap uses top sprite (idx 0), wall uses front (idx 1).
      expect(cap.graphic_index).toEqual([0])
      expect(wall.graphic_index).toEqual([1])
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
    }
  })

  it('stacks a wall column so each voxel front overpaints the lower top (z-ascending groups)', () => {
    withWallRule()
    try {
      const result = cookBakedScene({
        bundleId: 'demo-bundle',
        sceneName: 'Demo Scene',
        layers: [
          baseLayer({
            nodePath: '/World/Wall',
            nodeName: 'Wall',
            assetName: 'Wall',
            assetAlias: 'wall-sheet',
            assetType: 'tile',
            // a 3-tall column at (4, 10): z = 0,1,2
            cells: [
              { x: 4, y: 10, z: 0 },
              { x: 4, y: 10, z: 1 },
              { x: 4, y: 10, z: 2 },
            ],
            attributes: { export_role: 'terrain', template_id: 'wall' },
          }),
        ],
        aliases: [{ alias: 'wall-sheet', tileType: 'wall_test' }],
        generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      })

      // Groups exist for each elevation; the viewer draws them z-ascending so
      // higher-z front walls overpaint lower-z top caps at the same screen row.
      expect(Object.keys(result.terrain.cells).sort()).toEqual(['0', '1', '2'])
      // Screen rows (pre-offset): z0 cap@9 front@10; z1 cap@8 front@9; z2 cap@7
      // front@8. A z+1 front shares a screen row with the z top below it (e.g.
      // z1 front@9 == z0 cap@9). Those are SEPARATE group entries (z0 vs z1) so
      // the z-ascending group draw order yields the wall over the cap.
      const allRows = Object.entries(result.terrain.cells).flatMap(([h, list]) =>
        list.map((c) => ({ h: Number(h), y: c.y, gi: c.graphic_index[0] })),
      )
      // Every voxel contributes one cap (gi 0) and one front (gi 1).
      expect(allRows.filter((r) => r.gi === 0)).toHaveLength(3)
      expect(allRows.filter((r) => r.gi === 1)).toHaveLength(3)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
    }
  })

  it('does not emit a front wall for a ground-only rule (no faces.front)', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-ground-rules-'))
    const rule = {
      schemaVersion: 2,
      ppu: 16,
      sprites: [{ x: 0, y: 0, w: 16, h: 16 }],
      faces: { top: { basePieces: 1, map: { '*,*,*,*': 0 } } },
    }
    writeFileSync(join(rulesDir, 'ground_test.json'), JSON.stringify(rule))
    setRulesDir(rulesDir)
    try {
      const result = cookBakedScene({
        bundleId: 'demo-bundle',
        sceneName: 'Demo Scene',
        layers: [
          baseLayer({
            nodePath: '/World/Ground',
            nodeName: 'Ground',
            assetName: 'Grass',
            assetAlias: 'grass-sheet',
            assetType: 'tile',
            cells: [{ x: 0, y: 0, z: 1 }],
            attributes: { export_role: 'terrain', template_id: 'grass' },
          }),
        ],
        aliases: [{ alias: 'grass-sheet', tileType: 'ground_test' }],
        generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      })
      // Exactly one cell (the top cap); no front wall row.
      const all = Object.values(result.terrain.cells).flat()
      expect(all).toHaveLength(1)
      expect(all[0]!.height).toBe(1)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
    }
  })
})

// ── Defect #1: content presence (name-based alias resolution) ───────────────
describe('cookBakedScene content resolution', () => {
  it('resolves an aliasless tile layer to a library asset by name so it is not dropped', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        baseLayer({
          nodePath: '/World/Floor',
          nodeName: 'Floor',
          assetName: '地板',
          assetAlias: undefined,
          assetType: 'tile',
          cells: [{ x: 0, y: 0, z: 0 }],
          attributes: { export_role: 'terrain', template_id: '地板' },
        }),
      ],
      // non-cutout alias whose 5th bracket field (index 4) matches the name.
      aliases: [{ alias: '[a]_[b]_[c]_[d]_[地板]_[f]_[g]_[h]_[i]_[16]' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    // The template's atlas tile must reference the resolved alias (so the atlas
    // builder fetches real pixels) rather than emitting a contentless tile.
    const gid = result.terrainConfig.templates['地板']!.graphic_id
    const input = result.terrainAtlasInputs.find((i) => i.id === gid[0])!
    expect(input.alias).toBe('[a]_[b]_[c]_[d]_[地板]_[f]_[g]_[h]_[i]_[16]')
  })

  // ── Defect #1 (real-pipeline root cause): renderer-faithful skip gate ────────
  // The editor's billboard bake draws a layer ONLY when matchAssetEntry resolves
  // it to a library sheet — an unmatched name-only layer is INVISIBLE in the
  // editor. The cook used to emit such layers as blank index-0 placeholder tiles,
  // which the bundled viewer then painted as phantom terrain/objects (the
  // "occlusion / extra stitching" the real export showed but the editor never
  // did). The cook must now SKIP a name-only layer whose asset doesn't resolve,
  // while still honouring an EXPLICIT export_role / object_type_id contract.
  it('skips an unmatched name-only layer (renderer draws nothing) but keeps matched + explicit-role layers', () => {
    const result = cookBakedScene({
      bundleId: 'demo-bundle',
      sceneName: 'Demo Scene',
      layers: [
        // (a) matched by name → kept (renderer would draw it).
        baseLayer({
          nodePath: '/World/Floor',
          nodeName: 'Floor',
          assetName: '地板',
          assetType: 'tile',
          cells: [{ x: 0, y: 0, z: 0 }],
        }),
        // (b) name-only, NO library match, NO explicit role → renderer skips →
        //     cook must skip too (was the phantom-occlusion source).
        baseLayer({
          nodePath: '/World/Phantom',
          nodeName: 'Phantom',
          assetName: '不存在的资产',
          assetType: 'tile',
          cells: [{ x: 5, y: 5, z: 0 }],
        }),
        // (c) unmatched but EXPLICIT export_role → intentional contract → kept.
        baseLayer({
          nodePath: '/World/Tagged',
          nodeName: 'Tagged',
          assetName: '也不存在',
          assetType: 'tile',
          cells: [{ x: 9, y: 9, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'tagged' },
        }),
      ],
      aliases: [{ alias: '[a]_[b]_[c]_[d]_[地板]_[f]_[g]_[h]_[i]_[16]' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const all = Object.values(result.terrain.cells).flat()
    const templates = new Set(all.flatMap((c) => c.template_id))
    // matched (地板) + explicit-role (tagged) present; phantom dropped.
    expect(templates.has('tagged')).toBe(true)
    expect([...templates].some((t) => t.includes('地板') || t === '地板')).toBe(true)
    expect([...templates].some((t) => t.includes('不存在'))).toBe(false)
    // The phantom cell at (5,5) must not appear in ANY screen cell.
    expect(all.some((c) => c.x === 5)).toBe(false)
  })
})
