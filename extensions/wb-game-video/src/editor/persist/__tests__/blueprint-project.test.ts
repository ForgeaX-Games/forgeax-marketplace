import { describe, it, expect } from 'vitest'
import {
  playDocument, documentFromBlueprints, documentFromScenario, emptyBlueprintDoc, emptyLibraryDocument,
  validateDocument, docToPack, MAIN_ID, metaFromDocument,
} from '../blueprint-project'
import type { EditorScenarioDocument } from '../formula-authoring'
import type { BlueprintDoc, GraphLibraryDocument } from '../../../runtime/schema/graph-schema'

const mainGraph = {
  nodes: [{ id: 'n1', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'A' } }],
  edges: [] as [],
}
const subDoc: BlueprintDoc = {
  id: 'pack-x',
  title: 'X',
  version: '2',
  entry: 'e',
  graph: { nodes: [{ id: 'e', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'e' } }], edges: [] },
}
const scn: EditorScenarioDocument = {
  version: 'wb-game-video.graph.v1',
  variables: { v1: { id: 'v1', kind: 'number', initial: 0 } as any },
  graph: mainGraph,
}

function libraryDoc(): GraphLibraryDocument {
  const main: BlueprintDoc = {
    id: MAIN_ID,
    title: '主蓝图',
    entry: 'n1',
    graph: mainGraph,
  }
  return documentFromBlueprints({ [MAIN_ID]: main, 'pack-x': subDoc }, MAIN_ID, metaFromDocument(scn))
}

describe('blueprint-project document shape', () => {
  it('documentFromScenario puts root graph into main blueprint only', () => {
    const p = documentFromScenario(scn)
    expect(p.manifest.mainPackId).toBe(MAIN_ID)
    expect(Object.keys(p.manifest.packs)).toEqual([MAIN_ID])
    expect(p.graph).toEqual(p.manifest.packs[MAIN_ID]!.graph)
    expect(p.variables).toEqual(scn.variables)
  })
  it('documentFromBlueprints keeps sub blueprints in manifest (no packs field)', () => {
    const p = libraryDoc()
    expect(Object.keys(p.manifest.packs).sort()).toEqual([MAIN_ID, 'pack-x'])
    expect(p.manifest.packs['pack-x']!.version).toBe('2')
    expect((p as { packs?: unknown }).packs).toBeUndefined()
  })
  it('playDocument / play keeps root graph + manifest.mainPackId', () => {
    const p = libraryDoc()
    const out = playDocument(p)
    expect(out.graph.nodes).toHaveLength(1)
    expect(out.manifest.packs['pack-x']).toBeTruthy()
    expect(out.manifest.mainPackId).toBe(MAIN_ID)
    expect(out.variables).toEqual(scn.variables)
  })
  it('playDocument falls back to empty graph when main blueprint is missing', () => {
    const project: GraphLibraryDocument = {
      version: 'wb-game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      manifest: {
        version: 'wb-game-video.blueprint-manifest.v1',
        mainPackId: 'does-not-exist',
        packs: {},
      },
    }
    const out = playDocument(project)
    expect(out.graph).toEqual({ nodes: [], edges: [] })
  })
  it('playDocument({ rootBlueprintId }) swaps root graph; keeps full manifest for deps', () => {
    const p = libraryDoc()
    const out = playDocument(p, 'pack-x')
    expect(out.graph.nodes.map((n) => n.id)).toEqual(['e'])
    expect(out.manifest.packs[MAIN_ID]).toBeTruthy()
    expect(out.manifest.packs['pack-x']).toBeTruthy()
    expect(out.manifest.mainPackId).toBe(MAIN_ID)
  })
  it('docToPack heals stale entry pointing at a deleted node', () => {
    const pack = docToPack({
      id: 'bp-sub',
      title: 'Sub',
      entry: 'entry',
      graph: {
        nodes: [
          { id: 'n-a', type: 'perf', position: { x: 40, y: 0 }, inputs: [], outputs: [], data: { name: 'A' } },
          { id: 'n-b', type: 'perf', position: { x: 200, y: 0 }, inputs: [], outputs: [], data: { name: 'B' } },
        ],
        edges: [{ id: 'e', source: 'n-a', target: 'n-b', sourceHandle: 'default', targetHandle: 'in' }],
      },
    })
    expect(pack.entry).toBe('n-a')
  })
  it('emptyBlueprintDoc has a single entry node', () => {
    const d = emptyBlueprintDoc({ title: 'New' })
    expect(d.graph.nodes).toHaveLength(1)
    expect(d.entry).toBe(d.graph.nodes[0]!.id)
  })
  it('emptyLibraryDocument is a main pack with zero nodes', () => {
    const doc = emptyLibraryDocument()
    expect(doc.manifest.mainPackId).toBe(MAIN_ID)
    expect(doc.manifest.packs[MAIN_ID]!.graph.nodes).toEqual([])
    expect(doc.manifest.packs[MAIN_ID]!.graph.edges).toEqual([])
    expect(doc.graph.nodes).toEqual([])
    expect(doc.entities).toEqual({})
    expect(doc.variables).toEqual({})
  })
})

