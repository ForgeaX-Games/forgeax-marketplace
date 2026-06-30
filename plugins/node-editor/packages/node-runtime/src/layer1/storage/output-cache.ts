// outputs/<nodeId>/<portId>.{json,bin,data/} — execution cache.
//
// Two responsibilities:
//   1. Persist per-port output values keyed by graph.hash so the next
//      partial-execute can decide whether the cached value is still valid.
//   2. Tear down nodes (and their downstream) when invalidated.
//
// `outputs/` is intentionally NOT the source of truth for produced assets —
// long-lived assets land in <gameRoot>/assets/ via the asset-resolver. This
// cache exists for incremental re-execution and UI replay.
//
// Large-payload safety (why this is not a single JSON.stringify)
// ---------------------------------------------------------------
// A wire value is a DataTreeEntry[] = [{ path, items }]. An `item` can embed an
// entire scene tree with every voxel cell. Two independent blow-ups push the
// serialized text past V8's single-string limit (~512MB), at which point a
// naive `JSON.stringify(entry)` throws `Invalid string length` and takes the
// whole execution down with it:
//   • many ITEMS in one branch — tree_flatten collapses N fan-out branches into
//     a single entry whose `items` each carry a full scene copy (so one entry
//     alone can be hundreds of MB);
//   • many BRANCHES — fan-out producers emit one entry per branch, each a full
//     scene copy.
// Per-element (per-entry) sharding alone does NOT fix the first case, so we
// shard at the finest safe granularity: one chunk file per (branch-path, item)
// pair. Each chunk holds exactly one item (≈ one scene tree, sub-MB in
// practice), so neither write nor read ever builds a string near the limit,
// no matter how many nodes/layers/branches the scene has. Read reassembles the
// DataTreeEntry[] in memory (a large in-memory array is fine — only the
// *string* form is what blows up).
//
// Non-DataTreeEntry array payloads (rare) fall back to per-element sharding.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OutputCacheV1 } from './types.js'

// Above this total serialized size (bytes) a port's `data` switches from inline
// JSON to sharded chunk files. Chosen well under V8's ~512MB single-string
// ceiling: the threshold only decides inline-vs-shard; correctness comes from
// each *chunk* (one item) staying far below the limit, which it does because a
// single scene-tree item is sub-MB in practice.
const INLINE_DATA_MAX_BYTES = 32 * 1024 * 1024

// The cache is machine-read JSON (never hand-edited), so it is written COMPACT
// (no pretty-print indentation). A `voxel-mass` payload is a flat list of
// occupied cells `{x,y,z,token}`; pretty-printing exploded each cell across ~6
// deeply-indented lines — measured at 141 bytes/cell vs 34 bytes compact, a
// ~4.1× blow-up on outputs with millions of cells. Compact also roughly
// quarters the transient string built by JSON.stringify, easing the memory
// spike that was tipping the (already memory-saturated) backend into OOM.
const stringifyEntry = (entry: OutputCacheV1): string => JSON.stringify(entry)

/** One sharded unit: a single item tagged with its branch path so read can regroup entries. */
interface DataChunk {
  /** Branch path of the DataTreeEntry this item belongs to (null = non-DataTree element fallback). */
  path: readonly number[] | null
  /** The single item payload (for the fallback path, the whole array element). */
  item?: unknown
  /** True when this chunk records an empty branch (a DataTreeEntry with zero items). */
  empty?: boolean
}

/** Zero-padded chunk file name so a lexicographic dir read restores chunk order. */
function chunkName(index: number): string {
  return `chunk-${String(index).padStart(6, '0')}.json`
}

/** Duck-type a DataTreeEntry: `{ path: number[], items: unknown[] }`. */
function isDataTreeEntry(v: unknown): v is { path: number[]; items: unknown[] } {
  return (
    v !== null &&
    typeof v === 'object' &&
    Array.isArray((v as { path?: unknown }).path) &&
    Array.isArray((v as { items?: unknown }).items)
  )
}

