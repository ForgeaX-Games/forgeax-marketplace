import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameNode, GameScenario } from '../../../runtime/schema/graph-schema'
import type { MediaAsset } from '../../assets/registry-types'
import { NodeAgentVideoActions } from '../NodeAgentVideoActions'

const media = vi.hoisted(() => ({
  getGameStyleAxes: vi.fn(async () => ({})),
  importCharacterRefs: vi.fn(),
  importSceneRefs: vi.fn(),
  listRegistryAssets: vi.fn(),
  requestGenerateKeyframe: vi.fn(),
  requestGenerateVideo: vi.fn(),
  setGameStyleAxes: vi.fn(),
}))

vi.mock('../media', () => media)

const hostClient = vi.hoisted(() => ({
  context: {
    gameId: 'game-nodia-fighting',
    endpoints: { gamePackage: 'https://host.test/__workbench__/v1/games/game-nodia-fighting/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}))

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => hostClient,
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

const NODE: GameNode = {
  id: 'fight',
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: {
    name: '首领战',
    durationMs: 8_000,
    media: { kind: 'VIDEO', prompt: '巨兽冲锋' },
  },
}

const SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: { nodes: [NODE], edges: [] },
}

const CHARACTER_REF: MediaAsset = {
  id: 'character-1',
  kind: 'image',
  productionType: 'character_ref',
  status: 'ready',
  createdAt: 1,
  updatedAt: 1,
}

const SCENE_REF: MediaAsset = {
  id: 'scene-1',
  kind: 'image',
  productionType: 'scene_ref',
  status: 'ready',
  createdAt: 1,
  updatedAt: 1,
}

describe('NodeAgentVideoActions', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('复用生成能力，并把生成成片自动绑定到当前节点', async () => {
    const generated: MediaAsset = {
      id: 'a-video-ready',
      label: '首领战成片',
      kind: 'video',
      productionType: 'video_clip',
      status: 'ready',
      durationMs: 7_600,
      createdAt: 2,
      updatedAt: 2,
    }
    media.listRegistryAssets.mockResolvedValue([CHARACTER_REF, SCENE_REF])
    media.requestGenerateVideo.mockResolvedValue({ asset: generated })
    media.setGameStyleAxes.mockResolvedValue({})

    let editedScenario: GameScenario | undefined
    const onEditScenario = vi.fn((edit: (scenario: GameScenario, node: GameNode) => GameScenario) => {
      editedScenario = edit(SCENARIO, NODE)
    })
    render(
      <NodeAgentVideoActions
        game="game-nodia-fighting"
        blueprintId="bp-main"
        blueprintTitle="主线"
        graphPath={[]}
        graph={SCENARIO.graph}
        scenario={SCENARIO}
        node={NODE}
        videoGenerationEnabled
        onEditScenario={onEditScenario}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '🎬 生成视频' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '导入角色图 (1)' })).toBeTruthy())
    fireEvent.click(screen.getByText('▶ 生成视频', { selector: 'button' }))

    await waitFor(() => expect(onEditScenario).toHaveBeenCalledOnce())
    expect(media.requestGenerateVideo).toHaveBeenCalledWith('game-nodia-fighting', expect.objectContaining({
      sceneNodeId: 'fight',
      storyText: '巨兽冲锋',
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    }))
    expect(editedScenario?.graph.nodes[0]?.data.media).toMatchObject({
      kind: 'VIDEO',
      ref: 'a-video-ready',
      prompt: '巨兽冲锋',
    })
    expect(editedScenario?.graph.nodes[0]?.data.durationMs).toBe(7_600)
    expect(screen.getByText('已生成并绑定：首领战成片')).toBeTruthy()
  })
})
