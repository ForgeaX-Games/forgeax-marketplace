// Pipeline store — the core editor state: battery catalog, the working
// pipeline (nodes / edges / groups / annotations / frames), selection, node
// output cache, dynamic ports, plus execution and the AI-agent live-sync path.
//
// Transport: all backend I/O goes through the editor transport (see
// src/editor/transport) which bridges onto the kernel ApiClient. Graph
// mutations are submitted as kernel Op batches via applyBatch; the kernel
// announces 'graph:applied', and subscribeLiveSync() refetches the snapshot so
// the canvas updates the same way for every actor — human, AI or CLI. This is
// the North-Star "watch the AI work": agentAdd*/Remove*/Update* drive the store
// exactly like human edits, and a graph change from any actor flows back in.
//
// Decomposition: pure helpers live in pipelineStore.helpers.ts. The visual
// (ReactFlow) layer is wired through registerRfSetters() and consumed by the
// agent ops; the canvas components that supply those setters land in a later
// stage, so the data path here is fully exercised on its own.

import { create } from 'zustand'
import type { Node, Edge } from 'reactflow'

import type { ExecutionResult } from '@forgeax/node-runtime'

import { getEditorTransport } from '../transport/index.js'
import { makeGroupBoundaryNodeId, makeGroupContextNodeId } from '../components/canvas/groupBoundaryIds.js'
import { useHistoryStore } from './historyStore.js'
import { createEmptyPipeline, getDownstreamIds } from './pipelineStore.helpers.js'
import { bridgeBatchToHistory } from './pipelineHistoryBridge.js'
import { formatIdAsLabel } from '../utils/batteryLabels.js'
import {
  estimateValueBytes,
  logPersistDone,
  logPersistFlush,
  logPersistSchedule,
  logRefreshEnd,
  logRefreshStart,
  setPersistTraceReason,
  type RefreshReason,
  type RefreshPortStat,
} from '../utils/refreshTrace.js'
import {
  deferGraphAppliedBatch,
  deferRefreshUntilViewportEnd,
  flushDeferredGraphAppliedBatches,
  isViewportMoving,
  registerGraphAppliedHandler,
  setViewportMoving,
  takeDeferredRefreshReason,
} from '../utils/viewportRefreshDefer.js'

import type {
  Battery,
  BatteryAccess,
  BatteryCategory,
  BatteryOrder,
  CanvasAnnotation,
  CanvasFrame,
  ExposedPort,
  NodeGroup,
  Pipeline,
  PipelineNode,
  PipelineEdge,
  PipelineStatus,
} from '../types.js'

interface CompileInfo {
  status: 'success' | 'error' | 'compiling'
  message: string
}

type DynamicPort = { name: string; type: string; label: string; access?: BatteryAccess }

// Resolve an English display name for a pipeline node, for history `labelEn`
// (so AI/programmatic ops never leak the localized zh name into the EN panel).
function nodeNameEn(node: { name?: string; batteryId?: string }, batteries: Battery[]): string {
  const battery = batteries.find((b) => b.id === node.batteryId)
  if (battery?.nameEn) return battery.nameEn
  if (node.batteryId && node.batteryId !== '__group__') return formatIdAsLabel(node.batteryId)
  return node.name ?? node.batteryId ?? 'node'
}

// Live param-edit (slider drag) execution driver: a "latest value wins" stream
// with no fixed-interval throttle. `_execInFlight` ensures at most one execute
// for a dragged param runs at a time; `_execThrottlePendingId` remembers the
// newest node to run the moment the in-flight one settles. The slider itself
// caps pushes to one per animation frame, so this stays continuous (tracks the
// finger) instead of being diluted into a few sparse ticks.
let _execInFlight = false
let _execThrottlePendingId: string | null = null

// Group-view inner param-edit sink. While the canvas shows a group's INTERNAL
// view, inner nodes live in the group-view hook's live refs (flushed back to the
// store group on exit), NOT in `currentPipeline.nodes`. A param edit (text panel
// content, slider/toggle value, resize) is issued by a node component calling
// `updateNodeParam` directly, so without this bridge it would map over the ROOT
// nodes (where the inner node is absent) and be lost — the group never turns
// `unsaved*`. The group-view hook registers this sink while a group view is
// active (clears on exit); `updateNodeParam` routes through it. Returns whether
// the id was handled (false for non-inner ids → store falls back to root path).
// Node ADD is handled separately at the drop hook (placeBattery), not here, so
// other root `addNode` callers (paste / ctrl-drag) are left untouched.
type GroupInnerParamSink = (nodeId: string, key: string, value: unknown) => boolean
let _groupInnerSink: GroupInnerParamSink | null = null
export function setGroupInnerSink(sink: GroupInnerParamSink | null): void {
  _groupInnerSink = sink
}

// Run one local-param-edit execute, then immediately fire the latest pending one
// (if a newer drag value arrived while this was in flight). Defined at module
// scope so updateNodeParam can drive it without re-creating closures per call.
async function runParamExec(get: () => PipelineState, nodeId: string): Promise<void> {
  _execInFlight = true
  try {
    await get().incrementalExecute(nodeId, false, { localParamEdit: true })
  } finally {
    _execInFlight = false
    if (_execThrottlePendingId !== null) {
      const next = _execThrottlePendingId
      _execThrottlePendingId = null
      void runParamExec(get, next)
    }
  }
}

// Local graph writes are serialized so an older async persist cannot commit
// after a newer delete and recreate nodes from its stale desired snapshot.
let _localMutationSeq = 0
let _persistQueue: Promise<unknown> = Promise.resolve()

// Debounced best-effort persist for high-frequency layout/UI changes (node
// drag, annotation/frame move, preview toggle). Coalesces a burst into a single
// op-persist; the underlying _persistQueue + seq guard still drop any stale
// snapshot, so this only trims redundant in-flight requests. An explicit
// persistSession() cancels the pending timer and flushes immediately.
const PERSIST_DEBOUNCE_MS = 500
let _persistTimer: ReturnType<typeof setTimeout> | null = null

// refreshConnectedOutputs fan-out control. Mount + loadPipeline + live-sync +
// project-activate frequently request a refresh in the same tick; coalescing
// avoids stacking N identical GET storms, and the per-run concurrency cap keeps
// a large graph from opening hundreds of parallel requests at once.
let _outputsRefreshInFlight: Promise<void> | null = null
let _outputsRefreshAgain = false
/** StrictMode / coalesced mount calls share one fan-out per editor session. */
let _mountRefreshInFlight: Promise<void> | null = null
/** Sharded (multi-MB) ports skipped on mount — hydrated one-at-a-time when idle. */
let _deferredLargePortTimer: ReturnType<typeof setTimeout> | null = null
const _deferredLargePorts: Array<{ nodeId: string; port: string }> = []
// Each worker fetches a node port's FULL output value. Scene outputs can be
// hundreds of MB (voxel-mass data trees), and the backend reassembles + JSON-
// serializes each one in memory for the HTTP response. At concurrency 8 that
// was several 400MB trees in flight simultaneously — a multi-GB heap spike that
// helped tip the backend into OOM. 3 keeps the refresh responsive while
// bounding the worst-case concurrent payload memory.
const OUTPUTS_REFRESH_CONCURRENCY = 3

/** executedHash per (nodeId, port) — skip full GET when cache entry unchanged. */
const _outputMetaByPort: Record<string, Record<string, string>> = {}

function edgeTopologySignature(pipeline: Pipeline | null | undefined): string {
  if (!pipeline) return ''
  return [...pipeline.edges]
    .map((e) => `${e.source.nodeId}:${e.source.port}->${e.target.nodeId}:${e.target.port}`)
    .sort()
    .join('|')
}

// Per-group in-flight guard for the inner-view probe. exec:completed can fire in
// quick succession (e.g. a group Run followed by its incremental downstream
// pass); without this, each event would launch an overlapping probeGroupInner
// GET. We collapse concurrent probes of the SAME group to a single in-flight
// request so the backend is never hammered with redundant read-only re-runs.
const _groupProbeInFlight = new Map<string, Promise<void>>()

