import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph, GameScenario } from '../../../runtime/schema/graph-schema'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphConfigView } from '../GraphConfigView'

const initialState = useGraphScenario.getState()
beforeAll(registerCoreSkins)

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
})

describe('GraphConfigView overlay usage', () => {
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
    render(<GraphConfigView tabs={[{ section: 'overlays', label: '界面' }]} scenario={scenario} />)

    expect(screen.getByText('⇢2')).toHaveAttribute('title', '被 2 个节点的 overlayNodes 引用')
    expect(screen.getByText('被 2 个节点引用')).toBeTruthy()
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
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const scenario: GameScenario = { version: 'test', graph, ui: { overlays } }
    render(<GraphConfigView tabs={[{ section: 'overlays', label: '界面' }]} scenario={scenario} />)

    fireEvent.click(screen.getByTitle('新建界面方案'))
    expect(Object.values(useGraphScenario.getState().meta.ui?.overlays ?? {})
      .some((overlay) => overlay.title === '新方案 2')).toBe(true)

    const title = screen.getByDisplayValue('新方案 2')
    fireEvent.change(title, { target: { value: '战斗 HUD' } })
    expect(alert).toHaveBeenCalledWith('界面方案名称「战斗 HUD」已存在')
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
          component: 'BattlePlayerHpBar',
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

    const hpSelect = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
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

  it('keeps a confirmed interface entity and attribute in the shared rule catalog', () => {
    const graph: GameGraph = { nodes: [], edges: [] }
    const overlays = {
      hud: {
        id: 'hud',
        title: '战斗界面',
        children: [{
          id: 'hp',
          component: 'BattleEnemyHpBar',
          inputs: { label: '敌方', current: 0, max: 100 },
        }],
      },
    }
    const entities = {}
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

    const hpPicker = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
    chooseCascade(hpPicker, '实体属性', '配置「敌方」实体')
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(useGraphScenario.getState().meta.entities?.['ent-boss']).toMatchObject({
      id: 'ent-boss',
      name: '敌方',
    })
    expect(useGraphScenario.getState().meta.entities?.['ent-boss']?.attrs?.hp).toBe(100)
    expect(useGraphScenario.getState().meta.entities?.['ent-boss']?.attrMeta?.hp).toMatchObject({
      label: '当前血量',
      initial: 100,
    })

    chooseCascade(
      within(screen.getByText('血量').parentElement!)
        .getByRole('combobox', { name: '数值内容' }),
      '变量',
      '配置「var0」变量',
    )
    fireEvent.change(screen.getByRole('textbox', { name: '新变量显示名' }), {
      target: { value: '战斗计数' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新变量初始值' }), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(useGraphScenario.getState().meta.variables?.var0).toEqual({
      id: 'var0',
      name: '战斗计数',
      initial: 0,
    })
    expect(useGraphScenario.getState().meta.ui?.overlays?.hud?.children[0]?.inputs?.current).toMatchObject({
      expr: 'var.var0',
    })

    chooseCascade(
      within(screen.getByText('血量').parentElement!)
        .getByRole('combobox', { name: '数值内容' }),
      '公式',
      '配置「formula-0」公式',
    )
    fireEvent.change(screen.getByRole('textbox', { name: '新公式显示名' }), {
      target: { value: '界面计算' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新公式内容' }), {
      target: { value: 'var.var0 + 1' },
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(useGraphScenario.getState().meta.formulas?.['formula-0']).toMatchObject({
      id: 'formula-0',
      name: '界面计算',
      ast: { t: 'bin', id: 'n0', op: '+' },
    })
    expect(useGraphScenario.getState().meta.ui?.overlays?.hud?.children[0]?.inputs?.current).toMatchObject({
      expr: 'var.var0 + 1',
      pick: { mode: 'formula', formulaId: 'formula-0', holeBindings: {} },
    })

    cleanup()
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

    expect(screen.getByRole('textbox', { name: '实体 ID' })).toHaveValue('ent-boss')
    expect(screen.getByLabelText('属性「hp」的数值')).toHaveValue('100')
  })
})