const node = (id: string, data: Record<string, unknown> = {}) =>
  ({ id, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: id, ...data } })
const edge = (id: string, source: string, target: string) =>
  ({ id, source, target, sourceHandle: 'default', targetHandle: 'in' })
const bp = (id: string, nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[] = []) =>
  ({ id, title: id, entry: nodes[0]?.id ?? 'entry', graph: { nodes, edges } })
const validDoc = (): GraphLibraryDocument => {
  const main = bp('bp-main', [node('n1'), node('n2')], [edge('e1', 'n1', 'n2')])
  return {
    version: 'wb-game-video.graph.v1',
    graph: main.graph,
    manifest: {
      version: 'wb-game-video.blueprint-manifest.v1',
      mainPackId: 'bp-main',
      packs: { 'bp-main': main },
    },
  }
}

describe('validateDocument', () => {
  it('valid document → []', () => {
    expect(validateDocument(validDoc())).toEqual([])
  })
  it('duplicate node id within a blueprint graph → error', () => {
    const p = validDoc()
    p.manifest.packs['bp-main'] = bp('bp-main', [node('n1'), node('n1')])
    expect(validateDocument(p).length).toBeGreaterThan(0)
  })
  it('dangling edge → error', () => {
    const p = validDoc()
    p.manifest.packs['bp-main'] = bp('bp-main', [node('n1')], [edge('e1', 'n1', 'does-not-exist')])
    expect(validateDocument(p).length).toBeGreaterThan(0)
  })
  it('validates nested subProcess entry and edge boundaries', () => {
    const p = validDoc()
    const child = bp('child', [node('inner')], [edge('cross', 'inner', 'n2')]).graph
    p.manifest.packs['bp-main'] = bp('bp-main', [
      node('n1', { subProcess: { entry: 'missing', graph: child } }),
      node('n2'),
    ])
    const errors = validateDocument(p)
    expect(errors.some((error) => error.includes("entry 'missing'"))).toBe(true)
    expect(errors.some((error) => error.includes("target 指向本层不存在的节点 'n2'"))).toBe(true)
  })
  it('rejects duplicate ids across nested scopes in one blueprint', () => {
    const p = validDoc()
    const child = bp('child', [node('n2')]).graph
    p.manifest.packs['bp-main'] = bp('bp-main', [node('n1', { subProcess: { entry: 'n2', graph: child } }), node('n2')])
    expect(validateDocument(p).some((error) => error.includes("节点 id 重复：'n2'"))).toBe(true)
  })
  it('rejects a node containing both subProcess and subFlowPack', () => {
    const p = validDoc()
    const child = bp('child', [node('inner')]).graph
    p.manifest.packs['bp-main'] = bp('bp-main', [node('n1', {
      subProcess: { entry: 'inner', graph: child },
      subFlowPack: { id: 'reusable' },
    })])
    expect(validateDocument(p).some((error) => error.includes('subProcess 与 subFlowPack 不能同时存在'))).toBe(true)
  })
  it('manifest.mainPackId missing → error', () => {
    const p = validDoc()
    p.manifest = { ...p.manifest, mainPackId: 'missing' }
    expect(validateDocument(p).length).toBeGreaterThan(0)
  })
  it('cross-blueprint reference cycle → error', () => {
    const p = validDoc()
    p.manifest.packs['bp-main'] = bp('bp-main', [node('n1', { subFlowPack: { id: 'sub' } })])
    p.manifest.packs.sub = bp('sub', [node('n2', { subFlowPack: { id: 'bp-main' } })])
    expect(validateDocument(p).length).toBeGreaterThan(0)
  })
})