// Self-echo reload suppression for local param edits (slider drag, inspector
// edits). A local `incrementalExecute` already wrote the new param into
// `currentPipeline` BEFORE persisting, so the `graph:applied` self-echo for that
// write would only re-pull the identical snapshot — a full `loadPipeline()`
// rebuild of every node on every drag tick (the slider→preview lag). We tag each
// param-edit persist with a client-generated batchId, recorded synchronously
// BEFORE the write (so there is no race with the echo, whether it arrives in the
// same tick via the in-process mock or a tick later via a real WS), and let the
// handler skip the redundant reload for those batchIds. The grid preview still
// updates because `exec:completed` refreshes the connected outputs. Bounded ring
// so the set never grows unboundedly across a long session.
const _localParamEditBatchIds = new Set<string>()
const LOCAL_PARAM_EDIT_BATCH_LIMIT = 64
function rememberLocalParamEditBatch(batchId: string): void {
  _localParamEditBatchIds.add(batchId)
  if (_localParamEditBatchIds.size > LOCAL_PARAM_EDIT_BATCH_LIMIT) {
    const oldest = _localParamEditBatchIds.values().next().value
    if (oldest !== undefined) _localParamEditBatchIds.delete(oldest)
  }
}
function nextLocalParamEditBatchId(): string {
  return `editor-param-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// While a slider/inspector param edit is actively churning, each tick's execute
// response is applied directly (see incrementalExecute), so the trailing WS
// `exec:completed` -> refreshConnectedOutputs() per-port GET storm is pure
// redundant network churn competing with the drag. Mark a short window after
// each local-param exec; the exec:completed handler skips its re-pull inside it.
// A settle (no new tick within the window) lets the normal refresh resume.
let _localParamEditUntil = 0
const LOCAL_PARAM_EDIT_QUIET_MS = 150
function markLocalParamEditActive(): void {
  _localParamEditUntil = Date.now() + LOCAL_PARAM_EDIT_QUIET_MS
}
function isLocalParamEditActive(): boolean {
  return Date.now() < _localParamEditUntil
}

// Live-sync reconciler: the canvas updates only when a `graph:applied` WS frame
// arrives, so a single missed frame (WS reconnect after a `tsx --watch` backend
// restart, the project-activate rebind window, or a dropped frame) leaves it
// stale with no recovery — while the polling image-preview surface stays current
// (exactly the "preview updates, canvas does not" symptom). The reconciler polls
// the cheap pipeline hash on an interval and refetches when it drifts from the
// last hash we synced, giving the canvas the same self-healing the preview has.
// `_lastSyncedHash` is the content hash of the snapshot currently rendered.
let _lastSyncedHash: string | null = null
const LIVE_SYNC_RECONCILE_MS = 1500

// Local persist batches: correlate graph:applied self-echo with applyBatch metadata
// so layout-only / zero-invalidation writes skip the output fan-out storm.
const _persistBatchMeta = new Map<string, { layoutOnly: boolean; invalidatedNodeCount: number }>()
const PERSIST_BATCH_META_LIMIT = 64

function rememberPersistBatchMeta(
  batchId: string,
  meta: { layoutOnly?: boolean; invalidatedNodeCount?: number },
): void {
  _persistBatchMeta.set(batchId, {
    layoutOnly: !!meta.layoutOnly,
    invalidatedNodeCount: meta.invalidatedNodeCount ?? 0,
  })
  if (_persistBatchMeta.size > PERSIST_BATCH_META_LIMIT) {
    const oldest = _persistBatchMeta.keys().next().value
    if (oldest !== undefined) _persistBatchMeta.delete(oldest)
  }
}

// graph:applied can arrive on multiple WS bindings in the same tick — handle once.
const _handledGraphBatchIds = new Set<string>()
const HANDLED_GRAPH_BATCH_LIMIT = 128

function markGraphBatchHandled(batchId: string): boolean {
  if (_handledGraphBatchIds.has(batchId)) return false
  _handledGraphBatchIds.add(batchId)
  if (_handledGraphBatchIds.size > HANDLED_GRAPH_BATCH_LIMIT) {
    const oldest = _handledGraphBatchIds.values().next().value
    if (oldest !== undefined) _handledGraphBatchIds.delete(oldest)
  }
  return true
}

// Local editor persists: graph:applied (WS) can land before the POST /batch
// response that carries layoutOnly / invalidatedNodeCount — await the in-flight
// persist so the skip path has metadata before deciding to fan-out.
const _localPersistInFlight = new Map<string, Promise<unknown>>()

function markPipelineMutation(): void {
  _localMutationSeq += 1
}

/**
 * Cheap equality for a cached output port value. Primitives (slider values,
 * counts) short-circuit via Object.is. Objects/arrays (grid masks, scene trees)
 * are compared structurally with JSON — the editor's cached outputs are small
 * (a connected grid is a few KB), so this is far cheaper than the alternative:
 * replacing the `nodeOutputs` reference and forcing every subscribed preview to
 * re-render and repaint. JSON throws on cycles; treat that as "not equal" so we
 * fall back to the write rather than risk dropping a real update.
 */
// Cap (bytes, rough) for the deep value-equality compare below. Small port
// values (slider numbers, a few-KB grid array) sit far under this and get an
// exact compare; multi-MB scene / voxel wire values blow past it and skip the
// compare entirely.
const VALUE_COMPARE_BUDGET = 64 * 1024

// Bounded structural size probe: walk the value accumulating an approximate
// byte size and SHORT-CIRCUIT the moment it crosses `budget` — so a multi-MB
// (or multi-hundred-MB) scene tree is rejected after visiting only ~budget
// worth of nodes, never building a string. Returns true = "too big to compare".
function exceedsCompareBudget(value: unknown, budget: number): boolean {
  let size = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === null || cur === undefined) size += 4
    else if (typeof cur === 'string') size += cur.length + 2
    else if (typeof cur === 'number' || typeof cur === 'boolean') size += 8
    else if (Array.isArray(cur)) {
      size += 2
      for (const el of cur) stack.push(el)
    } else if (typeof cur === 'object') {
      for (const k in cur as Record<string, unknown>) {
        size += k.length + 3
        stack.push((cur as Record<string, unknown>)[k])
      }
    }
    if (size > budget) return true
  }
  return false
}

function outputValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  // A large wire value (scene/voxel) is prohibitively expensive to JSON-compare
  // — stringifying it twice on every refreshConnectedOutputs tick is pure churn.
  // Treat it as "changed" (skip the compare, let the preview update); the exact
  // compare is reserved for genuinely small values where it actually saves a
  // redundant re-render.
  if (exceedsCompareBudget(a, VALUE_COMPARE_BUDGET) || exceedsCompareBudget(b, VALUE_COMPARE_BUDGET)) {
    return false
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function enqueuePipelinePersist(snapshot: Pipeline, seq: number, actor = 'editor', batchId?: string) {
  const clientBatchId = batchId ?? crypto.randomUUID()
  const run = async () => {
    if (seq !== _localMutationSeq) return null
    const t0 = performance.now()
    const res = await getEditorTransport().api.updatePipeline(snapshot, actor, clientBatchId)
    const hashUpdated = !!(res?.status === 'ok' && res.newHash)
    // The canvas already reflects this local edit (RF setters / store writes),
    // so adopt the resulting hash as our sync baseline. Otherwise the live-sync
    // reconciler would see the post-persist hash drift and force a redundant
    // full reload that can disrupt an in-progress local edit (e.g. mid-drag).
    if (hashUpdated) _lastSyncedHash = res.newHash!
    if (res?.status === 'ok' && res.batchId) {
      rememberPersistBatchMeta(res.batchId, {
        layoutOnly: res.layoutOnly,
        invalidatedNodeCount: res.invalidatedNodeCount,
      })
    }
    logPersistDone({
      status: res?.status ?? 'unknown',
      newHash: res?.newHash,
      layoutOnly: res?.layoutOnly,
      lastSyncedHashUpdated: hashUpdated,
      durationMs: performance.now() - t0,
    })
    return res
  }
  const next = _persistQueue.then(run, run)
  _persistQueue = next.catch(() => undefined)
  _localPersistInFlight.set(clientBatchId, next)
  void next.finally(() => {
    _localPersistInFlight.delete(clientBatchId)
  })
  return next
}

// Live-drag param write coalescer. The hot path (slider drag / inspector scrub)
// must NOT serialize a whole-graph persist+diff per tick — that is the measured
// avalanche (persist leg 1.3s→3.3s as the queue backs up). Instead each tick
// submits ONE targeted `updateNode` ephemeral op (no getPipeline/listGroups/
// whole-graph diff, no history audit) via api.applyParamOp. To stop a backlog
// from forming we keep at most ONE in-flight write per node and remember only
// the LATEST pending params; while a write is in flight, newer ticks just
// overwrite the pending value, and the trailing run flushes that latest value.
// Stale intermediate values are dropped — the kernel only ever computes the
// newest param the user actually dragged to, so the round-trip can't grow.
interface PendingParamWrite {
  inFlight: boolean
  pending: { params: Record<string, unknown>; batchId?: string } | null
}
const _paramWrites = new Map<string, PendingParamWrite>()

function enqueueParamWrite(
  nodeId: string,
  params: Record<string, unknown>,
  batchId?: string,
): Promise<void> {
  let entry = _paramWrites.get(nodeId)
  if (!entry) {
    entry = { inFlight: false, pending: null }
    _paramWrites.set(nodeId, entry)
  }
  // Always record the latest desired params; an in-flight write picks them up
  // when it drains, so a burst collapses to one trailing write of the newest value.
  entry.pending = { params, batchId }
  if (entry.inFlight) return Promise.resolve()

  const drain = async (): Promise<void> => {
    const e = _paramWrites.get(nodeId)
    if (!e || !e.pending) {
      if (e) e.inFlight = false
      return
    }
    e.inFlight = true
    const { params: p, batchId: b } = e.pending
    e.pending = null
    try {
      await getEditorTransport().api.applyParamOp(nodeId, p, 'editor', b)
    } catch (err) {
      console.warn('[pipelineStore] param write failed:', err)
    }
    // A newer tick may have arrived while this write was in flight — flush it.
    e.inFlight = false
    if (e.pending) await drain()
  }
  return drain()
}

function fanOutScopeForReason(reason: RefreshReason): 'edges' | 'all' {
  // Cold open: hydrate wire/probe sources first; unconnected visible ports load
  // on hover / a trailing idle pass — avoids 100MB+ on the critical path.
  return reason === 'mount' ? 'edges' : 'all'
}

function scheduleDeferredLargePortHydration(
  get: () => PipelineState,
  ports: ReadonlyArray<{ nodeId: string; port: string }>,
): void {
  if (ports.length === 0) return
  for (const p of ports) {
    const key = `${p.nodeId}\u0000${p.port}`
    if (_deferredLargePorts.some((d) => `${d.nodeId}\u0000${d.port}` === key)) continue
    _deferredLargePorts.push(p)
  }
  if (_deferredLargePortTimer) return
  const tick = (): void => {
    _deferredLargePortTimer = null
    if (isViewportMoving() || _deferredLargePorts.length === 0) {
      if (_deferredLargePorts.length > 0) {
        _deferredLargePortTimer = setTimeout(tick, 250)
      }
      return
    }
    const next = _deferredLargePorts.shift()!
    void (async () => {
      const t0 = performance.now()
      try {
        const { api } = getEditorTransport()
        let meta: { executedHash: string; valid: boolean } | null = null
        try {
          meta = await api.getNodeOutputMeta(next.nodeId, next.port)
        } catch {
          /* optional */
        }
        const value = await api.getNodeOutput(next.nodeId, next.port)
        if (value !== undefined) {
          get().setNodeOutput(next.nodeId, next.port, value)
          if (meta?.executedHash) {
            if (!_outputMetaByPort[next.nodeId]) _outputMetaByPort[next.nodeId] = {}
            _outputMetaByPort[next.nodeId][next.port] = meta.executedHash
          }
        }
        if (typeof import.meta !== 'undefined' && (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD !== true) {
          const bytes = estimateValueBytes(value)
          if (bytes > 256 * 1024) {
            console.log(
              `[refresh-trace] mount-deferred ${next.nodeId}/${next.port} ` +
                `${(bytes / (1024 * 1024)).toFixed(2)}MB ${(performance.now() - t0).toFixed(0)}ms`,
            )
          }
        }
      } catch {
        /* cold / transient */
      }
      _deferredLargePortTimer = setTimeout(tick, _deferredLargePorts.length > 0 ? 50 : 0)
    })()
  }
  const schedule =
    typeof requestIdleCallback === 'function'
      ? (fn: () => void) => requestIdleCallback(fn, { timeout: 3000 })
      : (fn: () => void) => setTimeout(fn, 500)
  schedule(tick)
}

/**
 * One fan-out pass for refreshConnectedOutputs: collect every distinct visible /
 * wire-feeding output port, then GET its cached value with a bounded number of
 * concurrent requests (so a large graph never opens hundreds of parallel GETs).
 */
async function fanOutConnectedOutputs(
  get: () => PipelineState,
  reason: RefreshReason,
): Promise<{ fetched: number; skipped: number; totalBytes: number; topPorts: RefreshPortStat[]; abortedForViewport?: boolean; deferredLarge?: Array<{ nodeId: string; port: string }> }> {
  const stats = { fetched: 0, skipped: 0, totalBytes: 0, topPorts: [] as RefreshPortStat[] }
  const deferredLarge: Array<{ nodeId: string; port: string }> = []
  const scope = fanOutScopeForReason(reason)
  const { currentPipeline, batteries, dynamicOutputPorts } = get()
  if (!currentPipeline) return stats
  if (isViewportMoving()) {
    deferRefreshUntilViewportEnd(reason)
    return { ...stats, abortedForViewport: true }
  }
  const { api } = getEditorTransport()
  // Distinct (sourceNodeId, sourcePort) pairs feeding any wire, plus every
  // visible output port. Tooltips read nodeOutputs even when a port is not
  // connected, while probes read the same cache for connected edges.
  const seen = new Set<string>()
  const ports: Array<{ nodeId: string; port: string }> = []
  const addPort = (nodeId: string, port: string) => {
    const key = `${nodeId}\u0000${port}`
    if (seen.has(key)) return
    seen.add(key)
    ports.push({ nodeId, port })
  }
  for (const edge of currentPipeline.edges) {
    addPort(edge.source.nodeId, edge.source.port)
  }
  if (scope === 'all') {
  const groupsById = new Map((currentPipeline.groups ?? []).map((g) => [g.id, g] as const))
  for (const node of currentPipeline.nodes) {
    if (node.batteryId === '__group__') {
      const groupId = typeof node.params?.groupId === 'string' ? node.params.groupId : node.id
      const group = groupsById.get(groupId)
      if (group) {
        for (const ep of group.exposedOutputs) {
          if (!ep.hidden) addPort(node.id, ep.portName)
        }
      }
    } else {
      const battery = batteries.find((b) => b.id === node.batteryId)
      if (battery && !battery.hideOutputs) {
        for (const port of battery.outputs) {
          if (!port.hidden) addPort(node.id, port.name)
        }
      }
    }
    for (const port of dynamicOutputPorts[node.id] ?? []) {
      addPort(node.id, port.name)
    }
  }
  }

  let cursor = 0
  let abortedForViewport = false
  const worker = async (): Promise<void> => {
    while (cursor < ports.length) {
      if (isViewportMoving()) {
        abortedForViewport = true
        return
      }
      const { nodeId, port } = ports[cursor]
      cursor += 1
      const t0 = performance.now()
      try {
        let meta: { executedHash: string; valid: boolean; sharded?: boolean; dataChunks?: number } | null = null
        try {
          meta = await api.getNodeOutputMeta(nodeId, port)
        } catch {
          /* meta endpoint optional */
        }
        if (isViewportMoving()) {
          abortedForViewport = true
          return
        }
        const prevHash = _outputMetaByPort[nodeId]?.[port]
        const cached = get().nodeOutputs[nodeId]?.[port]
        if (meta?.valid && meta.executedHash && prevHash === meta.executedHash && cached !== undefined) {
          stats.skipped += 1
          stats.topPorts.push({ nodeId, port, bytes: 0, ms: performance.now() - t0, skipped: true })
          continue
        }
        // Sharded cache entries (tree_merge / tree_flatten with hundreds of scene
        // subtrees) must never be inline-fetched — reassembly + JSON.stringify
        // exceeds V8's single-string limit and 500s the preview bridge.
        if (meta?.sharded) {
          deferredLarge.push({ nodeId, port })
          stats.skipped += 1
          stats.topPorts.push({ nodeId, port, bytes: 0, ms: performance.now() - t0, skipped: true })
          continue
        }
        if (isViewportMoving()) {
          abortedForViewport = true
          return
        }
        const value = await api.getNodeOutput(nodeId, port)
        const ms = performance.now() - t0
        const bytes = estimateValueBytes(value)
        if (value !== undefined) {
          get().setNodeOutput(nodeId, port, value)
          if (meta?.executedHash) {
            if (!_outputMetaByPort[nodeId]) _outputMetaByPort[nodeId] = {}
            _outputMetaByPort[nodeId][port] = meta.executedHash
          }
        }
        stats.fetched += 1
        stats.totalBytes += bytes
        stats.topPorts.push({ nodeId, port, bytes, ms, skipped: false })
      } catch {
        /* port has no value yet / transient — ignore */
      }
    }
  }
  const workerCount = Math.min(OUTPUTS_REFRESH_CONCURRENCY, ports.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (abortedForViewport) deferRefreshUntilViewportEnd(reason)
  return {
    ...stats,
    ...(abortedForViewport ? { abortedForViewport: true } : {}),
    ...(deferredLarge.length > 0 ? { deferredLarge } : {}),
  }
}

// Mirror the real last-run values onto the inner view's synthetic boundary
// (shell) + external context node ids. The inner canvas renders a group's
// exposed-port shell and its external up/downstream nodes under prefixed ids
// distinct from the real node ids that carry the cached outputs, so without this
// alias their ports/wires read empty even though the data exists. Pure store
// reads/writes; no re-execution. Handles nesting via the parent-group container.
function hydrateGroupBoundaryAliases(get: () => PipelineState, groupId: string): void {
  const state = get()
  const pipeline = state.currentPipeline
  if (!pipeline) return
  const group = (pipeline.groups ?? []).find((g) => g.id === groupId)
  if (!group) return

  // Container = the level that instantiates this group: the parent group when
  // nested (one level up the active view stack), else the root pipeline.
  const stack = state.groupViewStack
  const idx = stack.lastIndexOf(groupId)
  const parentGroupId = idx > 0 ? stack[idx - 1] : null
  const parentGroup = parentGroupId ? (pipeline.groups ?? []).find((g) => g.id === parentGroupId) : undefined
  const containerNodes = parentGroup?.nodes ?? pipeline.nodes
  const containerEdges = parentGroup?.edges ?? pipeline.edges
  const shadowNodeId =
    containerNodes.find((n) => n.batteryId === '__group__' && n.params?.groupId === groupId)?.id ?? groupId

  const outputs = get().nodeOutputs
  const shellInId = makeGroupBoundaryNodeId('in', groupId)
  const shellOutId = makeGroupBoundaryNodeId('out', groupId)
  const exposedInNames = new Set(group.exposedInputs.map((p) => p.portName))

  // External inputs: each container edge feeding the shadow node carries the live
  // input value on the real upstream node. Surface it on the shell input port
  // (under the exposed port name) and on the external context-in node (mirroring
  // the whole upstream output bag so every shown handle resolves).
  for (const e of containerEdges) {
    if (e.target.nodeId !== shadowNodeId || !exposedInNames.has(e.target.port)) continue
    const srcBag = outputs[e.source.nodeId]
    if (!srcBag) continue
    const v = srcBag[e.source.port]
    if (v !== undefined) get().setNodeOutput(shellInId, e.target.port, v)
    const ctxInId = makeGroupContextNodeId('in', e.source.nodeId)
    for (const [port, val] of Object.entries(srcBag)) {
      if (val !== undefined) get().setNodeOutput(ctxInId, port, val)
    }
  }

  // Exposed outputs: the group's boundary outputs are cached on the shadow node
  // (written by the real run). Surface them on the shell output port.
  const shadowBag = outputs[shadowNodeId]
  if (shadowBag) {
    for (const ep of group.exposedOutputs) {
      const v = shadowBag[ep.portName]
      if (v !== undefined) get().setNodeOutput(shellOutId, ep.portName, v)
    }
  }

  // External downstream context-out nodes mirror their real output bag so their
  // own ports (if any) show real values too.
  for (const e of containerEdges) {
    if (e.source.nodeId !== shadowNodeId) continue
    const tgtBag = outputs[e.target.nodeId]
    if (!tgtBag) continue
    const ctxOutId = makeGroupContextNodeId('out', e.target.nodeId)
    for (const [port, val] of Object.entries(tgtBag)) {
      if (val !== undefined) get().setNodeOutput(ctxOutId, port, val)
    }
  }
}

// ReactFlow setter refs (module-level; the canvas registers them on mount).
let _rfSetters: {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  onUngroup?: (groupId: string) => void
  onEnterGroup?: (groupId: string) => void
} | null = null

interface PipelineState {
  batteries: Battery[]
  categories: BatteryCategory[]
  batteryOrder: BatteryOrder
  currentPipeline: Pipeline | null
  /** Non-null while a session restore is pending; the canvas rebuilds then clears it. */
  sessionRestorePending: Pipeline | null
  /**
   * Monotonic counter bumped on every `loadPipeline()` (initial load + any
   * graph:applied refetch). The canvas keys its full RF rebuild on this so a
   * refetch with new content but the SAME pipeline id ('main') still rebuilds.
   * Local edits go through RF setters and intentionally do NOT bump this.
   */
  pipelineRevision: number
  pipelineStatus: PipelineStatus
  selectedNode: PipelineNode | null
  selectedNodeIds: string[]
  /** Backend-driven selection signal; the canvas consumes then clears it. */
  pendingSelectNodeIds: string[] | null
  logs: string[]
  compileInfo: CompileInfo | null
  /** Per-node output port values: nodeId → portName → value. */
  nodeOutputs: Record<string, Record<string, unknown>>
  /** Dynamic output port snapshots: nodeId → port list. */
  dynamicOutputPorts: Record<string, DynamicPort[]>
  /** Group-view navigation stack; empty = root level. */
  groupViewStack: string[]

  // Catalog
  setBatteries: (batteries: Battery[]) => void
  setCategories: (categories: BatteryCategory[]) => void
  /** Load the catalog + categories + order from the transport. */
  loadBatteries: () => Promise<void>
  fetchBatteryOrder: () => Promise<void>
  saveBatteryOrder: (order: BatteryOrder) => Promise<void>

  // Pipeline + selection
  setPipeline: (pipeline: Pipeline | null) => void
  setSelectedNode: (node: PipelineNode | null) => void
  setSelectedNodeIds: (ids: string[]) => void
  requestSelectNodes: (ids: string[]) => void
  clearSelectRequest: () => void
  setNodePreview: (nodeIds: string[], enabled: boolean) => void
  addLog: (log: string) => void
  clearLogs: () => void
  setCompileInfo: (info: CompileInfo | null) => void

  // Outputs / dynamic ports
  setNodeOutput: (nodeId: string, portName: string, value: unknown) => void
  clearNodeOutputs: (nodeIds: string[]) => void
  setNodeDynamicOutputPorts: (nodeId: string, ports: DynamicPort[]) => void
  clearNodeDynamicOutputPorts: (nodeIds: string[]) => void

  // Session restore
  restoreSession: () => Promise<void>
  clearSessionRestore: () => void

  // Graph mutations (data layer)
  addNode: (node: PipelineNode) => void
  updateNode: (nodeId: string, updates: Partial<PipelineNode>) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: PipelineEdge) => void
  removeEdge: (edgeId: string) => void

  // Groups
  addGroup: (group: NodeGroup) => void
  removeGroup: (groupId: string) => void
  renameGroup: (groupId: string, name: string) => void
  updateGroup: (groupId: string, updates: Partial<NodeGroup>) => void
  updateGroupPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    patch: Partial<Pick<ExposedPort, 'hidden' | 'customLabel' | 'customLabelEn' | 'order' | 'portType'>>,
  ) => { ok: boolean; reason?: string }
  /** Reorder an exposed group port: delta=-1 moves up, delta=1 moves down. */
  moveGroupPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    delta: -1 | 1,
  ) => { ok: boolean; reason?: string }
  /**
   * Create a new (initially unmapped) exposed port on a group, used by the
   * group-view shell's "+" button. Allocates a fresh stable id (in_N / out_N).
   * Bind it to a real inner port later via {@link bindGroupExposedPort}.
   */
  addGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
  ) => { ok: boolean; portName?: string; reason?: string }
  /**
   * True-delete an exposed port from a group (NOT hide): removes it from
   * exposedInputs/Outputs and drops any external edge referencing it, anywhere
   * it is instanced. The outer group instance auto-derives `unsaved*`.
   */
  removeGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
  ) => { ok: boolean; reason?: string }
  /** Bind / re-wire an exposed port to a real inner port (shell↔inner connect). */
  bindGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    mapping: { sourceNodeId: string; sourcePortName: string; portType?: string; access?: ExposedPort['access'] },
  ) => { ok: boolean; reason?: string }
  /** Unbind an exposed port (shell↔inner disconnect): keeps the port, clears its mapping. */
  unbindGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
  ) => { ok: boolean; reason?: string }
  /**
   * Update a single param of one inner node of a group, then trigger an
   * incremental execution. Used by the GroupNode option pickers, which edit an
   * inner node's param directly.
   */
  updateGroupInnerNodeParam: (groupId: string, innerNodeId: string, key: string, value: unknown) => void

  // Group-view navigation
  enterGroupView: (groupId: string) => void
  exitGroupView: () => void
  popGroupViewTo: (depth: number) => void
  /**
   * Probe a group's inner sub-graph and fill `nodeOutputs` with each inner
   * node's real outputs (keyed by inner node id), so the INTERNAL view's wire
   * data-probes show real data + types instead of empty "any / no result". A
   * group executes as a black box (its inner intermediates are discarded), so
   * the editor re-runs the inner sub-graph on demand when entering its view.
   */
  probeGroupInnerOutputs: (groupId: string) => Promise<void>

  // Params + execution
  updateNodeParam: (nodeId: string, key: string, value: unknown, silent?: boolean) => void
  persistSession: () => Promise<void>
  /** Debounced best-effort session persist for high-frequency layout/UI changes. */
  schedulePersistSession: (reason?: string) => void
  incrementalExecute: (nodeId: string, fullExec?: boolean, options?: { persist?: boolean; localParamEdit?: boolean }) => Promise<void>
  executePipeline: () => Promise<void>
  /**
   * Run the whole pipeline once on project open IFF the output cache is cold
   * (no retained values hydrated). After a cache wipe / first open the graph has
   * inputs but no outputs, so nothing renders and groups can't be probed until
   * the user nudges an input — auto-run so the canvas (and every group's inner
   * view) is populated immediately. A no-op when outputs already exist, so a warm
   * reload never re-runs an expensive graph.
   */
  autoExecuteOnOpen: () => Promise<void>
  stopPipeline: () => Promise<void>

  // Loading
  loadPipeline: () => Promise<void>

  // AI-agent operations (same path as human edits: history + data + RF + exec)
  registerRfSetters: (setters: {
    setNodes: React.Dispatch<React.SetStateAction<Node[]>>
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
    onUngroup?: (groupId: string) => void
    onEnterGroup?: (groupId: string) => void
  }) => void
  agentAddNode: (node: PipelineNode) => void
  agentRemoveNodes: (nodeIds: string[]) => void
  agentAddEdge: (edge: PipelineEdge) => void
  agentRemoveEdges: (edgeIds: string[]) => void
  agentUpdateParams: (nodeId: string, params: Record<string, unknown>) => void

  // Live-sync: subscribe to graph:applied → refetch snapshot, and node-output
  // events → refresh the nodeOutputs cache. Returns unsubscribe.
  subscribeLiveSync: () => () => void
  /** Pull retained last-run values for connected and visible output ports into nodeOutputs. */
  refreshConnectedOutputs: (reason?: RefreshReason) => Promise<void>

  // Canvas annotations
  addAnnotation: (position: { x: number; y: number }) => string
  /** Copy an existing annotation to a new flow position; returns new id, or null if source missing. */
  duplicateAnnotation: (sourceId: string, position: { x: number; y: number }) => string | null
  updateAnnotation: (id: string, text: string, width?: number, height?: number) => void
  moveAnnotation: (id: string, position: { x: number; y: number }) => void
  removeAnnotation: (id: string) => void

  // Canvas frames
  addFrame: (frame: CanvasFrame) => void
  renameFrame: (frameId: string, name: string) => void
  removeFrame: (frameId: string) => void
  updateFrame: (frameId: string, updates: Partial<CanvasFrame>) => void
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  batteries: [],
  categories: [],
  batteryOrder: { bigLabels: [], smallLabels: {} },
  currentPipeline: null,
  sessionRestorePending: null,
  pipelineRevision: 0,
  pipelineStatus: 'idle',
  selectedNode: null,
  selectedNodeIds: [],
  pendingSelectNodeIds: null,
  logs: [],
  compileInfo: null,
  nodeOutputs: {},
  dynamicOutputPorts: {},
  groupViewStack: [],

  // ── Catalog ──────────────────────────────────────────────────────────
  setBatteries: (batteries) => set({ batteries }),
  setCategories: (categories) => set({ categories }),

  loadBatteries: async () => {
    const { api } = getEditorTransport()
    const [batteries, categories] = await Promise.all([api.getBatteries(), api.getCategories()])
    set({ batteries, categories })
    await get().fetchBatteryOrder()
  },

  fetchBatteryOrder: async () => {
    try {
      const order = await getEditorTransport().api.getBatteryOrder()
      set({ batteryOrder: order })
    } catch (error) {
      console.error('Failed to fetch battery order:', error)
    }
  },

  saveBatteryOrder: async (order) => {
    set({ batteryOrder: order })
    try {
      await getEditorTransport().api.saveBatteryOrder(order)
    } catch (error) {
      console.error('Failed to save battery order:', error)
    }
  },

  // ── Pipeline + selection ─────────────────────────────────────────────
  setPipeline: (pipeline) =>
    set({ currentPipeline: pipeline, pipelineStatus: pipeline?.status ?? 'idle' }),

  setSelectedNode: (node) => set({ selectedNode: node }),
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  requestSelectNodes: (ids) => set({ pendingSelectNodeIds: ids }),
  clearSelectRequest: () => set({ pendingSelectNodeIds: null }),

  setNodePreview: (nodeIds, enabled) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: state.currentPipeline.nodes.map((node) =>
            nodeIds.includes(node.id) ? { ...node, previewEnabled: enabled } : node,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('node-preview')
  },

  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),
  setCompileInfo: (info) => set({ compileInfo: info }),

  // ── Outputs / dynamic ports ──────────────────────────────────────────
  // Skip the state write entirely when the value is unchanged. `nodeOutputs` is
  // a single object subscribed to by every preview / probe / tooltip component
  // (e.g. GridPanelNode reads the whole map), so replacing its reference forces
  // ALL of them to re-render + redraw. During a slider drag refreshConnectedOutputs
  // re-GETs *every* connected port on each exec:completed — the unchanged slider
  // value ports and an unchanged grid would otherwise churn the reference (and
  // the grid canvas redraw) on every tick. Object.is short-circuits primitives
  // (slider values); a cheap structural compare via JSON covers grid arrays
  // (the grid output is small — a few KB — so this is far cheaper than a wasted
  // React render + full <canvas> repaint).
  setNodeOutput: (nodeId, portName, value) =>
    set((state) => {
      const prev = state.nodeOutputs[nodeId]?.[portName]
      if (outputValuesEqual(prev, value)) {
        return state
      }
      return {
        nodeOutputs: {
          ...state.nodeOutputs,
          [nodeId]: { ...state.nodeOutputs[nodeId], [portName]: value },
        },
      }
    }),

  clearNodeOutputs: (nodeIds) =>
    set((state) => {
      const next = { ...state.nodeOutputs }
      for (const id of nodeIds) {
        delete next[id]
        delete _outputMetaByPort[id]
      }
      return { nodeOutputs: next }
    }),

  setNodeDynamicOutputPorts: (nodeId, ports) =>
    set((state) => {
      const nextDynOut = { ...state.dynamicOutputPorts, [nodeId]: ports }
      const nextPipeline = state.currentPipeline
        ? {
            ...state.currentPipeline,
            nodes: state.currentPipeline.nodes.map((n) =>
              n.id === nodeId ? { ...n, params: { ...n.params, _dynOutPorts: ports } } : n,
            ),
            updatedAt: new Date().toISOString(),
          }
        : state.currentPipeline
      return { dynamicOutputPorts: nextDynOut, currentPipeline: nextPipeline }
    }),

  clearNodeDynamicOutputPorts: (nodeIds) =>
    set((state) => {
      const nextDynOut = { ...state.dynamicOutputPorts }
      for (const id of nodeIds) delete nextDynOut[id]
      const nextPipeline = state.currentPipeline
        ? {
            ...state.currentPipeline,
            nodes: state.currentPipeline.nodes.map((n) => {
              if (!nodeIds.includes(n.id)) return n
              const { _dynOutPorts: _removed, ...restParams } = n.params as Record<string, unknown>
              void _removed
              return { ...n, params: restParams }
            }),
            updatedAt: new Date().toISOString(),
          }
        : state.currentPipeline
      return { dynamicOutputPorts: nextDynOut, currentPipeline: nextPipeline }
    }),

  // ── Session restore ──────────────────────────────────────────────────
  restoreSession: async () => {
    try {
      const pipeline = await getEditorTransport().api.getSession()
      if (pipeline && pipeline.nodes.length > 0) {
        set({ currentPipeline: pipeline, sessionRestorePending: pipeline })
      }
    } catch (error) {
      console.error('[Session] Failed to restore session:', error)
    }
  },

  clearSessionRestore: () => set({ sessionRestorePending: null }),

  // ── Graph mutations (data layer) ─────────────────────────────────────
  addNode: (node) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) {
        return { currentPipeline: { ...createEmptyPipeline(), nodes: [node] } }
      }
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: [...state.currentPipeline.nodes, node],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateNode: (nodeId, updates) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      const existing = state.currentPipeline.nodes.find((n) => n.id === nodeId)
      let groups = state.currentPipeline.groups
      if (updates.position && existing?.batteryId === '__group__') {
        const groupId =
          typeof existing.params?.groupId === 'string' ? (existing.params.groupId as string) : nodeId
        groups = (groups ?? []).map((g) =>
          g.id === groupId ? { ...g, position: updates.position! } : g,
        )
      }
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups,
          nodes: state.currentPipeline.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates } : node,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeNode: (nodeId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: state.currentPipeline.nodes.filter((node) => node.id !== nodeId),
          edges: state.currentPipeline.edges.filter(
            (edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId,
          ),
          updatedAt: new Date().toISOString(),
        },
        selectedNode: state.selectedNode?.id === nodeId ? null : state.selectedNode,
      }
    })
  },

  addEdge: (edge) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          edges: [...state.currentPipeline.edges, edge],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeEdge: (edgeId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          edges: state.currentPipeline.edges.filter((edge) => edge.id !== edgeId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  // ── Groups ───────────────────────────────────────────────────────────
  addGroup: (group) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: [...(state.currentPipeline.groups ?? []), group],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeGroup: (groupId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).filter((g) => g.id !== groupId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  renameGroup: (groupId, name) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).map((g) =>
            g.id === groupId ? { ...g, name } : g,
          ),
          // Keep the `__group__` shadow node's mirror `name` in sync with the
          // group's authoritative name. Without this the shadow node keeps its
          // old default (e.g. "Group Node") after a rename, which used to leak
          // through the persist diff and back out via drag-out (loadGroup ->
          // getGroup). The NodeGroup is the name SSOT; the shadow node is a
          // mirror, so update both together.
          nodes: state.currentPipeline.nodes.map((n) =>
            n.params?.groupId === groupId || n.id === groupId
              ? { ...n, name }
              : n,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateGroup: (groupId, updates) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).map((g) =>
            g.id === groupId ? { ...g, ...updates } : g,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateGroupPort: (groupId, direction, portName, patch) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }

    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    const connected = state.currentPipeline.edges.some((edge) =>
      direction === 'input'
        ? edge.target.nodeId === groupId && edge.target.port === portName
        : edge.source.nodeId === groupId && edge.source.port === portName,
    )
    if (patch.hidden === true && connected) {
      return { ok: false, reason: 'This port is connected. Disconnect it before hiding.' }
    }

    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((group) => {
          if (group.id !== groupId) return group
          const nextPorts = group[portsKey].map((port) => {
            if (port.portName !== portName) return port
            changed = true
            return { ...port, ...patch }
          })
          return { ...group, [portsKey]: nextPorts }
        }),
        updatedAt: new Date().toISOString(),
      },
    })

    if (changed) get().schedulePersistSession('group-port-patch')
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  moveGroupPort: (groupId, direction, portName, delta) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }

    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((group) => {
          if (group.id !== groupId) return group
          const ports = [...group[portsKey]]
            .map((port, index) => ({ ...port, order: typeof port.order === 'number' ? port.order : index }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          const index = ports.findIndex((port) => port.portName === portName)
          const nextIndex = index + delta
          if (index < 0 || nextIndex < 0 || nextIndex >= ports.length) return group
          const [moved] = ports.splice(index, 1)
          ports.splice(nextIndex, 0, moved)
          changed = true
          const reordered = ports.map((port, order) => ({ ...port, order }))
          return { ...group, [portsKey]: reordered }
        }),
        updatedAt: new Date().toISOString(),
      },
    })

    if (changed) get().schedulePersistSession('group-port-move')
    return changed ? { ok: true } : { ok: false, reason: 'Port cannot be moved further' }
  },

  addGroupExposedPort: (groupId, direction) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    const prefix = direction === 'input' ? 'in_' : 'out_'
    const group = (state.currentPipeline.groups ?? []).find((g) => g.id === groupId)
    if (!group) return { ok: false, reason: 'Group not found' }

    // Allocate the next stable id (max existing in_N/out_N + 1) so it never
    // collides with a port that was deleted-then-recreated.
    let nextIndex = 0
    for (const port of group[portsKey]) {
      const match = /^(?:in|out)_(\d+)$/.exec(port.portName)
      if (match) nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
    }
    const portName = `${prefix}${nextIndex}`
    const maxOrder = group[portsKey].reduce((acc, p, i) => Math.max(acc, typeof p.order === 'number' ? p.order : i), -1)
    const newPort: ExposedPort = {
      portName,
      portType: 'any',
      sourceNodeId: '',
      sourcePortName: '',
      order: maxOrder + 1,
    }

    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) =>
          g.id === groupId ? { ...g, [portsKey]: [...g[portsKey], newPort] } : g,
        ),
        updatedAt: new Date().toISOString(),
      },
    })
    get().schedulePersistSession('group-port-add')
    return { ok: true, portName }
  },

  removeGroupExposedPort: (groupId, direction, portName) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'

    // Every shadow node that instances this group (root + nested), so external
    // edges to the deleted port are dropped wherever the group is wired.
    const shadowIds = new Set<string>()
    const collectShadows = (nodes: PipelineNode[]) => {
      for (const n of nodes) if (n.batteryId === '__group__' && n.params?.groupId === groupId) shadowIds.add(n.id)
    }
    collectShadows(state.currentPipeline.nodes)
    for (const g of state.currentPipeline.groups ?? []) collectShadows(g.nodes)

    const refsPort = (e: PipelineEdge): boolean =>
      direction === 'input'
        ? shadowIds.has(e.target.nodeId) && e.target.port === portName
        : shadowIds.has(e.source.nodeId) && e.source.port === portName

    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        edges: state.currentPipeline.edges.filter((e) => !refsPort(e)),
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          const filteredEdges = g.edges.filter((e) => !refsPort(e))
          if (g.id === groupId) {
            const nextPorts = g[portsKey].filter((p) => p.portName !== portName)
            if (nextPorts.length !== g[portsKey].length) changed = true
            return { ...g, [portsKey]: nextPorts, edges: filteredEdges }
          }
          return { ...g, edges: filteredEdges }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-remove')
      for (const sid of shadowIds) void get().incrementalExecute(sid, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  bindGroupExposedPort: (groupId, direction, portName, mapping) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            [portsKey]: g[portsKey].map((p) => {
              if (p.portName !== portName) return p
              changed = true
              return {
                ...p,
                sourceNodeId: mapping.sourceNodeId,
                sourcePortName: mapping.sourcePortName,
                portType: mapping.portType ?? p.portType,
                ...(mapping.access !== undefined ? { access: mapping.access } : {}),
              }
            }),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-bind')
      void get().incrementalExecute(groupId, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  unbindGroupExposedPort: (groupId, direction, portName) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            [portsKey]: g[portsKey].map((p) =>
              p.portName === portName
                ? ((changed = true), { ...p, sourceNodeId: '', sourcePortName: '', portType: 'any' })
                : p,
            ),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-unbind')
      void get().incrementalExecute(groupId, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  updateGroupInnerNodeParam: (groupId, innerNodeId, key, value) => {
    const state = get()
    if (!state.currentPipeline) return
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            nodes: g.nodes.map((n) =>
              n.id === innerNodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
            ),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    // Re-execute the outer GroupNode (its node id equals groupId).
    void get().incrementalExecute(groupId, false)
  },

  enterGroupView: (groupId) =>
    set((state) => ({ groupViewStack: [...state.groupViewStack, groupId] })),

  probeGroupInnerOutputs: async (groupId) => {
    const { api } = getEditorTransport()
    if (!api.probeGroupInner) return
    // Coalesce concurrent probes of the same group into one in-flight request so
    // bursty exec:completed events can't stack overlapping backend re-runs.
    const existing = _groupProbeInFlight.get(groupId)
    if (existing) return existing
    const run = (async () => {
      let inner: Record<string, Record<string, unknown>> | null = null
      try {
        inner = await api.probeGroupInner!(groupId)
      } catch {
        // Probe is best-effort; a failure just leaves the internal view as-is.
        return
      }
      if (!inner) return
      for (const [innerNodeId, bag] of Object.entries(inner)) {
        for (const [port, value] of Object.entries(bag)) {
          if (value !== undefined) get().setNodeOutput(innerNodeId, port, value)
        }
      }
      // Alias the real last-run values onto the inner view's synthetic boundary /
      // context node ids so the SHELL ports + external up/downstream nodes also
      // reflect actual data flow (they render under prefixed ids, not the real
      // node ids that carry the cached values). All values are already in the
      // store: external inputs sit on the real upstream node, and the group's
      // exposed outputs sit on the group shadow node (written by the run).
      hydrateGroupBoundaryAliases(get, groupId)
    })().finally(() => {
      _groupProbeInFlight.delete(groupId)
    })
    _groupProbeInFlight.set(groupId, run)
    return run
  },

  exitGroupView: () => set((state) => ({ groupViewStack: state.groupViewStack.slice(0, -1) })),
  popGroupViewTo: (depth) =>
    set((state) => ({
      groupViewStack: state.groupViewStack.slice(0, Math.max(0, Math.min(depth, state.groupViewStack.length))),
    })),

  // ── Params + execution ───────────────────────────────────────────────
  updateNodeParam: (nodeId, key, value, silent = false) => {
    const state = get()
    if (!state.currentPipeline) return

    // In a group's internal view, an inner node's params live in the group-view
    // hook's refs (flushed on exit), not in `currentPipeline.nodes`. Route the
    // edit there so it is saved into the group (turning it `unsaved*`) instead of
    // being lost / leaking to the root graph. The sink returns false for ids it
    // does not own, so root-level edits fall through to the normal path below.
    if (_groupInnerSink && _groupInnerSink(nodeId, key, value)) return

    // Early-out: no real change → no store write, no exec, no rerender.
    const targetNode = state.currentPipeline.nodes.find((n) => n.id === nodeId)
    if (targetNode && Object.is(targetNode.params[key], value)) return

    const updatedNodes = state.currentPipeline.nodes.map((node) =>
      node.id === nodeId ? { ...node, params: { ...node.params, [key]: value } } : node,
    )

    set({
      currentPipeline: {
        ...state.currentPipeline,
        nodes: updatedNodes,
        updatedAt: new Date().toISOString(),
      },
      selectedNode:
        state.selectedNode?.id === nodeId
          ? { ...state.selectedNode, params: { ...state.selectedNode.params, [key]: value } }
          : state.selectedNode,
    })

    if (silent) return

    // Drive execution as a continuous "latest value wins" stream rather than a
    // fixed-interval throttle. The slider already coalesces pushes to one per
    // animation frame; here we additionally ensure we never run two executes for
    // the same node concurrently (each round-trip is ~tens-to-hundreds of ms). If
    // an exec is in flight we just remember the latest node and fire exactly one
    // more when it settles — so the kernel always ends on the newest dragged
    // value and the preview keeps flowing without a backlog forming.
    if (!_execInFlight) {
      void runParamExec(get, nodeId)
    } else {
      _execThrottlePendingId = nodeId
    }
  },

  persistSession: async () => {
    if (_persistTimer) {
      clearTimeout(_persistTimer)
      _persistTimer = null
    }
    logPersistFlush()
    const { currentPipeline } = get()
    if (!currentPipeline) return
    const seq = _localMutationSeq
    try {
      const res = await enqueuePipelinePersist(currentPipeline, seq)
      if (res?.status === 'rejected') {
        if (res.diagnostics && res.diagnostics.length > 0) {
          // Plain-text dump so the diagnostics are copy-pasteable (Chrome collapses
          // the object form). One line per diagnostic: #opIndex [severity] message.
          const lines = res.diagnostics
            .map((d) => `  #${(d as { opIndex?: number }).opIndex ?? '?'} [${(d as { severity?: string }).severity ?? '?'}] ${(d as { message?: string }).message ?? JSON.stringify(d)}`)
            .join('\n')
          console.warn(`[Session] persist rejected: ${res.reason} (${res.diagnostics.length} diagnostics)\n${lines}`)
        } else {
          console.warn('[Session] persist rejected:', res.reason)
        }
      }
    } catch (error) {
      console.error('[Session] persist failed:', error)
    }
  },

  schedulePersistSession: (reason?: string) => {
    if (reason) {
      setPersistTraceReason(reason)
      logPersistSchedule(reason)
    }
    if (_persistTimer) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      _persistTimer = null
      void get().persistSession()
    }, PERSIST_DEBOUNCE_MS)
  },

  incrementalExecute: async (nodeId, fullExec = false, options = {}) => {
    const { currentPipeline, addLog } = get()
    if (!currentPipeline) return
    const downstreamIds = getDownstreamIds(nodeId, currentPipeline.edges)
    const seq = _localMutationSeq
    try {
      // Persist the latest graph first, then execute — unless the caller already
      // persisted (e.g. a drag-stop that ran schedulePersistSession), in which
      // case skip the redundant op-persist round-trip.
      if (options.persist !== false) {
        if (options.localParamEdit) {
          // HOT PATH (slider drag / inspector scrub). Do NOT run the whole-graph
          // persist+diff (getPipeline + listGroups + diffPipelineToOps + applyOps)
          // behind the serial _persistQueue — that is the measured avalanche
          // (persist leg 1.3s→3.3s). Instead submit ONE targeted ephemeral
          // `updateNode` op for just this node's params, coalesced so a burst
          // can't back up (latest value wins, stale drops). The kernel still
          // persists graph.json + invalidates caches, so the very next execute
          // computes with the new value (SSOT preserved); only the history audit
          // line is deferred to the settled commit below. Then debounce a normal
          // durable persist so the FINAL value lands in history.jsonl exactly once.
          const localBatchId = nextLocalParamEditBatchId()
          rememberLocalParamEditBatch(localBatchId)
          markLocalParamEditActive() // suppress the redundant WS re-pull this tick
          const editedNode = currentPipeline.nodes.find((n) => n.id === nodeId)
          if (editedNode) {
            await enqueueParamWrite(nodeId, { ...editedNode.params }, localBatchId)
          }
          // Commit the settled value durably (records the single history entry).
          // Debounced: only fires once the drag stops churning.
          get().schedulePersistSession('param-edit-settle')
        } else {
          // A local param edit (slider drag / inspector) already wrote the new
          // value into currentPipeline above. Tag the persist with a client batchId
          // recorded synchronously NOW, so the matching `graph:applied` self-echo is
          // recognized as our own write and does NOT trigger a full loadPipeline()
          // rebuild — that per-tick rebuild is the slider→preview lag. Outputs still
          // refresh via the trailing `exec:completed`.
          await enqueuePipelinePersist(currentPipeline, seq, 'editor')
        }
      }
      // The execute response already carries the freshly computed outputs
      // (nodeId -> portId -> wire value, same shape as getNodeOutput). Apply them
      // directly so the preview updates the instant the HTTP response lands,
      // instead of waiting for the trailing WS `exec:completed` -> per-port
      // getNodeOutput re-pull (a full extra round-trip + GET storm that is the
      // felt slider lag). The kernel stays the single source of truth — we are
      // only consuming the answer it already returned rather than re-fetching it.
      const result = fullExec
        ? await getEditorTransport().api.executePipeline()
        : await getEditorTransport().api.executePipeline({ startNodeId: nodeId })
      if (result?.outputs) {
        const setOut = get().setNodeOutput
        for (const [outNodeId, ports] of Object.entries(result.outputs)) {
          for (const [portName, value] of Object.entries(ports)) {
            setOut(outNodeId, portName, value)
          }
        }
      }
      addLog(
        fullExec
          ? `Full exec: pipeline (${currentPipeline.nodes.length} nodes)`
          : `Incremental exec: node ${nodeId}, ${downstreamIds.length} downstream node(s)`,
      )
    } catch (error) {
      addLog(`Execution failed: ${error}`)
    }
  },

  executePipeline: async () => {
    const { addLog, setCompileInfo } = get()
    try {
      set({ pipelineStatus: 'running' })
      addLog('Executing pipeline…')
      setCompileInfo({ status: 'compiling', message: 'Compiling…' })
      const result: ExecutionResult = await getEditorTransport().api.executePipeline()
      setCompileInfo({ status: 'success', message: 'Compiled successfully' })
      addLog('Pipeline execution complete')
      set({ pipelineStatus: result.status === 'error' ? 'error' : 'completed' })
    } catch (error) {
      console.error('Failed to execute pipeline:', error)
      addLog(`Execution failed: ${error}`)
      setCompileInfo({ status: 'error', message: String(error) })
      set({ pipelineStatus: 'error' })
    }
  },

  autoExecuteOnOpen: async () => {
    const { currentPipeline, nodeOutputs, batteries, addLog } = get()
    if (!currentPipeline || currentPipeline.nodes.length === 0) return
    // Only the cold-cache case: if refreshConnectedOutputs already hydrated any
    // retained value, the graph has been run before — leave it untouched.
    const hasAnyOutput = Object.values(nodeOutputs).some(
      (ports) => ports && Object.keys(ports).length > 0,
    )
    if (hasAnyOutput) return
    // A graph made up exclusively of manual-trigger (AI) nodes must never be
    // auto-fired — those run only on the explicit Run button. The full-pipeline
    // walker already skips manualTrigger nodes, but if EVERY node is one there is
    // nothing to compute, so don't bother.
    const hasRunnable = currentPipeline.nodes.some((n) => {
      if (n.batteryId === '__group__') return true
      const battery = batteries.find((b) => b.id === n.batteryId)
      return battery?.type !== 'ai'
    })
    if (!hasRunnable) return
    addLog('No cached outputs on open — auto-running pipeline')
    await get().executePipeline()
  },

  stopPipeline: async () => {
    const { addLog } = get()
    try {
      await getEditorTransport().api.stopPipeline()
      addLog('Pipeline stopped')
      set({ pipelineStatus: 'stopped' })
    } catch (error) {
      console.error('Failed to stop pipeline:', error)
      addLog(`Stop failed: ${error}`)
    }
  },

  loadPipeline: async () => {
    const { addLog } = get()
    try {
      addLog('Loading pipeline…')
      const pipeline = await getEditorTransport().api.getPipeline()
      if (pipeline) {
        set((s) => {
          // `previewEnabled` is a CLIENT-ONLY toggle (the editor preview switch);
          // the kernel graph has no such field, so a re-pull returns it undefined
          // for every node. Carry the user's prior choice forward so a re-exec /
          // live-sync refetch does not silently re-enable previews the user turned
          // off. (The `!== undefined` guard is defensive for hand-built fixtures.)
          const prevPreview = new Map(
            (s.currentPipeline?.nodes ?? []).map((n) => [n.id, n.previewEnabled] as const),
          )
          const nodes = pipeline.nodes.map((n) => {
            if (n.previewEnabled !== undefined) return n
            const prev = prevPreview.get(n.id)
            return prev !== undefined ? { ...n, previewEnabled: prev } : n
          })
          // Exposed-port presentation overlay (hidden / order / customLabel*) is
          // kernel-persisted: createGroup/updateGroup write it to graph.json and
          // getPipeline reads it back verbatim, so the freshly-pulled groups are
          // the single authority — no client carry-forward needed.
          return {
            currentPipeline: { ...pipeline, nodes },
            pipelineStatus: pipeline.status,
            pipelineRevision: s.pipelineRevision + 1,
          }
        })
        addLog('Pipeline loaded')
      }
    } catch (error) {
      console.error('Failed to load pipeline:', error)
      addLog(`Load failed: ${error}`)
    }
  },

  // ── AI-agent operations ──────────────────────────────────────────────
  registerRfSetters: (setters) => {
    _rfSetters = setters
  },

  agentAddNode: (node) => {
    const state = get()
    const battery = state.batteries.find((b) => b.id === node.batteryId)
    if (!battery) {
      console.warn(`[Agent] agentAddNode: battery not found: ${node.batteryId}`)
      return
    }
    if (state.currentPipeline) {
      useHistoryStore.getState().record('add_node', state.currentPipeline, {
        nodeIds: [node.id],
        label: `AI 添加节点：${battery.name}`,
        labelEn: `AI add node: ${battery.nameEn ?? formatIdAsLabel(battery.id)}`,
      })
    }
    get().addNode(node)
    if (_rfSetters) {
      const rfNode: Node = {
        id: node.id,
        type: battery.nodeType ?? 'battery',
        position: node.position,
        data: { battery, params: node.params ?? {} },
        selected: false,
      }
      _rfSetters.setNodes((nds) => [...nds, rfNode])
    }
    // AI-type batteries run on explicit user request, so skip auto-exec.
    if (battery.type !== 'ai') void get().incrementalExecute(node.id, false)
  },

  agentRemoveNodes: (nodeIds) => {
    const state = get()
    if (!state.currentPipeline) return
    const allEdges = state.currentPipeline.edges
    const deletedIds = new Set(nodeIds)

    const survivingDownstreamIds = new Set<string>()
    for (const nodeId of nodeIds) {
      allEdges
        .filter((e) => e.source.nodeId === nodeId)
        .map((e) => e.target.nodeId)
        .filter((id) => !deletedIds.has(id))
        .forEach((id) => survivingDownstreamIds.add(id))
    }

    const label = nodeIds.length > 1 ? `AI 删除 ${nodeIds.length} 个节点` : `AI 删除节点`
    const labelEn = nodeIds.length > 1 ? `AI delete ${nodeIds.length} nodes` : `AI delete node`
    useHistoryStore.getState().record('delete_node', state.currentPipeline, { nodeIds, label, labelEn })

    for (const nodeId of nodeIds) {
      get().removeNode(nodeId)
      get().clearNodeOutputs([nodeId])
      get().clearNodeDynamicOutputPorts([nodeId])
    }

    if (_rfSetters) {
      _rfSetters.setNodes((nds) => nds.filter((n) => !deletedIds.has(n.id)))
      _rfSetters.setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)))
    }

    void get().persistSession()
    for (const downId of survivingDownstreamIds) void get().incrementalExecute(downId, false)
  },

  agentAddEdge: (edge) => {
    const state = get()
    if (!state.currentPipeline) return
    const srcNode = state.currentPipeline.nodes.find((n) => n.id === edge.source.nodeId)
    const tgtNode = state.currentPipeline.nodes.find((n) => n.id === edge.target.nodeId)
    const srcName = srcNode?.name ?? edge.source.nodeId
    const tgtName = tgtNode?.name ?? edge.target.nodeId
    const srcNameEn = srcNode ? nodeNameEn(srcNode, state.batteries) : edge.source.nodeId
    const tgtNameEn = tgtNode ? nodeNameEn(tgtNode, state.batteries) : edge.target.nodeId
    useHistoryStore.getState().record('connect_edge', state.currentPipeline, {
      edgeIds: [edge.id],
      label: `AI 连线：${srcName} → ${tgtName}`,
      labelEn: `AI connect: ${srcNameEn} → ${tgtNameEn}`,
    })

    get().addEdge(edge)

    if (_rfSetters) {
      // One input port allows a single connection: drop any prior edge to the
      // same target port. Edge styling (port-type colour) lands with the canvas
      // stage; a neutral default is used here.
      _rfSetters.setEdges((eds) => {
        const filtered = eds.filter(
          (e) => !(e.target === edge.target.nodeId && e.targetHandle === edge.target.port),
        )
        return [
          ...filtered,
          {
            id: edge.id,
            source: edge.source.nodeId,
            target: edge.target.nodeId,
            sourceHandle: edge.source.port,
            targetHandle: edge.target.port,
            animated: false,
          },
        ]
      })
    }

    void get().incrementalExecute(edge.target.nodeId, false)
  },

  agentRemoveEdges: (edgeIds) => {
    const state = get()
    if (!state.currentPipeline) return
    const edgeIdSet = new Set(edgeIds)
    const removedEdges = state.currentPipeline.edges.filter((e) => edgeIdSet.has(e.id))
    if (removedEdges.length === 0) return

    const label = removedEdges.length > 1 ? `AI 删除 ${removedEdges.length} 条连线` : 'AI 删除连线'
    const labelEn = removedEdges.length > 1 ? `AI delete ${removedEdges.length} connections` : 'AI delete connection'
    useHistoryStore.getState().record('delete_edge', state.currentPipeline, { edgeIds, label, labelEn })

    const targetNodeIds = [...new Set(removedEdges.map((e) => e.target.nodeId))]
    for (const eid of edgeIds) get().removeEdge(eid)
    if (_rfSetters) _rfSetters.setEdges((eds) => eds.filter((e) => !edgeIdSet.has(e.id)))
    for (const targetId of targetNodeIds) void get().incrementalExecute(targetId, false)
  },

  agentUpdateParams: (nodeId, params) => {
    const state = get()
    if (!state.currentPipeline) return
    const node = state.currentPipeline.nodes.find((n) => n.id === nodeId)
    if (!node) return

    useHistoryStore.getState().record('change_param', state.currentPipeline, {
      nodeIds: [nodeId],
      label: `AI 更新参数：${node.name}`,
      labelEn: `AI update params: ${nodeNameEn(node, state.batteries)}`,
    })

    for (const [key, value] of Object.entries(params)) get().updateNodeParam(nodeId, key, value)

    if (_rfSetters) {
      _rfSetters.setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } } : n,
        ),
      )
    }
  },

  // ── Live-sync ────────────────────────────────────────────────────────
  subscribeLiveSync: () => {
    const { ws, api } = getEditorTransport()
    ws.connect()
    // Fresh sync session: forget any hash de-duped under a prior subscription.
    _lastSyncedHash = null
    _mountRefreshInFlight = null

    // Refetch the snapshot and record its content hash so the reconciler poll
    // below knows the canvas is up to date. Shared by the WS push path and the
    // poll fallback so both converge on the same "last synced" marker.
    const reloadAndRecordHash = async (): Promise<void> => {
      await get().loadPipeline()
      try {
        _lastSyncedHash = await api.getPipelineHash()
      } catch {
        /* transient — the next poll will retry */
      }
    }

    // Graph mutations (any actor) → refetch the snapshot, then refresh probe
    // values for the new wiring. Capture the PRE-batch pipeline FIRST (before
    // loadPipeline overwrites it) so a bridged history entry can undo back to
    // the state before this batch, then bridge the committed batch into the
    // visible history panel (non-local actors only).
    const handleGraphApplied = async (batchId: string | undefined): Promise<void> => {
      if (batchId && !markGraphBatchHandled(batchId)) return

      let meta = batchId ? _persistBatchMeta.get(batchId) : undefined
      if (batchId && meta === undefined) {
        const inFlight = _localPersistInFlight.get(batchId)
        if (inFlight) {
          await inFlight.catch(() => undefined)
          meta = _persistBatchMeta.get(batchId)
        }
      }
      if (batchId) _persistBatchMeta.delete(batchId)

      // Pure layout persist (reposition / frames) — kernel emits no bus event,
      // but guard anyway when meta says layout-only.
      if (meta?.layoutOnly) return

      // Local param-edit self-echo suppression. We tagged our own param-edit
      // persist with this batchId synchronously before writing, and already hold
      // the resulting snapshot locally, so a full loadPipeline() rebuild is pure
      // churn — and is the slider→preview lag. Skip the reload AND the duplicate
      // output-refresh here; the trailing `exec:completed` handler refreshes the
      // connected outputs once the new values are computed, which is what drives
      // the live grid preview.
      if (batchId && _localParamEditBatchIds.has(batchId)) {
        _localParamEditBatchIds.delete(batchId)
        return
      }

      // Local persist with zero output-cache invalidation (e.g. updateGroup
      // metadata / group position) — canvas already holds the desired state;
      // skip loadPipeline + fan-out; outputs on disk are unchanged.
      if (meta && meta.invalidatedNodeCount === 0) {
        try {
          _lastSyncedHash = await api.getPipelineHash()
        } catch {
          /* transient */
        }
        return
      }

      const preSnapshot = get().currentPipeline
      await reloadAndRecordHash()
      await get().refreshConnectedOutputs('graph:applied')
      if (batchId) await bridgeBatchToHistory(batchId, preSnapshot)
    }

    registerGraphAppliedHandler((batchId) => {
      void handleGraphApplied(batchId)
    })

    const unsubGraph = ws.on('graph:applied', ({ batchId }) => {
      if (isViewportMoving()) {
        deferGraphAppliedBatch(batchId)
        return
      }
      void handleGraphApplied(batchId)
    })

    // Reconciler safety net: poll the lightweight pipeline hash and refetch when it
    // drifts from what we last synced. Catches any `graph:applied` frame the WS
    // missed (reconnect after a backend restart, the project-activate rebind
    // window, a dropped frame), so an AI/CLI graph mutation always reaches the
    // canvas — matching the polling image-preview surface's resilience.
    const reconcileTimer = setInterval(() => {
      void (async () => {
        if (isViewportMoving()) return
        let hash: string | null
        try {
          hash = await api.getPipelineHash()
        } catch {
          return // backend momentarily unreachable (e.g. mid-restart) — retry next tick
        }
        if (hash === null) return
        if (_lastSyncedHash === null) {
          // No baseline yet (initial mount before the first sync): adopt the
          // current hash without forcing a reload the mount already did.
          _lastSyncedHash = hash
          return
        }
        if (hash === _lastSyncedHash) return
        _lastSyncedHash = hash
        const edgeSigBefore = edgeTopologySignature(get().currentPipeline)
        await get().loadPipeline()
        const edgeSigAfter = edgeTopologySignature(get().currentPipeline)
        // Layout-only drift (reposition / frames) changes hash but not wiring —
        // output cache stays valid, so skip the multi-MB fan-out.
        if (edgeSigBefore === edgeSigAfter) return
        await get().refreshConnectedOutputs('reconcile')
      })()
    }, LIVE_SYNC_RECONCILE_MS)

    // Per-port output values. The kernel announces 'node:output' (port + type
    // only, no value) as a node executes; we pull the value via the generic
    // ApiClient and cache it in nodeOutputs — the kernel-native replacement for
    // the legacy WS NODE_OUTPUT push that fed the wire data-probe, port tooltips
    // and preview nodes.
    const unsubNodeOutput = ws.on('node:output', ({ nodeId, portId }) => {
      if (isViewportMoving()) return
      void api
        .getNodeOutput(nodeId, portId)
        .then((value) => {
          if (value !== undefined) get().setNodeOutput(nodeId, portId, value)
        })
        .catch(() => {
          /* port has no value yet / transient — ignore */
        })
    })

    // After a run completes, refresh every connected source port so probes are
    // correct even if a 'node:output' event was missed (and to match the legacy
    // "updates after execution" behaviour). Bounded by the edge count.
    const unsubExecCompleted = ws.on('exec:completed', () => {
      // During an active slider/inspector param drag, incrementalExecute already
      // applied this tick's outputs directly from the execute response, so the
      // per-port getNodeOutput re-pull here is redundant churn competing with the
      // drag. Skip it inside the quiet window; the drag-stop settle (which falls
      // outside the window) runs the full refresh once.
      if (isLocalParamEditActive()) return
      void get().refreshConnectedOutputs('exec:completed')
      // If the user is INSIDE a group's internal view, the run just changed the
      // collapsed group's outputs, but refreshConnectedOutputs only covers the
      // root graph — inner nodes' wire data would stay stale. Re-probe the active
      // group's inner sub-graph (read-only; does not persist or emit events, so
      // it cannot re-trigger this handler) so the internal view's probes/ports/
      // AI previews reflect the latest run.
      const stack = get().groupViewStack
      const activeGroupId = stack.length > 0 ? stack[stack.length - 1] : null
      if (activeGroupId) void get().probeGroupInnerOutputs(activeGroupId)
    })

    // Battery hot-reload (dev): the backend re-scans batteries on a meta/index
    // edit and broadcasts `ops:changed`. Reload the catalog so the palette
    // reflects added/removed/renamed batteries without a manual refresh.
    const unsubOpsChanged = ws.on('ops:changed', () => {
      void get().loadBatteries()
    })

    return () => {
      clearInterval(reconcileTimer)
      registerGraphAppliedHandler(() => {})
      unsubGraph()
      unsubNodeOutput()
      unsubExecCompleted()
      unsubOpsChanged()
    }
  },

  refreshConnectedOutputs: (reason: RefreshReason = 'manual') => {
    if (isViewportMoving()) {
      deferRefreshUntilViewportEnd(reason)
      return Promise.resolve()
    }
    if (reason === 'mount' && _mountRefreshInFlight) return _mountRefreshInFlight
    // Coalesce bursts: if a fan-out is already running, request a single trailing
    // pass (so the latest graph is hydrated) and share the in-flight promise
    // instead of launching another full GET storm.
    if (_outputsRefreshInFlight) {
      // Mount is idempotent — don't queue trailing passes (StrictMode double effect).
      if (reason === 'mount') return _outputsRefreshInFlight
      _outputsRefreshAgain = true
      return _outputsRefreshInFlight
    }
    const runOnce = async (): Promise<void> => {
      do {
        _outputsRefreshAgain = false
        const { currentPipeline } = get()
        const scope = fanOutScopeForReason(reason)
        const portEstimate =
          scope === 'edges'
            ? (currentPipeline?.edges.length ?? 0)
            : currentPipeline
              ? currentPipeline.edges.length + currentPipeline.nodes.length * 2
              : 0
        const startedAt = logRefreshStart(reason, { portCount: portEstimate, lastSyncedHash: _lastSyncedHash })
        const stats = await fanOutConnectedOutputs(get, reason)
        logRefreshEnd(reason, startedAt, stats)
        if (reason === 'mount' && stats.deferredLarge?.length) {
          scheduleDeferredLargePortHydration(get, stats.deferredLarge)
        }
      } while (_outputsRefreshAgain)
    }
    const run = runOnce().finally(() => {
      _outputsRefreshInFlight = null
      if (reason === 'mount') _mountRefreshInFlight = null
    })
    _outputsRefreshInFlight = run
    if (reason === 'mount') _mountRefreshInFlight = run
    return run
  },

  // ── Canvas annotations ───────────────────────────────────────────────
  addAnnotation: (position) => {
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const annotation: CanvasAnnotation = { id, text: '', position }
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: [...(state.currentPipeline.annotations ?? []), annotation],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-add')
    return id
  },

  duplicateAnnotation: (sourceId, position) => {
    const source = get().currentPipeline?.annotations?.find((a) => a.id === sourceId)
    if (!source) return null

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const annotation: CanvasAnnotation = { ...source, id, position }
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: [...(state.currentPipeline.annotations ?? []), annotation],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-duplicate')
    return id
  },

  updateAnnotation: (id, text, width, height) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).map((a) => {
            if (a.id !== id) return a
            const updated = { ...a, text }
            if (width !== undefined) updated.width = width
            if (height !== undefined) updated.height = height
            return updated
          }),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-update')
  },

  moveAnnotation: (id, position) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).map((a) =>
            a.id === id ? { ...a, position } : a,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-move')
  },

  removeAnnotation: (id) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).filter((a) => a.id !== id),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-remove')
  },

  // ── Canvas frames ────────────────────────────────────────────────────
  addFrame: (frame) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: [...(state.currentPipeline.frames ?? []), frame],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-add')
  },

  renameFrame: (frameId, name) => {
    const trimmed = name.trim() || 'Frame'
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).map((frame) =>
            frame.id === frameId ? { ...frame, name: trimmed, updatedAt: new Date().toISOString() } : frame,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-rename')
  },

  removeFrame: (frameId) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).filter((frame) => frame.id !== frameId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-remove')
  },

  updateFrame: (frameId, updates) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).map((frame) =>
            frame.id === frameId ? { ...frame, ...updates, updatedAt: new Date().toISOString() } : frame,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-update')
  },
}))

/** Flush deferred graph:applied + output refresh after viewport pan/zoom ends. */
export function flushDeferredRefreshAfterViewport(): void {
  setViewportMoving(false)
  flushDeferredGraphAppliedBatches()
  const reason = takeDeferredRefreshReason()
  if (reason) void usePipelineStore.getState().refreshConnectedOutputs(reason)
}
