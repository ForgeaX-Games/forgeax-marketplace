// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { RendererSurface } from '../RendererSurface'
import { AssetStoreSurface } from '../AssetStoreSurface'
import { useRenderStore } from '../../renderer/store'
import { useAssetStoreStore, RULES_ZONE } from '../library/assetStoreStore'
import { readSelectedRule } from '../library/rulesApi'
import type { HttpApiClient } from '../../api/HttpApiClient'

// Mock the heavy RenderCanvas (WebGL/2D plugin host) with a light stub that
// publishes a fake PluginHandle into the parent's handleRef — exactly the §7.3
// screenshot protocol the real plugins expose (renderFrame + getFrameCanvas).
// This lets the screenshot test drive the SAME render API the surface reuses,
// without standing up a real renderer in jsdom.
const SHOT_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const renderFrameMock = vi.fn()
vi.mock('../../renderer/host/RenderCanvas.js', () => ({
  RenderCanvas: ({ handleRef }: { handleRef?: { current: unknown } }) => {
    if (handleRef) {
      const canvas = { width: 320, height: 200, toDataURL: () => SHOT_DATA_URL } as unknown as HTMLCanvasElement
      handleRef.current = {
        renderFrame: renderFrameMock,
        getFrameCanvas: () => canvas,
      }
    }
    return null
  },
}))

// A fake ApiClient with just the surface the renderer/assetstore consume.
function fakeClient(): HttpApiClient {
  return {
    subscribe: () => () => {},
    async listOps() {
      return []
    },
    async listNodes() {
      return []
    },
    async getNodeOutput() {
      return undefined
    },
  } as unknown as HttpApiClient
}

beforeEach(() => {
  useRenderStore.getState().reset()
  renderFrameMock.mockClear()
  if (!HTMLElement.prototype.scrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'featurePolicy')
  Reflect.deleteProperty(document, 'permissionsPolicy')
})

