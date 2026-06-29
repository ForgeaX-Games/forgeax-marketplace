import type { BakedCell, BakedLayer } from '../baked/store.js'
import type { AliasMeta } from '../library/service.js'
import { resolveLayerAlias } from './assetMatch.js'
import { orderBakedLayersForExport } from './layerOrder.js'
import { computeValidFrontVariantIdxs, computeValidTopVariantIdxs, loadTileRule, pickFrontSpriteIndex, pickTopSpriteIndex, resolveRuleRegions, type TileRule } from './tileRules.js'
import {
  compareBillboardDrawOrder,
  buildTopFaceKey,
  type BillboardFaceOrder,
} from '../../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'
import type {
  CookBakedSceneInput,
  CookedScene,
  ObjectTypeConfig,
  PassabilityConfigJson,
  SceneAtlasInput,
  TerrainCellExport,
  TerrainObjectExport,
  TerrainTemplateConfig,
} from './types.js'

type ExportRole = 'terrain' | 'object' | 'metadata'

function stringAttr(attrs: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = attrs[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numberAttr(attrs: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = attrs[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolAttr(attrs: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = attrs[key]
  return typeof value === 'boolean' ? value : fallback
}

function slug(value: string): string {
  return value.trim().replace(/\s+/g, '_') || 'unnamed'
}

/**
 * scene tree path → direct parent path, MIRRORING the renderer's
 * collect.ts:parentOfNodePath so the cook groups region "parent" scopes over the
 * SAME layer set the editor binding does (else region-gated wall variants diverge).
 *   "/world/houseA/walls" → "/world/houseA"   "/walls" → "/"   "/" / undefined → ""
 */
function parentOfNodePath(nodePath: string | undefined): string {
  if (!nodePath) return ''
  const segs = nodePath.split('/').filter(s => s.length > 0)
  if (segs.length <= 1) return segs.length === 1 ? '/' : ''
  return '/' + segs.slice(0, -1).join('/')
}

function aliasFor(layer: BakedLayer, aliases: readonly AliasMeta[]): AliasMeta | undefined {
  return resolveLayerAlias(
    { assetName: layer.assetName, assetAlias: layer.assetAlias, assetType: layer.assetType },
    aliases,
  )
}

export function layerExportRole(layer: BakedLayer, aliases: readonly AliasMeta[] = []): ExportRole {
  const explicit = stringAttr(layer.attributes, 'export_role')
  if (explicit === 'terrain' || explicit === 'object') return explicit
  if (layer.cells.length === 0) return 'metadata'
  const assetType = (layer.assetType ?? '').toLowerCase()
  if (assetType === 'tile') return 'terrain'
  if (assetType === 'object' || assetType === 'asset') return 'object'
  if (aliasFor(layer, aliases)?.tileType) return 'terrain'
  return 'metadata'
}

function templateIdFor(layer: BakedLayer): string {
  return slug(stringAttr(layer.attributes, 'template_id') ?? layer.assetName ?? layer.nodeName)
}

function objectTypeNameFor(layer: BakedLayer): string {
  return slug(stringAttr(layer.attributes, 'object_type_id') ?? layer.assetName ?? layer.nodeName)
}

function areaTags(attrs: Readonly<Record<string, unknown>>): Record<string, string[]> | undefined {
  const tags: Record<string, string[]> = {}
  for (let i = 0; i <= 4; i++) {
    const key = `area_L${i}`
    const value = stringAttr(attrs, key)
    if (value) tags[key] = [value]
  }
  return Object.keys(tags).length > 0 ? tags : undefined
}

function terrainConfigFor(attrs: Readonly<Record<string, unknown>>, graphicIds: number[]): TerrainTemplateConfig {
  const terrainType = stringAttr(attrs, 'terrain_type') ?? 'base'
  const moveCost = numberAttr(attrs, 'battle_move_cost', 1)
  const exploreSpeedMod = numberAttr(attrs, 'explore_speed_mod', 1)
  const passable = boolAttr(attrs, 'walkable', true) && terrainType !== 'water'
  return {
    terrain_type: terrainType,
    region: stringAttr(attrs, 'region') ?? 'default',
    water_body_id: stringAttr(attrs, 'water_body_id') ?? null,
    passability: {
      category: passable ? 'passable' : 'impassable',
      moveCost,
      exploreSpeedMod,
      requiredTags: [],
      failMoveCost: null,
      maxClimbDelta: 1,
      blocksLineOfSight: false,
    },
    navTerrain: stringAttr(attrs, 'nav_terrain') ?? 'normal',
    ramp: null,
    graphic: { ids: graphicIds, basePieces: graphicIds.length, variantProb: numberAttr(attrs, 'variant_prob', 0), placement: 'random' },
    base_pieces: graphicIds.length,
    variant_prob: numberAttr(attrs, 'variant_prob', 0),
    graphic_id: graphicIds,
    explore_speed_mod: exploreSpeedMod,
    battle_move_cost: moveCost,
  }
}

function objectConfigFor(
  name: string,
  attrs: Readonly<Record<string, unknown>>,
  meta: AliasMeta | undefined,
  graphicId: number,
): ObjectTypeConfig {
  const widthPx = meta?.widthPx ?? 16
  const heightPx = meta?.heightPx ?? 16
  const cols = Math.max(1, Math.ceil(widthPx / 16))
  const rows = Math.max(1, Math.ceil(heightPx / 16))
  const blocksMovement = boolAttr(attrs, 'blocks_movement', false) || boolAttr(attrs, 'blocking', false)
  const collisionMask = collisionMaskFrom(meta, blocksMovement)
  const interactionType = stringAttr(attrs, 'interaction') ?? 'none'
  return {
    name,
    category: stringAttr(attrs, 'category') ?? 'decoration',
    graphic: graphicId,
    graphicSize: { cols, rows },
    graphicOffset: { x: 0, y: 0 },
    objectHeight: numberAttr(attrs, 'object_height', meta?.objectHeightPx ? meta.objectHeightPx / 16 : 0),
    collisionMask,
    passability: {
      blocksMovement,
      blocksLineOfSight: boolAttr(attrs, 'blocks_line_of_sight', false),
      provideCover: null,
    },
    interaction: { type: interactionType, range: numberAttr(attrs, 'interaction_range', 1) },
    interactionLegacy: interactionType,
    variants: {},
  }
}

function collisionMaskFrom(meta: AliasMeta | undefined, blocksMovement: boolean): unknown[] {
  const mask = meta?.geometry?.collisionMask as unknown
  if (Array.isArray(mask)) return mask
  if (mask && typeof mask === 'object') return [mask]
  return blocksMovement ? [{ x: 0, y: 0 }] : []
}

/**
 * Per-cell layered tile record. `template_id[i]` / `graphic_index[i]` are
 * parallel arrays ordered bottom→top (draw order) — the vendored top-down viewer
 * draws `template_id[i]` in array order at this flat cell, so array order == the
 * on-screen stacking order.
 *
 * BILLBOARD PROJECTION: a voxel `(x,y,z)` is NOT recorded at its world `(x,y)`.
 * The editor renders in `topBillboard` mode, drawing each voxel as a top cap at
 * screen row `y-z-1` and a front wall at screen row `y-z`. To make the flat
 * viewer reproduce that exact image we bake the projection into the recorded
 * cells: `cell.y` here is already the projected SCREEN row, `cell.height` (the
 * `terrain.json` group key) is the voxel's elevation `z`, and `orderKey` controls
 * the within-cell layer order so cross-voxel face overlaps stack the same way the
 * billboard painter does (front walls before top caps; lower paint layers first).
 */
interface PendingTerrainLayer {
  templateId: string
  graphicIndex: number
  /** The renderer's painter-order key for THIS draw: the SOURCE voxel's
   *  (y, z, layerIdx) + face. Within a merged screen cell, draws sort by the
   *  shared compareBillboardDrawOrder so the export stacks EXACTLY as the
   *  billboard bake draws (delete of the old ad-hoc [faceOrder, layerSeq]). */
  orderKey: { y: number; z: number; layerIdx: number; face: BillboardFaceOrder }
}

function pushTerrainLayer(
  cells: Map<string, { cell: TerrainCellExport; pending: PendingTerrainLayer[] }>,
  x: number,
  screenRow: number,
  height: number,
  templateId: string,
  graphicIndex: number,
  orderKey: PendingTerrainLayer['orderKey'],
  tags: Record<string, string[]> | undefined,
): void {
  const key = `${x},${screenRow},${height}`
  const existing = cells.get(key)
  if (existing) {
    existing.pending.push({ templateId, graphicIndex, orderKey })
    if (tags) existing.cell.areaTags = { ...(existing.cell.areaTags ?? {}), ...tags }
    return
  }
  cells.set(key, {
    cell: {
      x,
      y: screenRow,
      height,
      template_id: [],
      graphic_index: [],
      ...(tags ? { areaTags: tags } : {}),
    },
    pending: [{ templateId, graphicIndex, orderKey }],
  })
}

/** Flush each cell's pending layers into its parallel arrays, ordered by the
 *  renderer's shared painter comparator so the bottom-most (drawn first) is
 *  index 0 — IDENTICAL to how the billboard bake stacks multiple faces/voxels
 *  that project onto the same screen cell. No second ordering model. */
function finalizeTerrainCells(
  cells: Map<string, { cell: TerrainCellExport; pending: PendingTerrainLayer[] }>,
): TerrainCellExport[] {
  const out: TerrainCellExport[] = []
  for (const { cell, pending } of cells.values()) {
    pending.sort((a, b) => compareBillboardDrawOrder(a.orderKey, b.orderKey))
    for (const layer of pending) {
      cell.template_id.push(layer.templateId)
      cell.graphic_index.push(layer.graphicIndex)
    }
    out.push(cell)
  }
  return out
}

function stateString(cell: BakedCell, key: string): string | undefined {
  const value = cell.state?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stateNumber(cell: BakedCell, key: string): number | undefined {
  const value = cell.state?.[key]
  return typeof value === 'number' ? value : undefined
}

function compareTerrainCells(a: TerrainCellExport, b: TerrainCellExport): number {
  return a.height - b.height || a.y - b.y || a.x - b.x
}

// Pick the anchor cell that the RENDERER's `chooseObjectAnchor`
// (buildVoxelMaster/index.ts) would pick for this object instance, because the
// exported (x, y) placement is the anchor cell projected to the viewer's flat
// grid. The renderer's order is: an explicit `state.role === 'anchor'` cell wins;
// otherwise sort by columnDz ASC (bottom of the column), then footprintDy DESC
// (front-most / largest depth row), then x ASC. `columnDz`/`footprintDy` fall
// back to the raw z/y when the baked cell carries no such state. NOTE the y tie
// is DESCENDING (front row): a prior z,y,x-all-ASC ordering picked the BACK row
// and misplaced multi-cell objects onto the wrong screen row.
function anchorCell(cells: readonly BakedCell[]): BakedCell {
  const explicit = cells.find((cell) => stateString(cell, 'role') === 'anchor')
  if (explicit) return explicit
  return [...cells].sort((a, b) => {
    const adz = stateNumber(a, 'columnDz') ?? a.z
    const bdz = stateNumber(b, 'columnDz') ?? b.z
    if (adz !== bdz) return adz - bdz
    const ady = stateNumber(a, 'footprintDy') ?? a.y
    const bdy = stateNumber(b, 'footprintDy') ?? b.y
    if (ady !== bdy) return bdy - ady
    return a.x - b.x
  })[0]!
}

function buildManifest(bundleId: string, generatedAt: Date): CookedScene['manifest'] {
  return {
    schemaVersion: '3.0',
    bundleId,
    generatedAt: formatLocalStamp(generatedAt),
    generatedAtUtc: generatedAt.toISOString(),
    files: {
      terrain: 'terrain.json',
      terrainConfig: 'terrain-config.json',
      objectTypeConfig: 'object-type-config.json',
      passabilityConfig: 'passability-config.json',
      terrainAtlas: { tsj: 'terrain_atlas.tsj', image: 'terrain_atlas.png' },
      objectAtlas: { tsj: 'object_atlas.tsj', image: 'object_atlas.png' },
    },
  }
}

/** "YYYY-MM-DD HH:MM:SS +0800" style local stamp matching the reference manifest. */
function formatLocalStamp(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const local = new Date(date.getTime() + offsetMin * 60_000)
  const ymd = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
  const hms = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  return `${ymd} ${hms} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

function globalPassabilityConfig(): PassabilityConfigJson {
  return {
    schemaVersion: '3.0',
    heightThresholds: { normalMaxDelta: 0, slopeMaxDelta: 1, bridgeIgnored: true },
    sentinelHeights: { cliff: 99, abyss: -99, validRange: { min: -4, max: 8 } },
    movementTags: {
      fly: { label: '飞行', ignoresHeightDelta: true },
      swim: { label: '游泳', ignoresHeightDelta: false },
    },
    cellMobilityArbitration: {
      blockedRule: 'anyLayerImpassable',
      moveCostRule: 'max',
      navTerrainRule: 'max',
      conditionalUnsatisfied: 'blockedUnlessFailMoveCost',
    },
    objectFootprintRule: { source: 'collisionMaskUnion', respectsBlocksMovement: true, ignoresObjectHeight: true },
    lineOfSight: { enabled: false },
  }
}

export function cookBakedScene(input: CookBakedSceneInput): CookedScene {
  // Verification hook: confirms the real cook entrypoint executes this code path
  // during a live export (set SCENE_EXPORT_DEBUG=1). Guards against a green parity
  // number coming from a stale/unused build.
  const cookDebug = process.env.SCENE_EXPORT_DEBUG === '1'
  // eslint-disable-next-line no-console
  if (cookDebug) console.error(`[cook] cookBakedScene ENTER layers=${input.layers.length} aliases=${input.aliases.length} hasResolveRuleImage=${!!input.resolveRuleImage}`)
  const terrainCells = new Map<string, { cell: TerrainCellExport; pending: PendingTerrainLayer[] }>()
  const objects: TerrainObjectExport[] = []
  // Parallel to `objects`: the renderer's billboard painter-sort key for each
  // emitted object, used to reorder `objects` into the renderer's object↔object
  // draw order (the viewer paints objects in array order). See the emission loop.
  const objectOrder: { orderY: number; orderZ: number; layerIdx: number; seq: number }[] = []
  // nodePath → renderer layer index (position in the ORIGINAL baked-layer order,
  // matching buildVoxelMaster's `inputs[].layerIdx`). The cook iterates layers in
  // a different (export) order, so the painter-sort tiebreak needs this map.
  const rendererLayerIdxByPath = new Map<string, number>()
  input.layers.forEach((layer, idx) => { rendererLayerIdxByPath.set(layer.nodePath, idx) })
  const terrainTemplates: CookedScene['terrainConfig']['templates'] = {}
  const objectTypes: CookedScene['objectTypeConfig']['types'] = {}
  const terrainAtlasInputs: SceneAtlasInput[] = []
  const objectAtlasInputs: SceneAtlasInput[] = []
  const objectGraphicIds = new Map<string, number>()
  const warnings: string[] = []

  // Monotonic atlas-tile id allocator for the terrain atlas. Each sliced
  // sub-tile (or whole single-image tile) gets its own id, mirroring the
  // reference terrain_atlas.tsj where every 16px tile has a distinct id.
  let nextTerrainTileId = 0

  /**
   * Register the atlas tiles for a terrain template's source sheet, sliced by
   * its tile rule (one atlas tile per sprite). Returns the per-sprite atlas
   * tile ids (parallel to `rule.sprites`). Memoized per template so multiple
   * cells of the same template share one set of atlas tiles + one graphic_id.
   */
  // Track which templates were registered with a sliced rule + alias so a later
  // richer layer (same asset_name, but carrying the real sheet alias/rule) can
  // upgrade a placeholder template registered earlier from an aliasless layer.
  const templateGraphicIds = new Map<string, number[]>()
  const templateIsRich = new Map<string, boolean>()
  // Resolved sheet alias each template_id is bound to. Used to disambiguate two
  // baked layers that slug to the SAME display name but resolve to DIFFERENT
  // sheets (distinct atlas art + distinct transparent-variant sets): the second
  // sheet gets a per-alias-unique template_id instead of silently inheriting the
  // first sheet's graphic_id list + variant filter (which mismatched the renderer,
  // whose bindings are keyed per layer/sheet and never collide).
  const templateIdAlias = new Map<string, string>()
  // Final autotile rule chosen per template (richest layer wins) — used in the
  // cell-emit pass so cells from a placeholder layer still autotile correctly.
  const templateRule = new Map<string, TileRule | null>()
  // Pixel-filtered variant candidate idxs per template (mirrors the renderer's
  // bindings.validVariantIdxs.{top,front}) — randomRules samples from these.
  const templateTopVariantIdxs = new Map<string, number[]>()
  const templateFrontVariantIdxs = new Map<string, number[]>()
  const templateTileType = new Map<string, string | undefined>()
  const registerTerrainTemplate = (
    templateId: string,
    layer: BakedLayer,
    meta: AliasMeta | undefined,
    rule: TileRule | null,
  ): number[] => {
    const resolvedAlias = meta?.alias
    const isRich = Boolean(resolvedAlias) && Boolean(rule)
    const cached = templateGraphicIds.get(templateId)
    // Keep the first registration unless a richer (aliased + ruled) layer can
    // replace a non-rich placeholder. Allocating fresh ids for the upgrade is
    // fine — stale placeholder ids simply become unused atlas tiles, and every
    // cell of this template re-resolves through the refreshed graphic_id list.
    if (cached && (templateIsRich.get(templateId) || !isRich)) return cached

    const ids: number[] = []
    if (rule && rule.sprites.length > 0) {
      for (const sprite of rule.sprites) {
        const id = nextTerrainTileId++
        ids.push(id)
        terrainAtlasInputs.push({
          id,
          role: 'terrain',
          name: `${templateId}#${id}`,
          ...(resolvedAlias ? { alias: resolvedAlias } : {}),
          widthPx: sprite.w,
          heightPx: sprite.h,
          srcRect: { x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h },
        })
      }
    } else {
      // No rule (single-image tile / rule missing): one whole-sheet tile.
      const id = nextTerrainTileId++
      ids.push(id)
      terrainAtlasInputs.push({
        id,
        role: 'terrain',
        name: templateId,
        ...(resolvedAlias ? { alias: resolvedAlias } : {}),
        ...(meta?.widthPx ? { widthPx: meta.widthPx } : {}),
        ...(meta?.heightPx ? { heightPx: meta.heightPx } : {}),
        ...(meta?.anchorX !== undefined ? { anchorX: meta.anchorX } : {}),
        ...(meta?.anchorY !== undefined ? { anchorY: meta.anchorY } : {}),
      })
    }
    templateGraphicIds.set(templateId, ids)
    templateIsRich.set(templateId, isRich)
    templateRule.set(templateId, rule)
    templateTileType.set(templateId, meta?.tileType)
    const ruleImg = (rule && meta?.tileType
      && ((rule.faces.top?.randomRules?.length ?? 0) > 0 || (rule.faces.front?.randomRules?.length ?? 0) > 0))
      ? input.resolveRuleImage?.(resolvedAlias ?? meta.tileType) ?? null
      : null
    if (rule && meta?.tileType) {
      // Cache/identity key MUST be the per-sheet alias, not the shared tileType:
      // every common_16 template uses tileType "common_16" with identical sheet
      // dims (e.g. 64x80), so keying the opacity-filter cache by tileType+dims
      // collides across DIFFERENT sheets — the first sheet's transparent-variant
      // candidate set then leaks to every later same-type sheet, picking variants
      // that are transparent on this sheet (the renderer keys per-binding/alias
      // and never collides). Use resolvedAlias so each sheet filters its OWN pixels.
      const variantKey = resolvedAlias ?? templateId
      templateTopVariantIdxs.set(templateId, computeValidTopVariantIdxs(rule, variantKey, ruleImg))
      templateFrontVariantIdxs.set(templateId, computeValidFrontVariantIdxs(rule, variantKey, ruleImg))
    } else {
      templateTopVariantIdxs.set(templateId, [])
      templateFrontVariantIdxs.set(templateId, [])
    }
    terrainTemplates[templateId] = terrainConfigFor(layer.attributes, ids)
    return ids
  }

  const objectGraphicId = (layer: BakedLayer, typeName: string): number => {
    const meta = aliasFor(layer, input.aliases)
    const key = meta?.alias ?? typeName
    const hit = objectGraphicIds.get(key)
    if (hit !== undefined) return hit
    const id = objectGraphicIds.size
    objectGraphicIds.set(key, id)
    objectAtlasInputs.push({
      id,
      role: 'object',
      name: typeName,
      ...(meta?.alias ? { alias: meta.alias } : {}),
      ...(meta?.widthPx ? { widthPx: meta.widthPx } : {}),
      ...(meta?.heightPx ? { heightPx: meta.heightPx } : {}),
      ...(meta?.anchorX !== undefined ? { anchorX: meta.anchorX } : {}),
      ...(meta?.anchorY !== undefined ? { anchorY: meta.anchorY } : {}),
    })
    return id
  }

  // ── Object → terrain-stack tile encoding ─────────────────────────────────
  // The shipped viewer paints the per-cell terrain stack in ELEVATION-ASCENDING
  // order (drawCellList per cellsByGroup[elev], elev ASC), then ALL `objects[]`
  // strictly last. So an object emitted through `objects[]` can NEVER be occluded
  // by terrain — it always paints on top (the ambulance "floating over the walls"
  // defect). To make the UNMODIFIED viewer reproduce the renderer's terrain↔object
  // occlusion (e.g. the ambulance seated in a wall pocket, IMAGE 2), we emit the
  // object's billboard sprite INTO the terrain stack as a whole-sheet terrain tile
  // at the object's elevation: a wall voxel at a HIGHER elevation then paints in a
  // later group and overdraws the object exactly like it overdraws lower terrain.
  //
  // Geometry parity: drawTerrainTile and drawObjectSprite use the IDENTICAL anchor
  // math (anchorX=(x+0.5)*16, imgX=anchorX − pivot.x*w, imgY=anchorY −
  // (1−pivot.y)*h); they differ ONLY by drawObjectSprite's PPU scale = 16/ppu.
  // For ppu===16 objects (ambulance/buildings/most decorations) scale===1, so a
  // terrain tile renders pixel-identically to the object sprite — the placement
  // fix (verbatim anchor pivot) is preserved. ppu!==16 objects (e.g. pickup PPU=32)
  // would need pre-scaling the atlas bitmap, which the terrain pipeline can't do,
  // so those stay in `objects[]` (small ground items where terrain occlusion is
  // not the visible concern).
  const objectTerrainTemplateId = new Map<string, string>()
  const registerObjectTerrainTemplate = (typeName: string, meta: AliasMeta | undefined): string | null => {
    if (!meta?.alias) return null
    const ppu = meta.ppu ?? 16
    if (ppu !== 16) return null
    const cached = objectTerrainTemplateId.get(typeName)
    if (cached) return cached
    const templateId = `obj__${slug(typeName)}`
    const id = nextTerrainTileId++
    terrainAtlasInputs.push({
      id,
      role: 'terrain',
      name: templateId,
      alias: meta.alias,
      ...(meta.widthPx ? { widthPx: meta.widthPx } : {}),
      ...(meta.heightPx ? { heightPx: meta.heightPx } : {}),
      ...(meta.anchorX !== undefined ? { anchorX: meta.anchorX } : {}),
      ...(meta.anchorY !== undefined ? { anchorY: meta.anchorY } : {}),
    })
    // Object carrier templates are pure sprite holders (no autotile rule): one
    // graphic_id, passable defaults. The viewer resolves template_id → graphic_id
    // → terrain-atlas rect via drawTerrainTile regardless of terrain semantics.
    terrainTemplates[templateId] = terrainConfigFor({}, [id])
    objectTerrainTemplateId.set(typeName, templateId)
    return templateId
  }


  // registered from an aliasless layer can be upgraded by a later aliased+ruled
  // layer of the same name BEFORE any cell's graphic_index is computed (cells
  // must autotile against the template's final rule, not whichever layer came
  // first). Objects are emitted inline in layer order.
  interface TerrainLayerWork { layer: BakedLayer; templateId: string }
  const terrainWork: TerrainLayerWork[] = []
  // Per-LAYER occupancy (one set per terrainWork entry / layerSeq). The renderer's
  // autotile neighbour probe (pickFaceSpriteIndex) reads `coordsByLayerIdx[layerIdx]`
  // — i.e. ONLY the cell's own layer's voxels, NOT a union across sibling layers
  // that happen to share a template. Feeding a per-template union (as before) makes
  // the cook see neighbours the renderer doesn't, producing a different neighbour
  // key → wrong autotile/common-16 sprite slot. Key the occupancy by layerSeq so
  // each layer's pick uses the IDENTICAL neighbour set the renderer's per-layer
  // coordsByLayerIdx provides.
  const occByLayerSeq: Set<string>[] = []

  let skippedNameOnly = 0
  let emittedTerrain = 0
  let emittedObject = 0
  for (const layer of orderBakedLayersForExport(input.layers)) {
    const role = layerExportRole(layer, input.aliases)
    if (role === 'metadata') continue
    // PARITY WITH THE RENDERER: the editor's billboard bake draws a layer ONLY
    // when matchAssetEntry resolves it to a library sheet (no match → paintCell
    // returns early, the layer is invisible). The cook previously emitted EVERY
    // layer — unmatched ones became blank index-0 placeholder tiles that the
    // bundled viewer then painted as solid terrain/objects the editor never
    // shows (the "extra stitching / wrong occlusion" in the exported visualizer).
    // Skip any name-only layer whose asset doesn't resolve, so the export reflects
    // exactly what the renderer draws. An EXPLICIT export_role / object_type_id is
    // an intentional export contract (e.g. procedurally-tagged layers with no
    // library art) and is honoured even without a library match.
    const resolved = aliasFor(layer, input.aliases)
    const hasExplicitRole = !!stringAttr(layer.attributes, 'export_role')
      || !!stringAttr(layer.attributes, 'object_type_id')
    if (!resolved && !hasExplicitRole) { skippedNameOnly++; continue }
    if (role === 'terrain') {
      const meta = resolved
      const rule = meta?.tileType ? loadTileRule(meta.tileType) : null
      // 💡 Sheet-aware template id. Two baked layers can share a display name (e.g.
      // both "土地") yet resolve to DIFFERENT sheets (different atlas art + a
      // different transparent-variant set). The viewer keys terrain art purely by
      // template_id → templates[template_id].graphic_id[graphic_index]; collapsing
      // distinct sheets under one template_id makes the later layer reference the
      // FIRST sheet's atlas tiles AND inherit the first sheet's variant candidates
      // (so common-16 picks land on a transparent/wrong slot — the renderer keys
      // per-layer binding and never collides). When the layer has no explicit
      // template_id attribute and its base id is already claimed by a DIFFERENT
      // resolved alias, derive a per-sheet unique id so each sheet gets its own
      // graphic_id list + variant filter, matching the renderer's per-binding art.
      const baseTemplateId = templateIdFor(layer)
      const hasExplicitTemplateId = !!stringAttr(layer.attributes, 'template_id')
      let templateId = baseTemplateId
      if (!hasExplicitTemplateId && meta?.alias) {
        const claimedBy = templateIdAlias.get(baseTemplateId)
        // Only disambiguate when the base id is already bound to a DIFFERENT
        // NON-EMPTY sheet alias. An empty/undefined claim is an aliasless
        // placeholder that registerTerrainTemplate is allowed to upgrade in place
        // (same display name, no competing art) — don't fork it into a new id.
        if (claimedBy !== undefined && claimedBy !== '' && claimedBy !== meta.alias) {
          templateId = `${baseTemplateId}__${slug(meta.alias)}`
        }
      }
      const priorClaim = templateIdAlias.get(templateId)
      if (priorClaim === undefined || (priorClaim === '' && meta?.alias)) {
        templateIdAlias.set(templateId, meta?.alias ?? '')
      }
      registerTerrainTemplate(templateId, layer, meta, rule)
      const layerSeq = terrainWork.length
      terrainWork.push({ layer, templateId })
      emittedTerrain++
      // Per-layer occupancy: ONLY this layer's voxels (mirrors the renderer's
      // coordsByLayerIdx[layerIdx]). Index parallels terrainWork (layerSeq).
      const occ = new Set<string>()
      for (const cell of layer.cells) occ.add(`${cell.x},${cell.y},${cell.z}`)
      occByLayerSeq.push(occ)
      continue
    }

    const typeName = objectTypeNameFor(layer)
    const graphicId = objectGraphicId(layer, typeName)
    emittedObject++
    objectTypes[typeName] = objectTypes[typeName] ?? objectConfigFor(typeName, layer.attributes, resolved, graphicId)
    const direction = numberAttr(layer.attributes, 'direction', 0)
    // Renderer layer index = position in the ORIGINAL baked-layer order
    // (buildVoxelMaster maps inputs as listBakedLayers().map((l,idx)=>…)), NOT the
    // export-reordered iteration order. The painter sort's layerIdx tiebreak must
    // use THIS index so the emitted object stack matches the renderer's.
    const rendererLayerIdx = rendererLayerIdxByPath.get(layer.nodePath) ?? 0
    // If this object type can ride the terrain stack (ppu===16, resolvable sprite),
    // register its carrier template once. A non-null id routes every instance below
    // into the elevation-ordered terrain stack (so higher walls occlude it); a null
    // id keeps the legacy `objects[]` path (always-on-top, e.g. ppu!==16 pickups).
    const objTerrainTemplateId = registerObjectTerrainTemplate(typeName, resolved)
    const objTags = areaTags(layer.attributes)

    const grouped = new Map<string, BakedCell[]>()
    const legacy: BakedCell[] = []
    // Preserve the renderer's intra-layer collection order: cells are collected in
    // `layer.cells` iteration order; the renderer's stable painter sort keeps that
    // order among draws sharing the same (y,z,layerIdx). For grouped objects the
    // ANCHOR cell's first appearance fixes the group's collection slot.
    const groupFirstSeq = new Map<string, number>()
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i]!
      const instanceId = stateString(cell, 'instanceId')
      if (!instanceId) { legacy.push(cell); continue }
      if (!grouped.has(instanceId)) { grouped.set(instanceId, []); groupFirstSeq.set(instanceId, i) }
      grouped.get(instanceId)!.push(cell)
    }
    // Billboard objects anchor on their FRONT/footprint face (screen row y - z,
    // see billboardObjectAnchorCanvasXY / objectSpriteAnchorScreenY). The viewer
    // draws an object at flat (x, y) using the tsj pivot, so the exported y must
    // be the projected screen row; `height` keeps the source elevation.
    //
    // OCCLUSION (object↔object): the shipped viewer paints objects strictly in
    // `terrain.json.objects[]` ARRAY ORDER, on top of all terrain. The renderer
    // instead interleaves each object by the SHARED billboard painter key
    // (compareBillboardDrawOrder) using the instance's FOOTPRINT DEPTH (max cell
    // y) and COLUMN TOP (max cell z) — see collectObjectVisuals' sortOverride
    // `{ y: footprintDepthY, z: topZ }`. So to make the viewer reproduce the
    // renderer's object stacking we must EMIT objects in that painter order. We
    // stamp each object with its painter key here and sort the whole array once
    // after every layer is processed (below). Do NOT sort within a layer by
    // instanceId/coords — that diverges from the renderer's cross-layer order.
    for (const [instanceId, groupCells] of grouped) {
      const anchor = anchorCell(groupCells)
      const footprintDepthY = Math.max(...groupCells.map((c) => c.y))
      const topZ = Math.max(...groupCells.map((c) => c.z))
      if (objTerrainTemplateId) {
        // Emit the object sprite INTO the terrain stack at its footprint elevation
        // so the viewer's elevation-ascending terrain paint lets higher walls
        // occlude it. Screen row = anchor.y − anchor.z (same projection the
        // `objects[]` path used), elevation group = anchor.z. Within a merged cell
        // it sorts via the shared billboard comparator using the instance footprint
        // depth/top + face:'object'.
        pushTerrainLayer(
          terrainCells,
          anchor.x,
          anchor.y - anchor.z,
          anchor.z,
          objTerrainTemplateId,
          0,
          { y: footprintDepthY, z: topZ, layerIdx: rendererLayerIdx, face: 'object' },
          objTags,
        )
        continue
      }
      objects.push({ instanceId, typeId: typeName, x: anchor.x, y: anchor.y - anchor.z, height: anchor.z, direction, interacted: false })
      objectOrder.push({ orderY: footprintDepthY, orderZ: topZ, layerIdx: rendererLayerIdx, seq: groupFirstSeq.get(instanceId)! })
    }
    for (const cell of legacy) {
      if (objTerrainTemplateId) {
        pushTerrainLayer(
          terrainCells,
          cell.x,
          cell.y - cell.z,
          cell.z,
          objTerrainTemplateId,
          0,
          { y: cell.y, z: cell.z, layerIdx: rendererLayerIdx, face: 'object' },
          objTags,
        )
        continue
      }
      objects.push({
        instanceId: `${layer.nodePath}:${cell.x},${cell.y},${cell.z}`,
        typeId: typeName,
        x: cell.x,
        y: cell.y - cell.z,
        height: cell.z,
        direction,
        interacted: false,
      })
      // Legacy single-voxel objects: footprint depth = own y, column top = own z.
      objectOrder.push({ orderY: cell.y, orderZ: cell.z, layerIdx: rendererLayerIdx, seq: layer.cells.indexOf(cell) })
    }
  }

  // Reorder objects to match the renderer's billboard painter order so the
  // viewer's array-order paint reproduces the editor's object↔object stacking.
  // Key = (footprintDepthY, topZ, rendererLayerIdx, collectionSeq) ASC — the exact
  // tuple compareBillboardDrawOrder + the renderer's stable sort yield. Sort the
  // index permutation so `objects` and `objectOrder` stay aligned.
  {
    const perm = objects.map((_, i) => i)
    perm.sort((a, b) => {
      const oa = objectOrder[a]!, ob = objectOrder[b]!
      if (oa.orderY !== ob.orderY) return oa.orderY - ob.orderY
      if (oa.orderZ !== ob.orderZ) return oa.orderZ - ob.orderZ
      if (oa.layerIdx !== ob.layerIdx) return oa.layerIdx - ob.layerIdx
      return oa.seq - ob.seq
    })
    const sorted = perm.map((i) => objects[i]!)
    objects.length = 0
    objects.push(...sorted)
  }

  // eslint-disable-next-line no-console
  if (cookDebug) console.error(`[cook] layer-gate done: emittedTerrain=${emittedTerrain} emittedObject=${emittedObject} skippedNameOnly=${skippedNameOnly} occByLayerSeq=${occByLayerSeq.length}`)

  // Region xy indices — MIRROR the renderer's collect.ts (xyByParentPath /
  // xyByLayerIdx). Region-gated face variants (e.g. wall_outer_16's inner-wall
  // sprites, fired when the voxel's (x,y+1) falls inside the parent scope's xy)
  // are evaluated by the SHARED pickFaceSpriteIndex against these sets.
  //
  // CRITICAL: the renderer's collectCells builds these scopes from EVERY layer's
  // raw cells — BEFORE asset binding — so a sibling layer whose art doesn't
  // resolve (e.g. a door with no library sheet) STILL contributes its footprint
  // to the parent scope. The cook gates such layers out of EMISSION (no blank
  // tile), but their footprint must remain in the region topology or region-gated
  // variants under-fire (walls render as outer instead of inner). So build the
  // parent-scope union over ALL terrain-role layers' cells, gated or not, exactly
  // like the editor's scope; only EMISSION respects the resolve gate.
  const xyByParentPath = new Map<string, Set<string>>()
  for (const layer of input.layers) {
    if (layerExportRole(layer, input.aliases) !== 'terrain') continue
    const parentPath = parentOfNodePath(layer.nodePath)
    let parentSet = xyByParentPath.get(parentPath)
    if (!parentSet) { parentSet = new Set(); xyByParentPath.set(parentPath, parentSet) }
    for (const cell of layer.cells) parentSet.add(`${cell.x},${cell.y}`)
  }
  // Per-emitted-layer self xy (source: "self" regions) parallels terrainWork.
  const selfXyByLayerSeq: Set<string>[] = []
  for (let s = 0; s < terrainWork.length; s++) {
    const selfSet = new Set<string>()
    for (const cell of terrainWork[s]!.layer.cells) selfSet.add(`${cell.x},${cell.y}`)
    selfXyByLayerSeq.push(selfSet)
  }

  // Pass 2: project each terrain voxel to its BILLBOARD faces and emit them as
  // flat cells the top-down viewer can draw. A voxel (x,y,z) draws:
  //   * top cap  → screen row (y - z - 1), top-face sprite     (orderKey face 1)
  //   * front wall → screen row (y - z),   front-face sprite   (orderKey face 0)
  // Ground-only rules (no faces.front) emit just the top cap; rules with no top
  // face skip the cap. The screen row is recorded as `cell.y`; the group key
  // (`height`) stays the voxel elevation `z` so the viewer's elevation filter and
  // z-ascending paint order reproduce billboard occlusion (higher-z front walls
  // overpaint lower-z tops — within a z group front walls sort before top caps).
  for (let layerSeq = 0; layerSeq < terrainWork.length; layerSeq++) {
    const { layer, templateId } = terrainWork[layerSeq]!
    const rule = templateRule.get(templateId) ?? null
    const occ = occByLayerSeq[layerSeq]
    const topVariants = templateTopVariantIdxs.get(templateId) ?? []
    const frontVariants = templateFrontVariantIdxs.get(templateId) ?? []
    const tags = areaTags(layer.attributes)
    const regions = rule
      ? resolveRuleRegions(rule, selfXyByLayerSeq[layerSeq]!, xyByParentPath.get(parentOfNodePath(layer.nodePath)) ?? new Set())
      : new Map<string, Set<string>>()
    const has = (cell: BakedCell) =>
      (dx: number, dy: number, dz: number) => !!occ && occ.has(`${cell.x + dx},${cell.y + dy},${cell.z + dz}`)
    for (const cell of layer.cells) {
      // Top cap at screen row y - z - 1.
      if (!rule || rule.faces.top) {
        const occCell = has(cell)
        const topIndex = rule && rule.faces.top && occ
          ? pickTopSpriteIndex(rule, cell.x, cell.y, cell.z, occCell, { validVariantIdxs: topVariants, regions })
          : 0
        pushTerrainLayer(terrainCells, cell.x, cell.y - cell.z - 1, cell.z, templateId, topIndex,
          { y: cell.y, z: cell.z, layerIdx: layerSeq, face: 'top' }, tags)
        if (input.onTerrainLayerDebug) {
          const key = rule?.faces.top ? buildTopFaceKey((dx, dy) => occCell(dx, dy, 0), rule.faces.top.keyMode) : ''
          input.onTerrainLayerDebug({ x: cell.x, srcY: cell.y, z: cell.z, face: 'top', layerSeq, nodePath: layer.nodePath, templateId, graphicIndex: topIndex, validVariantIdxs: topVariants, neighborKey: key })
        }
      }
      // Front wall at screen row y - z (only rules that declare a front face).
      if (rule && rule.faces.front && occ) {
        const occCell = has(cell)
        const frontIndex = pickFrontSpriteIndex(rule, cell.x, cell.y, cell.z, occCell, { validVariantIdxs: frontVariants, regions })
        if (frontIndex !== null) {
          pushTerrainLayer(terrainCells, cell.x, cell.y - cell.z, cell.z, templateId, frontIndex,
            { y: cell.y, z: cell.z, layerIdx: layerSeq, face: 'front' }, tags)
          if (input.onTerrainLayerDebug) {
            const t = occCell(0, 0, 1) ? 1 : 0, b = occCell(0, 0, -1) ? 1 : 0
            const l = occCell(-1, 0, 0) ? 1 : 0, r = occCell(1, 0, 0) ? 1 : 0
            input.onTerrainLayerDebug({ x: cell.x, srcY: cell.y, z: cell.z, face: 'front', layerSeq, nodePath: layer.nodePath, templateId, graphicIndex: frontIndex, validVariantIdxs: frontVariants, neighborKey: `${t},${b},${l},${r}` })
          }
        }
      }
    }
  }

  // ── Global offset ──────────────────────────────────────────────────────
  // The viewer treats cell/object x,y as raw canvas grid coords (canvas size =
  // cols×rows) and cannot show negatives. Compute the true bounding box across
  // every cell AND object (incl. negatives) and translate so the min corner
  // maps to (0,0). Billboard projection pushes top caps to y-z-1 (often
  // negative for elevated voxels), so the offset is what keeps elevated content
  // on-canvas. Height (z) is the group key and stays untranslated.
  const cellList = finalizeTerrainCells(terrainCells)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const cell of cellList) {
    minX = Math.min(minX, cell.x); minY = Math.min(minY, cell.y)
    maxX = Math.max(maxX, cell.x); maxY = Math.max(maxY, cell.y)
  }
  for (const object of objects) {
    minX = Math.min(minX, object.x); minY = Math.min(minY, object.y)
    maxX = Math.max(maxX, object.x); maxY = Math.max(maxY, object.y)
  }
  const hasContent = cellList.length > 0 || objects.length > 0
  const offsetX = hasContent && Number.isFinite(minX) ? -Math.min(0, minX) : 0
  const offsetY = hasContent && Number.isFinite(minY) ? -Math.min(0, minY) : 0
  if (offsetX !== 0 || offsetY !== 0) {
    for (const cell of cellList) { cell.x += offsetX; cell.y += offsetY }
    for (const object of objects) { object.x += offsetX; object.y += offsetY }
  }

  const sortedCells = cellList.sort(compareTerrainCells)
  const groupedCells: CookedScene['terrain']['cells'] = {}
  for (const cell of sortedCells) {
    const key = String(cell.height)
    groupedCells[key] = groupedCells[key] ?? []
    groupedCells[key]!.push(cell)
  }
  // cols/rows must span the full extent so no content is clipped.
  const cols = hasContent && Number.isFinite(maxX) ? maxX + offsetX + 1 : 0
  const rows = hasContent && Number.isFinite(maxY) ? maxY + offsetY + 1 : 0
  if (input.layers.length > 0 && !hasContent) warnings.push('No exportable terrain or object cells were found.')

  return {
    bundleId: input.bundleId,
    sceneName: input.sceneName,
    terrain: {
      version: '2.0',
      cols,
      rows,
      cells: groupedCells,
      objects,
    },
    terrainConfig: {
      schemaVersion: '3.0',
      templates: terrainTemplates,
    },
    objectTypeConfig: {
      schemaVersion: '3.0',
      types: objectTypes,
    },
    passabilityConfig: globalPassabilityConfig(),
    manifest: buildManifest(input.bundleId, input.generatedAt),
    warnings,
    terrainAtlasInputs,
    objectAtlasInputs,
  }
}
