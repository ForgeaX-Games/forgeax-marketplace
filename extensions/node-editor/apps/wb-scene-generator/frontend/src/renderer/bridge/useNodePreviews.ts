import { useEffect } from 'react'
import type { HttpApiClient } from '../../api/HttpApiClient'
import { useRenderStore } from '../store'
import { flattenWire, flattenWireList } from './flattenWire'
import type { NameListEntry, VoxelLayer } from '../types'
import { syncTrace, syncTraceHintOnce, summarizeNodeOutputs } from '../../debug/syncTrace.js'
import { beginLoadingTask, endLoadingTask, updateLoadingTask } from './loadingSignals.js'

// Project every executed node's renderable outputs into the render store so the
// preview updates live as a graph is wired up — matching the legacy behavior.
//
// Two buckets, both fed here:
//   * grid ports (ANY node) → previewLayers (dense 2D heatmaps).
//     This is the key fix: an intermediate chain (e.g. cellular_noise →
//     max_rectangle) shows up immediately, without needing a scene_output sink.
//   * voxel_layers / name_list ports (scene_output sink) → layers (voxel).
//
// The kernel exec bus carries no payloads, so output VALUES are pulled via the
// ApiClient on each exec:completed. Output PORT TYPES come from the op catalog
// (listOps), fetched once and cached. Per-node `previewEnabled` (default true)
// gates visibility, mirroring the editor's preview toggle.

type PortSpec = { name: string; type: string }

/** Sharded outputs (tree_merge etc.) are too large to inline-fetch; skip them. */
async function isShardedOutput(
  client: HttpApiClient,
  nodeId: string,
  port: string,
): Promise<boolean> {
  try {
    const meta = await client.getNodeOutputMeta(nodeId, port)
    return meta?.sharded === true
  } catch {
    return false
  }
}

/** A dense 2D grid (`number[][]`): non-empty array whose first row is a number array. */
function isGrid2D(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstRow = value[0]
  return Array.isArray(firstRow) && (firstRow.length === 0 || typeof firstRow[0] === 'number')
}

/** DataTree wire shape: `[{ path, items:[…] }, …]`. */
function isWireEntries(value: unknown): value is Array<{ items?: unknown[] }> {
  return Array.isArray(value) && value.length > 0 &&
    typeof value[0] === 'object' && value[0] !== null &&
    Array.isArray((value[0] as { items?: unknown[] }).items)
}

/**
 * Recursively collect every 2D grid (`number[][]`) reachable from a runtime
 * payload. Pass-through batteries declare dynamic outputs as `any`/`tree`, so
 * the port type is too wide to gate on; here we trust the actual data and pull
 * any grids out of the wire/array nesting so the renderer still shows layers.
 * (Faithful analog of the legacy renderer `collectGridValues`.)
 */
function collectGrids(value: unknown, out: number[][][] = []): number[][][] {
  if (isGrid2D(value)) { out.push(value); return out }
  if (isWireEntries(value)) {
    for (const item of flattenWire<unknown>(value)) collectGrids(item, out)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGrids(item, out)
  }
  return out
}

function debugPreviewErrors(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('wb-scene-generator.debugPreview') === 'true'
}

// ── Live direct-push projector (slider-drag fast path) ───────────────────────
// The editor pushes freshly executed output VALUES straight to this iframe via
// the `workbench:preview-data` postMessage, bypassing the WS `exec:completed` →
// `getNodeOutput` re-pull round-trip (~200ms) that is the felt slider lag. The
// push carries `nodeId → portName → value`, but the op port-type catalog and
// per-node names live here (loaded by `useNodePreviews`). So `useNodePreviews`
// registers a projector that turns a pushed outputs map into setPreviewLayer/
// setLayers calls using its in-memory catalog — no network, same projection as
// the WS path. View-only latency shortcut; the trailing exec:completed / GC
// still own eviction and the durable post-drag refresh.
type LiveProjector = (outputs: Record<string, Record<string, unknown>>) => void
let _liveProjector: LiveProjector | null = null
let _localParamEditNotifier: (() => void) | null = null

/**
 * Project a directly-pushed outputs map (`nodeId → portName → value`) into the
 * render store, identical to the WS re-pull path but with zero network. No-op
 * until `useNodePreviews` has mounted and loaded the op catalog. Safe to call
 * from the renderer's `workbench:preview-data` handler on every drag tick.
 */
