import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '../../../runtime/schema/graph-schema'
import { findUiTreeNode } from '../../persist/ui-tree'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useDocumentNav } from '../../persist/documentNavStore'
import { useRuleSelection } from '../../persist/ruleSelectionStore'
import { useUiSelection } from '../../persist/uiSelectionStore'
import { NewSidebar } from '../NewSidebar'

vi.mock('../../assets/useVideoAssets', () => ({
  useVideoAssets: () => ({ items: [] }),
}))

vi.mock('../../assets/use-asset-browser', () => ({
  useAssetBrowser: () => ({
    entries: [],
    directory: {
      assetLibrary: { version: 1, folders: [], placements: {} },
      loading: false,
      saving: false,
      error: null,
      refresh: vi.fn(),
      save: vi.fn(),
    },
  }),
}))

const initialScenario = useGraphScenario.getState()
const emptyGraph: GameGraph = { nodes: [], edges: [] }
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'entry', graph: emptyGraph }

beforeEach(() => {
  useGraphView.setState({ view: 'ui' })
  useDocumentNav.setState({ documentType: 'intake' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
  useUiSelection.getState().clearUiSelection()
  useGraphScenario.setState({
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph: emptyGraph,
    meta: {
      ui: {
        overlays: {
          hud: { id: 'hud', title: '战斗 HUD', children: [] },
        },
      },
      uiTree: {
        root: [{
          kind: 'folder',
          id: 'folder',
          name: '战斗',
          children: [{
            kind: 'folder',
            id: 'nested',
            name: '首领',
            children: [{ kind: 'scheme', id: 'hud-node', overlayId: 'hud' }],
          }],
        }],
      },
    },
  })
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  useUiSelection.getState().clearUiSelection()
})

function expandUiTree(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))
}

