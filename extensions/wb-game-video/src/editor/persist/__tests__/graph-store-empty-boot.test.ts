import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return {
    ...actual,
    loadStore: vi.fn(async () => ({ project: null, draft: null, versions: [] })),
    saveProject: vi.fn(async () => ({ ok: true })),
    currentVersion: vi.fn(async () => ({ tag: null, commitHash: null, dirty: false })),
    listVersions: vi.fn(async () => []),
  }
})

vi.mock('../../../runtime/component-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../runtime/component-host')>()
  return {
    ...actual,
    loadGameComponents: vi.fn(async () => {}),
  }
})

import { useGraphScenario } from '../graphScenarioStore'
import { saveProject } from '../persist-client'
import type { GraphLibraryDocument } from '../../../runtime/schema/graph-schema'

const demoNode = {
  id: 'demo-node',
  type: 'perf' as const,
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: 'Demo node' },
}
const demoMain = {
  id: 'demo-main',
  title: 'Demo main',
  entry: demoNode.id,
  graph: { nodes: [demoNode], edges: [] },
}
const demo = {
  version: 'wb-game-video.graph.v1',
  graph: demoMain.graph,
  entities: {
    'demo-entity': { id: 'demo-entity', attrs: { hp: 100 } },
  },
  variables: {
    'demo-variable': { id: 'demo-variable', kind: 'number', initial: 1 },
  },
  manifest: {
    version: 'wb-game-video.blueprint-manifest.v1',
    mainPackId: demoMain.id,
    packs: { [demoMain.id]: demoMain },
  },
} as unknown as GraphLibraryDocument

beforeEach(() => {
  vi.clearAllMocks()
  useGraphScenario.setState({
    game: '',
    demo: null,
    blueprints: { stale: demoMain },
    mainBlueprintId: 'stale',
    activeBlueprintId: 'stale',
    graph: demoMain.graph,
    meta: {
      entities: demo.entities,
      variables: demo.variables,
    },
    booted: false,
    isDraft: true,
    loadEpoch: 0,
  } as never)
})

describe('store boot without persisted content', () => {
  it('starts an empty library instead of seeding the demo', async () => {
    useGraphScenario.getState().ensureBoot('brand-new-game', demo)

    await vi.waitFor(() => {
      expect(useGraphScenario.getState().loadEpoch).toBe(1)
    })

    const state = useGraphScenario.getState()
    expect(state.graph.nodes).toEqual([])
    expect(state.blueprints[state.mainBlueprintId]?.graph.nodes).toEqual([])
    expect(state.meta.entities).toEqual({})
    expect(state.meta.variables).toEqual({})
    expect(state.mainBlueprintId).not.toBe('demo-main')
    expect(saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: { nodes: [], edges: [] },
        entities: {},
        variables: {},
      }),
      'brand-new-game',
    )
  })
})
