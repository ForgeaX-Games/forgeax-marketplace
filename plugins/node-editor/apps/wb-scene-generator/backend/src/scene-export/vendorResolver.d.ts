/**
 * Ambient types for the vendored renderer sprite resolver.
 *
 * `vendor/dist/renderer-resolve/...` is the renderer's PURE autotile resolver
 * (`pickFaceSpriteIndex` / `pickFaceSprite` / `buildTopFaceKey` /
 * `lookupWithWildcard`) compiled directly from the frontend SOURCE by
 * `scripts/build-vendor.mjs`. The scene exporter calls these — the SAME
 * functions the browser renderer uses — instead of maintaining a parallel
 * autotile re-derivation. The compiled bundle ships no `.d.ts` and its `.ts`
 * source lives outside the backend `rootDir`, so we declare the small surface
 * the cooker uses here. The shapes mirror the frontend `PickFaceContext` /
 * `RuleSprite` exactly (kept in lockstep by the renderer-parity test).
 */
declare module '*/vendor/dist/renderer-resolve/renderer/server/spriteResolver.js' {
  export interface RuleSprite {
    x: number
    y: number
    w: number
    h: number
  }
  export type FaceKeyMode = 'adjacent4' | 'edgeDist2'
  export interface FaceVariant {
    when: { regionContains: { region: string; offset: [number, number] } }
    map: Record<string, number>
  }
  export interface FaceRule {
    basePieces: number
    keyMode?: FaceKeyMode
    map: Record<string, number>
    variants?: FaceVariant[]
    randomRules?: Array<{ tileId: number; keepProbability: number }>
    variantIdxs?: number[]
  }
  export interface CollectedCell {
    layerIdx: number
    x: number
    y: number
    z: number
    [extra: string]: unknown
  }
  export interface PickFaceContext {
    face: FaceRule
    faceTag: 'top' | 'front'
    sprites: ReadonlyArray<RuleSprite>
    validVariantIdxs: ReadonlyArray<number>
    cell: CollectedCell
    coordsByLayerIdx: Map<number, Set<string>>
    regions: Map<string, Set<string>>
  }
  export function pickFaceSpriteIndex(ctx: PickFaceContext): number
  export function pickFaceSprite(ctx: PickFaceContext): RuleSprite | null
  export function buildTopFaceKey(has: (dx: number, dy: number) => boolean, keyMode?: FaceKeyMode): string
  export function lookupWithWildcard(map: Record<string, number>, key: string): number | undefined
  /** Within one cell the bake draws the top cap before the front wall. */
  export type BillboardFaceOrder = 'top' | 'front' | 'object'
  export interface BillboardDrawOrderKey {
    y: number
    z: number
    layerIdx: number
    face: BillboardFaceOrder
  }
  /** The renderer's painter order: (y,z,layerIdx) ASC then top-before-front. */
  export function compareBillboardDrawOrder(a: BillboardDrawOrderKey, b: BillboardDrawOrderKey): number
  /** Minimal RGBA view (Buffer / typed-array backed); alpha at (y*width+x)*4+3. */
  export interface RgbaView {
    width: number
    height: number
    data: { readonly length: number; readonly [i: number]: number }
  }
  /** Raw variant candidate idxs (face.variantIdxs ?? sprites[basePieces..]). */
  export function rawVariantCandidates(face: FaceRule, spriteCount: number): number[]
  /** True if the sprite sub-rect has any pixel with alpha>0 (null img → true). */
  export function spriteHasVisiblePixel(img: RgbaView | null, sprite: RuleSprite): boolean
  /** Non-transparent variant candidate idxs — the SAME filter the renderer uses. */
  export function computeValidVariantIdxs(
    face: FaceRule,
    sprites: ReadonlyArray<RuleSprite>,
    img: RgbaView | null,
  ): number[]
}
