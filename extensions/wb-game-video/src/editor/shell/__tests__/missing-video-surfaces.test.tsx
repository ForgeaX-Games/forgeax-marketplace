import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphPlaySurface } from '../GraphPlaySurface'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())

vi.mock('../../assets/kinoVideoCacheStore', () => {
  return {
    useKinoVideoResources,
  }
})

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
    expect(screen.getByRole('status')).toHaveTextContent('missing-stable-id')
  })

  it('GraphStudio reports the current stable id without advancing', () => {
    const { container } = render(<GraphStudio scenario={SCENARIO} />)
    const openPlayer = screen.getByRole('button', { name: /试玩/ })
    fireEvent.click(openPlayer)
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    fireEvent.error(video!)
    expect(screen.getByRole('status')).toHaveTextContent('missing-stable-id')
  })

  it('GraphStudio exposes a Kino list failure while retaining bundled options', async () => {
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
      'Kino 视频素材加载失败：invalid_page_size（仅显示内置视频）',
    )
  })
})
