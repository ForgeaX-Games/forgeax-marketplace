import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphPlaySurface } from '../GraphPlaySurface'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useProjectAssets = vi.hoisted(() => vi.fn())
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

vi.mock('../../assets/kinoVideoCacheStore', () => {
  return {
    useKinoVideoResources,
  }
})

// 音频资产查询与本件无关（它的失败面由 missing-audio-surfaces.test.tsx 钉）；不 mock 的话它的
// 异步 hydration 会在本文件里落成一串 act(...) 警告，失败时还会多出一条 alert。
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))

const SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: {
    nodes: [{
      id: 'intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: 'Intro',
        media: { kind: 'video', ref: 'missing-stable-id' },
      },
    }],
    edges: [],
  },
}

const MAIN_ID = 'bp-main'
const MAIN_DOC: BlueprintDoc = {
  id: MAIN_ID,
  title: 'Main',
  entry: 'intro',
  graph: SCENARIO.graph,
}
const PACK_ID = 'bp-pack'
const PACK_DOC: BlueprintDoc = {
  id: PACK_ID,
  title: 'Pack',
  entry: 'pack-intro',
  graph: {
    nodes: [{
      id: 'pack-intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: 'Pack intro', media: { kind: 'video', ref: 'missing-stable-id' } },
    }],
    edges: [],
  },
}

function seedGraphStore(): void {
  useGraphScenario.setState({
    game: 'game-nodia-fighting',
    demo: SCENARIO,
    blueprints: { [MAIN_ID]: MAIN_DOC },
    mainBlueprintId: MAIN_ID,
    activeBlueprintId: MAIN_ID,
    graph: SCENARIO.graph,
    meta: {},
    booted: true,
  })
}

