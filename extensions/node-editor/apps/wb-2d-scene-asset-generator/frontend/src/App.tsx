import { useMemo } from 'react'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { ImagePreviewSurface } from './surfaces/ImagePreviewSurface.js'
import { GeneratedAssetStoreSurface } from './surfaces/GeneratedAssetStoreSurface.js'

// Pane router. The 2D asset generator serves every surface from this one Vite app
// and selects by `?pane=`:
//   • preview     → generated image preview surface (embedded iframe child)
//   • renderer    → compatibility alias for preview
//   • assetstore  → generated asset folder surface (embedded iframe child)
//   • left        → host sidebar: navigation/status/help, not the main canvas
//   • center      → the workbench host: kernel Editor + embedded panes on 9565
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  if (pane === 'preview' || pane === 'renderer') return <ImagePreviewSurface />
  if (pane === 'assetstore') return <GeneratedAssetStoreSurface />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  return <WorkbenchHost />
}
