// Compact on-disk encoding for sparse voxel cell arrays inside output-cache JSON.
//
// Wire / in-memory shape stays VoxelCell { x, y, z, token, state? } everywhere
// above this layer (preview, probe, batteries, renderer). Only OutputCache
// compresses on write and expands on read so legacy uncompressed entries still
// round-trip.

/** Marker object stored in place of a VoxelCell[] on disk. */
export interface VoxelCellsCompactV1 {
  readonly __voxelCells: 1
  /** Token dictionary — cell records reference by index. */
  readonly t: readonly string[]
  /** Flat [x, y, z, tokenIdx, …] — four numbers per occupied cell. */
  readonly d: readonly number[]
  /** Cell indices (0-based) that carry optional state payloads. */
  readonly si?: readonly number[]
  /** State objects parallel to `si`. */
  readonly st?: readonly Readonly<Record<string, unknown>>[]
}

const MARKER = '__voxelCells' as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isVoxelCell(v: unknown): v is { x: number; y: number; z: number; token: string; state?: unknown } {
  if (!isRecord(v)) return false
  return (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.z === 'number' &&
    typeof v.token === 'string'
  )
}

function isVoxelCellArray(v: unknown): v is ReadonlyArray<{ x: number; y: number; z: number; token: string; state?: unknown }> {
  return Array.isArray(v) && v.length > 0 && v.every(isVoxelCell)
}

function isVoxelCellsCompact(v: unknown): v is VoxelCellsCompactV1 {
  if (!isRecord(v) || v[MARKER] !== 1) return false
  return Array.isArray(v.t) && Array.isArray(v.d)
}

/** Expand a compact cells blob (or pass through a legacy array). */
export function expandVoxelCells(v: unknown): unknown {
  if (isVoxelCellsCompact(v)) {
    const { t, d } = v
    const cellCount = Math.floor(d.length / 4)
    const cells: Array<{ x: number; y: number; z: number; token: string; state?: Record<string, unknown> }> = []
    const stateByIndex = new Map<number, Record<string, unknown>>()
    if (Array.isArray(v.si) && Array.isArray(v.st)) {
      for (let i = 0; i < v.si.length; i++) {
        const idx = v.si[i]
        const st = v.st[i]
        if (typeof idx === 'number' && isRecord(st)) stateByIndex.set(idx, st)
      }
    }
    for (let i = 0; i < cellCount; i++) {
      const base = i * 4
      const x = d[base]!
      const y = d[base + 1]!
      const z = d[base + 2]!
      const ti = d[base + 3]!
      const token = t[ti] ?? ''
      const cell: { x: number; y: number; z: number; token: string; state?: Record<string, unknown> } = {
        x,
        y,
        z,
        token,
      }
      const state = stateByIndex.get(i)
      if (state) cell.state = state
      cells.push(cell)
    }
    return cells
  }
  if (Array.isArray(v)) return v.map((el) => expandPayload(el))
  return v
}

/** Compress a VoxelCell[] when non-empty; empty arrays stay as []. */
export function compressVoxelCells(
  cells: ReadonlyArray<{ x: number; y: number; z: number; token: string; state?: unknown }>,
): VoxelCellsCompactV1 | readonly [] {
  if (cells.length === 0) return []
  const tokenToIdx = new Map<string, number>()
  const t: string[] = []
  const d: number[] = []
  const si: number[] = []
  const st: Record<string, unknown>[] = []

  const tokenIndex = (token: string): number => {
    let idx = tokenToIdx.get(token)
    if (idx === undefined) {
      idx = t.length
      t.push(token)
      tokenToIdx.set(token, idx)
    }
    return idx
  }

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    d.push(c.x, c.y, c.z, tokenIndex(c.token))
    if (c.state !== undefined && isRecord(c.state)) {
      si.push(i)
      st.push(c.state)
    }
  }

  const out: VoxelCellsCompactV1 = { __voxelCells: 1, t, d }
  if (si.length > 0) return { ...out, si, st }
  return out
}

/** Deep-walk a cache payload and compress every voxel cell array. */
export function compressPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((el) => compressPayload(el))
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(obj)) {
    if (key === 'cells' && isVoxelCellArray(child)) {
      out[key] = compressVoxelCells(child)
    } else {
      out[key] = compressPayload(child)
    }
  }
  return out
}

/** Deep-walk a parsed cache payload and expand compact cell blobs. */
export function expandPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((el) => expandPayload(el))
  const obj = value as Record<string, unknown>
  if (isVoxelCellsCompact(obj)) return expandVoxelCells(obj)
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(obj)) {
    if (key === 'cells') out[key] = expandVoxelCells(child)
    else out[key] = expandPayload(child)
  }
  return out
}

/** Serialized byte length after voxel compression (for inline/shard budgeting). */
export function compressedPayloadByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(compressPayload(value)) ?? 'null', 'utf-8')
}