export interface OutputCacheMeta {
  executedHash: string
  valid: boolean
  sharded: boolean
  dataChunks?: number
}

export class OutputCache {
  constructor(private readonly root: string) {}

  /** Absolute path to the .json metadata file for one node/port. */
  jsonPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.json`)
  }

  /** Absolute path to the sibling .bin payload (if the entry uses an external blob). */
  binPath(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.bin`)
  }

  /** Absolute path to the directory holding sharded `data` chunks (large array payloads). */
  private dataChunkDir(nodeId: string, portId: string): string {
    return join(this.root, nodeId, `${portId}.data`)
  }

  /**
   * List every port id that has a cached `.json` entry for a node. Used to read
   * back whatever a node actually produced without knowing its (possibly dynamic)
   * output port set in advance. Returns [] when the node has no cache directory.
   */
  listPorts(nodeId: string): string[] {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
    } catch {
      return []
    }
  }

  /** Read metadata only — no shard reassembly (cheap for refresh skip checks). */
  readMeta(nodeId: string, portId: string): OutputCacheMeta | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as OutputCacheV1
      if (parsed.schemaVersion !== 1) return null
      const sharded = typeof parsed.dataChunks === 'number' && parsed.dataChunks >= 0
      return {
        executedHash: parsed.executedHash,
        valid: parsed.valid,
        sharded,
        ...(sharded ? { dataChunks: parsed.dataChunks } : {}),
      }
    } catch {
      return null
    }
  }

  /** Read one cached entry. Returns null when missing or invalid JSON. */
  read(nodeId: string, portId: string): OutputCacheV1 | null {
    const p = this.jsonPath(nodeId, portId)
    if (!existsSync(p)) return null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as OutputCacheV1
      if (parsed.schemaVersion !== 1) return null
      // Sharded `data`: reassemble from per-item chunk files. Each chunk is
      // parsed on its own (never one giant string), then regrouped in memory.
      if (typeof parsed.dataChunks === 'number' && parsed.dataChunks >= 0) {
        parsed.data = this.readDataChunks(nodeId, portId, parsed.dataChunks)
        delete parsed.dataChunks
      }
      return parsed
    } catch {
      return null
    }
  }

  /**
   * Reassemble sharded `data` from its per-item chunk files. Chunks are stored
   * in iteration order and regrouped back into DataTreeEntry[] by branch path
   * (contiguous chunks sharing a path collapse into one entry's `items`). A
   * chunk with `path === null` is a non-DataTree fallback element, pushed as-is.
   */
  private readDataChunks(nodeId: string, portId: string, count: number): unknown[] {
    const dir = this.dataChunkDir(nodeId, portId)
    const out: unknown[] = []
    let current: { path: number[]; items: unknown[] } | null = null
    for (let i = 0; i < count; i++) {
      const chunk = JSON.parse(readFileSync(join(dir, chunkName(i)), 'utf-8')) as DataChunk
      if (chunk.path === null) {
        if (current) {
          out.push(current)
          current = null
        }
        out.push(chunk.item)
        continue
      }
      // Open (or switch to) the entry for this branch path. An `empty` chunk
      // opens a zero-item entry and contributes no item.
      if (!current || !samePath(current.path, chunk.path)) {
        if (current) out.push(current)
        current = { path: [...chunk.path], items: [] }
      }
      if (!chunk.empty) current.items.push(chunk.item)
    }
    if (current) out.push(current)
    return out
  }

  /**
   * Write a cached entry. Inline JSON when small, sibling .bin when binary,
   * sharded chunks when huge.
   *
   * Returns `true` when the payload was "large" — sharded or binary — and
   * `false` when it inlined as a small value. Callers (the executor) use this
   * to decide whether to also echo the value back in an HTTP response: a large
   * value must NOT be serialized into the execute response (it would rebuild
   * the same multi-hundred-MB string this sharding exists to avoid), so the
   * client re-fetches it lazily from the cache instead.
   */
  write(nodeId: string, portId: string, entry: Omit<OutputCacheV1, 'schemaVersion'>, binPayload?: Buffer): boolean {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // A stale shard dir from a previous (possibly larger) write must not survive
    // a new inline/binary write, or read() would resurrect the old payload.
    const shardDir = this.dataChunkDir(nodeId, portId)
    if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true })

    const finalEntry: OutputCacheV1 = { schemaVersion: 1, ...entry }

    if (binPayload !== undefined) {
      finalEntry.binFile = `${portId}.bin`
      delete (finalEntry as { data?: unknown }).data
      writeFileSync(this.binPath(nodeId, portId), binPayload)
      writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
      return true
    }

    // Shard only array payloads (the wire shape is DataTreeEntry[]). A non-array
    // value is a scalar/object that the wire contract never grows unbounded, so
    // it inlines safely.
    const data = (finalEntry as { data?: unknown }).data
    if (Array.isArray(data) && this.exceedsInlineBudget(data)) {
      const chunkCount = this.writeShardedData(nodeId, portId, data)
      delete (finalEntry as { data?: unknown }).data
      finalEntry.dataChunks = chunkCount
      // The metadata file carries no inline `data`, so this stringify is tiny
      // and can never hit the single-string limit.
      writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
      return true
    }

    writeFileSync(this.jsonPath(nodeId, portId), stringifyEntry(finalEntry), 'utf-8')
    return false
  }

  /**
   * Decide if an array `data` is too large to inline. We sum each item's
   * serialized byte length (DataTreeEntry items individually, or whole elements
   * for the fallback) and short-circuit once the running total crosses the
   * budget — so we never build the full combined string just to measure it.
   */
  private exceedsInlineBudget(data: readonly unknown[]): boolean {
    let total = 0
    for (const element of data) {
      if (isDataTreeEntry(element)) {
        for (const item of element.items) {
          total += Buffer.byteLength(JSON.stringify(item) ?? 'null', 'utf-8')
          if (total > INLINE_DATA_MAX_BYTES) return true
        }
      } else {
        total += Buffer.byteLength(JSON.stringify(element) ?? 'null', 'utf-8')
        if (total > INLINE_DATA_MAX_BYTES) return true
      }
    }
    return false
  }

  /**
   * Shard `data` into one chunk file per item (per (branch-path, item) pair for
   * DataTreeEntry elements; per whole element for fallback). Returns the number
   * of chunk files written. Each chunk is serialized in isolation and stays far
   * below the single-string limit regardless of how many branches/items exist.
   */
  private writeShardedData(nodeId: string, portId: string, data: readonly unknown[]): number {
    const dir = this.dataChunkDir(nodeId, portId)
    mkdirSync(dir, { recursive: true })
    let index = 0
    for (const element of data) {
      if (isDataTreeEntry(element)) {
        const path = element.path
        if (element.items.length === 0) {
          // Preserve an empty branch as a chunk with no item so read can still
          // reconstruct a zero-item entry at this path.
          this.writeChunk(dir, index++, { path, empty: true })
          continue
        }
        for (const item of element.items) {
          this.writeChunk(dir, index++, { path, item })
        }
      } else {
        this.writeChunk(dir, index++, { path: null, item: element })
      }
    }
    return index
  }

  private writeChunk(dir: string, index: number, chunk: DataChunk): void {
    // One item per chunk → serializes independently, never near the limit.
    writeFileSync(join(dir, chunkName(index)), JSON.stringify(chunk), 'utf-8')
  }

  /** Mark a node's cache invalid by removing its directory (json + bin + shards). */
  invalidate(nodeId: string): void {
    const dir = join(this.root, nodeId)
    if (!existsSync(dir)) return
    rmSync(dir, { recursive: true, force: true })
  }

  /** Clear the entire cache root. */
  clearAll(): void {
    if (!existsSync(this.root)) return
    rmSync(this.root, { recursive: true, force: true })
  }
}

/** Branch-path equality for regrouping contiguous per-item chunks. */
function samePath(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