describe('NewSidebar interface tree', () => {
  it('keeps the Figma 196px rail and exposes the asset-library hierarchy', () => {
    render(<NewSidebar />)

    const sidebar = screen.getByRole('complementary', { name: /视频游戏工坊/ })
    expect(sidebar).toBeTruthy()
    expect(document.querySelector('style[data-reel-style="new-sidebar"]')?.textContent).toContain('width: 196px')
    expect(sidebar.querySelector('.ns-label[title="蓝图"]')?.textContent).toContain('蓝图')
    expect(sidebar.querySelector('.ns-label[title="试玩"]')?.textContent).toContain('试玩')
    expect(sidebar.querySelector('.ns-label[title="视频"]')?.textContent).toContain('视频')
    expect(sidebar.querySelector('.ns-label[title="界面"]')?.textContent).toContain('界面')
    expect(sidebar.querySelector('.ns-label[title="文档"]')?.textContent).toContain('文档')
    expect(sidebar.querySelector('.ns-label[title="控件"]')?.textContent).toContain('控件')
    // Top-level order: 文档 → 蓝图 → 试玩 → 界面 → …
    const topLabels = [...sidebar.querySelectorAll('[role="tree"] > [role="treeitem"] .ns-label')]
      .map((el) => el.getAttribute('title'))
    expect(topLabels.indexOf('蓝图')).toBeLessThan(topLabels.indexOf('试玩'))
    expect(topLabels.indexOf('试玩')).toBeLessThan(topLabels.indexOf('界面'))
  })

  it('reserves the disclosure icon column for top-level leaves', () => {
    render(<NewSidebar />)

    const playLabel = document.querySelector('.ns-label[title="试玩"]')
    const playRow = playLabel?.closest('[role="treeitem"]')
    expect(playRow?.querySelector('.ns-chev-spacer')).toBeTruthy()
  })

  it('opens the fixed document category even when the project has no documents', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))
    expect(screen.getByText('需求')).toBeTruthy()
    expect(screen.getByText('核心')).toBeTruthy()
    expect(screen.getByText('问询')).toBeTruthy()
    expect(screen.getByText('支柱')).toBeTruthy()
    fireEvent.click(screen.getByText('核心'))

    expect(useGraphView.getState().view).toBe('documents')
    expect(useDocumentNav.getState().documentType).toBe('core')
  })

  it('setPendingDocumentTypes marks sidebar leaf', async () => {
    const { setPendingDocumentTypes, resetPendingDocumentTypes } = await import(
      '../../persist/pendingDocumentsStore'
    )
    act(() => resetPendingDocumentTypes())
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '展开 文档' }))

    expect(
      screen.getByText('核心').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBeNull()

    act(() => setPendingDocumentTypes(['core']))
    expect(
      screen.getByText('核心').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBe('true')

    act(() => setPendingDocumentTypes([]))
    expect(
      screen.getByText('核心').closest('[role="treeitem"]')?.getAttribute('data-pending'),
    ).toBeNull()
    act(() => resetPendingDocumentTypes())
  })

  it('renders the real recursive tree and publishes scheme selection', () => {
    render(<NewSidebar />)
    expect(screen.queryByText('自定义界面')).toBeNull()
    expandUiTree()
    expect(screen.getByText('战斗')).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    expect(screen.getByText('首领')).toBeTruthy()
    expect(screen.queryByText('战斗 HUD')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))

    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 战斗 HUD' }))
    expect(useUiSelection.getState()).toMatchObject({
      selectedTreeNodeId: 'hud-node',
      selectedOverlayId: 'hud',
    })
    // 选中具体方案后，主树「界面」父行不应高亮（activeId 指向方案节点 id，不在 navTree 里）——
    // 与蓝图选中具体蓝图时「蓝图」父行不高亮一致。
    const uiRow = screen.getByRole('button', { name: '折叠 界面' }).closest('.ns-row')
    expect(uiRow).not.toHaveClass('is-active')
  })

  it('clears interface selection when a non-ui leaf (blueprint) is selected', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))
    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 战斗 HUD' }))
    expect(useUiSelection.getState().selectedTreeNodeId).toBe('hud-node')

    // 切去点「试玩」叶子（非 ui 视图）：界面选中态应被清空，界面子树行不再高亮。
    fireEvent.click(screen.getByText('试玩'))
    expect(useUiSelection.getState().selectedTreeNodeId).toBeNull()
  })

  it('shows interface children when its arrow is clicked from the rule view', () => {
    useGraphView.setState({ view: 'rule' })
    render(<NewSidebar />)

    expect(screen.getByRole('button', { name: '展开 界面' })).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))

    expect(useGraphView.getState().view).toBe('rule')
    expect(screen.getByRole('button', { name: '折叠 界面' })).toBeTruthy()
    expect(screen.getByText('战斗')).toBeTruthy()
    expect(screen.queryByText('首领')).toBeNull()
    expect(screen.getByRole('button', { name: '展开战斗' })).toBeTruthy()
  })

  it('creates top-level folders from the 界面 add button before schemes can be added inside', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新增 界面 子项' }))
    const input = screen.getByPlaceholderText('新建界面组名称')
    fireEvent.change(input, { target: { value: '过场界面' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const selectedId = useUiSelection.getState().selectedTreeNodeId!
    const meta = useGraphScenario.getState().meta
    expect(findUiTreeNode(meta.uiTree!, selectedId)).toMatchObject({
      kind: 'folder',
      name: '过场界面',
    })
    expect(meta.uiTree?.root.some((node) => node.id === selectedId)).toBe(true)
    expect(useGraphView.getState().view).toBe('ui')
  })

  it('creates a named overlay from the folder add button', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByLabelText('新增界面 战斗'))
    const input = screen.getByPlaceholderText('新建界面名称')
    fireEvent.change(input, { target: { value: '战斗结算' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const selection = useUiSelection.getState()
    expect(selection.selectedOverlayId).toBeTruthy()
    const meta = useGraphScenario.getState().meta
    expect(meta.ui?.overlays?.[selection.selectedOverlayId!]).toMatchObject({
      id: selection.selectedOverlayId,
      title: '战斗结算',
      children: [],
    })
    expect(findUiTreeNode(meta.uiTree!, selection.selectedTreeNodeId!)).toMatchObject({
      kind: 'scheme',
      overlayId: selection.selectedOverlayId,
    })
  })

  it('does not flicker selection when creating a new overlay (no heal-back to another scheme)', () => {
    // 回归：新建方案后，选中态应直接落在新方案，不出现「先被自愈抢回第一个方案、再回跳」的中间态。
    // 修复前 GraphConfigView 的自愈 effect 会与 add-scheme 的 selectUiNode 抢态，trace 里会出现别的 overlayId。
    const trace: Array<string | null> = []
    let last: string | null = useUiSelection.getState().selectedOverlayId
    trace.push(last)
    const unsub = useUiSelection.subscribe((next) => {
      if (next.selectedOverlayId !== last) {
        last = next.selectedOverlayId
        trace.push(last)
      }
    })

    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByLabelText('新增界面 战斗'))
    const input = screen.getByPlaceholderText('新建界面名称')
    fireEvent.change(input, { target: { value: '战斗结算' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    unsub()

    const selection = useUiSelection.getState()
    expect(selection.selectedOverlayId).toBeTruthy()
    // 末态就是新方案。
    expect(trace[trace.length - 1]).toBe(selection.selectedOverlayId)
    // 新建过程中不应出现「先选中别的方案、再回跳到新方案」——trace 里新方案 id 只应在末尾出现一次。
    const finalId = selection.selectedOverlayId!
    const firstFinalIndex = trace.indexOf(finalId)
    expect(firstFinalIndex).toBe(trace.length - 1)
  })

  it('persists nested folder rename and delete operations', () => {
    render(<NewSidebar />)
    fireEvent.click(screen.getByRole('button', { name: '新增 界面 子项' }))
    const input = screen.getByPlaceholderText('新建界面组名称')
    fireEvent.change(input, { target: { value: '新文件夹' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const folderId = useUiSelection.getState().selectedTreeNodeId!
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toMatchObject({
      kind: 'folder',
      name: '新文件夹',
    })

    fireEvent.click(screen.getByLabelText('重命名 新文件夹'))
    fireEvent.change(screen.getByRole('textbox', { name: '重命名文件夹' }), {
      target: { value: '过场界面' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toMatchObject({
      name: '过场界面',
    })

    fireEvent.click(screen.getByLabelText('删除 过场界面'))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(findUiTreeNode(useGraphScenario.getState().meta.uiTree!, folderId)).toBeUndefined()
  })

  it('deletes a scheme reference and its overlay together', () => {
    render(<NewSidebar />)
    expandUiTree()
    fireEvent.click(screen.getByRole('button', { name: '展开战斗' }))
    fireEvent.click(screen.getByRole('button', { name: '展开首领' }))
    fireEvent.click(screen.getByLabelText('删除 战斗 HUD'))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const meta = useGraphScenario.getState().meta
    expect(meta.ui?.overlays?.hud).toBeUndefined()
    expect(findUiTreeNode(meta.uiTree!, 'hud-node')).toBeUndefined()
  })

  it('routes the formula navigation leaf to the formula rule section', () => {
    render(<NewSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '展开 规则' }))
    fireEvent.click(screen.getByText('公式'))

    expect(useGraphView.getState().view).toBe('rule')
    expect(useRuleSelection.getState()).toMatchObject({
      section: 'formulas',
      itemId: null,
    })
  })
})

describe('NewSidebar blueprint folder interactions', () => {
  it('adds a blueprint from + while the folder is collapsed', () => {
    render(<NewSidebar />)
    expect(screen.queryByText('主蓝图')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新增 蓝图 子项' }))
    const input = screen.getByPlaceholderText('新建蓝图名称')
    fireEvent.change(input, { target: { value: '支线 A' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const state = useGraphScenario.getState()
    const created = Object.values(state.blueprints).find((doc) => doc.title === '支线 A')
    expect(created).toBeTruthy()
    expect(screen.getByText('支线 A')).toBeTruthy()
    expect(screen.getByText('主蓝图')).toBeTruthy()
  })

  it('toggles the blueprint folder on row click without selecting a child', () => {
    useGraphView.setState({ view: 'ui' })
    render(<NewSidebar />)
    const folderLabel = document.querySelector('.ns-label[title="蓝图"]')
    expect(folderLabel).toBeTruthy()
    const folder = folderLabel!.closest('[role="treeitem"]') as HTMLElement
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('主蓝图')).toBeNull()

    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('主蓝图')).toBeTruthy()
    // 展开只是展示子项，不切视图、不选中某个蓝图
    expect(useGraphView.getState().view).toBe('ui')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('main')

    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('主蓝图')).toBeNull()
    expect(useGraphView.getState().view).toBe('ui')
  })

  it('switches view only after clicking a blueprint leaf', () => {
    useGraphView.setState({ view: 'ui' })
    render(<NewSidebar />)
    fireEvent.click(document.querySelector('.ns-label[title="蓝图"]')!.closest('[role="treeitem"]')!)
    expect(useGraphView.getState().view).toBe('ui')

    fireEvent.click(screen.getByText('主蓝图'))
    expect(useGraphView.getState().view).toBe('graph')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('main')
  })
})
