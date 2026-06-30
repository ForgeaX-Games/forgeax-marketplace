// Baked-layer ingestion — the graph-INDEPENDENT counterpart to useNodePreviews.
// It pulls the project's hand-edited layers from the baked scene-layer service
// into the store's `bakedLayers` bucket. Baked edits can originate outside the
// renderer iframe (left-pane undo/redo, agent actions), so this hook also listens
// for the backend's `baked:changed` broadcast and refreshes from the service.

import { useEffect } from 'react'
import { deferBakedLayersRefresh, hasLocalBakedLayerEdits, useRenderStore } from '../store'
import { bakedApi } from './bakedApi'

let projectRevision = 0

/**
 * Fetch the baked layers and write them into the store. Safe to call anywhere.
 *
 * Defaults to `deferIfLocalPending: true`: a refresh is NEVER allowed to clobber
 * in-flight local paint edits (the dominant "drawing results lost" cause was an
 * eager host-side refresh racing a local persist). When local edits are pending
 * the refresh is deferred — the persist's settle path replays it against fresh
 * server state. Pass `deferIfLocalPending: false` only from flows that have
 * already drained local edits (post-settle reconcile, undo/redo, project load).
 */
export async function refreshBakedLayers(options: { deferIfLocalPending?: boolean } = {}): Promise<void> {
  const revision = projectRevision
  const deferIfLocalPending = options.deferIfLocalPending ?? true
  if (deferIfLocalPending && hasLocalBakedLayerEdits()) {
    deferBakedLayersRefresh()
    return
  }
  try {
    const layers = await bakedApi.list()
    if (revision !== projectRevision) return
    useRenderStore.getState().setBakedLayers(layers)
  } catch (e) {
    // Leave the current bucket intact on a transient fetch error.
    console.warn('[baked] layer refresh failed', e)
  }
}

function refreshBakedLayersForProject(): void {
  projectRevision += 1
  useRenderStore.getState().clearBakedLayers()
  void refreshBakedLayers()
}

function projectIdFromRuntimeMessage(msg: { event?: string; payload?: unknown }): string | null {
  if (msg.event !== 'runtime' || !msg.payload || typeof msg.payload !== 'object') return null
  const payload = msg.payload as { kind?: unknown; projectId?: unknown }
  if (payload.kind !== 'project:activated') return null
  return typeof payload.projectId === 'string' ? payload.projectId : ''
}

/** Load baked layers and keep them synced with backend baked mutations. */
export function useBakedLayers(): void {
  useEffect(() => {
    void refreshBakedLayers()
    let activeProjectId: string | null = null
    const handleProjectChanged = (projectId?: string) => {
      const nextProjectId = projectId && projectId.trim() ? projectId : null
      if (nextProjectId && nextProjectId === activeProjectId) return
      activeProjectId = nextProjectId
      refreshBakedLayersForProject()
    }
    let ws: WebSocket | null = null
    if (typeof WebSocket !== 'undefined' && typeof location !== 'undefined') {
      ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
      ws.onmessage = (ev) => {
        let msg: { event?: string }
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.event === 'baked:changed') void refreshBakedLayers({ deferIfLocalPending: true })
        const activatedProjectId = projectIdFromRuntimeMessage(msg)
        if (activatedProjectId !== null) handleProjectChanged(activatedProjectId)
      }
    }
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      handleProjectChanged(typeof data.projectId === 'string' ? data.projectId : undefined)
    }
    window.addEventListener('message', onWorkbenchMessage)
    return () => {
      ws?.close()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [])
}
