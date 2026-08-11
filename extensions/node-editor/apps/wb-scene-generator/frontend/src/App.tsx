import { useMemo } from 'react'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { RendererSurface } from './surfaces/RendererSurface.js'

// Pane router. The scene generator serves every surface from this one Vite app
// and selects by `?pane=`:
//   • renderer    → the faithful render preview surface (embedded iframe child)
//   • left        → host sidebar: navigation/status/help, not the main canvas
//   • center      → the workbench host: kernel Editor + embedded preview on 9555
export function App({
  pane,
  slug,
  projectId,
}: {
  pane?: string
  slug?: string | null
  projectId?: string | null
}): JSX.Element {
  const client = useMemo(
    () => new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: projectId ?? undefined }),
    [projectId],
  )

  if (pane === 'renderer') return <RendererSurface client={client} gameSlug={slug} />
  if (pane === 'left') return <WorkbenchLeftPane client={client} slug={slug} />
  return <WorkbenchHost />
}
