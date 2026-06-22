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
import { useHistoryStore } from './historyStore.js'
import { createEmptyPipeline, getDownstreamIds } from './pipelineStore.helpers.js'
import { bridgeBatchToHistory } from './pipelineHistoryBridge.js'
import { formatIdAsLabel } from '../utils/batteryLabels.js'

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
const OUTPUTS_REFRESH_CONCURRENCY = 8

// Per-group in-flight guard for the inner-view probe. exec:completed can fire in
// quick succession (e.g. a group Run followed by its incremental downstream
// pass); without this, each event would launch an overlapping probeGroupInner
// GET. We collapse concurrent probes of the SAME group to a single in-flight
// request so the backend is never hammered with redundant read-only re-runs.
const _groupProbeInFlight = new Map<string, Promise<void>>()

// Live-sync de-dup: the id of the last committed batch we already re-pulled for.
// A single committed batch must drive at most one snapshot re-pull, even if its
// `graph:applied` is delivered more than once (e.g. a WS reconnect replay, or
// two announce paths racing). Empty batchId (project activate / import server
// broadcasts that carry none) is never de-duped — it always refetches.
let _lastSyncedBatchId: string | null = null

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
function outputValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function enqueuePipelinePersist(snapshot: Pipeline, seq: number, actor = 'editor', batchId?: string) {
  const run = async () => {
    if (seq !== _localMutationSeq) return null
    const res = await getEditorTransport().api.updatePipeline(snapshot, actor, batchId)
    // The canvas already reflects this local edit (RF setters / store writes),
    // so adopt the resulting hash as our sync baseline. Otherwise the live-sync
    // reconciler would see the post-persist hash drift and force a redundant
    // full reload that can disrupt an in-progress local edit (e.g. mid-drag).
    if (res?.status === 'ok' && res.newHash) _lastSyncedHash = res.newHash
    return res
  }
  const next = _persistQueue.then(run, run)
  _persistQueue = next.catch(() => undefined)
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

/**
 * One fan-out pass for refreshConnectedOutputs: collect every distinct visible /
 * wire-feeding output port, then GET its cached value with a bounded number of
 * concurrent requests (so a large graph never opens hundreds of parallel GETs).
 */
async function fanOutConnectedOutputs(get: () => PipelineState): Promise<void> {
  const { currentPipeline, batteries, dynamicOutputPorts } = get()
  if (!currentPipeline) return
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

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < ports.length) {
      const { nodeId, port } = ports[cursor]
      cursor += 1
      try {
        const value = await api.getNodeOutput(nodeId, port)
        if (value !== undefined) get().setNodeOutput(nodeId, port, value)
      } catch {
        /* port has no value yet / transient — ignore */
      }
    }
  }
  const workerCount = Math.min(OUTPUTS_REFRESH_CONCURRENCY, ports.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
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
  refreshConnectedOutputs: () => Promise<void>

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
      for (const id of nodeIds) delete next[id]
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
      return {
        currentPipeline: {
          ...state.currentPipeline,
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
    const { currentPipeline } = get()
    if (!currentPipeline) return
    const seq = _localMutationSeq
    try {
      const res = await enqueuePipelinePersist(currentPipeline, seq)
      if (res?.status === 'rejected') {
        if (res.diagnostics && res.diagnostics.length > 0) {
          console.warn('[Session] persist rejected:', res.reason, { diagnostics: res.diagnostics })
        } else {
          console.warn('[Session] persist rejected:', res.reason)
        }
      }
    } catch (error) {
      console.error('[Session] persist failed:', error)
    }
  },

  schedulePersistSession: () => {
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
    // Fresh sync session: forget any batchId/hash de-duped under a prior subscription.
    _lastSyncedBatchId = null
    _lastSyncedHash = null

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
    const unsubGraph = ws.on('graph:applied', ({ batchId }) => {
      // De-dup by batchId so one committed batch drives a single re-pull even if
      // the event is delivered twice (single-source contract: the backend WS is
      // the only announcer; the client no longer synthesizes a local copy).
      if (batchId && batchId === _lastSyncedBatchId) return
      if (batchId) _lastSyncedBatchId = batchId

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

      const preSnapshot = get().currentPipeline
      void reloadAndRecordHash()
        .then(() => get().refreshConnectedOutputs())
        .then(() => bridgeBatchToHistory(batchId, preSnapshot))
    })

    // Reconciler safety net: poll the cheap pipeline hash and refetch when it
    // drifts from what we last synced. Catches any `graph:applied` frame the WS
    // missed (reconnect after a backend restart, the project-activate rebind
    // window, a dropped frame), so an AI/CLI graph mutation always reaches the
    // canvas — matching the polling image-preview surface's resilience.
    const reconcileTimer = setInterval(() => {
      void (async () => {
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
        await get().loadPipeline()
        await get().refreshConnectedOutputs()
      })()
    }, LIVE_SYNC_RECONCILE_MS)

    // Per-port output values. The kernel announces 'node:output' (port + type
    // only, no value) as a node executes; we pull the value via the generic
    // ApiClient and cache it in nodeOutputs — the kernel-native replacement for
    // the legacy WS NODE_OUTPUT push that fed the wire data-probe, port tooltips
    // and preview nodes.
    const unsubNodeOutput = ws.on('node:output', ({ nodeId, portId }) => {
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
      void get().refreshConnectedOutputs()
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

    return () => {
      clearInterval(reconcileTimer)
      unsubGraph()
      unsubNodeOutput()
      unsubExecCompleted()
    }
  },

  refreshConnectedOutputs: () => {
    // Coalesce bursts: if a fan-out is already running, request a single trailing
    // pass (so the latest graph is hydrated) and share the in-flight promise
    // instead of launching another full GET storm.
    if (_outputsRefreshInFlight) {
      _outputsRefreshAgain = true
      return _outputsRefreshInFlight
    }
    const runOnce = async (): Promise<void> => {
      do {
        _outputsRefreshAgain = false
        await fanOutConnectedOutputs(get)
      } while (_outputsRefreshAgain)
    }
    _outputsRefreshInFlight = runOnce().finally(() => {
      _outputsRefreshInFlight = null
    })
    return _outputsRefreshInFlight
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
