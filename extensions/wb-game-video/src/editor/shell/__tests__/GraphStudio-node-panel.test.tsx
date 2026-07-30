import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useAudioAssets = vi.hoisted(() => vi.fn())

vi.mock('../../assets/kinoVideoCacheStore', () => ({ useKinoVideoResources }))
vi.mock('../../assets/audioAssetCacheStore', () => ({ useAudioAssets }))

const SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: {
    nodes: [
      {
        id: 'intro',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: 'Intro' },
      },
      {
        id: 'second',
        type: 'perf',
        position: { x: 240, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: 'Second' },
      },
    ],
    edges: [],
  },
}

const MAIN_ID = 'bp-main'
const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'intro', graph: SCENARIO.graph }

describe('GraphStudio 节点配置分栏', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    vi.stubGlobal('confirm', vi.fn(() => true))
    useKinoVideoResources.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useAudioAssets.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      demo: SCENARIO,
      blueprints: { [MAIN_ID]: MAIN_DOC },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: MAIN_ID,
      graph: SCENARIO.graph,
      meta: {},
      selectedNodeId: 'intro',
      booted: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('记忆已有节点的展开状态，但新增节点时强制收起', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    expect(screen.queryByTestId('node-preview-column')).toBeNull()
    expect(screen.getByTestId('node-inspector-column')).toHaveStyle({ minWidth: '280px' })

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    expect(screen.getByTestId('node-panel-columns')).toHaveStyle({
      gridTemplateColumns: 'minmax(340px, 3fr) 5px minmax(280px, 2fr)',
    })
    expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    expect(window.localStorage.getItem('wb-game-video.nodePanel.previewOpen')).toBe('1')

    act(() => { useGraphScenario.getState().setSelectedNode('second') })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
      expect(screen.queryByTestId('node-preview-column')).toBeNull()
      expect(window.localStorage.getItem('wb-game-video.nodePanel.previewOpen')).toBe('0')
    })
  })

  it('配置面板打开时屏蔽 Delete，关闭面板后恢复删除', async () => {
    useGraphScenario.setState({ selectedNodeId: null })
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByTestId('rf__node-intro'))
    expect(screen.getByText('节点配置 · Intro')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    expect(useGraphScenario.getState().graph.nodes.some((node) => node.id === 'intro')).toBe(true)
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('关闭'))
    await waitFor(() => { expect(screen.queryByText('节点配置 · Intro')).toBeNull() })

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    await waitFor(() => {
      expect(useGraphScenario.getState().graph.nodes.some((node) => node.id === 'intro')).toBe(false)
    })
  })
})
