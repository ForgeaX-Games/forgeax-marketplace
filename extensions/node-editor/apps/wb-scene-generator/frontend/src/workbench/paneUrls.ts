// Embedded sub-app URLs. Unlike the legacy workbench (separate dev ports for
// editor / renderer / assetstore), the scene generator serves every surface from
// the SAME Vite app and routes by `?pane=`. Same-origin keeps the `/api` proxy
// and WebSocket working for the child iframes without extra dev-server wiring.

export type WorkbenchPane = 'renderer' | 'assetstore'

export function paneUrl(pane: WorkbenchPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  return `${path}?pane=${pane}`
}
