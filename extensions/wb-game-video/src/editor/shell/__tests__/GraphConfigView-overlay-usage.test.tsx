import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph, GameScenario } from '../../../runtime/schema/graph-schema'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { CUSTOM_UI_FOLDER_ID } from '../../persist/ui-tree'
import { useUiSelection } from '../../persist/uiSelectionStore'
import { GraphConfigView } from '../GraphConfigView'
import { NewSidebar } from '../NewSidebar'
import { useGraphView } from '../../persist/graphViewStore'
import { useRuleSelection } from '../../persist/ruleSelectionStore'

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

const initialState = useGraphScenario.getState()
beforeAll(registerTestComponents)

function graphWithOverlay(nodeId: string, overlay: string): GameGraph {
  return {
    nodes: [{
      id: nodeId,
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: nodeId, overlayNodes: [{ overlay }] },
    }],
    edges: [],
  }
}

function blueprint(id: string, graph: GameGraph): BlueprintDoc {
  return { id, title: id, entry: graph.nodes[0]?.id ?? 'entry', graph }
}

function chooseCascade(trigger: HTMLElement, ...labels: string[]): void {
  fireEvent.click(trigger)
  for (const label of labels) {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  }
}

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialState, true)
  useUiSelection.getState().clearUiSelection()
  useGraphView.setState({ view: 'graph' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
})

describe('GraphConfigView overlay usage', () => {
  it('renders the rule section selected by the navigation store', () => {
    const graph: GameGraph = { nodes: [], edges: [] }
    const scenario: GameScenario = { version: 'test', graph }
    useGraphScenario.setState({
      graph,
      blueprints: { main: blueprint('main', graph) },
      mainBlueprintId: 'main',
      activeBlueprintId: 'main',
      meta: {},
    })
    useGraphView.setState({ view: 'rule' })
    useRuleSelection.setState({ section: 'formulas', itemId: null })

    render(
      <GraphConfigView
        tabs={[
          { section: 'entities', label: '实体' },
          { section: 'variables', label: '变量' },
          { section: 'formulas', label: '公式' },
        ]}
        scenario={scenario}
      />,
    )

    expect(screen.getByRole('button', { name: '＋ 新建公式' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '搜索公式' })).toBeTruthy()
  })

  it('counts references from the main blueprint and unopened sub-blueprints', () => {
    const overlayId = 'scheme-shared'
    const mainGraph = graphWithOverlay('main-node', overlayId)
    const childGraph = graphWithOverlay('child-node', overlayId)
    const overlays = { [overlayId]: { id: overlayId, title: '共享界面', children: [] } }

    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      booted: true,
      blueprints: {
        'bp-main': blueprint('bp-main', mainGraph),
        'bp-child': blueprint('bp-child', childGraph),
      },
      mainBlueprintId: 'bp-main',
      activeBlueprintId: 'bp-main',
      graph: mainGraph,
      meta: { ui: { overlays } },
    })

    const scenario: GameScenario = { version: 'test', graph: mainGraph, ui: { overlays } }
    useGraphView.setState({ view: 'ui' })
    render(
      <>
        <NewSidebar />
        <GraphConfigView tabs={[{ section: 'overlays', label: '界面' }]} scenario={scenario} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))
    fireEvent.click(screen.getByRole('button', { name: '展开自定义界面' }))
    expect(screen.getByText('⇢2')).toBeTruthy()
    expect(screen.queryByText('被 2 个节点引用')).toBeNull()
  })

  it('creates unique scheme titles and blocks duplicate renames', () => {
    const graph: GameGraph = { nodes: [], edges: [] }
    const overlays = {
      a: { id: 'a', title: '新方案', children: [] },
      b: { id: 'b', title: '战斗 HUD', children: [] },
    }
    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      booted: true,
      blueprints: { main: blueprint('main', graph) },
      mainBlueprintId: 'main',
      activeBlueprintId: 'main',
      graph,
      meta: { ui: { overlays } },
    })
    expect(useGraphScenario.getState().createUiScheme(CUSTOM_UI_FOLDER_ID)).not.toBeNull()
    const scenario: GameScenario = { version: 'test', graph, ui: { overlays } }
    render(<GraphConfigView tabs={[{ section: 'overlays', label: '界面' }]} scenario={scenario} />)

    expect(Object.values(useGraphScenario.getState().meta.ui?.overlays ?? {})
      .some((overlay) => overlay.title === '新方案 2')).toBe(true)

    const selectedTreeNodeId = useUiSelection.getState().selectedTreeNodeId!
    expect(useGraphScenario.getState().renameUiNode(selectedTreeNodeId, '战斗 HUD')).toBe(false)
    expect((useGraphScenario.getState().meta.ui?.overlays?.['scheme-2'])?.title).toBe('新方案 2')
  })

  it('stores a direct entity hp selection from the interface scheme entry', () => {
    const graph: GameGraph = { nodes: [], edges: [] }
    const overlays = {
      hud: {
        id: 'hud',
        title: '战斗界面',
        children: [{
          id: 'hp',
          component: 'test.hud',
          inputs: { label: '我方', current: 0, max: 100 },
        }],
      },
    }
    const entities = { hero: { id: 'hero', name: '主角', attrs: { hp: 80, hpMax: 100 } } }
    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      booted: true,
      blueprints: { main: blueprint('main', graph) },
      mainBlueprintId: 'main',
      activeBlueprintId: 'main',
      graph,
      meta: { entities, ui: { overlays } },
    })
    const scenario: GameScenario = { version: 'test', graph, entities, ui: { overlays } }
    render(<GraphConfigView tabs={[{ section: 'overlays', label: '界面' }]} scenario={scenario} />)

    const hpSelect = screen.getAllByRole('combobox', { name: '数值内容' })[0]!
    fireEvent.click(hpSelect)
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'hp' }))

    expect(useGraphScenario.getState().meta.ui?.overlays?.hud?.children[0]?.inputs?.current).toEqual({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'pick',
        terms: [{
          source: 'entity',
          refId: 'hero',
          attr: 'hp',
          op: '+',
          constValue: undefined,
        }],
      },
    })
  })

})
