import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData } from '../../../runtime/schema/graph-schema'
import { getSubProcess } from '../../../runtime/schema/graph-schema'
import { NodeInspector } from '../NodeInspector'

function graphWith(data: GameNodeData): GameGraph {
  return {
    nodes: [{ id: 'node', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
    edges: [],
  }
}

function expectPerformanceFieldsHidden(): void {
  expect(screen.queryByText('演出视频', { selector: 'label > span:first-child' })).toBeNull()
  expect(screen.queryByRole('group', { name: '播放模式' })).toBeNull()
  expect(screen.queryByText('界面', { selector: 'b' })).toBeNull()
  expect(screen.queryByText('结算', { selector: '.ni-section-title' })).toBeNull()
  expect(screen.queryByText('响应规则', { selector: 'b' })).toBeNull()
}

afterEach(cleanup)

describe('NodeInspector · 蓝图节点角色约束', () => {
  it.each([
    ['内嵌子流程容器', {
      name: '容器',
      subProcess: { entry: 'entry', graph: { nodes: [
        { id: 'entry', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '入口' } },
      ], edges: [] } },
    }],
    ['子蓝图容器', { name: '容器', subFlowPack: { id: 'bp-child', version: '1', entry: 'legacy-entry' } }],
  ] as const)('%s 不开放演出、界面和结算配置', (_name, data) => {
    render(<NodeInspector graph={graphWith(data)} nodeId="node" onChange={vi.fn()} />)

    expectPerformanceFieldsHidden()
    expect(screen.queryByText('入口覆盖')).toBeNull()
  })

  it('普通演出节点可配置演出、界面和结算，但不再展示响应规则', () => {
    render(<NodeInspector graph={graphWith({ name: '演出' })} nodeId="node" onChange={vi.fn()} />)

    expect(screen.getByText('演出视频', { selector: 'label > span:first-child' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '播放模式' })).toBeTruthy()
    expect(screen.getByText('界面', { selector: '.ni-section-title' })).toBeTruthy()
    expect(screen.getByText('结算', { selector: '.ni-section-title' })).toBeTruthy()
    expect(screen.queryByText('响应规则', { selector: 'b' })).toBeNull()
    expect(screen.getByText('嵌套', { selector: 'label > span:first-child' })).toBeTruthy()
  })

  it('子蓝图包下拉始终保留“无”，有候选时一并列出实际蓝图', () => {
    const graph = graphWith({ name: '容器', subFlowPack: { id: 'missing', version: '1' } })
    const { rerender } = render(<NodeInspector graph={graph} nodeId="node" onChange={vi.fn()} />)
    const emptySelect = screen.getByTitle('引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑')
    expect(within(emptySelect).getByRole('option', { name: '无' })).toBeTruthy()

    rerender(
      <NodeInspector
        graph={graph}
        nodeId="node"
        packs={[{ id: 'missing', version: '1', title: '战斗', entry: 'entry', graph: { nodes: [], edges: [] } }]}
        onChange={vi.fn()}
      />,
    )
    const populatedSelect = screen.getByTitle('引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑')
    expect(within(populatedSelect).getByRole('option', { name: '无' })).toBeTruthy()
    expect(within(populatedSelect).getByRole('option', { name: '战斗' })).toBeTruthy()
  })

  it('切到子蓝图时不自动建库、不预挂候选，仅进入未挂包模式', () => {
    const graph = graphWith({ name: '回合' })
    const onChange = vi.fn()
    const onPacksChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="node"
        packs={[{ id: 'bp-child', version: '1', title: '战斗', entry: 'entry', graph: { nodes: [], edges: [] } }]}
        onChange={onChange}
        onPacksChange={onPacksChange}
      />,
    )

    fireEvent.change(screen.getByTitle('无 / 私有内嵌子流程 / 外部子蓝图（互斥）'), { target: { value: 'pack' } })

    expect(onPacksChange).not.toHaveBeenCalled()
    const nextGraph = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(nextGraph.nodes[0]!.data).not.toHaveProperty('subFlowPack')
    expect(screen.getByTitle('无 / 私有内嵌子流程 / 外部子蓝图（互斥）')).toHaveProperty('value', 'pack')
    expect(within(screen.getByTitle('引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑')).getByRole('option', { name: '无' })).toBeTruthy()
  })

  it('新建内嵌子流程时只在私有子图创建入口，不向父图追加节点', () => {
    const graph = graphWith({ name: '回合' })
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="node"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTitle('无 / 私有内嵌子流程 / 外部子蓝图（互斥）'), { target: { value: 'process' } })

    const nextGraph = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(nextGraph.nodes).toHaveLength(1)
    expect(getSubProcess(nextGraph.nodes[0]!.data)?.graph.nodes).toHaveLength(1)
  })
})
