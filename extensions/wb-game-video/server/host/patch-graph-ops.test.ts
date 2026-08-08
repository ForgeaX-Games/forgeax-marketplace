import { describe, expect, test } from 'vitest'
import blueprint from './fixtures/nodia.blueprint.json'
import { applyPatchGraphOps } from './patch-graph-ops'
import type { GameNode, GraphLibraryDocument } from '../../src/runtime/schema/graph-schema'
import { normalizeDocument } from '../../src/editor/persist/blueprint-project'
import { getSubProcess } from '../../src/runtime/schema/graph-schema'

describe('applyPatchGraphOps', () => {
  test('renames a node on the main pack and keeps root graph in sync', () => {
    const doc = normalizeDocument(blueprint as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    const result = applyPatchGraphOps(doc, {
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '过桥' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toBe(1)
    const renamed = result.document.graph.nodes.find((n) => n.id === nodeId)
    expect(renamed?.data.name ?? (renamed as { name?: string }).name).toBeDefined()
    // set-node-field name writes node.data.name when field==='name' OR top-level name —
    // implement as: field 'name' → patchNodeData({ name: value })
    expect(result.document.graph.nodes.find((n) => n.id === nodeId)!.data.name).toBe('过桥')
    const mainId = result.document.manifest.mainPackId
    expect(result.document.manifest.packs[mainId]!.graph.nodes.find((n) => n.id === nodeId)!.data.name).toBe('过桥')
  })

  test('rolls back entire batch when a later op fails', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    const before = JSON.stringify(doc)
    const result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'set-node-field', nodeId, field: 'name', value: '临时名' },
        { op: 'set-node-field', nodeId: 'missing-node', field: 'name', value: 'x' },
      ],
    })
    expect(result).toMatchObject({ ok: false, failedOpIndex: 1 })
    expect(JSON.stringify(doc)).toBe(before) // input doc not mutated
  })

  test('rejects empty ops', () => {
    const doc = normalizeDocument(blueprint as GraphLibraryDocument)
    expect(applyPatchGraphOps(doc, { ops: [] }).ok).toBe(false)
  })

  test('set-node-data null deletes key', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    let result = applyPatchGraphOps(doc, {
      ops: [{ op: 'set-node-data', nodeId, patch: { storyText: 'x' } }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result = applyPatchGraphOps(result.document, {
      ops: [{ op: 'set-node-data', nodeId, patch: { storyText: null } }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      (result.document.graph.nodes.find((node) => node.id === nodeId)!.data as unknown as Record<string, unknown>)
        .storyText,
    ).toBeUndefined()
  })

  test('add-node, connect, update-edge-data, and disconnect edit topology', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const source = doc.graph.nodes[0]!.id
    const node: GameNode = {
      id: 'patch-added',
      type: 'perf',
      position: { x: 640, y: 80 },
      inputs: [],
      outputs: [],
      data: { name: '新增节点' },
    }
    const result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'add-node', node },
        { op: 'connect', id: 'patch-edge', source, target: node.id },
        { op: 'update-edge-data', edgeId: 'patch-edge', data: { weight: 3 } },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes.some((item) => item.id === node.id)).toBe(true)
    expect(result.document.graph.edges.find((edge) => edge.id === 'patch-edge')?.data?.weight).toBe(3)

    const disconnected = applyPatchGraphOps(result.document, {
      ops: [{ op: 'disconnect', edgeId: 'patch-edge' }],
    })
    expect(disconnected.ok).toBe(true)
    if (!disconnected.ok) return
    expect(disconnected.document.graph.edges.some((edge) => edge.id === 'patch-edge')).toBe(false)
  })

  test('remove-node deletes the node and its connected edges', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const [source, target] = doc.graph.nodes
    const result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'connect', id: 'remove-edge', source: source!.id, target: target!.id },
        { op: 'remove-node', nodeId: target!.id },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes.some((node) => node.id === target!.id)).toBe(false)
    expect(result.document.graph.edges.some((edge) => edge.id === 'remove-edge')).toBe(false)
  })

  test('insert-node-after inserts the supplied node and rewires the default route', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const afterId = doc.graph.nodes[0]!.id
    const node: GameNode = {
      id: 'inserted-node',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '插入节点' },
    }
    const result = applyPatchGraphOps(doc, {
      ops: [{ op: 'insert-node-after', afterId, node }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes.some((item) => item.id === node.id)).toBe(true)
    expect(result.document.graph.edges.some((edge) => edge.source === afterId && edge.target === node.id)).toBe(true)
  })

  test('patch-node-bgm writes and clears node BGM', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    let result = applyPatchGraphOps(doc, {
      ops: [{ op: 'patch-node-bgm', nodeId, patch: { ref: 'battle', mode: 'replace', volume: 0.5 } }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes.find((node) => node.id === nodeId)!.data.bgm).toEqual({
      ref: 'battle',
      mode: 'replace',
      volume: 0.5,
    })
    result = applyPatchGraphOps(result.document, {
      ops: [{ op: 'patch-node-bgm', nodeId, patch: { ref: '', volume: null } }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes.find((node) => node.id === nodeId)!.data.bgm).toBeUndefined()
  })

  test('overlay operations create, patch, mount, reset, and remove a child', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    let result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'ensure-node-overlay', nodeId },
        {
          op: 'add-overlay-child',
          nodeId,
          child: { id: 'caption', component: 'test.dialogue', inputs: { text: 'hello' } },
        },
        { op: 'patch-overlay-child', nodeId, childId: 'caption', patch: { note: 'patched' } },
        { op: 'patch-overlay-child-params', nodeId, childId: 'caption', inputs: { color: 'red' } },
        {
          op: 'patch-overlay-mount',
          nodeId,
          mountId: `node:${nodeId}`,
          patch: { layout: { zIndex: 2 } },
        },
        { op: 'reset-overlay-override', nodeId, childId: 'caption' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const child = result.document.ui!.overlays[`node:${nodeId}`]!.children[0]!
    expect(child).toMatchObject({ id: 'caption', note: 'patched', inputs: { text: 'hello', color: 'red' } })
    expect(result.document.graph.nodes.find((node) => node.id === nodeId)!.data.overlayNodes![0]!.layout).toEqual({
      zIndex: 2,
    })

    result = applyPatchGraphOps(result.document, {
      ops: [{ op: 'remove-overlay-child', nodeId, childId: 'caption' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.ui!.overlays[`node:${nodeId}`]!.children).toEqual([])
  })

  test('reset-overlay-override removes a shared child override', () => {
    let doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    doc = {
      ...doc,
      ui: {
        ...doc.ui,
        overlays: {
          ...doc.ui?.overlays,
          shared: {
            id: 'shared',
            children: [{ id: 'shared-child', component: 'test.dialogue', inputs: { text: 'base' } }],
          },
        },
      },
    }
    let result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'set-node-data', nodeId, patch: { overlayNodes: [{ overlay: 'shared' }] } },
        {
          op: 'patch-overlay-child',
          nodeId,
          childId: 'shared-child',
          patch: { inputs: { text: 'override' } },
        },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.document.graph.nodes.find((node) => node.id === nodeId)!.data.overlayNodes![0]!.overrides,
    ).toHaveProperty('shared-child')

    result = applyPatchGraphOps(result.document, {
      ops: [{ op: 'reset-overlay-override', nodeId, childId: 'shared-child' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.document.graph.nodes.find((node) => node.id === nodeId)!.data.overlayNodes![0]!.overrides,
    ).toBeUndefined()
  })

  test('attach-sub-process creates a private child graph', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    const result = applyPatchGraphOps(doc, {
      ops: [{ op: 'attach-sub-process', nodeId }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const process = getSubProcess(result.document.graph.nodes.find((node) => node.id === nodeId)!.data)
    expect(process?.graph.nodes.some((node) => node.id === process.entry)).toBe(true)
  })

  test.each([
    ['set-node-data', { op: 'set-node-data', nodeId: 'missing-node', patch: { storyText: 'x' } }],
    ['remove-node', { op: 'remove-node', nodeId: 'missing-node' }],
    ['insert-node-after', { op: 'insert-node-after', afterId: 'missing-node' }],
    ['attach-sub-process', { op: 'attach-sub-process', nodeId: 'missing-node' }],
    ['ensure-node-overlay', { op: 'ensure-node-overlay', nodeId: 'missing-node' }],
    [
      'add-overlay-child',
      {
        op: 'add-overlay-child',
        nodeId: 'missing-node',
        child: { id: 'caption', component: 'test.dialogue' },
      },
    ],
    ['remove-overlay-child', { op: 'remove-overlay-child', nodeId: 'missing-node', childId: 'caption' }],
    [
      'patch-overlay-child',
      { op: 'patch-overlay-child', nodeId: 'missing-node', childId: 'caption', patch: {} },
    ],
    [
      'patch-overlay-child-params',
      { op: 'patch-overlay-child-params', nodeId: 'missing-node', childId: 'caption', inputs: {} },
    ],
    [
      'patch-overlay-mount',
      { op: 'patch-overlay-mount', nodeId: 'missing-node', mountId: 'node:missing-node', patch: {} },
    ],
    ['reset-overlay-override', { op: 'reset-overlay-override', nodeId: 'missing-node', childId: 'caption' }],
    ['disconnect', { op: 'disconnect', edgeId: 'missing-edge' }],
    ['update-edge-data', { op: 'update-edge-data', edgeId: 'missing-edge', data: { weight: 2 } }],
  ])('%s fails the batch when the target is missing', (_name, op) => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const before = JSON.stringify(doc)
    const result = applyPatchGraphOps(doc, { ops: [op as Record<string, unknown>] })
    expect(result).toMatchObject({ ok: false, failedOpIndex: 0 })
    expect(JSON.stringify(doc)).toBe(before)
  })

  test.each([
    ['source', { source: 'missing-node', target: undefined }],
    ['target', { source: undefined, target: 'missing-node' }],
  ])('connect fails the batch when %s is missing', (_name, endpoints) => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const [first, second] = doc.graph.nodes
    const result = applyPatchGraphOps(doc, {
      ops: [{
        op: 'connect',
        source: endpoints.source ?? first!.id,
        target: endpoints.target ?? second!.id,
      }],
    })
    expect(result).toMatchObject({ ok: false, failedOpIndex: 0 })
  })

  test('reports the failing index when a missing target appears mid-batch', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const nodeId = doc.graph.nodes[0]!.id
    const result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'set-node-data', nodeId, patch: { storyText: 'kept?' } },
        { op: 'remove-node', nodeId: 'missing-node' },
      ],
    })
    expect(result).toMatchObject({ ok: false, failedOpIndex: 1 })
    if (result.ok) return
    expect(result.errors[0]).toContain('missing-node')
  })

  test('make-empty-sub-flow-pack adds a normalized manifest pack', () => {
    const doc = normalizeDocument(structuredClone(blueprint) as GraphLibraryDocument)
    const result = applyPatchGraphOps(doc, {
      ops: [{ op: 'make-empty-sub-flow-pack', id: 'enemy-turn', title: '敌方回合', version: '2' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.manifest.packs['enemy-turn']).toMatchObject({
      id: 'enemy-turn',
      title: '敌方回合',
      version: '2',
      entry: 'entry',
    })
  })
})
