import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GameGraph } from '../../../runtime/schema/graph-schema'
import { canvasNodeDetails, GraphCanvas } from '../GraphCanvas'

const graph: GameGraph = {
  nodes: [
    { id: 'a', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '起点' } },
    { id: 'b', type: 'perf', position: { x: 220, y: 0 }, inputs: [], outputs: [], data: { name: '终点' } },
  ],
  edges: [{ id: 'a-b', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
}

describe('GraphCanvas output handles', () => {
  it('marks source handles interactive only on the editable canvas', () => {
    const { container, rerender } = render(
      <GraphCanvas graph={graph} onChange={() => {}} />,
    )

    expect(container.querySelector('.gv-flow-handle.is-interactive')).toBeTruthy()

    rerender(<GraphCanvas graph={graph} onChange={() => {}} readOnly />)

    const staticHandle = container.querySelector<HTMLElement>('.gv-flow-handle.is-static')
    expect(staticHandle).toBeTruthy()
    expect(staticHandle?.style.pointerEvents).toBe('none')
    expect(container.querySelector('.gv-flow-handle.is-interactive')).toBeNull()
    expect(container.querySelector('.react-flow.gv-readonly-flow')).toBeTruthy()
    expect(container.querySelector('.react-flow__node.selectable')).toBeNull()
    expect(container.querySelector('.react-flow__edge.selectable')).toBeNull()
  })

  it('marks the current graph entry node', () => {
    const { getByLabelText, queryAllByLabelText } = render(
      <GraphCanvas graph={graph} entryNodeId="a" onChange={() => {}} />,
    )

    expect(getByLabelText('入口节点')).toHaveAttribute('title', '入口节点')
    expect(getByLabelText('入口节点')).toHaveStyle({ background: '#55b98a' })
    expect(queryAllByLabelText('入口节点')).toHaveLength(1)
  })

  it('shows the selected video and interface names on a node', () => {
    const detailedGraph: GameGraph = {
      nodes: [{
        ...graph.nodes[0]!,
        data: {
          name: '起点',
          media: { kind: 'video', ref: 'video-1' },
          overlayNodes: [{ overlay: 'main-ui' }, { overlay: 'dialogue-ui' }],
        },
      }],
      edges: [],
    }
    const { getByText, getByTestId } = render(
      <GraphCanvas
        graph={detailedGraph}
        onChange={() => {}}
        videoOptions={[{ id: 'video-1', label: '叙事·第1章·上岸' }]}
        overlays={{
          'main-ui': { id: 'main-ui', title: '主界面', children: [] },
          'dialogue-ui': { id: 'dialogue-ui', title: '对话', children: [] },
        }}
      />,
    )

    expect(getByText('演出')).toBeTruthy()
    expect(getByText('叙事·第1章·上岸')).toBeTruthy()
    expect(getByText('界面')).toBeTruthy()
    expect(getByText('主界面')).toBeTruthy()
    expect(getByText('对话')).toBeTruthy()
    expect(
      getByTestId('node-edge-info').compareDocumentPosition(getByTestId('node-content-info'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('falls back to persisted ids when referenced catalogs are unavailable', () => {
    const node: GameGraph['nodes'][number] = {
      ...graph.nodes[0]!,
      data: { name: '起点', media: { kind: 'video', ref: 'missing-video' }, overlayNodes: [{ overlay: 'missing-ui' }] },
    }

    expect(canvasNodeDetails(node)).toEqual({
      performance: 'missing-video',
      interfaces: ['missing-ui'],
    })
  })
})
