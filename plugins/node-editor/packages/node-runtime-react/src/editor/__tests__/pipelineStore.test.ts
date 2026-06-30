// Pipeline store tests — focus on the live-sync backbone:
//   (1) agentAddNode drives the store + persists through applyBatch (the same
//       path a human edit takes);
//   (2) a graph:applied event delivered via the subscribe adapter triggers the
//       store to refetch and the canvas nodes to change (non-vacuous: assert
//       store.currentPipeline gains a node it did not have before).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient, type MockApiClient } from '../../test/mockApiClient.js'
import {
  configureEditorTransport,
  createEditorTransport,
  type EditorTransport,
} from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'

function spec(id: string, name: string, outputs: OpSpec['outputs'] = []): OpSpec {
  return { id, name, inputs: [], outputs, params: [], execute: () => null }
}

let client: MockApiClient
let transport: EditorTransport

function resetStores(): void {
  usePipelineStore.setState({
    batteries: [],
    categories: [],
    currentPipeline: null,
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
}

async function flush(): Promise<void> {
  // Let the async loadPipeline triggered by the sync event resolve.
  await Promise.resolve()
  await Promise.resolve()
}

describe('pipelineStore live-sync backbone', () => {
  beforeEach(() => {
    client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    resetStores()
  })

  afterEach(() => {
    transport.dispose()
    configureEditorTransport(null)
  })

  it('loadBatteries populates the catalog from listOps()', async () => {
    await usePipelineStore.getState().loadBatteries()
    expect(usePipelineStore.getState().batteries.map((b) => b.id)).toEqual(['a.one', 'a.two'])
  })

  it('agentAddNode records history, updates the store, and persists via applyBatch', async () => {
    await usePipelineStore.getState().loadBatteries()
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    const applySpy = vi.spyOn(client, 'applyBatch')

    usePipelineStore.getState().agentAddNode({
      id: 'n1',
      batteryId: 'a.one',
      name: 'One',
      position: { x: 0, y: 0 },
      params: {},
    })

    // Data layer: the node is in the working pipeline.
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('n1')
    // History recorded (same path as a human add).
    expect(useHistoryStore.getState().entries).toHaveLength(1)
    expect(useHistoryStore.getState().entries[0].type).toBe('add_node')

    // Persist + execute flow through applyBatch.
    await flush()
    expect(applySpy).toHaveBeenCalled()
    expect(applySpy.mock.calls[0][0]).toEqual([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
  })

  it('LIVE-SYNC: a graph change from another actor refetches and updates the canvas', async () => {
    // Start from an empty, loaded pipeline.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes ?? []).toHaveLength(0)

    // The store subscribes to live-sync (graph:applied → refetch).
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    // Another actor (AI / CLI / another client) mutates the kernel graph
    // directly. The mock emits graph:applied synchronously inside applyBatch.
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-1', opId: 'a.two', position: { x: 5, y: 5 }, params: {} }],
      { actor: 'ai-agent' },
    )

    // The subscribe adapter drove the store to refetch — non-vacuous: the
    // canvas now shows a node it never had locally.
    await flush()
    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).toContain('remote-1')

    unsub()
  })

  it('LIVE-SYNC RECONCILER: a missed graph:applied frame still reaches the canvas via the hash poll', async () => {
    vi.useFakeTimers()
    try {
      await usePipelineStore.getState().loadPipeline()
      expect(usePipelineStore.getState().currentPipeline?.nodes ?? []).toHaveLength(0)

      const unsub = usePipelineStore.getState().subscribeLiveSync()
      // Let the reconciler adopt the current hash as its baseline.
      await vi.advanceTimersByTimeAsync(1600)

      // Simulate a graph mutation whose `graph:applied` WS frame was DROPPED
      // (reconnect after a backend restart / rebind window): the kernel state +
      // hash change, but NO event is emitted to the subscribers.
      client.__state.nodes.set('orphan-1', {
        id: 'orphan-1',
        opId: 'a.one',
        position: { x: 9, y: 9 },
        params: {},
      })
      client.__state.hash = 'mock-drifted-1'

      // Canvas is stale until the reconciler poll detects the hash drift.
      expect(
        (usePipelineStore.getState().currentPipeline?.nodes ?? []).map((n) => n.id),
      ).not.toContain('orphan-1')

      await vi.advanceTimersByTimeAsync(1600)

      // Self-healed: the poll refetched and the canvas now shows the node.
      expect(
        (usePipelineStore.getState().currentPipeline?.nodes ?? []).map((n) => n.id),
      ).toContain('orphan-1')

      unsub()
    } finally {
      vi.useRealTimers()
    }
  })

  it('LIVE-SYNC: unsubscribe stops further refetches', async () => {    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()
    unsub()

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-2', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      { actor: 'ai-agent' },
    )
    await flush()

    const nodes = usePipelineStore.getState().currentPipeline?.nodes ?? []
    expect(nodes.map((n) => n.id)).not.toContain('remote-2')
  })

  it('local param edit does NOT trigger a full loadPipeline reload on its self-echo, but a remote edit does', async () => {
    client.__reset({
      ops: [spec('a.one', 'One', [{ name: 'out', type: 'number' }])],
      nodes: [{ id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: { value: 1 } }],
      edges: [],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()
    const unsub = usePipelineStore.getState().subscribeLiveSync()

    const loadSpy = vi.spyOn(usePipelineStore.getState(), 'loadPipeline')

    // A LOCAL param edit: the store writes the value locally, persists (applyBatch
    // → graph:applied self-echo), and executes. The self-echo must be recognized
    // as our own write and NOT cause a full snapshot reload (the slider→preview
    // lag). The local value is already present in currentPipeline.
    usePipelineStore.getState().updateNodeParam('n1', 'value', 42)
    await flush()
    await flush()
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.params.value).toBe(42)
    expect(loadSpy).not.toHaveBeenCalled()

    // A REMOTE actor's batch must still drive a full reload (no suppression).
    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'remote-x', opId: 'a.one', position: { x: 9, y: 9 }, params: {} }],
      { actor: 'ai-agent' },
    )
    await flush()
    await flush()
    expect(loadSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().currentPipeline?.nodes.map((n) => n.id)).toContain('remote-x')

    loadSpy.mockRestore()
    unsub()
  })

  it('loadPipeline preserves the client-only previewEnabled toggle across a re-pull', async () => {
    client.__reset({
      ops: [spec('a.one', 'One')],
      nodes: [{ id: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
    })
    await usePipelineStore.getState().loadPipeline()
    // previewEnabled is never persisted to the backend → undefined after a pull.
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBeUndefined()

    // User turns the node's preview OFF (client-only state).
    usePipelineStore.setState((s) => ({
      currentPipeline: s.currentPipeline
        ? { ...s.currentPipeline, nodes: s.currentPipeline.nodes.map((n) => ({ ...n, previewEnabled: false })) }
        : s.currentPipeline,
    }))

    // A live-sync / re-exec re-pull must NOT silently re-enable the preview.
    await usePipelineStore.getState().loadPipeline()
    expect(usePipelineStore.getState().currentPipeline?.nodes[0]?.previewEnabled).toBe(false)
  })

  it('keeps the kernel-persisted hidden flag on an exposed port across a load', async () => {
    // The exposed-port presentation overlay (hidden / order / customLabel*) is
    // kernel-persisted and round-trips verbatim through getPipeline()/listGroups.
    // loadPipeline must trust the freshly-pulled value (no client carry-forward).
    client.__reset({ ops: [spec('a.one', 'One')] })
    client.__state.groups.set('g1', {
      id: 'g1',
      name: 'G',
      nodes: [],
      edges: [],
      position: { x: 0, y: 0 },
      exposedInputs: [
        { portName: 'in_0', portType: 'scene', sourceNodeId: 'a', sourcePortName: 'in', hidden: true },
      ],
      exposedOutputs: [],
    })

    await usePipelineStore.getState().loadPipeline()

    const after = usePipelineStore.getState().currentPipeline
    expect(after?.groups?.[0]?.exposedInputs[0]?.hidden).toBe(true)
  })

  it('executePipeline routes through the transport execute()', async () => {
    const execSpy = vi.spyOn(client, 'execute')
    usePipelineStore.getState().setPipeline(createEmptyPipeline())
    await usePipelineStore.getState().executePipeline()
    expect(execSpy).toHaveBeenCalled()
    expect(usePipelineStore.getState().pipelineStatus).toBe('completed')
  })

  it('refreshConnectedOutputs hydrates unconnected visible output ports for tooltips', async () => {
    client.__reset({
      ops: [
        spec('scene.add_child', 'AddChild', [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'childPaths', type: 'string', access: 'list' },
        ]),
        spec('scene.output', 'Scene Output'),
      ],
      nodes: [
        { id: 'add', opId: 'scene.add_child', position: { x: 0, y: 0 }, params: {} },
        { id: 'out', opId: 'scene.output', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: [
        {
          id: 'e-add-scene-out-scene',
          source: { nodeId: 'add', port: 'scene' },
          target: { nodeId: 'out', port: 'scene' },
        },
      ],
    })
    await usePipelineStore.getState().loadBatteries()
    await usePipelineStore.getState().loadPipeline()
    vi.spyOn(client, 'getNodeOutput').mockImplementation(async (_nodeId, portId) => {
      if (portId === 'scene') return [{ path: [0], items: [{ focus: '/Root' }] }]
      if (portId === 'childPaths') {
        return [
          { path: [0, 0], items: ['/Root/A'] },
          { path: [0, 1], items: ['/Root/B'] },
        ]
      }
      return undefined
    })

    await usePipelineStore.getState().refreshConnectedOutputs()

    expect(usePipelineStore.getState().nodeOutputs.add?.childPaths).toEqual([
      { path: [0, 0], items: ['/Root/A'] },
      { path: [0, 1], items: ['/Root/B'] },
    ])
  })

  it('renameGroup syncs both the NodeGroup name and the __group__ shadow node mirror', () => {
    // The save-as-template dialog renames via renameGroup. If only group.name
    // updates and the shadow node keeps its stale mirror (e.g. "Group Node"),
    // the persist diff (name = group.name SSOT) and any drag-out (loadGroup ->
    // getGroup) would surface the stale name. Both must move together.
    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'g1', batteryId: '__group__', name: 'Group Node', position: { x: 0, y: 0 }, params: { groupId: 'g1' } },
        ],
        groups: [
          { id: 'g1', name: 'Group Node', nodes: [], edges: [], position: { x: 0, y: 0 }, exposedInputs: [], exposedOutputs: [] },
        ],
      },
    })

    usePipelineStore.getState().renameGroup('g1', 'ttt')

    const pipeline = usePipelineStore.getState().currentPipeline!
    expect(pipeline.groups?.find((g) => g.id === 'g1')?.name).toBe('ttt')
    expect(pipeline.nodes.find((n) => n.id === 'g1')?.name).toBe('ttt')
  })

  describe('group-view shell exposed-port editing', () => {
    function seedGroupPipeline() {
      usePipelineStore.setState({
        currentPipeline: {
          ...createEmptyPipeline(),
          nodes: [
            { id: 'g1', batteryId: '__group__', name: 'G', position: { x: 0, y: 0 }, params: { groupId: 'g1' } },
            { id: 'up', batteryId: 'a.one', name: 'Up', position: { x: -200, y: 0 }, params: {} },
          ],
          edges: [
            { id: 'ext_in', source: { nodeId: 'up', port: 'out' }, target: { nodeId: 'g1', port: 'in_0' } },
          ],
          groups: [
            {
              id: 'g1', name: 'G', nodes: [
                { id: 'inner', batteryId: 'a.one', name: 'In', position: { x: 0, y: 0 }, params: {} },
              ], edges: [], position: { x: 0, y: 0 },
              exposedInputs: [{ portName: 'in_0', portType: 'string', sourceNodeId: 'inner', sourcePortName: 'in', order: 0 }],
              exposedOutputs: [],
            },
          ],
        },
      })
    }

    it('addGroupExposedPort allocates the next stable id and an unmapped placeholder', () => {
      seedGroupPipeline()
      const res = usePipelineStore.getState().addGroupExposedPort('g1', 'input')
      expect(res.ok).toBe(true)
      expect(res.portName).toBe('in_1')
      const ports = usePipelineStore.getState().currentPipeline!.groups![0].exposedInputs
      const added = ports.find((p) => p.portName === 'in_1')!
      expect(added.sourceNodeId).toBe('')
      expect(added.portType).toBe('any')
    })

    it('bind then unbind round-trips an exposed port mapping', () => {
      seedGroupPipeline()
      usePipelineStore.getState().addGroupExposedPort('g1', 'output')
      usePipelineStore.getState().bindGroupExposedPort('g1', 'output', 'out_0', {
        sourceNodeId: 'inner', sourcePortName: 'out', portType: 'string',
      })
      let port = usePipelineStore.getState().currentPipeline!.groups![0].exposedOutputs[0]
      expect(port).toMatchObject({ sourceNodeId: 'inner', sourcePortName: 'out', portType: 'string' })

      usePipelineStore.getState().unbindGroupExposedPort('g1', 'output', 'out_0')
      port = usePipelineStore.getState().currentPipeline!.groups![0].exposedOutputs[0]
      expect(port).toMatchObject({ sourceNodeId: '', sourcePortName: '', portType: 'any' })
    })

    it('removeGroupExposedPort deletes the port and drops its external edge', () => {
      seedGroupPipeline()
      const res = usePipelineStore.getState().removeGroupExposedPort('g1', 'input', 'in_0')
      expect(res.ok).toBe(true)
      const pipeline = usePipelineStore.getState().currentPipeline!
      expect(pipeline.groups![0].exposedInputs).toEqual([])
      expect(pipeline.edges.find((e) => e.id === 'ext_in')).toBeUndefined()
    })
  })
})
