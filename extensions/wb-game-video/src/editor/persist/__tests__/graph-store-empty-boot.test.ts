import { beforeEach, describe, expect, it, vi } from 'vitest'

const hostClient = vi.hoisted(() => ({
  versions: { supported: vi.fn(() => true) },
  gameComponents: { moduleUrl: vi.fn(() => 'https://host.test/games/%E7%8C%AB/components/index.js') },
}))

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => hostClient,
}))

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return {
    ...actual,
    loadStore: vi.fn(async () => {
      throw new Error('temporary package read failure')
    }),
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
import { loadStore, saveProject } from '../persist-client'
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
  hostClient.versions.supported.mockReturnValue(true)
  hostClient.gameComponents.moduleUrl.mockReturnValue('https://host.test/games/%E7%8C%AB/components/index.js')
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

describe('store boot package failures', () => {
  it('propagates a package load failure without saving an empty replacement', async () => {
    const firstBoot = useGraphScenario.getState().ensureBoot('猫', demo)
    const replayedBoot = useGraphScenario.getState().ensureBoot('猫', demo)

    await expect(
      replayedBoot,
    ).rejects.toThrow('temporary package read failure')
    await expect(
      firstBoot,
    ).rejects.toThrow('temporary package read failure')

    expect(loadStore).toHaveBeenCalledTimes(1)
    expect(saveProject).not.toHaveBeenCalled()
    expect(useGraphScenario.getState().booted).toBe(false)
  })
})
