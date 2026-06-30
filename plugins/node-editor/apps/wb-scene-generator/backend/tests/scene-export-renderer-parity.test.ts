// 💡 Shared-resolver tests for the cooker's per-cell tile resolution.
//
// The exported `graphic_index` MUST equal the sprite the RENDERER actually
// draws. After unification there is ONE implementation of that pick — the
// renderer's `pickFaceSpriteIndex` (modes/topBillboard/buildVoxelMaster/
// pickFaceSprite.ts) — and the cooker CALLS it via the vendored bundle
// `vendor/dist/renderer-resolve/...` (the SAME emitted module, no parallel
// backend re-derivation). These tests cook a scene and run that SAME shared
// resolver over the same neighbourhood, asserting the cook's index equals the
// shared resolver's — including the `edgeDist2` keyMode (6-tuple key) and the
// front-wall face. Importing from the vendored bundle (not a second frontend
// import) is deliberate: it is the exact module the export path executes, so a
// match proves "export === shared resolver" by construction.

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import { loadTileRule, setRulesDir, type TileRule } from '../src/scene-export/tileRules.js'
import type { BakedLayer } from '../src/baked/store.js'
import {
  computeValidVariantIdxs,
  pickFaceSpriteIndex,
  type CollectedCell,
  type FaceRule,
} from '../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'

function baseLayer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return { value: 1, schema: 'tile', assetName: '', cells: [], attributes: {}, ...partial }
}

/** Run the SHARED resolver (the exact module the cook uses) for the TOP face. */
function rendererTopIndex(
  rule: TileRule,
  cell: { x: number; y: number; z: number },
  coords: Set<string>,
): number {
  const cc: CollectedCell = { x: cell.x, y: cell.y, z: cell.z, layerIdx: 0 }
  return pickFaceSpriteIndex({
    face: rule.faces.top! as unknown as FaceRule,
    faceTag: 'top',
    sprites: rule.sprites,
    validVariantIdxs: [],
    cell: cc,
    coordsByLayerIdx: new Map([[0, coords]]),
    regions: new Map(),
  })
}

/** Same, for the FRONT face (billboard front-wall sprite resolution). */
function rendererFrontIndex(
  rule: TileRule,
  cell: { x: number; y: number; z: number },
  coords: Set<string>,
): number {
  const cc: CollectedCell = { x: cell.x, y: cell.y, z: cell.z, layerIdx: 0 }
  return pickFaceSpriteIndex({
    face: rule.faces.front! as unknown as FaceRule,
    faceTag: 'front',
    sprites: rule.sprites,
    validVariantIdxs: [],
    cell: cc,
    coordsByLayerIdx: new Map([[0, coords]]),
    regions: new Map(),
  })
}

