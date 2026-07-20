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
//
// 2026-07-01 新增：可选的 `expectedLocationNames` 入参 — 上游叙事/契约地点名列表。
// 当调用方（aw-support/Sino，经 scene:pipeline.execute 的 narrativeLocationNames 参数）
// 提供了这份名单，本模块会把已经收集到的 childNames/descendantNames（本就是
// sino 判断"每组是否产出"的信号）拿来同时跑一遍 stage3.location_names 硬门控
// （见 lib/locationNameGate.ts），并把结果写进 `verification.locationNameAlignment`
// + 追加进 `verification.hints`——不通过就在摘要里给出结构化缺失清单，而不是让
// 命名对齐仅仅停留在 prompt 文档里的"应该"。

import { checkLocationNameAlignment } from './lib/locationNameGate.js'

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
/**
 * 复盘(2026-07-01 循环引用死循环事故):这里原来是无环防护的裸递归——若树里出现
 * 结构性循环引用(baked-scene.json 观测到的 ~9.7 亿次迭代死循环),会直接栈溢出
 * 或长时间挂死整个执行摘要计算,拖垮 backend。vendor 的不可变 tree API 理论上不
 * 会产生结构环,但这里作为纵深防御层不依赖那份保证——`visited` 记录已下探过的
 * 节点引用,再次撞到同一引用直接短路返回 0(而不是继续下探),把"死循环"降级成
 * "该子树按 0 计,摘要偏小但绝不挂死"。
 */
