import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GameGraph } from '../../../runtime/schema/graph-schema'
import { GraphCanvas } from '../GraphCanvas'

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
})