describe('cookBakedScene renderer parity', () => {
  let rulesDir: string | undefined
  afterEach(() => {
    setRulesDir(undefined)
    if (rulesDir) rmSync(rulesDir, { recursive: true, force: true })
    rulesDir = undefined
  })

  function writeRule(name: string, rule: unknown): void {
    rulesDir = rulesDir ?? mkdtempSync(join(tmpdir(), 'scene-parity-'))
    writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(rule))
    setRulesDir(rulesDir)
  }

  it('honours edgeDist2 keyMode (6-tuple key) exactly like the renderer', () => {
    // A 3-row vertical strip: a true edgeDist2 rule distinguishes the head row
    // (no up neighbour), the middle row (up & down at dist 1, none at dist 2),
    // and the tail row (no down neighbour). A 4-tuple fork CANNOT tell head/mid
    // apart when both have an up & down neighbour at distance 1.
    writeRule('bridge_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // 0 head
        { x: 16, y: 0, w: 16, h: 16 },  // 1 middle
        { x: 32, y: 0, w: 16, h: 16 },  // 2 tail
      ],
      faces: {
        top: {
          basePieces: 3,
          keyMode: 'edgeDist2',
          map: {
            '0,1,0,0,0,1': 0, // head: up absent at dist 1; down present at dist 1 & 2
            '1,1,0,0,0,0': 1, // middle: up & down at dist 1, neither at dist 2
            '1,0,0,0,1,0': 2, // tail: down absent at dist 1; up present at dist 1 & 2
            '*,*,*,*,*,*': 1,
          },
        },
      },
    })

    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    ]
    const result = cookBakedScene({
      bundleId: 'b',
      sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Bridge', nodeName: 'Bridge',
        assetName: 'Bridge', assetAlias: 'bridge-sheet', assetType: 'tile',
        cells,
        attributes: { export_role: 'terrain', template_id: 'bridge' },
      })],
      aliases: [{ alias: 'bridge-sheet', tileType: 'bridge_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('bridge_test')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))

    // head=0, middle=1, tail=2 — and identical to the renderer's pickFaceSprite.
    const byY = (y: number) => result.terrain.cells['0']!.find((c) => c.y === y)!.graphic_index[0]
    expect(byY(0)).toBe(0)
    expect(byY(1)).toBe(1)
    expect(byY(2)).toBe(2)
    for (const c of cells) {
      expect(byY(c.y)).toBe(rendererTopIndex(rule, c, coords))
    }
  })

  it('matches the renderer pickFaceSprite for a 2D adjacency block', () => {
    writeRule('common_test2', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
        { x: 32, y: 0, w: 16, h: 16 },
        { x: 48, y: 0, w: 16, h: 16 },
        { x: 0, y: 16, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 5,
          map: {
            '0,0,0,0': 0,
            '0,1,0,1': 1, // top-left corner (down + right neighbours)
            '0,1,1,1': 2, // top edge
            '1,1,1,1': 3, // interior
            '*,*,*,*': 4,
          },
        },
      },
    })

    // 3x3 filled block → corners/edges/centre exercise multiple keys.
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/G', nodeName: 'G',
        assetName: 'G', assetAlias: 'g-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'g' },
      })],
      aliases: [{ alias: 'g-sheet', tileType: 'common_test2' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('common_test2')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const emitted = result.terrain.cells['0']!
    for (const c of cells) {
      const got = emitted.find((e) => e.x === c.x && e.y === c.y)!.graphic_index[0]
      expect(got).toBe(rendererTopIndex(rule, c, coords))
    }
  })

  it('resolves the FRONT-wall sprite exactly like the renderer pickFaceSprite (front face)', () => {
    // A 3-tall wall column. The front face key is (t,b,l,r) where t/b probe the
    // z-axis (voxel above/below) and l/r the x-axis. Distinct map entries per
    // vertical position let us assert the backend front pick == renderer front pick.
    writeRule('wall_front_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // top sprite
        { x: 16, y: 0, w: 16, h: 16 },  // front: bottom of column (no b)
        { x: 32, y: 0, w: 16, h: 16 },  // front: middle (t & b)
        { x: 48, y: 0, w: 16, h: 16 },  // front: top of column (no t)
      ],
      faces: {
        top: { basePieces: 4, map: { '*,*,*,*': 0 } },
        front: {
          basePieces: 4,
          // key = t,b,l,r (t/b = up/down on z, l/r = neighbours on x)
          map: {
            '1,0,0,0': 1, // has voxel above, none below → bottom of column
            '1,1,0,0': 2, // sandwiched → middle
            '0,1,0,0': 3, // none above, voxel below → top of column
            '*,*,*,*': 1,
          },
        },
      },
    })

    const cells = [
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 5, z: 1 },
      { x: 0, y: 5, z: 2 },
    ]
    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Wall', nodeName: 'Wall',
        assetName: 'Wall', assetAlias: 'wall-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'wall' },
      })],
      aliases: [{ alias: 'wall-sheet', tileType: 'wall_front_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('wall_front_test')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))

    // For each voxel, the FRONT-wall cell lives in group z at screen row y-z.
    // Identify it by a graphic_index that is NOT the top sprite (idx 0).
    for (const c of cells) {
      const group = result.terrain.cells[String(c.z)]!
      const frontRow = c.y - c.z
      const frontCells = group.filter((e) => e.x === c.x && e.y === frontRow)
      // pick the layer whose sprite differs from the flat top cap (idx 0)
      const frontGi = frontCells.flatMap((e) => e.graphic_index).find((gi) => gi !== 0)
      expect(frontGi).toBe(rendererFrontIndex(rule, c, coords))
    }
  })
})

