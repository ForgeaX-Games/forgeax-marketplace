// Embedded sub-app URLs. Unlike the legacy workbench (separate dev ports for
// editor / renderer / assetstore), the scene generator serves every surface from
// the SAME Vite app and routes by `?pane=`. Same-origin keeps the `/api` proxy
// and WebSocket working for the child iframes without extra dev-server wiring.

export type WorkbenchPane = 'renderer' | 'assetstore'

/** Build a same-origin child-pane URL, forwarding host context (game slug, etc.). */
export function paneUrl(pane: WorkbenchPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  const params = new URLSearchParams()
  params.set('pane', pane)
  if (typeof location !== 'undefined') {
    const src = new URLSearchParams(location.search)
    // Studio encodes the active ForgeaX game on every plugin iframe; child panes
    // (renderer / assetstore) need the same slug for game-scoped actions like
    // mesh3d export.
    for (const key of ['slug', 'projectId'] as const) {
      const value = src.get(key)
      if (value) params.set(key, value)
    }
  }
  return `${path}?${params.toString()}`
}
