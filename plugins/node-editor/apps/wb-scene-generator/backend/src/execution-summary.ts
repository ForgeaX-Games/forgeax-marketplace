// Agent-facing projection of a pipeline ExecutionResult.
//
// The REST route /api/v1/execute (routes/execute.ts) intentionally returns the
// FULL ExecutionResult — every node/port carries its DataTreeEntry[] wire value,
// and a scene port's items embed the entire SceneNodeSnapshot tree with all voxel
// `cells`. For a real graph that is ~28MB (single port up to ~1.7MB). UI and other
// REST callers may depend on the full payload, so the route stays as-is.
//
// But the agent tool `scene:pipeline.execute` must NOT pour that into the model's
// context. This module projects the full result into a KB-scale summary that keeps
// exactly what sino needs to verify "did each group produce output":
//   - top-level status / error / durationMs (unchanged — sino judges success on these)
//   - per node/port: branch & item counts, the scene tree's child NAMES, and voxel
//     CELL COUNTS (never the cells themselves).
//
// The projection is defensive: any unexpected port shape collapses to a safe note
// instead of throwing, so one malformed port can never break the whole summary.

/** Mirrors layer2/execute-node.ts ExecutionResult (kept local to avoid a dep). */
export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  outputs: Record<string, Record<string, unknown>>
  error?: { nodeId?: string; message: string }
  durationMs: number
}

// Above this many cells/items we replace the array with a count and stop walking
// into individual elements. Small scalar/string/number ports pass through as-is.
const MAX_INLINE_ITEMS = 8
// A scalar string item longer than this is replaced by a shape note instead of
// being inlined. Guards against image/data-URI ports (2D asset app) and other
// large text payloads bloating the summary — sino only needs the shape, not the
// bytes. (Tier-4 spill in host_tool_bridge is the backstop if a summary still
// somehow grows large; this keeps the common case lean at the source.)
const MAX_STRING_CHARS = 256
const MAX_CHILD_NAMES = 64
// Cap on unique descendant names collected per scene subtree. Names are the key
// signal sino uses to verify "which assets/groups got produced" (the SKILL jq
// `[.. | objects | select(has("name")) | .name] | unique`), and real graphs nest
// the asset names a couple levels below the focus root — so we collect uniquely
// across the subtree, not just direct children. Bounded to stay KB-scale.
const MAX_DESCENDANT_NAMES = 80