// ── Parser parity: backend parseRule accepts every shipped rule + advanced fields ──
describe('parseRule shipped-rule parity', () => {
  afterEach(() => setRulesDir(undefined))

  it('parses every shipped rule file into a NormalizedRule with advanced fields intact', () => {
    setRulesDir(undefined) // default = apps/wb-scene-generator/assets/rules
    // bridge_vertical_15: edgeDist2 keyMode must survive parsing.
    const bridge = loadTileRule('bridge_vertical_15')
    expect(bridge).not.toBeNull()
    expect(bridge!.faces.top?.keyMode).toBe('edgeDist2')
    expect(bridge!.sprites).toHaveLength(15)

    // common_16: explicit variantIdxs + randomRules must survive.
    const common = loadTileRule('common_16')
    expect(common).not.toBeNull()
    expect(common!.faces.top?.variantIdxs).toEqual([16, 17, 18, 19])
    expect(common!.faces.top?.randomRules).toEqual([{ tileId: 6, keepProbability: 0.6 }])

    // wall_outer_16: regions + front face must survive (v2 multi-face).
    const wall = loadTileRule('wall_outer_16')
    expect(wall).not.toBeNull()
    expect(wall!.regions).toMatchObject({ scope: { source: 'parent' } })
    expect(wall!.faces.front).toBeTruthy()
  })
})

