import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useRuleSelection } from '../../persist/ruleSelectionStore'
import { useUiSelection } from '../../persist/uiSelectionStore'
import { GraphConfigView } from '../GraphConfigView'
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

// 三个根级文件夹（基础/自定义/test）各挂一个 scheme，复现用户反馈的多一级目录场景。
beforeEach(() => {
  useGraphView.setState({ view: 'ui' })
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
          'scheme-a': { id: 'scheme-a', title: '方案A', children: [] },
          'scheme-b': { id: 'scheme-b', title: '方案B', children: [] },
          'scheme-c': { id: 'scheme-c', title: '方案C', children: [] },
        },
      },
      uiTree: {
        root: [
          { kind: 'folder', id: 'ui-folder:basic', name: '基础界面', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-a', overlayId: 'scheme-a' }] },
          { kind: 'folder', id: 'ui-folder:custom', name: '自定义界面', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-b', overlayId: 'scheme-b' }] },
          { kind: 'folder', id: 'ui-folder:test', name: 'test', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-c', overlayId: 'scheme-c' }] },
        ],
      },
    },
  })
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  useUiSelection.getState().clearUiSelection()
  useGraphView.setState({ view: 'graph' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
})

// 模拟 GraphMain：按当前 view 渲染对应 GraphConfigView（界面 overlays / 规则 entities·variables·formulas）。
function GraphConfigViewScenario(): JSX.Element {
  const view = useGraphView((state) => state.view)
  const scenario = useGraphScenario.getState().scn()
  if (view === 'ui') {
    return <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'overlays', label: '自定义界面' }]} scenario={scenario} />
  }
  if (view === 'rule') {
    return (
      <GraphConfigView
        title="规则"
        icon="📏"
        tabs={[
          { section: 'entities', label: '实体' },
          { section: 'variables', label: '变量' },
          { section: 'formulas', label: '公式' },
        ]}
        scenario={scenario}
      />
    )
  }
  return <div data-testid="empty-stage" />
}

describe('NewSidebar interface folder selection', () => {
  it('keeps a folder selected after clicking it then switching to 规则/公式 (no flicker back to a scheme)', () => {
    // 订阅 uiSelection，记录 selectedTreeNodeId 的变化序列。
    // 修复前：点文件夹后自愈 effect 会把选中抢回第一个 scheme，trace 末尾变成 scheme id。
    const trace: Array<string | null> = []
    let last: string | null = useUiSelection.getState().selectedTreeNodeId
    trace.push(last)
    const unsub = useUiSelection.subscribe((next) => {
      if (next.selectedTreeNodeId !== last) {
        last = next.selectedTreeNodeId
        trace.push(last)
      }
    })

    render(
      <>
        <NewSidebar />
        <GraphConfigViewScenario />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))
    // 选中「基础界面」文件夹（uit-main 的 aria-label = `选择文件夹 ${label}`）。
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹 基础界面' }))

    // 切到规则 → 公式，期间 uiSelection 不应被改写。
    fireEvent.click(screen.getByText('规则'))
    fireEvent.click(screen.getByText('公式'))

    unsub()

    // 选中文件夹后必须保持稳定：trace 末尾应是文件夹 id，而非被自愈抢回的 scheme id。
    expect(trace[trace.length - 1]).toBe('ui-folder:basic')
    // 且「基础界面」选中后不应再出现任何 scheme id 的回跳。
    const folderIndex = trace.indexOf('ui-folder:basic')
    expect(folderIndex).toBeGreaterThan(-1)
    expect(trace.slice(folderIndex + 1)).toEqual([])
    // 切规则/公式期间 uiSelection 完全不变。
    expect(useUiSelection.getState().selectedTreeNodeId).toBe('ui-folder:basic')
  })
})