function countSubtreeCells(node: unknown, visited: WeakSet<object> = new WeakSet()): number {
  if (!isRecord(node)) return 0
  if (visited.has(node)) return 0
  visited.add(node)
  let n = Array.isArray(node.cells) ? node.cells.length : 0
  if (Array.isArray(node.children)) {
    for (const child of node.children) n += countSubtreeCells(child, visited)
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
  // 复盘(2026-07-01):原实现只靠 `seen.size < MAX_DESCENDANT_NAMES` 兜底——如果环上
  // 的节点全同名(seen.size 卡在 1 不再增长)或环很大,queue 会被同一批节点反复
  // push 到无界增长,MAX_DESCENDANT_NAMES 根本拦不住,照样 OOM/挂死。额外用
  // `visitedRefs` 记对象引用去重,任何节点只下探一次,双重兜底。
  const visitedRefs = new WeakSet<object>()
  const queue: unknown[] = [...root.children]
  while (queue.length > 0 && seen.size < MAX_DESCENDANT_NAMES) {
    const node = queue.shift()
    if (!isRecord(node)) continue
    if (visitedRefs.has(node)) continue
    visitedRefs.add(node)
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
 * Walk the ALREADY-SUMMARIZED outputs tree and collect every scene node name
 * that appears anywhere (`name` / `childNames` / `descendantNames` fields).
 * This is the "final baked/executed scene graph's set of node names" the
 * location-name gate compares the upstream narrative names against — sourced
 * from the summary (not the raw ExecutionResult) so it stays cheap and never
 * re-walks the potentially-huge scene trees a second time.
 */
function collectSceneNodeNamesFromSummary(summarizedOutputs: Record<string, Record<string, unknown>>): string[] {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.name === 'string' && value.name.length > 0) names.add(value.name)
    if (Array.isArray(value.childNames)) {
      for (const n of value.childNames) if (typeof n === 'string') names.add(n)
    }
    if (Array.isArray(value.descendantNames)) {
      for (const n of value.descendantNames) if (typeof n === 'string') names.add(n)
    }
    for (const v of Object.values(value)) visit(v)
  }
  visit(summarizedOutputs)
  return [...names]
}

/**
 * Project a full ExecutionResult into a KB-scale summary for the AI tool layer.
 * status / error / executionId / durationMs are preserved verbatim — sino judges
 * success/failure on them. `outputs` is projected node-by-node, port-by-port into
 * child names + cell counts, never the raw cells.
 *
 * `expectedLocationNames` (optional): the upstream narrative/location-tree entity
 * names (硬门控 stage3.location_names — see compose-sino-scene/SKILL.md 与
 * compose-sino-scene/SKILL.md「命名对齐 + 结构展开」). When supplied and non-empty,
 * this runs `checkLocationNameAlignment` against every node name collected from
 * `outputs` and reports the result under `verification.locationNameAlignment`
 * (plus a hint line when it fails) — never a silent no-op, and a failing check
 * always carries the structured missing-name list, never a bare boolean.
 */
export function summarizeExecutionResult(full: unknown, expectedLocationNames?: readonly string[]): unknown {
  if (!isRecord(full)) return full
  const summarizedOutputs: Record<string, Record<string, unknown>> = {}
  const outputs = isRecord(full.outputs) ? full.outputs : {}
  let totalSceneCells = 0
  for (const [nodeId, ports] of Object.entries(outputs)) {
    if (!isRecord(ports)) continue
    const portSummaries: Record<string, unknown> = {}
    for (const [portId, value] of Object.entries(ports)) {
      try {
        portSummaries[portId] = summarizePort(value)
        const ps = portSummaries[portId] as PortSummary
        if (typeof ps.totalCellCount === 'number') totalSceneCells += ps.totalCellCount
      } catch {
        portSummaries[portId] = { error: 'summary failed for this port' }
      }
    }
    summarizedOutputs[nodeId] = portSummaries
  }

  const status = full.status
  const structuralHints: string[] = []
  if (status === 'completed' && totalSceneCells === 0) {
    structuralHints.push(
      'execute completed but totalCellCount=0 across all ports. This is NOT template whitelist blocking. ' +
      'Required scene inputs are likely disconnected (悬空端口) or Rest wiring is wrong. ' +
      'Run pipeline.get, verify edges into template group in_* ports, fix Rest chain (fast-loop.md), re-execute.',
    )
  } else if (status === 'completed') {
    for (const [nodeId, ports] of Object.entries(summarizedOutputs)) {
      const portEntries = Object.entries(ports)
      if (portEntries.length === 0) {
        structuralHints.push(
          `Node ${nodeId} has no output ports in execute summary — likely required inputs (in_*) disconnected. ` +
          'NOT whitelist blocking. Run pipeline.get and verify edges (e.g. IslandRegions.in_1 ← manual_points.point, NOT "points").',
        )
        continue
      }
      for (const [portId, summary] of portEntries) {
        const ps = summary as PortSummary
        if (portId.includes('out') && ps.itemCount === 0 && ps.branchCount === 0) {
          structuralHints.push(
            `Node ${nodeId} port ${portId} is empty after completed execute — check incoming connect to this group's inputs ` +
            '(IslandRegions: in_0 scene + in_1 Points via manual_points.point or tree_merge; PickOneBuilding: in_3 Point). NOT whitelist.',
          )
        }
      }
    }
  }

  const locationHints: string[] = []

  // stage3.location_names 硬门控（2026-07-01 新增，见 lib/locationNameGate.ts）：
  // 仅当调用方提供了非空的上游叙事/契约地点名单才跑（DEFAULT-OFF，同
  // isSinoBatch/checkSinoOpAllowlist 的哲学——没传名单就是没有上游契约可比对，
  // 不能瞎报缺失，也不影响未传该参数的既有调用方）。结果永远是结构化对象
  // （{ok, missing:[{name,reason}]}），从不是裸布尔，未命中同时并入上面的
  // `hints` 数组，让 Sino 在同一份摘要里看到全部需要修的问题。
  const hasExpectedNames = Array.isArray(expectedLocationNames) && expectedLocationNames.length > 0
  const locationRejection = hasExpectedNames
    ? checkLocationNameAlignment(expectedLocationNames!, collectSceneNodeNamesFromSummary(summarizedOutputs))
    : null
  if (locationRejection) {
    locationHints.push(
      `[stage3.location_names] ${locationRejection.reason} 缺失地点：${locationRejection.missing.map((m) => m.name).join('、')}。${locationRejection.fix}`,
    )
  }

  const hints = [...structuralHints, ...locationHints]
  const locationNamesOk = !locationRejection?.missing?.length

  return {
    executionId: full.executionId,
    status: full.status,
    durationMs: full.durationMs,
    ...(full.error !== undefined ? { error: full.error } : {}),
    ...(Array.isArray((full as { execFailures?: string[] }).execFailures)
      ? { execFailures: (full as { execFailures: string[] }).execFailures }
      : {}),
    summarized: true,
    verification: {
      ok: structuralHints.length === 0 && (!hasExpectedNames || locationNamesOk),
      totalSceneCells,
      ...(hasExpectedNames
        ? {
            locationNameAlignment: locationRejection
              ? { ok: false, missing: locationRejection.missing, fix: locationRejection.fix }
              : { ok: true, missing: [] },
          }
        : {}),
      ...(hints.length > 0 ? { hints } : {}),
    },
    outputs: summarizedOutputs,
  }
}
