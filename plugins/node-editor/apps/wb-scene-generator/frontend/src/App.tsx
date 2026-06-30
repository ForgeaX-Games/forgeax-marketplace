import { useMemo } from 'react'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { RendererSurface } from './surfaces/RendererSurface.js'
import { AssetStoreSurface } from './surfaces/AssetStoreSurface.js'

// Pane router. The scene generator serves every surface from this one Vite app
// and selects by `?pane=`:
//   • renderer    → the faithful render preview surface (embedded iframe child)
//   • assetstore  → the asset library surface (embedded iframe child)
//   • left        → host sidebar: navigation/status/help, not the main canvas
//   • center      → the workbench host: kernel Editor + embedded panes on 9555
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  if (pane === 'renderer') return <RendererSurface client={client} />
  if (pane === 'assetstore') return <AssetStoreSurface client={client} />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  return <WorkbenchHost />
}
