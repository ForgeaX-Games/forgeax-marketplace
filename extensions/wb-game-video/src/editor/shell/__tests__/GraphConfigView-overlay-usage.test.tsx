import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BlueprintDoc, GameGraph, GameScenario } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphConfigView } from '../GraphConfigView'

const initialState = useGraphScenario.getState()

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
})