describe('missing video notices across play surfaces', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    useKinoVideoResources.mockReset()
    useKinoVideoResources.mockReturnValue({
      items: [],
      total: 0,
      loading: false,
      error: null,
      generation: 0,
      refresh: vi.fn(),
    })
    useProjectAssets.mockReset()
    useProjectAssets.mockReturnValue({
      items: [], loading: false, error: null, generation: 0,
    })
    seedGraphStore()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('GraphPlaySurface reports the current stable id without advancing', () => {
    const { container } = render(<GraphPlaySurface scenario={SCENARIO} />)
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    fireEvent.error(video!)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.error(video!)
    expect(screen.getByRole('status')).toHaveTextContent('missing-stable-id')
  })

  it('GraphPlaySurface exposes pause and playback-rate controls', () => {
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
    const { container } = render(<GraphPlaySurface scenario={SCENARIO} />)
    const video = container.querySelector('video') as HTMLVideoElement

    fireEvent.change(screen.getByRole('combobox', { name: '试玩倍速' }), { target: { value: '2' } })
    expect(video.playbackRate).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: '暂停试玩' }))
    expect(pause).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '继续试玩' })).toBeInTheDocument()
  })

  it('GraphStudio reports the current stable id without advancing', async () => {
    useGraphScenario.setState({ selectedNodeId: 'intro' })
    const { container } = render(<GraphStudio scenario={SCENARIO} />)
    const openPlayer = screen.getByRole('button', { name: '▶ 从此试玩' })
    fireEvent.click(openPlayer)
    let video: HTMLVideoElement | null = null
    await waitFor(() => {
      const playVideos = container.querySelectorAll<HTMLVideoElement>('video[data-video-slot]')
      expect(playVideos).toHaveLength(2)
      video = playVideos.item(playVideos.length - 1)
      expect(video).toBeTruthy()
    })
    expect(video).toBeTruthy()
    fireEvent.error(video!)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.error(video!)
    expect(await screen.findByRole('status')).toHaveTextContent('missing-stable-id')
  })

  it('GraphStudio exposes a Kino list failure without falling back to bundled options', async () => {
    useKinoVideoResources.mockReturnValue({
      items: [],
      total: 0,
      loading: false,
      error: 'invalid_page_size',
      generation: 1,
      refresh: vi.fn(),
    })

    render(<GraphStudio scenario={SCENARIO} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kino 视频素材加载失败：invalid_page_size',
    )
  })

  it('GraphStudio video selector contains only Kino resources without prefixes', () => {
    useKinoVideoResources.mockReturnValue({
      items: [{
        resource_id: 'kino-clip',
        game_id: 'game-nodia-fighting',
        media_type: 'video',
        name: 'clip.mp4',
        type: 'UPLOAD',
        url: '/api/v1/kino/resources/kino-clip/content',
        source: 'upload',
        source_meta: {},
        created_at: 1,
        updated_at: 1,
      }],
      total: 1,
      loading: false,
      error: null,
      generation: 1,
      refresh: vi.fn(),
    })
    useGraphScenario.setState({ selectedNodeId: 'intro' })

    const { container } = render(<GraphStudio scenario={SCENARIO} />)
    const selector = container.querySelector<HTMLSelectElement>(
      'select[title*="与视频素材库一致"]',
    )

    expect(selector).toBeTruthy()
    expect([...selector!.options].map((option) => [option.value, option.text]))
      .toEqual([
        ['__unavailable__', '（当前视频不在素材库）'],
        ['', '（无演出）'],
        ['kino-clip', 'clip.mp4'],
      ])
    expect(selector!.textContent).not.toContain('missing-stable-id')
    expect(selector!.textContent).not.toContain('上传 ·')
  })

  it('returns to follow mode when the active breadcrumb is clicked', () => {
    const entryNode = {
      ...SCENARIO.graph.nodes[0]!,
      data: { name: 'Enter pack', subFlowPack: { id: PACK_ID } },
    }
    const mainDoc: BlueprintDoc = {
      ...MAIN_DOC,
      graph: { nodes: [entryNode], edges: [] },
    }
    useGraphScenario.setState({
      blueprints: { [MAIN_ID]: mainDoc, [PACK_ID]: PACK_DOC },
      graph: mainDoc.graph,
    })

    render(<GraphPlaySurface scenario={{ ...SCENARIO, graph: mainDoc.graph }} />)
    fireEvent.click(screen.getByRole('button', { name: '蓝图' }))
    fireEvent.click(screen.getByRole('button', { name: 'Main' }))
    expect(screen.getByText('蓝图状态机 · 回看')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Pack' }))
    expect(screen.getByText('蓝图状态机 · 跟随执行')).toBeTruthy()
  })

  it('isolates same-graph subflow members while following and drilling', () => {
    const subflowGraph: GameScenario['graph'] = {
      nodes: [
        {
          id: 'turn', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [],
          data: {
            name: '我方回合',
            subProcess: {
              entry: 'skill',
              graph: {
                nodes: [{
                  id: 'skill', type: 'perf', position: { x: 0, y: 120 }, inputs: [], outputs: [],
                  data: { name: '选择技能', media: { kind: 'video', ref: 'missing-stable-id' } },
                }],
                edges: [],
              },
            },
          },
        },
        {
          id: 'end', type: 'perf', position: { x: 200, y: 0 }, inputs: [], outputs: [],
          data: { name: '战斗结束' },
        },
      ],
      edges: [{ id: 'turn-end', source: 'turn', target: 'end', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const mainDoc: BlueprintDoc = { ...MAIN_DOC, entry: 'turn', graph: subflowGraph }
    useGraphScenario.setState({
      blueprints: { [MAIN_ID]: mainDoc },
      graph: subflowGraph,
    })

    const { container } = render(<GraphPlaySurface scenario={{ ...SCENARIO, graph: subflowGraph }} />)
    fireEvent.click(screen.getByRole('button', { name: '蓝图' }))

    const canvasNodeLabels = () => [...container.querySelectorAll('.gv-bp-node')]
      .map((node) => node.textContent ?? '')

    expect(canvasNodeLabels().some((label) => label.includes('选择技能'))).toBe(true)
    expect(canvasNodeLabels().some((label) => label.includes('我方回合'))).toBe(false)
    expect(screen.getByRole('button', { name: '总览' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '总览' }))
    expect(canvasNodeLabels().some((label) => label.includes('我方回合'))).toBe(true)
    expect(canvasNodeLabels().some((label) => label.includes('选择技能'))).toBe(false)
    expect(screen.getByText('蓝图状态机 · 回看')).toBeTruthy()

    const drillButton = container.querySelector<HTMLButtonElement>('.gv-bp-node button[title*="进入子流程"]')
    expect(drillButton).toBeTruthy()
    fireEvent.click(drillButton!)
    expect(canvasNodeLabels().some((label) => label.includes('选择技能'))).toBe(true)
    expect(canvasNodeLabels().some((label) => label.includes('我方回合'))).toBe(false)
  })
})