describe('RendererSurface', () => {
  it('renders a faithful Preview toolbar (view dropdown + draw segment) with NO run/execute button and a Layers panel', () => {
    const { container, getByText } = render(<RendererSurface client={fakeClient()} />)
    // Faithful legacy chrome: "Preview" title, view-mode trigger (default "Billboard"),
    // and the Wire/Color/Asset draw segment.
    expect(getByText('Preview')).toBeTruthy()
    expect(getByText('Billboard')).toBeTruthy()
    expect(getByText('Wire')).toBeTruthy()
    expect(getByText('Color')).toBeTruthy()
    expect(getByText('Asset')).toBeTruthy()
    // Layers side panel present with the faithful (scene-output-only) empty-state copy.
    expect(container.querySelector('.renderer-layers')).not.toBeNull()
    expect(getByText('No scene output layers')).toBeTruthy()
    // No execution affordance leaks into the renderer chrome.
    expect(container.textContent).not.toMatch(/\b(Run|Execute|Play|Stop)\b/)
  })

  it('lists ONLY scene_output voxel layers — grid previews stay on canvas, never in the panel', () => {
    // Seed both buckets: a grid preview (intermediate node) and a voxel layer (sink).
    useRenderStore.getState().setPreviewLayer('noise', 'grid', 'cellular_noise', [[0, 1], [1, 0]], 'grid')
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    const rows = container.querySelectorAll('.renderer-layers .renderer-layer-row')
    // Exactly one row — the voxel layer. The grid preview is rendered on canvas only.
    expect(rows).toHaveLength(1)
    expect(container.querySelector('.renderer-layers')?.textContent).toContain('Wall')
    expect(container.querySelector('.renderer-layers')?.textContent).not.toContain('cellular_noise')
  })

  it('surfaces the screenshot + reset-view actions as direct top-toolbar buttons', () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    const shot = container.querySelector('.renderer-toolbar button[title="Save screenshot"]')
    expect(shot).not.toBeNull()
    // Reset view ("回正视角") is now a direct toolbar button, no longer buried in
    // the removed settings gear dropdown.
    expect(container.querySelector('.renderer-toolbar button[title="Reset view"]')).not.toBeNull()
    expect(container.querySelectorAll('button[title="Save screenshot"]')).toHaveLength(1)
  })

  it('captures the frame via the existing render API and presents a copyable PNG result (no clipboard/download)', async () => {
    const writeTextMock = vi.fn(async () => {})
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock, write: vi.fn(async () => {}) },
    })
    const createObjectURL = vi.fn(() => 'blob:should-not-be-used')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })

    const { container, getByLabelText } = render(<RendererSurface client={fakeClient()} />)
    const shot = container.querySelector('button[title="Save screenshot"]') as HTMLButtonElement

    await act(async () => { fireEvent.click(shot) })

    // The button drives the SAME render API the surface already had a handle to:
    // force a synchronous compose, then read the frame canvas.
    expect(renderFrameMock).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(container.querySelector('.renderer-shot-popover')).not.toBeNull())
    const popover = container.querySelector('.renderer-shot-popover') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(popover.textContent).toContain('Screenshot ready')

    // Copyable readonly PNG data URL (base64) — selectable text, the same kind of
    // surface the export-URL popover uses since the iframe blocks the clipboard.
    const field = popover.querySelector('[aria-label="Screenshot PNG data URL"]') as HTMLTextAreaElement
    expect(field).not.toBeNull()
    expect(field.readOnly).toBe(true)
    expect(field.value).toBe(SHOT_DATA_URL)
    fireEvent.focus(field)
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(SHOT_DATA_URL.length)

    // Inline thumbnail the user can right-click → Copy/Save.
    const img = popover.querySelector('.renderer-shot-popover__preview') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(SHOT_DATA_URL)

    // No blocked APIs: no clipboard write, no createObjectURL / <a download> click.
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()

    // X close dismisses the popover.
    fireEvent.click(getByLabelText('Close screenshot result'))
    expect(container.querySelector('.renderer-shot-popover')).toBeNull()
  })

  it('exports the current baked scene as scene.zip from the Preview toolbar', async () => {
    const writeTextMock = vi.fn(async () => {})
    const downloadUrl = 'http://192.168.50.20:9557/api/v1/scene-export/download/preview-export-2026-06-04T06-00-00Z'
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scene-export/cook' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          bundleId: 'preview-export-2026-06-04T06-00-00Z',
          zipPath: '/tmp/project/exports/scene/preview-export/scene.zip',
          unpackedDir: '/tmp/project/exports/scene/preview-export/unpacked',
          downloadUrl,
          warnings: [],
        }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByLabelText } = render(<RendererSurface client={fakeClient()} />)
    const exportButton = container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement

    await act(async () => { fireEvent.click(exportButton) })

    await waitFor(() => expect(container.querySelector('.renderer-export-popover')).not.toBeNull())
    expect(container.querySelector('.renderer-toolbar button[aria-label="Export scene.zip"]')).toBe(exportButton)
    const popover = container.querySelector('.renderer-export-popover') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(popover.textContent).toContain('Scene export ready')
    expect(popover.textContent).toContain('Select and copy this full URL to download scene.zip:')
    const urlField = popover.querySelector('[aria-label="Scene zip download URL"]') as HTMLInputElement
    expect(urlField).not.toBeNull()
    expect(urlField.readOnly).toBe(true)
    expect(urlField.value).toBe(downloadUrl)
    fireEvent.focus(urlField)
    expect(urlField.selectionStart).toBe(0)
    expect(urlField.selectionEnd).toBe(downloadUrl.length)
    expect(container.querySelector('.renderer-export-download')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('Download scene.zip')
    expect(container.textContent).not.toContain('Open download page')
    expect(container.textContent).not.toContain('/tmp/project/exports/scene/preview-export/scene.zip')
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scene-export/cook', expect.objectContaining({ method: 'POST' }))

    fireEvent.click(getByLabelText('Close scene export result'))
    expect(container.querySelector('.renderer-export-popover')).toBeNull()

    await act(async () => { fireEvent.click(exportButton) })
    await waitFor(() => expect(container.querySelector('.renderer-export-popover')).not.toBeNull())
    expect((getByLabelText('Scene zip download URL') as HTMLInputElement).value).toBe(downloadUrl)
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/v1/scene-export/cook' && (init as RequestInit | undefined)?.method === 'POST',
    )).toHaveLength(2)
  })

  it('uses the backend-provided scene.zip download URL without redundant fallback controls', async () => {
    const downloadUrl = 'http://10.11.12.13:9557/api/v1/scene-export/download/minimal-export'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scene-export/cook' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          bundleId: 'minimal-export',
          zipPath: '/tmp/project/exports/scene/minimal-export/scene.zip',
          unpackedDir: '/tmp/project/exports/scene/minimal-export/unpacked',
          downloadUrl,
          warnings: [],
        }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<RendererSurface client={fakeClient()} />)
    await act(async () => {
      fireEvent.click(container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement)
    })

    await waitFor(() => expect(container.querySelector('.renderer-export-popover')).not.toBeNull())
    const urlField = container.querySelector('[aria-label="Scene zip download URL"]') as HTMLInputElement
    expect(urlField).not.toBeNull()
    expect(urlField.readOnly).toBe(true)
    expect(urlField.value).toBe(downloadUrl)
    expect(container.querySelector('.renderer-export-download')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('Download scene.zip')
    expect(container.textContent).not.toContain('Open download page')
    expect(container.textContent).not.toContain('/tmp/project/exports/scene/minimal-export/scene.zip')
  })

  it('shows export errors in a Preview toolbar popover without touching graph state', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/scene-export/cook') return new Response(JSON.stringify({ error: 'missing asset: grass' }), { status: 400 })
      if (url === '/api/v1/baked/layers') return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByText } = render(<RendererSurface client={fakeClient()} />)
    await act(async () => {
      fireEvent.click(container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement)
    })

    await waitFor(() => expect(container.querySelector('.renderer-export-popover--error')).not.toBeNull())
    const popover = container.querySelector('.renderer-export-popover--error') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(getByText(/Export failed/i)).toBeTruthy()
    expect(popover.textContent).toContain('missing asset: grass')
    expect(container.querySelector('.renderer-export-status--error')).toBeNull()
    expect(useRenderStore.getState().layers).toEqual({})
  })

  it('provides a draggable splitter between Editable and Output layers', () => {
    const { getAllByRole } = render(<RendererSurface client={fakeClient()} />)
    const splitter = getAllByRole('separator', { name: 'Resize editable and output layers' })[0]
    expect(splitter.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('selects, scrolls, and starts renaming a newly added editable layer', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    const bakedLayers: Array<{
      nodePath: string
      nodeName: string
      value: number
      assetName: string
      cells: []
      attributes: Record<string, unknown>
    }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/baked/layers' && init?.method === 'POST') {
        bakedLayers.push({ nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: '', cells: [], attributes: {} })
        return new Response(JSON.stringify({ path: '/Layer' }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: bakedLayers }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    await act(async () => { fireEvent.click(editable.querySelector('button[title="Add editable layer"]') as HTMLButtonElement) })

    await waitFor(() => expect(getByLabelText('Rename editable layer')).toBe(document.activeElement))
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Layer')
    expect(container.querySelector('.renderer-layer-row--baked.is-selected')?.textContent).toContain('0')
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('selects and starts renaming a newly added editable sub-layer', async () => {
    const bakedLayers = [
      { nodePath: '/Parent', nodeName: 'Parent', value: 1, assetName: '', cells: [], attributes: {} },
    ]
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/baked/sublayer' && init?.method === 'POST') {
        bakedLayers.push({ nodePath: '/Parent/Sub', nodeName: 'Sub', value: 2, assetName: '', cells: [], attributes: {} })
        return new Response(JSON.stringify({ path: '/Parent/Sub' }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: bakedLayers }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    await waitFor(() => expect(editable.querySelector('.renderer-layer-name')?.textContent).toBe('Parent'))
    await act(async () => { fireEvent.click(editable.querySelector('button[title="Add sub-layer"]') as HTMLButtonElement) })

    await waitFor(() => expect(getByLabelText('Rename editable layer')).toBe(document.activeElement))
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Parent/Sub')
  })

  it('opens inline rename mode when double-clicking an editable layer title', async () => {
    const layers = [
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ layers }), { status: 200 })))
    useRenderStore.getState().setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
    ])

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    fireEvent.doubleClick(editable.querySelector('.renderer-layer-name') as HTMLElement)

    await waitFor(() => expect(getByLabelText('Rename editable layer')).toBe(document.activeElement))
    expect((getByLabelText('Rename editable layer') as HTMLInputElement).value).toBe('Floor')
  })

  it('marks a clicked editable layer as selected and the active paint target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ layers: [] }), { status: 200 })))
    useRenderStore.getState().setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
      { nodePath: '/Walls', nodeName: 'Walls', value: 2, assetName: '', cells: [], attributes: {} },
    ])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    const rows = editable.querySelectorAll('.renderer-layer-row--baked')
    fireEvent.click(rows[1])

    expect(rows[1].classList.contains('is-selected')).toBe(true)
    expect(rows[1].classList.contains('is-active')).toBe(true)
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].querySelector('.renderer-layer-paint-target')).toBeNull()
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Walls')
  })

  it('highlights the editor-selected node row (green) from store state', () => {
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    useRenderStore.getState().setSelectedEditorNodeIds(['sink'])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    const row = container.querySelector('.renderer-layers .renderer-layer-row')
    expect(row?.classList.contains('is-editor-selected')).toBe(true)
  })

  it('renders scene_output voxel layers as a scene-path hierarchy, not a flat list', () => {
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [
        { nodePath: '/Root', nodeName: 'Root', value: 1, cells: [{ x: 0, y: 0, z: 0 }] },
        { nodePath: '/Root/Child', nodeName: 'Child', value: 2, cells: [{ x: 1, y: 0, z: 0 }] },
        { nodePath: '/Root/Child/Leaf', nodeName: 'Leaf', value: 3, cells: [{ x: 2, y: 0, z: 0 }] },
      ],
      [
        { id: 1, name: 'root', type: 'scene' },
        { id: 2, name: 'child', type: 'scene' },
        { id: 3, name: 'leaf', type: 'scene' },
      ])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    const rows = Array.from(container.querySelectorAll('.renderer-layers .renderer-layer-row'))
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Root'),
      expect.stringContaining('Child'),
      expect.stringContaining('Leaf'),
    ]))
    expect(rows[1].classList.contains('renderer-layer-row--child')).toBe(true)
    expect(rows[2].classList.contains('renderer-layer-row--child')).toBe(true)
    expect((rows[2] as HTMLElement).style.paddingLeft).toBe('34px')
  })

  it('collapses descendants for output rows whose parent is also a layer', () => {
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [
        { nodePath: '/Root', nodeName: 'Root', value: 1, cells: [{ x: 0, y: 0, z: 0 }] },
        { nodePath: '/Root/Child', nodeName: 'Child', value: 2, cells: [{ x: 1, y: 0, z: 0 }] },
      ],
      [{ id: 1, name: 'root' }, { id: 2, name: 'child' }])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    const output = container.querySelector('.renderer-layers__section--output') as HTMLElement
    expect(output.querySelectorAll('.renderer-layer-row')).toHaveLength(2)
    act(() => (output.querySelector('button[title="Collapse"]') as HTMLButtonElement).click())
    expect(output.querySelectorAll('.renderer-layer-row')).toHaveLength(1)
  })

  it('mirrors a workbench:editor-selection postMessage into the highlight (host→pane wiring)', async () => {
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])

    const { container } = render(<RendererSurface client={fakeClient()} />)
    expect(container.querySelector('.renderer-layer-row')?.classList.contains('is-editor-selected')).toBe(false)

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workbench:editor-selection', selectedNodeIds: ['sink'] },
      }))
    })

    await waitFor(() => {
      expect(useRenderStore.getState().selectedEditorNodeIds).toEqual(['sink'])
      expect(container.querySelector('.renderer-layer-row')?.classList.contains('is-editor-selected')).toBe(true)
    })
  })
})

