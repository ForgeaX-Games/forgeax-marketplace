import { useEffect, useMemo } from 'react'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { Viewer3DSurface } from './surfaces/Viewer3DSurface.js'

// Pane router. Every surface is served from this one Vite app and selected by
// `?pane=`:
//   • viewer3d  → the three.js 3D viewer surface (static / URDF / character; embedded iframe child)
//   • left      → host sidebar: navigation/status/help, not the main canvas
//   • center    → the workbench host: kernel Editor + embedded panes
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  // Dispose the client (and its WebSocket) when the app tears down / HMR remounts.
  useEffect(() => () => { client.dispose() }, [client])

  if (pane === 'viewer3d') return <Viewer3DSurface client={client} />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  return <WorkbenchHost />
}
