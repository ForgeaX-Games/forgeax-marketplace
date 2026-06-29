// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { useBakedLayers, refreshBakedLayers } from '../useBakedLayers'
import { bakedApi } from '../bakedApi'
import type { BakedLayerDTO } from '../bakedApi'
import { hasLocalBakedLayerEdits, useRenderStore } from '../../store'

vi.mock('../bakedApi', () => ({
  bakedApi: {
    list: vi.fn(),
  },
}))

class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeWebSocket.last = this
  }

  close(): void {
    this.closed = true
  }
}

describe('useBakedLayers', () => {
  beforeEach(() => {
    useRenderStore.getState().reset()
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.mocked(bakedApi.list).mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('refreshes baked layers when the backend broadcasts baked:changed', async () => {
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          cells: [{ x: 2, y: 3, z: 0, token: 'grass' }],
        },
      ])

    renderHook(() => useBakedLayers())
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(1))

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({ event: 'baked:changed', payload: {} }),
    })

    await waitFor(() => {
      expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
        { x: 2, y: 3, z: 0, token: 'grass' },
      ])
    })
  })

  it('defers baked:changed refresh while local paint is dirty', async () => {
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [],
        },
      ])

    renderHook(() => useBakedLayers())
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 1, y: 2, z: 0, token: 'grass' },
    ])

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({ event: 'baked:changed', payload: {} }),
    })

    await Promise.resolve()
    expect(bakedApi.list).toHaveBeenCalledTimes(1)
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 1, y: 2, z: 0, token: 'grass' },
    ])
  })

  it('clears dirty baked layers immediately when the workbench switches project', async () => {
    let resolveProjectList: (layers: BakedLayerDTO[]) => void = () => {}
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 0, y: 0, z: 0, token: 'grass' }],
        },
      ])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveProjectList = resolve
      }))

    renderHook(() => useBakedLayers())
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())
    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 9, y: 9, z: 0, token: 'grass' },
    ])

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workbench:project-changed', projectId: 'project-2' },
      }))
    })

    expect(useRenderStore.getState().bakedLayers).toEqual({})
    expect(useRenderStore.getState().activeBakedLayerKey).toBeNull()
    expect(bakedApi.list).toHaveBeenCalledTimes(2)

    resolveProjectList([])
    await waitFor(() => expect(useRenderStore.getState().bakedLayers).toEqual({}))
  })

  it('reloads project-activated baked layers without preserving same-path dirty cells', async () => {
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 0, y: 0, z: 0, token: 'grass' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'stone',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 2, y: 3, z: 0, token: 'stone' }],
        },
      ])

    renderHook(() => useBakedLayers())
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())
    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 9, y: 9, z: 0, token: 'grass' },
    ])

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'project:activated', projectId: 'project-2' },
      }),
    })

    await waitFor(() => {
      expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
        { x: 2, y: 3, z: 0, token: 'stone' },
      ])
    })
  })

  it('closes the baked websocket subscription on unmount', async () => {
    vi.mocked(bakedApi.list).mockResolvedValue([])

    const { unmount } = renderHook(() => useBakedLayers())
    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull())
    const ws = FakeWebSocket.last!

    unmount()

    expect(ws.closed).toBe(true)
  })

  // Regression: a STRUCTURAL baked mutation (add/move/remove/bake) right after a
  // paint left the just-created layer / new order invisible until a manual
  // reload. Cause: the structural refresh used the DEFAULT refreshBakedLayers(),
  // which defers while a paint edit is still dirty, so the new structure never
  // landed. Structural ops now drain paint persists then force the refresh in
  // (deferIfLocalPending:false). These two cases pin both halves of that fix.
  describe('structural refresh must not be swallowed by an in-flight paint', () => {
    it('a DEFAULT refresh is deferred while paint is dirty — the old "must reload" bug', async () => {
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
      ])
      renderHook(() => useBakedLayers())
      await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

      // A paint is in flight (dirty) — exactly the place-object → auto-sub-layer case.
      useRenderStore.getState().paintBakedCells('baked:/Layer', [{ x: 0, y: 0, z: 0, token: 'grass' }])

      // Backend has since created a NEW sub-layer; a DEFAULT refresh tries to pull it.
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [{ x: 0, y: 0, z: 0, token: 'grass' }] },
        { nodePath: '/Layer/layer-1', nodeName: 'layer-1', value: 2, assetName: 'stone', assetType: 'tile', version: 2, cells: [] },
      ])
      await refreshBakedLayers() // default deferIfLocalPending: true

      // Deferred → the new layer is NOT visible (this is the reported bug).
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1']).toBeUndefined()
    })

    it('a FORCED refresh (what structural ops now use) lands the new structure despite dirty paint', async () => {
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
      ])
      renderHook(() => useBakedLayers())
      await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

      useRenderStore.getState().paintBakedCells('baked:/Layer', [{ x: 0, y: 0, z: 0, token: 'grass' }])
      expect(hasLocalBakedLayerEdits()).toBe(true)

      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [{ x: 0, y: 0, z: 0, token: 'grass' }] },
        { nodePath: '/Layer/layer-1', nodeName: 'layer-1', value: 2, assetName: 'stone', assetType: 'tile', version: 2, cells: [] },
      ])
      // structuralBakedRefresh drains paint persists then forces this in.
      await refreshBakedLayers({ deferIfLocalPending: false })

      // The new sub-layer is now visible immediately — no manual reload needed.
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1']).toBeDefined()
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1'].nodeName).toBe('layer-1')
    })
  })
})
