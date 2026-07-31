import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData } from '../../../runtime/schema/graph-schema'
import { PRESET_SCHEME_BY_ID } from '../schemeOverlays'
import { NodeInspector } from '../NodeInspector'

afterEach(cleanup)

describe('NodeInspector · 界面事件动作入口', () => {
  it('事件响应保留沿边推进入口，并把走边选择收进目标节点路由', () => {
    const overlay = structuredClone(PRESET_SCHEME_BY_ID.n_door!)
    const data: GameNodeData = {
      name: '慈悲狱门口',
      overlayNodes: [{ overlay: overlay.id }],
    }
    const graph: GameGraph = {
      nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
      edges: [],
    }

    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: '＋ 效果' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '＋ 沿边推进' })).toHaveLength(2)
    expect(screen.queryByText('走边')).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 生成组件' })).toBeNull()
    expect(screen.getByText('界面')).toBeTruthy()
    expect(screen.queryByText('覆盖物事件')).toBeNull()
    expect((screen.getByTitle(/从目录追加一张 overlay 挂载/) as HTMLSelectElement).options[0]?.text).toBe('＋ 添加界面')
    expect(screen.queryByText(/尚未挂载/)).toBeNull()
  })

  it('允许同一界面方案重复添加，并为第二份生成独立挂载 id', () => {
    const overlay = structuredClone(PRESET_SCHEME_BY_ID.n_door!)
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '慈悲狱门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTitle(/从目录追加一张 overlay 挂载/), { target: { value: overlay.id } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes).toEqual([
      { overlay: 'n_door' },
      { id: 'n_door__2', overlay: 'n_door', layout: { left: 0, top: 0, width: 1, height: 1 } },
    ])
  })
})
