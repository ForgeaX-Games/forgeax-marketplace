// Baked-layer ingestion — the graph-INDEPENDENT counterpart to useNodePreviews.
// It pulls the project's hand-edited layers from the baked scene-layer service
// into the store's `bakedLayers` bucket. Baked edits can originate outside the
// renderer iframe (left-pane undo/redo, agent actions), so this hook also listens
// for the backend's `baked:changed` broadcast and refreshes from the service.

import { useEffect } from 'react'
import { deferBakedLayersRefresh, hasLocalBakedLayerEdits, useRenderStore } from '../store'
import { bakedApi, type BakedLayersMode } from './bakedApi'
import { readEditMode, subscribeEditMode } from '../../surfaces/library/editToolbarBus'
import { syncTrace, syncTraceHintOnce } from '../../debug/syncTrace.js'

let projectRevision = 0
let viewingProjectId: string | null = null
let bakedChangedTimer: ReturnType<typeof setTimeout> | null = null
const BAKED_CHANGED_DEBOUNCE_MS = 400

/**
 * Fetch baked layers and write them into the store. Safe to call anywhere.
 *
 * Defaults to summary mode (no cells) for browse/project-switch perf; pass
 * `mode: 'full'` when entering edit/paint or after structural mutations.
 */
export async function refreshBakedLayers(
  options: { deferIfLocalPending?: boolean; mode?: BakedLayersMode } = {},
): Promise<void> {
  const revision = projectRevision
  const deferIfLocalPending = options.deferIfLocalPending ?? true
  const mode = options.mode ?? (readEditMode() ? 'full' : 'summary')
  syncTrace('baked:refresh-start', { mode, deferIfLocalPending, revision })
  if (deferIfLocalPending && hasLocalBakedLayerEdits()) {
    syncTrace('baked:refresh-deferred', { reason: 'localPaintDirty' })
    deferBakedLayersRefresh()
    return
  }
  try {
    const layers = await bakedApi.list(mode)
    if (!Array.isArray(layers)) return
    if (revision !== projectRevision) return
    syncTrace('baked:refresh-done', { layerCount: layers.length, mode })
    useRenderStore.getState().setBakedLayers(layers, { summary: mode === 'summary' })
  } catch (e) {
    syncTrace('baked:refresh-error', { error: String(e) })
    // Leave the current bucket intact on a transient fetch error.
    console.warn('[baked] layer refresh failed', e)
  }
}

function refreshBakedLayersForProject(): void {
  projectRevision += 1
  void (async () => {
    const revision = projectRevision
    const mode = readEditMode() ? 'full' : 'summary'
    try {
      const layers = await bakedApi.list(mode)
      if (!Array.isArray(layers) || revision !== projectRevision) return
      const store = useRenderStore.getState()
      store.clearBakedLayers()
      store.setBakedLayers(layers, { summary: mode === 'summary' })
    } catch (e) {
      console.warn('[baked] project switch refresh failed', e)
    }
  })()
}

function projectIdFromRuntimeMessage(msg: { event?: string; payload?: unknown }): {
  kind: 'viewing' | null
  projectId: string | null
} {
  if (msg.event !== 'runtime' || !msg.payload || typeof msg.payload !== 'object') {
    return { kind: null, projectId: null }
  }
  const payload = msg.payload as { kind?: unknown; projectId?: unknown }
  if (payload.kind === 'project:viewing') {
    return {
      kind: 'viewing',
      projectId: typeof payload.projectId === 'string' ? payload.projectId : null,
    }
  }
  // Ignore legacy project:activated alias — backend broadcasts both and would double-fetch.
  if (payload.kind === 'project:activated') {
    return { kind: null, projectId: null }
  }
  return { kind: null, projectId: null }
}

/** Ignore baked mutations for projects the preview iframe is not showing. */
function shouldIgnoreBakedChanged(payload: unknown): boolean {
  const changedProjectId =
    payload && typeof payload === 'object' && typeof (payload as { projectId?: unknown }).projectId === 'string'
      ? (payload as { projectId: string }).projectId
      : null
  if (changedProjectId && viewingProjectId && changedProjectId !== viewingProjectId) return true
  return false
}

function scheduleBakedChangedRefresh(payload: unknown): void {
  if (shouldIgnoreBakedChanged(payload)) return
  syncTrace('baked:ws-changed-scheduled', { payload })
  if (bakedChangedTimer) clearTimeout(bakedChangedTimer)
  bakedChangedTimer = setTimeout(() => {
    bakedChangedTimer = null
    void refreshBakedLayers({ deferIfLocalPending: true })
  }, BAKED_CHANGED_DEBOUNCE_MS)
}

/** Load baked layers and keep them synced with backend baked mutations. */
export function useBakedLayers(): void {
  useEffect(() => {
    syncTraceHintOnce()
    // Defer so preview/asset-store iframes paint before the baked browse fetch.
    const initialTimer = setTimeout(() => { void refreshBakedLayers() }, 0)
    let activeProjectId: string | null = null
    const handleProjectChanged = (projectId?: string) => {
      const nextProjectId = projectId && projectId.trim() ? projectId : null
      viewingProjectId = nextProjectId
      if (nextProjectId && nextProjectId === activeProjectId) return
      activeProjectId = nextProjectId
      refreshBakedLayersForProject()
    }
    let ws: WebSocket | null = null
    if (typeof WebSocket !== 'undefined' && typeof location !== 'undefined') {
      ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
      ws.onmessage = (ev) => {
        let msg: { event?: string; payload?: unknown }
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.event === 'baked:changed') scheduleBakedChangedRefresh(msg.payload)
        const runtime = projectIdFromRuntimeMessage(msg)
        if (runtime.kind === 'viewing') handleProjectChanged(runtime.projectId ?? undefined)
      }
    }
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      handleProjectChanged(typeof data.projectId === 'string' ? data.projectId : undefined)
    }
    window.addEventListener('message', onWorkbenchMessage)
    const unsubEdit = subscribeEditMode((on) => {
      if (on) void refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })
    })
    return () => {
      clearTimeout(initialTimer)
      unsubEdit()
      if (bakedChangedTimer) clearTimeout(bakedChangedTimer)
      ws?.close()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [])
}
