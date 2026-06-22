import { useEffect } from 'react'
import { useRenderStore } from '../store'
import type { AliasMeta } from '../framework/asset/matchAssetEntry'
import { clearAllImgCache } from '../framework/asset/imageCache'

// Fetch the 'raw' zone's alias metadata and push it into the store. The asset
// drawMode matcher resolves each layer's asset_name against this pool.
//
// The pool is NOT static: it grows whenever a texture is imported / published
// into the active project's private `raw` zone (e.g. the texture-pipeline
// publish bridge `scene:library.publishExternal`), and it differs per project.
// So besides the initial fetch we MUST re-pull on:
//   - `library:changed`  — any library mutation (import / publish-external / …)
//                          broadcasts this; without it a freshly published
//                          texture never matches until a full reload.
//   - project activation — switching the active project changes the private
//                          store; the old project's pool is stale.
// Mirrors the `/ws` + `workbench:project-changed` wiring in useBakedLayers.

async function refreshAliasMetas(): Promise<void> {
  try {
    const res = await fetch('/api/v1/library/aliases-meta?zone=raw')
    if (!res.ok) return
    const metas = (await res.json()) as AliasMeta[]
    if (Array.isArray(metas)) {
      useRenderStore.getState().setAliasMetas(metas)
      // New sandbox/private assets may have failed an earlier serve fetch (404);
      // bust the cache so billboard/topBillboard retry loading textures live.
      clearAllImgCache()
    }
  } catch {
    // tolerate failure — leave the current pool intact
  }
}

function isProjectActivated(msg: { event?: string; payload?: unknown }): boolean {
  if (msg.event !== 'runtime' || !msg.payload || typeof msg.payload !== 'object') return false
  return (msg.payload as { kind?: unknown }).kind === 'project:activated'
}

export function useAliasMetas(): void {
  useEffect(() => {
    void refreshAliasMetas()

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
        if (msg.event === 'library:changed' || isProjectActivated(msg)) void refreshAliasMetas()
      }
    }
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown } | null
      if (data && data.type === 'workbench:project-changed') void refreshAliasMetas()
    }
    window.addEventListener('message', onWorkbenchMessage)
    return () => {
      ws?.close()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [])
}