export function projectLiveOutputs(outputs: Record<string, Record<string, unknown>>): void {
  syncTrace('preview:live-push', { nodes: summarizeNodeOutputs(outputs) })
  _liveProjector?.(outputs)
}

/** Explicit host pulse sent before a local slider tick mutates the graph. */
export function notifyLocalParamEdit(): void {
  _localParamEditNotifier?.()
}

export function useNodePreviews(client: HttpApiClient): void {
  const setLayers = useRenderStore((s) => s.setLayers)
  const clearLayers = useRenderStore((s) => s.clearLayers)
  const retainVoxelNodes = useRenderStore((s) => s.retainVoxelNodes)
  const setPreviewLayer = useRenderStore((s) => s.setPreviewLayer)
  const clearPreviewLayers = useRenderStore((s) => s.clearPreviewLayers)
  const retainPreviewLayers = useRenderStore((s) => s.retainPreviewLayers)

  useEffect(() => {
    syncTraceHintOnce()
    let cancelled = false
    // Bumped on every project switch (project:viewing WS event or
    // workbench:project-changed postMessage). `client.viewingProjectId` is a
    // single mutable field read fresh by every `projectPrefix()` call, so a
    // refresh() already in flight for the OLD project can have its LATER
    // `getNodeOutput` awaits silently redirected to the NEW project mid-loop
    // once the switch flips that field — painting the new project's data under
    // the old project's node ids (near-identical demo templates share node-id
    // schemes, so this doesn't even 404, it just shows the wrong content).
    // Every refresh() captures the revision at start and re-checks it after
    // every await; a mismatch means a switch happened underneath it, so it
    // bails without touching the store (a fresh refresh for the new project is
    // already scheduled by the same handler that bumped the revision).
    let projectRevision = 0
    // opId → output port specs, fetched lazily once (the catalog is static for a
    // session). A failed fetch leaves the cache null so a later run can retry.
    let opOutputs: Map<string, PortSpec[]> | null = null
    // nodeId → { opId, name }, refreshed from every listNodes() pass. The live
    // direct-push projector reads this (instead of re-fetching listNodes per
    // tick) to map a pushed (nodeId, port) value to its port types + label.
    const nodeMeta = new Map<string, { opId: string; name: string }>()
    // A network refresh can start before an execute response is pushed directly
    // from the editor, then finish afterwards with an older cached value. Track
    // the latest live write per node so that stale fetches cannot paint over it.
    let liveProjectionRevision = 0
    const liveNodeRevisions = new Map<string, number>()
    async function ensureOpOutputs(): Promise<Map<string, PortSpec[]>> {
      if (opOutputs) return opOutputs
      const ops = await client.listOps()
      opOutputs = new Map(
        ops.map((o) => [o.id, ((o.outputs ?? []) as PortSpec[]).map((p) => ({ name: p.name, type: p.type }))]),
      )
      return opOutputs
    }

    // Project the grid/voxel buckets for ONE node from already-resolved values.
    // Shared by the WS re-pull path (`refresh`, values from getNodeOutput) and the
    // live direct-push projector (values from the postMessage). `getValue` returns
    // the resolved wire value for a port; voxel pulls (list-valued) stay async via
    // the WS path's getValue, while the push path only carries grids (sync). The
    // function returns the grid keys it set so the caller can drive GC.
    const desiredGridKeysFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
    ): string[] => {
      const ports = (opOutputs?.get(opId)) ?? []
      const keys: string[] = []
      if (!previewEnabled) {
        clearPreviewLayers(nodeId)
        return keys
      }
      const gridPorts = ports.filter((p) =>
        p.type === 'grid' || p.type === 'any' || p.type === 'array' || p.type === 'list')
      for (const port of gridPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const isDeclaredGrid = port.type === 'grid'
        const grids = isDeclaredGrid
          ? flattenWire<number[][]>(raw).filter(isGrid2D)
          : collectGrids(raw)
        if (grids.length === 0) continue
        grids.forEach((grid, i) => {
          const portKey = grids.length > 1 ? `${port.name}[${i}]` : port.name
          setPreviewLayer(nodeId, portKey, nodeName, grid)
          keys.push(`${nodeId}:${portKey}`)
        })
      }
      return keys
    }

    const projectVoxelLayersFor = (
      nodeId: string,
      opId: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
    ): void => {
      const ports = (opOutputs?.get(opId)) ?? []
      const voxelPort = ports.find((p) => p.type === 'voxel_layers')
      if (!voxelPort) return
      const raw = getValue(voxelPort.name)
      if (raw === undefined) return
      const layers = flattenWireList<VoxelLayer>(raw)
      const namePort = ports.find((p) => p.type === 'name_list')
      const names = namePort
        ? flattenWireList<NameListEntry>(getValue(namePort.name))
        : []
      if (previewEnabled && layers.length) {
        setLayers(nodeId, opId, layers, names)
      } else if (!previewEnabled) {
        clearLayers(nodeId)
      }
    }

    // Register the live direct-push projector: the editor forwards freshly
    // executed outputs over `workbench:preview-data`; we paint them straight into
    // the render store using the cached catalog/meta, with zero network. Grids
    // AND voxel_layers sinks (scene_output) ride this path so param edits on the
    // root graph update the preview in the same frame as the wire probe.
    _liveProjector = (outputs) => {
      // A direct output push is authoritative evidence that the editor already
      // has this execution's values. Suppress the redundant WS→GET refresh even
      // if the preceding activity pulse was delayed or dropped.
      _localParamEditNotifier?.()
      const overrides = useRenderStore.getState().previewOverrides
      let missingMeta = false
      for (const [nodeId, ports] of Object.entries(outputs)) {
        liveNodeRevisions.set(nodeId, ++liveProjectionRevision)
        const meta = nodeMeta.get(nodeId)
        if (!meta) {
          missingMeta = true
          continue
        }
        const override = overrides[nodeId]
        const previewEnabled = override !== undefined ? override : true
        projectVoxelLayersFor(nodeId, meta.opId, previewEnabled, (portName) => ports[portName])
        desiredGridKeysFor(nodeId, meta.opId, meta.name, previewEnabled, (portName) => ports[portName])
      }
      if (missingMeta) scheduleRefresh()
    }

    async function refresh(onlyNodeIds?: ReadonlySet<string>): Promise<void> {
      const revision = projectRevision
      const liveRevisionAtStart = liveProjectionRevision
      const __t0 = performance.now()
      syncTrace('preview:refresh-start', { narrowed: onlyNodeIds?.size ?? 'full' })
      await client.ensureViewingProject()
      const __t1 = performance.now()
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh ABORTED after ensureViewingProject (stale revision) +${(__t1 - __t0).toFixed(1)}ms`)
        return
      }
      const [allNodes, specs] = await Promise.all([client.listNodes(), ensureOpOutputs()])
      const __t2 = performance.now()
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh ABORTED after listNodes/ops (stale revision) +${(__t2 - __t1).toFixed(1)}ms`)
        return
      }
      // Refresh the node meta cache used by the live push projector.
      nodeMeta.clear()
      for (const n of allNodes) nodeMeta.set(n.id, { opId: n.opId, name: n.name ?? n.id })
      // Keep the race guard bounded across long editing sessions.
      for (const nodeId of liveNodeRevisions.keys()) {
        if (!nodeMeta.has(nodeId)) liveNodeRevisions.delete(nodeId)
      }

      // Narrowed re-pull (drag-tick fast path): a high-frequency `exec:completed`
      // only needs the nodes this execution actually touched (collected from the
      // `exec:node:output` events), not every node in the graph. This cuts the
      // per-tick fan-out from O(graph) `getNodeOutput` calls down to the handful
      // downstream of the dragged slider — the iframe preview can then keep up
      // with the drag. Generic: purely a projection scope, no computation moves
      // here. GC is skipped on a narrowed pass (it needs the full node set); the
      // graph:applied / initial full refresh owns eviction.
      const narrowed = onlyNodeIds !== undefined && onlyNodeIds.size > 0
      // Narrowed exec refresh (param-drag fast path): re-pull only nodes touched
      // this run — EXCEPT voxel_layers sinks (scene_output). Upstream group /
      // const edits always change the final scene even when the sink did not emit
      // exec:node:output in a partial frame; always re-fetch sinks so preview ==
      // probe == manual wiring.
      const nodes = narrowed
        ? allNodes.filter((n) => {
            if (onlyNodeIds!.has(n.id)) return true
            const ports = specs.get(n.opId) ?? []
            return ports.some((p) => p.type === 'voxel_layers')
          })
        : allNodes

      if (!narrowed) updateLoadingTask('previews', { total: nodes.length })

      const desiredGridKeys = new Set<string>()
      const nodeIds = new Set<string>()
      // Editor preview toggles ride the `workbench:preview-change` postMessage,
      // not the backend graph, so consult the client-side override first; only
      // fall back to the backend `previewEnabled` when a node has no override.
      const overrides = useRenderStore.getState().previewOverrides

      // Phase 1 (sync, no network): classify every node and fire the
      // zero-cost clears immediately; collect the ones that need a network
      // fetch into task lists.
      type VoxelTask = { node: typeof nodes[number]; voxelPort: PortSpec; namePort?: PortSpec }
      type GridTask = { node: typeof nodes[number]; port: PortSpec }
      const voxelTasks: VoxelTask[] = []
      const gridTasks: GridTask[] = []

      for (const node of nodes) {
        nodeIds.add(node.id)
        const ports = specs.get(node.opId) ?? []
        const override = overrides[node.id]
        const previewEnabled =
          override !== undefined ? override : (node as { previewEnabled?: boolean }).previewEnabled !== false

        // ── voxel layers (scene_output sink): replace this node's voxel bucket ──
        const voxelPort = ports.find((p) => p.type === 'voxel_layers')
        if (voxelPort) {
          if (previewEnabled) {
            const namePort = ports.find((p) => p.type === 'name_list')
            voxelTasks.push({ node, voxelPort, ...(namePort ? { namePort } : {}) })
          } else {
            clearLayers(node.id)
          }
        }

        // ── grid previews (any node) ──
        // grid ports are declared dense previews; any/array/list ports (e.g.
        // pass-through batteries with dynamic `any`/`tree` outputs) may still
        // carry grid payloads at runtime, so include them and trust the data.
        const gridPorts = ports.filter((p) =>
          p.type === 'grid' || p.type === 'any' || p.type === 'array' || p.type === 'list')
        if (!previewEnabled) {
          clearPreviewLayers(node.id)
          continue
        }
        for (const port of gridPorts) gridTasks.push({ node, port })
      }

      // Phase 2 (async): previously each node's port(s) were fetched with
      // sequential `await`s — an O(nodes × ports) chain of network round trips
      // that is the direct cause of the felt "slow switching" lag on any graph
      // with more than a handful of nodes. Collapse the WHOLE wave (voxel +
      // name + grid ports, across every task) into a SINGLE batched HTTP POST
      // when the transport supports it; fall back to per-port parallel GETs
      // otherwise (e.g. the unit-test fake client).
      const __t3 = performance.now()
      const __voxelFetchCount = voxelTasks.length * 2 // voxel port + optional name port (upper bound)
      const __gridFetchCount = gridTasks.length
      const portKey = (nodeId: string, portId: string): string => `${nodeId}\u0000${portId}`
      let batchValues: Map<string, unknown> | null = null
      if (typeof client.getNodeOutputsBatch === 'function') {
        const batchPorts: Array<{ nodeId: string; portId: string }> = []
        for (const t of voxelTasks) {
          batchPorts.push({ nodeId: t.node.id, portId: t.voxelPort.name })
          if (t.namePort) batchPorts.push({ nodeId: t.node.id, portId: t.namePort.name })
        }
        for (const t of gridTasks) batchPorts.push({ nodeId: t.node.id, portId: t.port.name })
        if (batchPorts.length > 0) {
          try {
            const res = await client.getNodeOutputsBatch(batchPorts)
            batchValues = new Map(res.map((r) => [portKey(r.nodeId, r.portId), r.value]))
          } catch {
            batchValues = null // network hiccup — fall back to the per-port path below
          }
        }
      }
      const getPortValue = (nodeId: string, portId: string): Promise<unknown> | unknown =>
        batchValues ? batchValues.get(portKey(nodeId, portId)) : client.getNodeOutput(nodeId, portId)
      const [voxelResults, gridResults] = await Promise.all([
        Promise.all(voxelTasks.map(async (t) => {
          // `voxel_layers` / `name_list` are list-valued ports: the wire is
          // double-wrapped (`fromItem(T[])` → items:[[…]]), so unwrap to the
          // leaf elements — flattenWire alone would yield a single array-element
          // and the renderer would hit `layer.cells is not iterable`.
          const layers = flattenWireList<VoxelLayer>(await getPortValue(t.node.id, t.voxelPort.name))
          const names = t.namePort
            ? flattenWireList<NameListEntry>(await getPortValue(t.node.id, t.namePort.name))
            : []
          return { node: t.node, layers, names }
        })),
        Promise.all(gridTasks.map(async (t) => {
          const raw = await getPortValue(t.node.id, t.port.name)
          return { node: t.node, port: t.port, raw }
        })),
      ])

      const __t4 = performance.now()
      console.log(
        `[switch-trace] preview:refresh nodes=${allNodes.length} voxelTasks=${voxelTasks.length}(~${__voxelFetchCount}req) gridTasks=${__gridFetchCount}req ` +
          `ensureViewingProject=${(__t1 - __t0).toFixed(1)}ms listNodes+ops=${(__t2 - __t1).toFixed(1)}ms ` +
          `classify=${(__t3 - __t2).toFixed(1)}ms fetchWave(parallel)=${(__t4 - __t3).toFixed(1)}ms TOTAL=${(__t4 - __t0).toFixed(1)}ms`,
      )
      // Single staleness check AFTER the fetch wave settles — if a project
      // switch happened while any of these were in flight, `client`'s shared
      // viewingProjectId (read fresh by every getNodeOutput call) may have
      // drifted mid-fetch, so the results above could belong to the WRONG
      // project. Discard them wholesale rather than risk painting mismatched
      // content; the switch handler that bumped the revision already
      // scheduled a fresh refresh for the project actually being viewed now.
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh DISCARDED after fetch wave (stale revision) — results thrown away`)
        return
      }

      // Index the current layer keys once per refresh. A live push may have
      // landed during the fetch wave, so build this after the awaits. This keeps
      // stale/empty-output retention O(grid ports + preview layers), rather than
      // rescanning every preview layer for every affected port.
      const existingGridKeysByPort = new Map<string, string[]>()
      const gridPortIndexKey = (nodeId: string, portName: string): string =>
        `${nodeId}\u0000${portName}`
      for (const { node, port } of gridTasks) {
        existingGridKeysByPort.set(gridPortIndexKey(node.id, port.name), [])
      }
      for (const [key, layer] of Object.entries(useRenderStore.getState().previewLayers)) {
        const exactIndexKey = gridPortIndexKey(layer.nodeId, layer.portName)
        let bucket = existingGridKeysByPort.get(exactIndexKey)
        if (!bucket) {
          const multiValueMatch = /^(.*)\[\d+\]$/.exec(layer.portName)
          if (multiValueMatch) {
            bucket = existingGridKeysByPort.get(gridPortIndexKey(layer.nodeId, multiValueMatch[1]))
          }
        }
        bucket?.push(key)
      }
      const retainExistingGridKeys = (nodeId: string, portName: string) => {
        for (const key of existingGridKeysByPort.get(gridPortIndexKey(nodeId, portName)) ?? []) {
          desiredGridKeys.add(key)
        }
      }

      for (const { node, layers, names } of voxelResults) {
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) continue
        if (layers.length) setLayers(node.id, node.opId, layers, names)
        // empty payload: keep the last good frame. Param-drag emits
        // graph:applied (cache invalidated) BEFORE execute finishes, so
        // clearing here would black out the preview until rerun.
      }

      for (const { node, port, raw } of gridResults) {
        // The editor's direct push is newer than this fetch wave. Keep its keys
        // and discard the stale network result instead of visibly jumping back.
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) {
          retainExistingGridKeys(node.id, port.name)
          continue
        }
        // Declared grid ports: one flattened item == one dense grid. Wider
        // (any/array/list) ports: recursively pull grids out of the payload.
        const isDeclaredGrid = port.type === 'grid'
        const grids = isDeclaredGrid
          ? flattenWire<number[][]>(raw).filter(isGrid2D)
          : collectGrids(raw)
        if (grids.length === 0) {
          // Output caches are briefly empty between graph:applied and execute.
          // A declared grid cannot change runtime type, so retain its last good
          // frame; node deletion, port removal and preview-off are still GC'd.
          if (isDeclaredGrid) retainExistingGridKeys(node.id, port.name)
          continue
        }
        grids.forEach((grid, i) => {
          const portKey = grids.length > 1 ? `${port.name}[${i}]` : port.name
          setPreviewLayer(node.id, portKey, node.name ?? node.id, grid)
          desiredGridKeys.add(`${node.id}:${portKey}`)
        })
      }

      // GC layers whose source node/port vanished (deleted node, removed list
      // item, or a disconnect that left a node with no renderable output). This
      // is the faithful analog of the legacy `clearStale*` / `removePreviewLayer`
      // eviction — `listNodes()` is the post-mutation source of truth, so any
      // layer keyed off a node/port that is gone (or now empty) is pruned.
      // Skip on a NARROWED pass: it only inspected a subset of nodes, so its
      // desired sets are incomplete and would wrongly evict live layers belonging
      // to untouched nodes. Full refreshes (graph:applied, mount) own the GC.
      if (!narrowed) {
        retainPreviewLayers(desiredGridKeys)
        retainVoxelNodes(nodeIds)
      }
      syncTrace('preview:refresh-done', {
        voxelNodes: nodeIds.size,
        gridKeys: desiredGridKeys.size,
        narrowed,
      })
    }

    // Coalesce bursts (a delete can fire graph:applied, and downstream re-exec
    // can fire exec:completed) into a single refresh, and never overlap two
    // in-flight refreshes; if a trigger lands mid-flight, run exactly one more.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let graphRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let localParamSettleTimer: ReturnType<typeof setTimeout> | null = null
    const GRAPH_REFRESH_DEBOUNCE_MS = 400
    const LOCAL_PARAM_SETTLE_MS = 190
    let localParamEditUntil = 0
    const executionsInFlight = new Set<string>()
    let inFlight = false
    let pending = false
    let pendingNarrow: Set<string> | null = null
    async function runRefresh(): Promise<void> {
      if (inFlight) { pending = true; return }
      inFlight = true
      const scope = pendingNarrow
      pendingNarrow = null
      // Only surface the loading indicator for FULL refreshes (project switch /
      // mount / graph:applied) — narrowed slider-drag re-pulls are high-frequency
      // and would just make the progress panel flicker for no user benefit.
      const isFullRefresh = scope === null
      if (isFullRefresh) beginLoadingTask('previews')
      try {
        await refresh(scope ?? undefined)
      } catch (err) {
        syncTrace('preview:refresh-error', { error: String(err) })
        // Refresh can race graph edits while outputs are temporarily unavailable.
        // Keep the bridge quiet by default; opt in with localStorage when debugging.
        if (debugPreviewErrors()) {
          console.warn('[useNodePreviews] refresh failed:', err)
        }
      } finally {
        inFlight = false
        if (isFullRefresh) endLoadingTask('previews')
        if (pending && !cancelled) { pending = false; scheduleRefresh() }
      }
    }
    // `narrowTo` carries the affected-node scope for a coalesced exec refresh. A
    // full refresh (undefined) wins over a narrowed one when both coalesce into
    // the same window (structural changes must re-pull everything).
    function scheduleRefresh(narrowTo?: ReadonlySet<string>): void {
      if (narrowTo === undefined) {
        pendingNarrow = null
      } else if (pendingNarrow !== null) {
        for (const id of narrowTo) pendingNarrow.add(id)
      } else {
        pendingNarrow = new Set(narrowTo)
      }
      if (cancelled || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void runRefresh()
      }, 30)
    }

    // Local slider batches invalidate output caches before their execute
    // completes. Direct workbench preview-data pushes own the live frames; one
    // cache refresh after both the drag and the final execute settle owns GC.
    const scheduleLocalParamSettle = (): void => {
      if (localParamSettleTimer) clearTimeout(localParamSettleTimer)
      const wait = Math.max(30, localParamEditUntil - Date.now())
      localParamSettleTimer = setTimeout(() => {
        localParamSettleTimer = null
        if (executionsInFlight.size > 0 || Date.now() < localParamEditUntil) {
          scheduleLocalParamSettle()
          return
        }
        scheduleRefresh()
      }, wait)
    }
    _localParamEditNotifier = () => {
      // Cover slow group execution as well as the pointermove cadence. Every
      // pulse extends the window; the settle callback also waits for all known
      // executions, so this does not delay the final durable refresh.
      localParamEditUntil = Date.now() + 600
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      if (graphRefreshTimer) {
        clearTimeout(graphRefreshTimer)
        graphRefreshTimer = null
      }
      scheduleLocalParamSettle()
    }

    // Refresh on execution completion (live output values) AND on any graph
    // mutation. The latter is the fix for stale previews: deleting a node that
    // has no downstream triggers NO execution, so without a graph trigger the
    // GC never runs. The backend emits `graph:applied` on every applyBatch and
    // broadcasts it over WS, so the renderer iframe (subscribed to the 'graph'
    // channel) re-runs the GC and the orphaned grid/voxel layers vanish.
    const unsubExec = client.subscribe('execution', (e) => {
      if (e.kind === 'exec:started') {
        executionsInFlight.add(e.executionId)
        return
      }
      if (e.kind === 'exec:error') {
        executionsInFlight.delete(e.executionId)
      }
      // Always full refresh after execute — scene_output must re-pull even when
      // upstream-only exec:node:output events fired. Narrow scope caused stale
      // sinks; racing graph:applied before exec caused empty cache → black preview.
      if (e.kind === 'exec:completed') {
        executionsInFlight.delete(e.executionId)
        syncTrace('preview:exec-completed', {})
        if (graphRefreshTimer) {
          clearTimeout(graphRefreshTimer)
          graphRefreshTimer = null
        }
        if (Date.now() < localParamEditUntil || localParamSettleTimer) {
          scheduleLocalParamSettle()
        } else {
          scheduleRefresh()
        }
      }
    })
    const unsubGraph = client.subscribe('graph', (e) => {
      // Ephemeral param-drag batches emit graph:applied BEFORE execute lands;
      // debounce so exec:completed owns the live refresh and we don't pull an
      // invalidated (empty) scene_output mid-flight. Structural edits still GC
      // after the debounce window (delete/disconnect with no exec).
      if (e.kind === 'graph:applied') {
        if (e.batchId.startsWith('editor-param-')) {
          localParamEditUntil = Date.now() + LOCAL_PARAM_SETTLE_MS
          if (graphRefreshTimer) {
            clearTimeout(graphRefreshTimer)
            graphRefreshTimer = null
          }
          scheduleLocalParamSettle()
          return
        }
        syncTrace('preview:graph-applied-debounced', {})
        if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
        graphRefreshTimer = setTimeout(() => {
          graphRefreshTimer = null
          scheduleRefresh()
        }, GRAPH_REFRESH_DEBOUNCE_MS)
      }
      if (e.kind === 'project:viewing' || e.kind === 'project:activated') {
        const projectId = (e as { projectId?: string }).projectId
        if (projectId) {
          projectRevision += 1
          client.syncViewingProjectId(projectId)
          scheduleRefresh()
        }
      }
    })
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      if (!projectId) return
      projectRevision += 1
      client.syncViewingProjectId(projectId)
      scheduleRefresh()
    }
    window.addEventListener('message', onWorkbenchMessage)
    // Re-project when the editor's preview toggles arrive (override map changes),
    // so flipping a node's preview off/on adds/removes its layers immediately
    // without waiting for a graph mutation or re-execution. Compare by CONTENT
    // (not object identity): a `reset()` mints a fresh empty map but must not
    // trigger a spurious refresh when the override set is effectively unchanged.
    const overrideKey = (m: Record<string, boolean>): string =>
      Object.keys(m).sort().map((k) => `${k}=${m[k] ? 1 : 0}`).join(',')
    let lastOverrideKey = overrideKey(useRenderStore.getState().previewOverrides)
    const unsubOverrides = useRenderStore.subscribe((state) => {
      const key = overrideKey(state.previewOverrides)
      if (key !== lastOverrideKey) {
        lastOverrideKey = key
        scheduleRefresh()
      }
    })
    void runRefresh()
    return () => {
      cancelled = true
      _liveProjector = null
      _localParamEditNotifier = null
      if (refreshTimer) clearTimeout(refreshTimer)
      if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
      if (localParamSettleTimer) clearTimeout(localParamSettleTimer)
      unsubExec()
      unsubGraph()
      unsubOverrides()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [client, setLayers, clearLayers, retainVoxelNodes, setPreviewLayer, clearPreviewLayers, retainPreviewLayers])
}
