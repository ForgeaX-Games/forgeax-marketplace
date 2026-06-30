import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App.js'

vi.mock('../workbench/WorkbenchHost.js', () => ({
  WorkbenchHost: () => <div>Center Workbench</div>,
}))

vi.mock('../surfaces/UrdfViewerSurface.js', () => ({
  UrdfViewerSurface: () => <div>URDF Viewer Surface</div>,
}))

// The left pane now mounts the kernel <ProjectPanel> from the editor barrel,
// which transitively loads the canvas (touches `document` at import). This
// pane-routing test runs in a node env, so stub the barrel — its intent is
// routing, not the project panel internals.
vi.mock('@forgeax/node-runtime-react/editor', () => ({
  ProjectPanel: () => <div>Project Panel</div>,
  EditorControlsPanel: () => <div>Editor Controls</div>,
  configureEditorTransport: () => {},
  createEditorTransport: () => ({ dispose: () => {} }),
  useProjectStore: Object.assign(() => undefined, {
    getState: () => ({ fetchProjects: () => {}, subscribeProjectActivation: () => () => {} }),
  }),
}))

describe('App pane routing', () => {
  it('renders a dedicated lowpoly left pane for pane=left', () => {
    const html = renderToStaticMarkup(<App pane="left" />)

    expect(html).toContain('Lowpoly Workbench Navigation')
    expect(html).not.toContain('Character')
    expect(html).not.toContain('character')
    expect(html).not.toContain('Center Workbench')
  })

  it('keeps pane=center on the main workbench host', () => {
    const html = renderToStaticMarkup(<App pane="center" />)

    expect(html).toContain('Center Workbench')
  })
})