// ── Pixel-filtered variant candidates (parity with bindings.computeValidVariantIdxs) ──
describe('cookBakedScene variant pixel filtering', () => {
  let rulesDir: string | undefined
  afterEach(() => {
    setRulesDir(undefined)
    if (rulesDir) rmSync(rulesDir, { recursive: true, force: true })
    rulesDir = undefined
  })

  it('drops transparent variant slots before randomRules sampling', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-variant-'))
    // base sprite 0; variant slots 1,2,3 — but only slot 2 has visible pixels.
    // keepProbability 0 forces the randomRules branch to ALWAYS pick a variant,
    // so a single isolated cell must land on the one non-transparent slot (2).
    writeFileSync(join(rulesDir, 'variant_test.json'), JSON.stringify({
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
          basePieces: 1,
          variantIdxs: [1, 2, 3],
          randomRules: [{ tileId: 0, keepProbability: 0 }],
          map: { '*,*,*,*': 0 },
        },
      },
    }))
    setRulesDir(rulesDir)

    // 64px-wide sheet, all transparent EXCEPT the slot-2 rect (x=32..47).
    const w = 64, h = 16
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 32; x < 48; x++) {
        const i = (y * w + x) * 4
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
      }
    }
    const img = { width: w, height: h, data }

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/V', nodeName: 'V',
        assetName: 'V', assetAlias: 'v-sheet', assetType: 'tile',
        cells: [{ x: 0, y: 0, z: 0 }],
        attributes: { export_role: 'terrain', template_id: 'v' },
      })],
      aliases: [{ alias: 'v-sheet', tileType: 'variant_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      resolveRuleImage: () => img,
    })

    // Only slot 2 is visible → the single valid candidate → must be picked.
    expect(result.terrain.cells['0']![0]!.graphic_index).toEqual([2])
  })

  it('falls back to the raw variant range when no image is provided', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-variant2-'))
    writeFileSync(join(rulesDir, 'variant_test2.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
      ],
      faces: {
        top: { basePieces: 1, variantIdxs: [1], randomRules: [{ tileId: 0, keepProbability: 0 }], map: { '*,*,*,*': 0 } },
      },
    }))
    setRulesDir(rulesDir)

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/V', nodeName: 'V',
        assetName: 'V', assetAlias: 'v-sheet', assetType: 'tile',
        cells: [{ x: 0, y: 0, z: 0 }],
        attributes: { export_role: 'terrain', template_id: 'v' },
      })],
      aliases: [{ alias: 'v-sheet', tileType: 'variant_test2' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      // no resolveRuleImage → candidate range [1] used as-is
    })
    expect(result.terrain.cells['0']![0]!.graphic_index).toEqual([1])
  })

  // ── common-16 regression: the iceberg's first symptom ──────────────────
  // A real common-16 tile-group: basePieces 16, interior key 1,1,1,1 → tile 6,
  // randomRules substitutes tile 6 from variantIdxs [16,17,18,19] (the bottom
  // row at y=64). In a real sheet only SOME bottom-row slots are drawn; the rest
  // are transparent placeholders. The renderer pixel-probes the sheet and samples
  // ONLY the non-transparent slots, so it never shows a transparent block. Before
  // the fix the export had its OWN headless probe (and returned ALL four when no
  // probe ran) → it could place a transparent variant the editor never shows.
  // After unification the cook calls the renderer's shared computeValidVariantIdxs
  // on the cook's decoded pixels → identical candidate set → identical seeded pick.
  it('common-16: export samples the randomized interior slot from the renderer\'s non-transparent variant set (never a transparent placeholder)', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-common16-'))
    const sprites = [
      // 16 base pieces (4×4 grid, 16px each)
      ...Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 16, y: Math.floor(i / 4) * 16, w: 16, h: 16 })),
      // 4 variant slots on row y=64 (idx 16..19)
      { x: 0, y: 64, w: 16, h: 16 },   // 16 transparent
      { x: 16, y: 64, w: 16, h: 16 },  // 17 transparent
      { x: 32, y: 64, w: 16, h: 16 },  // 18 OPAQUE (the only real variant)
      { x: 48, y: 64, w: 16, h: 16 },  // 19 transparent
    ]
    writeFileSync(join(rulesDir, 'common16_test.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites,
      faces: {
        top: {
          basePieces: 16,
          map: { '1,1,1,1': 6, '*,*,*,*': 12 },
          // keepProbability 0 → ALWAYS substitute, so the chosen slot is fully
          // determined by the (filtered) candidate set + the cell's seeded RNG.
          randomRules: [{ tileId: 6, keepProbability: 0 }],
          variantIdxs: [16, 17, 18, 19],
        },
      },
    }))
    setRulesDir(rulesDir)

    // Sheet: everything transparent EXCEPT variant slot 18 (x=32..47, y=64..79).
    const w = 64, h = 80
    const data = new Uint8Array(w * h * 4)
    for (let y = 64; y < 80; y++) {
      for (let x = 32; x < 48; x++) {
        const i = (y * w + x) * 4
        data[i] = 0; data[i + 1] = 200; data[i + 2] = 0; data[i + 3] = 255
      }
    }
    const img = { width: w, height: h, data }

    // 3×3 filled block so the centre cell is a true interior (key 1,1,1,1 → tile 6).
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/C16', nodeName: 'C16',
        assetName: 'C16', assetAlias: 'c16-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'c16' },
      })],
      aliases: [{ alias: 'c16-sheet', tileType: 'common16_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      resolveRuleImage: () => img,
    })

    const rule = loadTileRule('common16_test')!
    const top = rule.faces.top! as unknown as FaceRule
    // The renderer's SHARED opacity filter over the cook's pixels: only slot 18.
    const validIdxs = computeValidVariantIdxs(top, rule.sprites, img)
    expect(validIdxs).toEqual([18])
    const transparentSlots = [16, 17, 19]

    const interior = { x: 1, y: 1, z: 0 }
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const emitted = result.terrain.cells['0']!
    const interiorGi = emitted.find((e) => e.x === interior.x && e.y === interior.y)!.graphic_index[0]

    // Export must pick FROM the renderer's non-transparent candidate set …
    expect(validIdxs).toContain(interiorGi)
    // … and NEVER a transparent placeholder slot.
    expect(transparentSlots).not.toContain(interiorGi)
    // … and it must equal the shared resolver's pick over that SAME set (one mechanism).
    const cc: CollectedCell = { x: interior.x, y: interior.y, z: interior.z, layerIdx: 0 }
    const resolverIdx = pickFaceSpriteIndex({
      face: top, faceTag: 'top', sprites: rule.sprites,
      validVariantIdxs: validIdxs, cell: cc,
      coordsByLayerIdx: new Map([[0, coords]]), regions: new Map(),
    })
    expect(interiorGi).toBe(resolverIdx)
  })
})
