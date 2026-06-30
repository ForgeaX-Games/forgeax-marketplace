export type Point3D = { x: number; y: number; z: number; token?: string; state?: Record<string, unknown> }
export type ViewMode = 'top' | 'topBillboard' | 'iso' | 'free3d'
export type DrawMode = 'wire' | 'color' | 'asset'

// The scene_output battery's wire output (see shared/types/scene/projection.ts).
// `tokens`/`cellsByToken` are present only on multi-value layers (a node whose
// cells carry >1 distinct voxel token) — they drive the collapsible sub-layer
// rows + per-token visibility in the Layers panel.
export interface VoxelLayer {
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  cells: Point3D[]
  tokens?: string[]
  cellsByToken?: Record<string, Point3D[]>
}
export interface NameListEntry { id: number; name: string; type?: string }

// A dense 2D preview layer projected from any node's `grid` output port (legacy
// "preview" channel). `data` is indexed [row][col]; a value
// of 0 means an empty cell. Unlike voxel layers (only from the scene_output
// sink), every executed node with a grid output contributes one of these, so the
// preview updates live as a graph is wired up — even without a scene_output.
export interface GridLayer {
  key: string // `${nodeId}:${portName}`
  nodeId: string
  portName: string
  nodeName: string
  data: number[][]
  rows: number
  cols: number
  outputType: 'grid'
  visible: boolean
  updatedAt: number
}

// The renderer's internal layer (VoxelLayer + resolved name/type + bookkeeping):
export interface RendererVoxelLayer {
  key: string // `${nodeId}:${nodePath}`
  nodeId: string
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  cells: Point3D[]
  visible: boolean
  updatedAt: number
  assetName: string
  assetAlias?: string
  assetType?: string
  /** Scene-node attribute bag (baked layers only; output may omit). */
  attributes?: Record<string, unknown>
  version?: number
  bounds?: { width: number; height: number }
  /**
   * Cached XY extent of `cells`, maintained incrementally by paintBakedCells (an
   * additive paint extends it in O(k); a non-append change drops it). Lets
   * voxelLayerCellSource skip the O(N) bbox scan over all cells on every paint —
   * the per-paint cell-source recreation was the last O(N)-per-paint cost in the
   * paint→visible React render. `undefined` → caller computes it by scanning.
   */
  bbox?: { minX: number; minY: number; maxX: number; maxY: number }
  /**
   * Multi-value (G2) sub-layer breakdown: the distinct voxel `token`s present on
   * this node, in stable first-seen order. A node carrying >1 token becomes a
   * collapsible parent row with one sub-layer per token.
   */
  subTokens?: string[]
  /** Per-token visibility, key = token. Absent → the layer is single-value. */
  subVisible?: Record<string, boolean>
  /** Per-token cell buckets so the canvas can hide a single sub-layer's voxels. */
  cellsByToken?: Record<string, Point3D[]>
}
