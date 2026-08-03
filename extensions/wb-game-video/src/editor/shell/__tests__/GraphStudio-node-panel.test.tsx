import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSubProcess } from '../../../runtime/schema/graph-schema'
import type { BlueprintDoc, GameScenario } from '../../../runtime/schema/graph-schema'
import { disconnect } from '../../../graph/edit/graph-edit'
import { GraphSession } from '../../../runtime/engine/session'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useProjectAssets = vi.hoisted(() => vi.fn())

vi.mock('../../assets/kinoVideoCacheStore', () => ({ useKinoVideoResources }))
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))

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

const FOCUS_SCENARIO: GameScenario = {
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
        durationMs: 3_000,
        overlayNodes: [{ id: 'mount-hud', overlay: 'hud' }],
        reactions: [{
          when: { type: 'at', ms: 1_000 },
          do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }],
        }],
      },
    }],
    edges: [],
  },
  ui: {
    overlays: {
      hud: {
        id: 'hud',
        title: 'HUD',
        children: [{ id: 'damage', component: 'DamageFloatText', window: { startMs: 500, endMs: 2_500 }, trigger: { when: 'enter' }, inputs: { value: 20 } }],
      },
    },
  },
}

describe('GraphStudio 节点配置分栏', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
    useKinoVideoResources.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useProjectAssets.mockReturnValue({
      items: [], loading: false, error: null, generation: 0,
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

  it('实体规则数值变化时用最新模板重建试玩 session', async () => {
    useGraphScenario.setState({
      meta: {
        entities: {
          player: { id: 'player', attrs: { hpMax: 100 } },
        },
      },
    })
    const start = vi.spyOn(GraphSession.prototype, 'start')
    render(<GraphStudio scenario={SCENARIO} />)
    const startsBeforeRuleChange = start.mock.calls.length

    act(() => {
      useGraphScenario.setState((state) => ({
        meta: {
          ...state.meta,
          entities: {
            player: { id: 'player', attrs: { hpMax: 200 } },
          },
        },
      }))
    })

    await waitFor(() => expect(start.mock.calls.length).toBeGreaterThan(startsBeforeRuleChange))
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

  it('切换节点时保持节点预览的声音开关', async () => {
    const videoScenario: GameScenario = {
      ...SCENARIO,
      graph: {
        ...SCENARIO.graph,
        nodes: SCENARIO.graph.nodes.map((node) => ({
          ...node,
          data: { ...node.data, media: { kind: 'VIDEO', ref: `${node.id}-video` } },
        })),
      },
    }
    window.localStorage.setItem('wb-game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: videoScenario,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: videoScenario.graph } },
      graph: videoScenario.graph,
      selectedNodeId: 'intro',
    })

    const { container } = render(<GraphStudio scenario={videoScenario} />)
    const firstVideo = await waitFor(() => container.querySelector<HTMLVideoElement>('.nps-frame video')!)
    expect(firstVideo.muted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '取消静音' }))
    await waitFor(() => {
      expect(firstVideo.muted).toBe(false)
      expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('rf__node-second'))
    const secondVideo = await waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>('.nps-frame video')
      expect(video).not.toBe(firstVideo)
      return video!
    })
    expect(secondVideo.muted).toBe(false)
    expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
  })

  it('试玩浮层与已展开的节点视频预览互斥，关闭后恢复预览', async () => {
    window.localStorage.setItem('wb-game-video.nodePanel.previewOpen', '1')
    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByTestId('node-preview-column')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))

    await waitFor(() => {
      expect(screen.getByTitle('隐藏')).toBeTruthy()
      expect(screen.queryByTestId('node-preview-column')).toBeNull()
      expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    })
    expect(window.localStorage.getItem('wb-game-video.nodePanel.previewOpen')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    await waitFor(() => {
      expect(screen.queryByTitle('隐藏')).toBeNull()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    await waitFor(() => expect(screen.getByTitle('隐藏')).toBeTruthy())
    fireEvent.click(screen.getByTitle('隐藏'))
    await waitFor(() => {
      expect(screen.queryByTitle('隐藏')).toBeNull()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    })
    expect(window.localStorage.getItem('wb-game-video.nodePanel.previewOpen')).toBe('1')
  })

  it('关闭节点配置面板时同步关闭从此试玩浮层', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    await waitFor(() => expect(screen.getByTitle('隐藏')).toBeTruthy())

    fireEvent.click(screen.getByTitle('关闭'))
    await waitFor(() => {
      expect(screen.queryByText('节点配置 · Intro')).toBeNull()
      expect(screen.queryByTitle('隐藏')).toBeNull()
    })
  })

  it('按时间轴像素比例在当前指针前添加不重叠的结算', async () => {
    window.localStorage.setItem('wb-game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: FOCUS_SCENARIO,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: FOCUS_SCENARIO.graph } },
      graph: FOCUS_SCENARIO.graph,
      meta: { ui: FOCUS_SCENARIO.ui },
      selectedNodeId: 'intro',
    })
    const { container } = render(<GraphStudio scenario={FOCUS_SCENARIO} />)
    const timeline = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(container.querySelector('.gc-mtimeline-ruler')!, {
      pointerId: 7,
      clientX: 100,
    })
    fireEvent.pointerUp(timeline, { pointerId: 7, clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: '＋ 结算' }))

    await waitFor(() => {
      const reactions = useGraphScenario.getState().graph.nodes[0]?.data.reactions ?? []
      // 3s / 200px，14px 的视觉间距换算为 210ms：1500ms → 1290ms。
      expect(reactions.at(-1)?.when).toEqual({ type: 'at', ms: 1_290 })
    })
    await waitFor(() => {
      expect(container.querySelector('.gc-point-mark.is-lifecycle.is-selected')).toBeTruthy()
      expect(container.querySelector('[data-lifecycle-effect-index][data-selected="true"]')).toBeTruthy()
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
    expect(useGraphScenario.getState().blueprints[MAIN_ID]!.entry).toBe('second')
  })

  it('点击预览工作区的其他区域会清空选中态，当前对象自身与配置块除外', async () => {
    window.localStorage.setItem('wb-game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: FOCUS_SCENARIO,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: FOCUS_SCENARIO.graph } },
      graph: FOCUS_SCENARIO.graph,
      meta: { ui: FOCUS_SCENARIO.ui },
      selectedNodeId: 'intro',
    })
    const { container } = render(<GraphStudio scenario={FOCUS_SCENARIO} />)

    const clip = await waitFor(() => container.querySelector<HTMLElement>('.gc-mclip.is-mount')!)
    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 10, clientY: 10 })
    await waitFor(() => expect(clip).toHaveClass('is-selected'))

    const mountCard = container.querySelector<HTMLElement>('[data-focus-anchor="mount:mount-hud"]')!
    expect(mountCard.style.outline).not.toBe('')
    fireEvent.pointerDown(mountCard)
    expect(clip).toHaveClass('is-selected')

    const play = screen.getByRole('button', { name: '播放' })
    fireEvent.pointerDown(play)
    fireEvent.click(play)
    await waitFor(() => {
      expect(clip).not.toHaveClass('is-selected')
      expect(mountCard.style.outline).toBe('')
    })

    const settlement = screen.getByRole('slider', { name: /结算 · ent-player\.hp add -20/ })
    fireEvent.pointerDown(settlement, { pointerId: 2, clientX: 20, clientY: 20 })
    await waitFor(() => expect(settlement.closest('.gc-point-mark')).toHaveClass('is-selected'))
    fireEvent.pointerDown(container.querySelector('.gc-mtimeline-canvas')!, { pointerId: 3, clientX: 200, clientY: 200 })
    await waitFor(() => expect(settlement.closest('.gc-point-mark')).not.toHaveClass('is-selected'))
  })

  it('下钻子流程后添加节点只写入当前子图', async () => {
    const childEntry = {
      id: 'child-entry', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '子流程入口' },
    }
    const rootGraph = {
      nodes: [{
        id: 'process', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: '回合', subProcess: { entry: childEntry.id, graph: { nodes: [childEntry], edges: [] } } },
      }],
      edges: [],
    }
    const rootScenario: GameScenario = { version: 'wb-game-video.graph.v1', graph: rootGraph }
    useGraphScenario.setState({
      demo: rootScenario,
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'process', graph: rootGraph } },
      activeBlueprintId: MAIN_ID,
      graph: rootGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={rootScenario} />)
    fireEvent.click(screen.getByTitle('双击或点此下钻子流程'))
    await waitFor(() => expect(screen.getByTestId('rf__node-child-entry')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    await waitFor(() => {
      const savedRoot = useGraphScenario.getState().graph
      expect(savedRoot.nodes.map((node) => node.id)).toEqual(['process'])
      expect(getSubProcess(savedRoot.nodes[0]!.data)!.graph.nodes).toHaveLength(2)
    })
  })

  it('下钻子流程后可以从当前子图节点试玩并重开', async () => {
    const childEntry = {
      id: 'child-play', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
      data: { name: '子流程试玩节点', durationMs: 5000 },
    }
    const rootGraph = {
      nodes: [{
        id: 'process-play', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: '试玩回合', subProcess: { entry: childEntry.id, graph: { nodes: [childEntry], edges: [] } } },
      }],
      edges: [],
    }
    const rootScenario: GameScenario = { version: 'wb-game-video.graph.v1', graph: rootGraph }
    useGraphScenario.setState({
      demo: rootScenario,
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'process-play', graph: rootGraph } },
      activeBlueprintId: MAIN_ID,
      graph: rootGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={rootScenario} />)
    fireEvent.click(screen.getByTitle('双击或点此下钻子流程'))
    await waitFor(() => expect(screen.getByTestId('rf__node-child-play')).toBeTruthy())
    fireEvent.click(screen.getByTestId('rf__node-child-play'))
    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))

    await waitFor(() => expect(screen.getByText(/试玩 · playing/)).toHaveTextContent('子流程试玩节点'))
    fireEvent.click(screen.getByTitle('重开 · 回到 child-play'))
    await waitFor(() => expect(screen.getByText(/试玩 · playing/)).toHaveTextContent('子流程试玩节点'))
  })

  it('子蓝图入口作为第一个业务节点展示完整演出配置和入口标识', () => {
    const childGraph = {
      nodes: [{
        id: 'child-entry',
        type: 'perf' as const,
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '子蓝图入口' },
      }],
      edges: [],
    }
    const child: BlueprintDoc = { id: 'bp-child', title: 'Child', entry: 'child-entry', graph: childGraph }
    useGraphScenario.setState({
      blueprints: { [MAIN_ID]: MAIN_DOC, [child.id]: child },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: child.id,
      graph: childGraph,
      selectedNodeId: 'child-entry',
    })

    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    expect(screen.queryByTestId('node-preview-column')).toBeNull()
    expect(screen.getByText('视频', { selector: 'label > span:first-child' })).toBeTruthy()
    expect(screen.getByText('播放', { selector: 'label > span:first-child' })).toBeTruthy()
    expect(screen.getByText('界面', { selector: 'b' })).toBeTruthy()
    expect(screen.getByText('结算', { selector: 'b' })).toBeTruthy()
    expect(screen.queryByText('响应规则', { selector: 'b' })).toBeNull()
    expect(screen.getByLabelText('入口节点')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '🗑 删除节点' }))
    expect(useGraphScenario.getState().blueprints[child.id]!.graph.nodes).toHaveLength(1)
    expect(alert).toHaveBeenCalledWith('入口是当前图唯一的业务节点，不能删除。')
  })

  it('下钻子流程后新增节点和删除边只修改子蓝图', async () => {
    const childGraph = {
      nodes: [
        { id: 'child-entry', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '入口' } },
        { id: 'child-after', type: 'perf' as const, position: { x: 240, y: 0 }, inputs: [], outputs: [], data: { name: '后续' } },
      ],
      edges: [{ id: 'child-edge', source: 'child-entry', target: 'child-after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const child: BlueprintDoc = { id: 'bp-child', title: 'Child', entry: 'child-entry', graph: childGraph }
    const mainGraph = {
      nodes: [{
        id: 'container',
        type: 'perf' as const,
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '子流程', subFlowPack: { id: child.id } },
      }],
      edges: [],
    }
    const main: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'container', graph: mainGraph }
    useGraphScenario.setState({
      blueprints: { [main.id]: main, [child.id]: child },
      mainBlueprintId: main.id,
      activeBlueprintId: main.id,
      graph: mainGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={{ ...SCENARIO, graph: mainGraph }} />)
    fireEvent.doubleClick(screen.getByTestId('rf__node-container'))
    await waitFor(() => expect(useGraphScenario.getState().activeBlueprintId).toBe(child.id))

    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    await waitFor(() => expect(useGraphScenario.getState().blueprints[child.id]!.graph.nodes).toHaveLength(3))
    expect(useGraphScenario.getState().blueprints[main.id]!.graph).toEqual(mainGraph)

    act(() => useGraphScenario.getState().setGraph((graph) => disconnect(graph, 'child-edge')))
    const state = useGraphScenario.getState()
    expect(state.blueprints[child.id]!.graph.edges).toHaveLength(0)
    expect(state.blueprints[child.id]!.graph.nodes).toHaveLength(3)
    expect(state.blueprints[main.id]!.graph).toEqual(mainGraph)
  })
})
