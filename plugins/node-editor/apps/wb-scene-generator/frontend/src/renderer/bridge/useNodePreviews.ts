import { useEffect } from 'react'
import type { HttpApiClient } from '../../api/HttpApiClient'
import { useRenderStore } from '../store'
import { flattenWire, flattenWireList } from './flattenWire'
import type { NameListEntry, VoxelLayer } from '../types'

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

/**
 * Project a directly-pushed outputs map (`nodeId → portName → value`) into the
 * render store, identical to the WS re-pull path but with zero network. No-op
 * until `useNodePreviews` has mounted and loaded the op catalog. Safe to call
 * from the renderer's `workbench:preview-data` handler on every drag tick.
 */
export function projectLiveOutputs(outputs: Record<string, Record<string, unknown>>): void {
  _liveProjector?.(outputs)
}

export function useNodePreviews(client: HttpApiClient): void {
  const setLayers = useRenderStore((s) => s.setLayers)
  const clearLayers = useRenderStore((s) => s.clearLayers)
  const retainVoxelNodes = useRenderStore((s) => s.retainVoxelNodes)
  const setPreviewLayer = useRenderStore((s) => s.setPreviewLayer)
  const clearPreviewLayers = useRenderStore((s) => s.clearPreviewLayers)
  const retainPreviewLayers = useRenderStore((s) => s.retainPreviewLayers)

  useEffect(() => {
    let cancelled = false
    // opId → output port specs, fetched lazily once (the catalog is static for a
    // session). A failed fetch leaves the cache null so a later run can retry.
    let opOutputs: Map<string, PortSpec[]> | null = null
    // nodeId → { opId, name }, refreshed from every listNodes() pass. The live
    // direct-push projector reads this (instead of re-fetching listNodes per
    // tick) to map a pushed (nodeId, port) value to its port types + label.
    const nodeMeta = new Map<string, { opId: string; name: string }>()
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

    // Register the live direct-push projector: the editor forwards freshly
    // executed outputs over `workbench:preview-data`; we paint them straight into
    // the render store using the cached catalog/meta, with zero network. Only the
    // grid bucket is pushed live (the felt slider preview); voxel sinks still ride
    // the trailing WS refresh. No-op for nodes we have no meta for yet (the first
    // full refresh seeds it). Honors the same previewOverrides gate as the WS path.
    _liveProjector = (outputs) => {
      const overrides = useRenderStore.getState().previewOverrides
      for (const [nodeId, ports] of Object.entries(outputs)) {
        const meta = nodeMeta.get(nodeId)
        if (!meta) continue
        const override = overrides[nodeId]
        const previewEnabled = override !== undefined ? override : true
        desiredGridKeysFor(nodeId, meta.opId, meta.name, previewEnabled, (portName) => ports[portName])
      }
    }

    async function refresh(onlyNodeIds?: ReadonlySet<string>): Promise<void> {
      const [allNodes, specs] = await Promise.all([client.listNodes(), ensureOpOutputs()])
      if (cancelled) return
      // Refresh the node meta cache used by the live push projector.
      nodeMeta.clear()
      for (const n of allNodes) nodeMeta.set(n.id, { opId: n.opId, name: n.name ?? n.id })

      // Narrowed re-pull (drag-tick fast path): a high-frequency `exec:completed`
      // only needs the nodes this execution actually touched (collected from the
      // `exec:node:output` events), not every node in the graph. This cuts the
      // per-tick fan-out from O(graph) `getNodeOutput` calls down to the handful
      // downstream of the dragged slider — the iframe preview can then keep up
      // with the drag. Generic: purely a projection scope, no computation moves
      // here. GC is skipped on a narrowed pass (it needs the full node set); the
      // graph:applied / initial full refresh owns eviction.
      const narrowed = onlyNodeIds !== undefined && onlyNodeIds.size > 0
      const nodes = narrowed ? allNodes.filter((n) => onlyNodeIds!.has(n.id)) : allNodes

      const desiredGridKeys = new Set<string>()
      const nodeIds = new Set<string>()
      // Editor preview toggles ride the `workbench:preview-change` postMessage,
      // not the backend graph, so consult the client-side override first; only
      // fall back to the backend `previewEnabled` when a node has no override.
      const overrides = useRenderStore.getState().previewOverrides

      for (const node of nodes) {
        nodeIds.add(node.id)
        const ports = specs.get(node.opId) ?? []
        const override = overrides[node.id]
        const previewEnabled =
          override !== undefined ? override : (node as { previewEnabled?: boolean }).previewEnabled !== false

        // ── voxel layers (scene_output sink): replace this node's voxel bucket ──
        const voxelPort = ports.find((p) => p.type === 'voxel_layers')
        if (voxelPort) {
          // `voxel_layers` / `name_list` are list-valued ports: the wire is
          // double-wrapped (`fromItem(T[])` → items:[[…]]), so unwrap to the
          // leaf elements — flattenWire alone would yield a single array-element
          // and the renderer would hit `layer.cells is not iterable`.
          const layers = flattenWireList<VoxelLayer>(await client.getNodeOutput(node.id, voxelPort.name))
          if (cancelled) return
          const namePort = ports.find((p) => p.type === 'name_list')
          const names = namePort
            ? flattenWireList<NameListEntry>(await client.getNodeOutput(node.id, namePort.name))
            : []
          if (cancelled) return
          if (previewEnabled && layers.length) setLayers(node.id, node.opId, layers, names)
          else clearLayers(node.id)
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
        for (const port of gridPorts) {
          if (await isShardedOutput(client, node.id, port.name)) continue
          const raw = await client.getNodeOutput(node.id, port.name)
          if (cancelled) return
          // Declared grid ports: one flattened item == one dense grid. Wider
          // (any/array/list) ports: recursively pull grids out of the payload.
          const isDeclaredGrid = port.type === 'grid'
          const grids = isDeclaredGrid
            ? flattenWire<number[][]>(raw).filter(isGrid2D)
            : collectGrids(raw)
          if (grids.length === 0) continue
          grids.forEach((grid, i) => {
            const portKey = grids.length > 1 ? `${port.name}[${i}]` : port.name
            setPreviewLayer(node.id, portKey, node.name ?? node.id, grid)
            desiredGridKeys.add(`${node.id}:${portKey}`)
          })
        }
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
    }

    // Coalesce bursts (a delete can fire graph:applied, and downstream re-exec
    // can fire exec:completed) into a single refresh, and never overlap two
    // in-flight refreshes; if a trigger lands mid-flight, run exactly one more.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let pending = false
    // Drag-tick fast path: nodes whose output changed in the CURRENT execution,
    // accumulated from `exec:node:output` between `exec:started` and
    // `exec:completed`. When non-empty at completion, the next refresh is
    // narrowed to just these nodes, avoiding the whole-graph re-pull. A
    // `graph:applied` (structural change) forces a full refresh by clearing it.
    let liveAffected = new Set<string>()
    let pendingNarrow: Set<string> | null = null
    async function runRefresh(): Promise<void> {
      if (inFlight) { pending = true; return }
      inFlight = true
      const scope = pendingNarrow
      pendingNarrow = null
      try {
        await refresh(scope ?? undefined)
      } catch (err) {
        // Refresh can race graph edits while outputs are temporarily unavailable.
        // Keep the bridge quiet by default; opt in with localStorage when debugging.
        if (debugPreviewErrors()) {
          console.warn('[useNodePreviews] refresh failed:', err)
        }
      } finally {
        inFlight = false
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

    // Refresh on execution completion (live output values) AND on any graph
    // mutation. The latter is the fix for stale previews: deleting a node that
    // has no downstream triggers NO execution, so without a graph trigger the
    // GC never runs. The backend emits `graph:applied` on every applyBatch and
    // broadcasts it over WS, so the renderer iframe (subscribed to the 'graph'
    // channel) re-runs the GC and the orphaned grid/voxel layers vanish.
    const unsubExec = client.subscribe('execution', (e) => {
      // Track which nodes this execution touched so the completion refresh can be
      // narrowed to just them (drag-tick fast path). exec:started clears the
      // scope; each exec:node:output adds its node; exec:completed flushes.
      if (e.kind === 'exec:started') {
        liveAffected = new Set()
      } else if (e.kind === 'exec:node:output') {
        const id = (e as { nodeId?: string }).nodeId
        if (id) liveAffected.add(id)
      } else if (e.kind === 'exec:completed') {
        const scope = liveAffected.size > 0 ? liveAffected : undefined
        liveAffected = new Set()
        scheduleRefresh(scope)
      }
    })
    const unsubGraph = client.subscribe('graph', (e) => {
      if (e.kind === 'graph:applied') scheduleRefresh() // full (GC) refresh
    })
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
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubExec()
      unsubGraph()
      unsubOverrides()
    }
  }, [client, setLayers, clearLayers, retainVoxelNodes, setPreviewLayer, clearPreviewLayers, retainPreviewLayers])
}
