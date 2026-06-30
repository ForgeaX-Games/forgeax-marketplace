// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useNodePreviews } from '../useNodePreviews'
import { useRenderStore } from '../../store'
import type { HttpApiClient } from '../../../api/HttpApiClient'

// Fake ApiClient surface useNodePreviews consumes. A graph of:
//   noise (cellular_noise: grid) → sink (scene_output: voxel_layers + name_list)
// exercises BOTH buckets: the intermediate grid preview AND the voxel sink.
// Port TYPES come from listOps; output VALUES from getNodeOutput (wire form).
function makeFakeClient(opts?: { sinkPreviewOff?: boolean }) {
  let execCb: ((e: { kind: string }) => void) | null = null
  let graphCb: ((e: { kind: string }) => void) | null = null
  // `wire(value)` = the kernel `DataTree.fromItem(value)` serialization
  // (`[{path:[0], items:[value]}]`), matching the LIVE backend exactly:
  //   * grid       → value is the grid → items:[grid]              (single-wrap)
  //   * voxel/names→ value is the LIST → items:[[ …elements ]]      (double-wrap)
  const wire = (v: unknown) => [{ path: [0], items: [v] }]
  const outputs: Record<string, unknown> = {
    'noise:grid': wire([
      [0, 1],
      [1, 0],
    ]),
    'sink:layers': wire([{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }]),
    'sink:names': wire([{ id: 1, name: 'wall', type: 'tile' }]),
  }
  // Mutable node set so tests can simulate a deletion/disconnect then fire a
  // graph mutation; listNodes() is the post-mutation source of truth.
  let nodes: Array<Record<string, unknown>> = [
    { id: 'noise', opId: 'cellular_noise', position: { x: 0, y: 0 }, params: {} },
    {
      id: 'sink',
      opId: 'scene_output',
      position: { x: 0, y: 0 },
      params: {},
      previewEnabled: opts?.sinkPreviewOff ? false : undefined,
    },
  ]
  const client = {
    subscribe(channel: string, cb: (e: { kind: string }) => void) {
      if (channel === 'execution') execCb = cb
      else if (channel === 'graph') graphCb = cb
      return () => {
        if (channel === 'execution') execCb = null
        else if (channel === 'graph') graphCb = null
      }
    },
    async listOps() {
      return [
        { id: 'cellular_noise', outputs: [{ name: 'grid', type: 'grid' }] },
        {
          id: 'scene_output',
          outputs: [
            { name: 'layers', type: 'voxel_layers' },
            { name: 'names', type: 'name_list' },
          ],
        },
      ]
    },
    async listNodes() {
      return nodes
    },
    async getNodeOutput(nodeId: string, port: string) {
      return outputs[`${nodeId}:${port}`]
    },
  }
  return {
    client: client as unknown as HttpApiClient,
    completeExecution: () => execCb?.({ kind: 'exec:completed' }),
    applyGraph: () => graphCb?.({ kind: 'graph:applied' }),
    deleteNodes: (ids: string[]) => {
      nodes = nodes.filter((n) => !ids.includes(n.id as string))
    },
  }
}

beforeEach(() => useRenderStore.getState().reset())

describe('useNodePreviews', () => {
  it('projects an intermediate node grid into previewLayers (no scene_output needed)', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(Object.keys(useRenderStore.getState().previewLayers)).toContain('noise:grid')
    })
    const layer = useRenderStore.getState().previewLayers['noise:grid']
    expect(layer.rows).toBe(2)
    expect(layer.cols).toBe(2)
    expect(layer.outputType).toBe('grid')
  })

  it('projects scene_output into the voxel layers bucket', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => {
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })
    expect(useRenderStore.getState().layers['sink:/A'].assetName).toBe('wall')
  })

  // Regression: the LIVE backend double-wraps voxel_layers/name_list. Before the
  // flattenWireList fix, setLayers received a single array-element and the
  // renderer crashed with `layer.cells is not iterable`. Assert the projected
  // layer is a REAL VoxelLayer with an iterable `cells` array (and the grid's
  // single-wrap still yields a real number[][] — so neither regresses the other).
  it('projects a non-empty (double-wrapped) scene_output into real VoxelLayers with iterable cells', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().layers['sink:/A']).toBeDefined())

    const layer = useRenderStore.getState().layers['sink:/A']
    expect(Array.isArray(layer.cells)).toBe(true)
    expect(layer.cells).toHaveLength(1)
    expect(layer.value).toBe(1)
    // The grid bucket (single-wrap) stays a real dense grid, not over-flattened.
    const grid = useRenderStore.getState().previewLayers['noise:grid']
    expect(grid.rows).toBe(2)
    expect(grid.cols).toBe(2)
  })

  it('refreshes both buckets when an execution completes', async () => {
    const { client, completeExecution } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())

    useRenderStore.getState().reset()
    expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()

    completeExecution()
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
  })

  it('evicts a deleted node\'s grid preview AND voxel layer on graph:applied (no execution needed)', async () => {
    const { client, applyGraph, deleteNodes } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    // Both buckets populated initially.
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })

    // Simulate deleting BOTH nodes in the editor: a pure delete fires no
    // execution, only graph:applied. The GC must still prune the stale layers.
    deleteNodes(['noise', 'sink'])
    applyGraph()

    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
    })
  })

  it('honors previewEnabled=false by clearing that node\'s layers', async () => {
    const { client } = makeFakeClient({ sinkPreviewOff: true })
    renderHook(() => useNodePreviews(client))
    // Grid still previews; the scene_output sink with preview off must not project.
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
    expect(useRenderStore.getState().layers['sink:/A']).toBeUndefined()
  })

  // G4: the editor's preview toggle rides the client-side previewOverrides map
  // (workbench:preview-change), not the backend graph. Flipping a node off drops
  // its layers immediately; clearing the override restores them.
  it('honors a client-side previewOverride and restores layers when cleared', async () => {
    const { client } = makeFakeClient()
    renderHook(() => useNodePreviews(client))
    // Both buckets populated with no override.
    await waitFor(() => {
      expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined()
      expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()
    })

    // Editor turns the grid node's preview OFF → override drops its grid layer.
    useRenderStore.getState().setPreviewOverrides({ noise: false })
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeUndefined())
    // The sink (not overridden) keeps projecting.
    expect(useRenderStore.getState().layers['sink:/A']).toBeDefined()

    // Editor turns it back ON (override cleared) → grid layer comes back.
    useRenderStore.getState().setPreviewOverrides({})
    await waitFor(() => expect(useRenderStore.getState().previewLayers['noise:grid']).toBeDefined())
  })
})
