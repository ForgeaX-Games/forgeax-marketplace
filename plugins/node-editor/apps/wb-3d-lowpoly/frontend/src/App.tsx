import { useEffect, useMemo } from 'react'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { UrdfViewerSurface } from './surfaces/UrdfViewerSurface.js'

// Pane router. Every surface is served from this one Vite app and selected by
// `?pane=`:
//   • urdf      → the three.js URDF 3D viewer surface (embedded iframe child)
//   • left      → host sidebar: navigation/status/help, not the main canvas
//   • center    → the workbench host: kernel Editor + embedded panes
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  // Dispose the client (and its WebSocket) when the app tears down / HMR remounts.
  useEffect(() => () => { client.dispose() }, [client])

  if (pane === 'urdf') return <UrdfViewerSurface client={client} />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  return <WorkbenchHost />
}
