// Embedded sub-app URLs. The 2D asset generator serves every surface from the
// SAME Vite app and routes by `?pane=`. Same-origin keeps the `/api` proxy and
// WebSocket working for the child iframes without extra dev-server wiring.

export type WorkbenchPane = 'preview' | 'assetstore'

export function paneUrl(pane: WorkbenchPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  return `${path}?pane=${pane}`
}
