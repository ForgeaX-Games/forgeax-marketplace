import { useEffect } from 'react'
import type { ApiClient } from '@forgeax/node-runtime-react'
import type { GraphNode } from '@forgeax/node-runtime'
import { flattenWire } from './flattenWire'
import { useViewerStore } from './store/viewerStore'

// Live-sync the embedded URDF viewer to the graph. Modeled on the scene
// generator's `useNodePreviews`: the kernel exec bus carries no payloads, so the
// URDF XML is PULLED via the ApiClient whenever a node executes or the graph
// mutates, then pushed into the vendored viewer store.
//
// Source-of-truth node: the `urdf_preview` battery's `urdf` output. FALLBACK: a
// bare `…→ g_to_urdf` graph (no preview node yet) still previews off the
// `g_to_urdf.urdf` output, so wiring the converter is enough to see the model.
//
// STALE: if no `urdf_preview` / `g_to_urdf` node remains (deleted / disconnected
// chain that yields no URDF), the source is cleared so the viewport empties —
// the faithful analog of the renderer's stale eviction.

const PREVIEW_OP = 'urdf_preview'
const FALLBACK_OP = 'g_to_urdf'
const URDF_PORT = 'urdf'

/**
 * Pick the best URDF source node: prefer `urdf_preview` nodes; if none exist,
 * fall back to `g_to_urdf`. Among the chosen bucket, prefer the most recently
 * `completed` one (last in list order — the kernel exposes no exec timestamp),
 * else the last node so a freshly-wired graph still previews.
 */
function pickSourceNode(nodes: readonly GraphNode[]): GraphNode | null {
  const previews = nodes.filter((n) => n.opId === PREVIEW_OP)
  const bucket = previews.length ? previews : nodes.filter((n) => n.opId === FALLBACK_OP)
  if (!bucket.length) return null
  const completed = bucket.filter((n) => n.status === 'completed')
  const pool = completed.length ? completed : bucket
  return pool[pool.length - 1] ?? null
}

export function useUrdfLiveSync(client: ApiClient): void {
  useEffect(() => {
    let cancelled = false

    async function refresh(): Promise<void> {
      const nodes = await client.listNodes()
      if (cancelled) return
      const node = pickSourceNode(nodes)
      if (!node) {
        // STALE eviction: no source node left → empty the viewer.
        if (useViewerStore.getState().source) useViewerStore.getState().setSource('', { baseUrl: '' })
        return
      }
      const value = await client.getNodeOutput(node.id, URDF_PORT)
      if (cancelled) return
      const urdf = flattenWire<string>(value)[0]
      if (typeof urdf === 'string' && urdf.includes('<robot')) {
        // Baked composite Parts/Gears emit <mesh filename="<sha>.obj"/>; the
        // viewer's geometry loader fetches `baseUrl + '/' + filename`, so point
        // it at the content-addressed blob route. URDF-native primitives
        // (box/cylinder/sphere) carry no filename and ignore baseUrl.
        useViewerStore.getState().setSource(urdf, { baseUrl: '/api/v1/library/blob' })
      }
    }

    // Coalesce bursts (a delete fires graph:applied; downstream re-exec fires
    // exec:completed) into one refresh, and never overlap two in-flight; if a
    // trigger lands mid-flight, run exactly one more.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let pending = false
    async function runRefresh(): Promise<void> {
      if (inFlight) { pending = true; return }
      inFlight = true
      try {
        await refresh()
      } catch {
        /* transient fetch failure — a later trigger will retry */
      } finally {
        inFlight = false
        if (pending && !cancelled) { pending = false; scheduleRefresh() }
      }
    }
    function scheduleRefresh(): void {
      if (cancelled || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void runRefresh()
      }, 30)
    }

    const unsubExec = client.subscribe('execution', (e) => {
      if (e.kind === 'exec:completed') scheduleRefresh()
    })
    const unsubGraph = client.subscribe('graph', (e) => {
      if (e.kind === 'graph:applied') scheduleRefresh()
    })
    void runRefresh()

    return () => {
      cancelled = true
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubExec()
      unsubGraph()
    }
  }, [client])
}
