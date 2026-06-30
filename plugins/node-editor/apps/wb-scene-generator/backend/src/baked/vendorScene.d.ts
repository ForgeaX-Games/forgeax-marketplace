/**
 * Ambient types for the vendored scene tree+projection bundle.
 *
 * The compiled bundle (`vendor/dist/shared/types/scene/index.js`) ships no
 * `.d.ts`, and its `.ts` source lives outside the backend `rootDir`, so we
 * declare the small surface the baked-layer store uses. The runtime loads the
 * real (CJS) bundle — the SAME one the scene_output battery imports — so the
 * tree mutations stay byte-for-byte consistent with the graph's scene semantics.
 */
declare module '*/vendor/dist/shared/types/scene/index.js' {
  export interface VoxelCell {
    x: number
    y: number
    z: number
    token: string
    state?: Readonly<Record<string, unknown>>
  }
  export interface SceneNodeSnapshot {
    name: string
    path: string
    schema?: string
    version: number
    cells?: readonly VoxelCell[]
    children: readonly SceneNodeSnapshot[]
    attributes?: Readonly<Record<string, unknown>>
    bounds?: Readonly<{ width: number; height: number }>
  }
  export function emptyTree(): SceneNodeSnapshot
  export function readNode(root: SceneNodeSnapshot, path: string): SceneNodeSnapshot | null
  export function splitPath(path: string): string[]
  export function upsertCells(
    root: SceneNodeSnapshot,
    path: string,
    data: { schema: string; cells: readonly VoxelCell[]; bounds?: { width: number; height: number } },
    newVersion: number,
  ): SceneNodeSnapshot
  export function setAttribute(
    root: SceneNodeSnapshot,
    path: string,
    key: string,
    value: unknown,
    newVersion: number,
  ): SceneNodeSnapshot
  export function upsertSubtree(
    root: SceneNodeSnapshot,
    destPath: string,
    source: SceneNodeSnapshot,
    newVersion: number,
  ): SceneNodeSnapshot
}