/** A scene node snapshot's lightweight summary: name + schema + cell count + child names. */
interface SceneNodeSummary {
  name?: string
  path?: string
  schema?: string
  /** Cells on this node only (not descendants). */
  cellCount: number
  /** Total cells in this node's whole subtree (self + descendants). */
  subtreeCellCount: number
  childCount: number
  /** Direct child names — sino's primary "what did this group produce" signal. */
  childNames?: string[]
  /** Unique node names anywhere in the subtree (bounded) — surfaces nested asset names. */
  descendantNames?: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Count cells across a SceneNodeSnapshot subtree (self + all descendants). Defensive. */
function countSubtreeCells(node: unknown): number {
  if (!isRecord(node)) return 0
  let n = Array.isArray(node.cells) ? node.cells.length : 0
  if (Array.isArray(node.children)) {
    for (const child of node.children) n += countSubtreeCells(child)
  }
  return n
}

/**
 * Collect unique node names across a subtree (breadth-first, bounded). The root
 * itself is skipped (its name is reported separately); we want the descendant
 * asset/group names sino verifies against (e.g. "architecture_0", "rest", "石路").
 * Stops once `out` reaches MAX_DESCENDANT_NAMES so a huge tree stays KB-scale.
 */
function collectDescendantNames(root: unknown): string[] {
  if (!isRecord(root) || !Array.isArray(root.children)) return []
  const seen = new Set<string>()
  const queue: unknown[] = [...root.children]
  while (queue.length > 0 && seen.size < MAX_DESCENDANT_NAMES) {
    const node = queue.shift()
    if (!isRecord(node)) continue
    if (typeof node.name === 'string' && node.name.length > 0) seen.add(node.name)
    if (Array.isArray(node.children)) {
      for (const child of node.children) queue.push(child)
    }
  }
  return [...seen]
}

/** Summarize a SceneNodeSnapshot (the `tree` of a scene port value). Never throws. */
function summarizeSceneNode(node: unknown): SceneNodeSummary {
  if (!isRecord(node)) {
    return { cellCount: 0, subtreeCellCount: 0, childCount: 0 }
  }
  const cells = Array.isArray(node.cells) ? node.cells : []
  const children = Array.isArray(node.children) ? node.children : []
  const childNames = children
    .map((c) => (isRecord(c) && typeof c.name === 'string' ? c.name : undefined))
    .filter((name): name is string => name !== undefined)
    .slice(0, MAX_CHILD_NAMES)
  const summary: SceneNodeSummary = {
    cellCount: cells.length,
    subtreeCellCount: countSubtreeCells(node),
    childCount: children.length,
  }
  if (typeof node.name === 'string') summary.name = node.name
  if (typeof node.path === 'string') summary.path = node.path
  if (typeof node.schema === 'string') summary.schema = node.schema
  if (childNames.length > 0) summary.childNames = childNames
  const descendantNames = collectDescendantNames(node)
  if (descendantNames.length > 0) summary.descendantNames = descendantNames
  return summary
}

/**
 * Summarize a single item inside a DataTreeEntry.items array. An item is the
 * actual wire payload for one branch element:
 *   - scene port  → ScenePortValue `{ tree: SceneNodeSnapshot, focus }`
 *   - string/number/boolean → the scalar (small → kept as-is)
 *   - grid        → nested arrays (huge → replaced by a shape note)
 *   - other arrays/objects → shape note with a length/size
 */
function summarizeItem(item: unknown): unknown {
  // Scene port value: { tree, focus }
  if (isRecord(item) && isRecord(item.tree)) {
    return {
      focus: typeof item.focus === 'string' ? item.focus : undefined,
      tree: summarizeSceneNode(item.tree),
    }
  }
  // Long strings (image data URIs, base64, big text) → shape note, never inlined.
  if (typeof item === 'string' && item.length > MAX_STRING_CHARS) {
    return { kind: 'string', length: item.length }
  }
  // Small scalars pass through unchanged (string/number/boolean/null).
  if (item === null || typeof item !== 'object') return item
  // Arrays (e.g. grid 2D arrays, raw cell lists) — never inline; just shape it.
  if (Array.isArray(item)) {
    return { kind: 'array', length: item.length }
  }
  // A bare SceneNodeSnapshot (no port wrapper) — summarize it directly.
  if (isRecord(item) && (typeof item.path === 'string' || Array.isArray(item.children) || Array.isArray(item.cells))) {
    return { tree: summarizeSceneNode(item) }
  }
  // Unknown object: report its keys so sino sees structure without payload.
  return { kind: 'object', keys: Object.keys(item).slice(0, 32) }
}

/** A summarized port: branch/item counts + per-item lightweight summaries. */
interface PortSummary {
  /** Number of DataTree branches (entries). */
  branchCount: number
  /** Total items across all branches. */
  itemCount: number
  /** Total voxel cells across every scene item in this port (subtree-wide). */
  totalCellCount: number
  /** Per-item summaries (capped; if more, a `truncated` flag is set). */
  items: unknown[]
  truncated?: boolean
}

/** Summarize one port wire value (DataTreeEntry[] toJSON form). Never throws. */
function summarizePort(value: unknown): unknown {
  // Expected shape: DataTreeEntry[] = [{ path, items }, ...]
  if (!Array.isArray(value)) {
    // Unexpected (non-array) port value — report shape only.
    if (value === null || typeof value !== 'object') return { value }
    return { kind: 'object', keys: Object.keys(value as object).slice(0, 32) }
  }
  const summaries: unknown[] = []
  let itemCount = 0
  let totalCellCount = 0
  let truncated = false
  for (const entry of value) {
    const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items : []
    itemCount += items.length
    for (const item of items) {
      // Tally cells regardless of whether we inline this item's summary.
      if (isRecord(item) && isRecord(item.tree)) {
        totalCellCount += countSubtreeCells(item.tree)
      } else if (isRecord(item) && (Array.isArray(item.children) || Array.isArray(item.cells))) {
        totalCellCount += countSubtreeCells(item)
      }
      if (summaries.length < MAX_INLINE_ITEMS) {
        const path = isRecord(entry) && Array.isArray(entry.path) ? entry.path : undefined
        summaries.push({ ...(path ? { path } : {}), ...(summarizeItemAsObject(item)) })
      } else {
        truncated = true
      }
    }
  }
  const out: PortSummary = {
    branchCount: value.length,
    itemCount,
    totalCellCount,
    items: summaries,
  }
  if (truncated) out.truncated = true
  return out
}

/** Wrap summarizeItem so a scalar item still nests under a `value` key for consistency. */
function summarizeItemAsObject(item: unknown): Record<string, unknown> {
  const s = summarizeItem(item)
  return isRecord(s) ? s : { value: s }
}

/**
 * Project a full ExecutionResult into a KB-scale summary for the AI tool layer.
 * status / error / executionId / durationMs are preserved verbatim — sino judges
 * success/failure on them. `outputs` is projected node-by-node, port-by-port into
 * child names + cell counts, never the raw cells.
 */
export function summarizeExecutionResult(full: unknown): unknown {
  if (!isRecord(full)) return full
  const summarizedOutputs: Record<string, Record<string, unknown>> = {}
  const outputs = isRecord(full.outputs) ? full.outputs : {}
  for (const [nodeId, ports] of Object.entries(outputs)) {
    if (!isRecord(ports)) continue
    const portSummaries: Record<string, unknown> = {}
    for (const [portId, value] of Object.entries(ports)) {
      try {
        portSummaries[portId] = summarizePort(value)
      } catch {
        portSummaries[portId] = { error: 'summary failed for this port' }
      }
    }
    summarizedOutputs[nodeId] = portSummaries
  }
  return {
    executionId: full.executionId,
    status: full.status,
    durationMs: full.durationMs,
    ...(full.error !== undefined ? { error: full.error } : {}),
    summarized: true,
    outputs: summarizedOutputs,
  }
}