describe('AssetStoreSurface', () => {
  it('renders the legacy titlebar chrome (zone dropdown + view dropdown + fullscreen) and a thumbnail grid', async () => {
    useAssetStoreStore.setState({
      zones: [],
      activeZone: 'raw',
      search: '',
      viewMode: 'grid',
      assets: [],
      total: 0,
      page: 1,
      pageSize: 60,
      loading: false,
      selected: null,
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/zones')) {
        return new Response(JSON.stringify(['raw', 'staging']), { status: 200 })
      }
      if (url.includes('/library/list')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'a1', alias: 'grass.png', zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 1234, widthPx: 16, heightPx: 16, anchorX: null, anchorY: null },
            ],
            total: 1,
            page: 1,
            pageSize: 60,
          }),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByText } = render(<AssetStoreSurface client={fakeClient()} />)
    // Faithful legacy chrome: gradient wordmark, compact zone dropdown (raw→"Ra"),
    // icon-only view dropdown, and fullscreen — no titlebar search field or
    // plain Grid/List text buttons.
    expect(getByText('Asset Store')).toBeTruthy()
    expect(container.querySelector('.assetstore-zone-trigger')).not.toBeNull()
    expect(container.querySelector('.assetstore-view-trigger')).not.toBeNull()
    expect(container.querySelector('button[title="Settings"]')).toBeNull()
    expect(container.querySelector('.assetstore-ctrl-btn[title="Fullscreen"]')).not.toBeNull()

    await waitFor(() => {
      expect(container.querySelector('.asset-card')).not.toBeNull()
    })
    const img = container.querySelector('.asset-card-thumb img') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toContain('/api/v1/library/serve/')
  })

  it('highlights the asset bound to the selected editable layer', () => {
    localStorage.setItem('wb-scene-generator.preview.selectedLayers', JSON.stringify({
      layers: [{
        kind: 'baked',
        layerKey: 'baked:/Floor',
        nodePath: '/Floor',
        nodeName: 'Floor',
        value: 1,
        assetName: '草地',
        attributes: { asset_name: '草地' },
        voxelStats: { cellCount: 1, xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0, tokenCount: 0 },
      }],
      editContext: { editMode: false, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: false },
    }))
    useAssetStoreStore.setState({
      zones: [],
      activeZone: 'raw',
      search: '',
      viewMode: 'grid',
      assets: [
        { id: 'a1', alias: '[]_[]__[]_[]_[草地]_[]_[风格]_[正常]_[抠图]_[16]__[静态]_[]_[0].png', zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 10, anchorX: null, anchorY: null },
      ],
      total: 1,
      page: 1,
      pageSize: 60,
      loading: false,
      selected: null,
    })

    const { container } = render(<AssetStoreSurface client={fakeClient()} />)
    expect(container.querySelector('.asset-card')?.classList.contains('is-layer-asset')).toBe(true)
  })

  it('renders rule metadata cards in the Rules zone and publishes the selection to the cross-pane bus', async () => {
    localStorage.removeItem('wb-scene-generator.assetstore.selectedRule')
    useAssetStoreStore.setState({
      zones: [], activeZone: RULES_ZONE, search: '', viewMode: 'grid',
      assets: [], total: 0, page: 1, pageSize: 60, loading: false, selected: null,
      rules: [], selectedRule: null,
    })
    const rule = {
      alias: 'common_16', name: 'common_16', description: 'desc', schemaVersion: 2, ppu: 16, spriteCount: 20,
      faces: { top: { basePieces: 16, mapEntries: 47, variants: 0, hasRandom: false } }, regions: [],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/zones')) return new Response(JSON.stringify(['raw']), { status: 200 })
      if (url.includes('/library/rules')) return new Response(JSON.stringify([rule]), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<AssetStoreSurface client={fakeClient()} />)
    await waitFor(() => expect(container.querySelector('.asset-rule-card')).not.toBeNull())
    const card = container.querySelector('.asset-rule-card') as HTMLElement
    expect(card.textContent).toContain('common_16')
    // No image thumbnail on a rule card — it's metadata only.
    expect(card.querySelector('img')).toBeNull()

    act(() => card.click())
    expect(useAssetStoreStore.getState().selectedRule?.alias).toBe('common_16')
    // Selection is published on the localStorage bus the left pane reads.
    expect(readSelectedRule()?.alias).toBe('common_16')
  })
})
