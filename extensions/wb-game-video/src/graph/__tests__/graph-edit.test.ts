import { describe, expect, it } from 'vitest'
import { addNode, connect, disconnect, duplicateNodes, insertNodeAfter, insertSubFlowPackAfter, makeEmptySubFlowPack, makeSubFlowPackContainer, normalizeSubFlowFields, reconnect, removeNode, setNodePosition } from '../edit/graph-edit'
import type { GameGraph, GameNode } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'

const n = (id: string): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id },
})
const g0 = (): GameGraph => ({ nodes: [n('a'), n('b')], edges: [] })

describe('graph-edit', () => {
  it('addNode / removeNode(+连带删边)', () => {
    let g = addNode(g0(), n('c'))
    expect(g.nodes.map((x) => x.id)).toContain('c')
    g = connect(g, { source: 'a', sourceHandle: 'out', target: 'c' })
    g = removeNode(g, 'c')
    expect(g.nodes.some((x) => x.id === 'c')).toBe(false)
    expect(g.edges.length).toBe(0) // 连带删掉 a→c
  })

  it('connect: 拒绝自环 & 去重', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'a' })
    expect(g.edges.length).toBe(0) // 自环拒绝
    g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'b' })
    const g2 = connect(g, { source: 'a', sourceHandle: 'out', target: 'b' })
    expect(g2.edges.length).toBe(1) // 重复拒绝
  })

  it('disconnect / reconnect', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'b', id: 'e1' })
    g = reconnect(g, 'e1', { target: 'a' })
    // reconnect 到自身允许（数据层不校验语义），target 改为 a
    expect(g.edges[0]!.target).toBe('a')
    g = disconnect(g, 'e1')
    expect(g.edges.length).toBe(0)
  })

  it('setNodePosition', () => {
    const g = setNodePosition(g0(), 'a', { x: 100, y: 50 })
    expect(g.nodes.find((x) => x.id === 'a')!.position).toEqual({ x: 100, y: 50 })
  })

  it('immutability: 原图不被修改', () => {
    const src = g0()
    connect(src, { source: 'a', sourceHandle: 'out', target: 'b' })
    expect(src.edges.length).toBe(0)
  })

  it('makeEmptySubFlowPack + makeSubFlowPackContainer', () => {
    const pack = makeEmptySubFlowPack({ id: 'enemy-turn', title: '敌方回合', version: '1' })
    expect(pack.schemaVersion).toBe('wb-game-video.pack.v1')
    expect(pack.entry).toBe('entry')
    expect(pack.graph.nodes[0]?.data.name).toBe('入口')
    expect(pack.graph.nodes[0]?.data.durationMs).toBe(100)
    const c = makeSubFlowPackContainer(pack, { id: 'wrap', name: '敌方回合' })
    expect(getSubFlowPack(c.data)).toEqual({ id: 'enemy-turn', version: '1' })
    expect(getSubFlow(c.data)).toBeUndefined()
  })

  it('insertNodeAfter: 插入并改接 out 边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId } = insertNodeAfter(g, 'a')
    expect(next.nodes.some((n) => n.id === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && (e.sourceHandle ?? 'out') === 'out')).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-ab')).toBe(false)
  })

  it('insertSubFlowPackAfter: 后插子蓝图容器并改接 out 边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId, pack } = insertSubFlowPackAfter(g, 'a', { title: '敌方回合' })
    const container = next.nodes.find((n) => n.id === nodeId)
    expect(getSubFlowPack(container!.data)).toEqual({ id: pack.id, version: pack.version })
    expect(pack.title).toBe('敌方回合')
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-ab')).toBe(false)
  })

  it('duplicateNodes: 多节点 + 内部边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'out', target: 'b', id: 'e-ab' })
    const { graph: next, nodeIds } = duplicateNodes(g, ['a', 'b'])
    expect(nodeIds).toHaveLength(2)
    expect(next.nodes.length).toBe(4)
    expect(next.edges.filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target))).toHaveLength(1)
    expect(next.nodes.find((n) => n.id === nodeIds[0])!.data.name).toContain('副本')
  })

  it('normalizeSubFlowFields: subFlowRef → subFlow', () => {
    const g: GameGraph = {
      nodes: [{
        ...n('a_my'),
        data: { name: '我方回合', subFlowRef: 'wait' } as GameNode['data'],
      }],
      edges: [],
    }
    const next = normalizeSubFlowFields(g)
    expect(getSubFlow(next.nodes[0]!.data)).toBe('wait')
    expect((next.nodes[0]!.data as { subFlowRef?: string }).subFlowRef).toBeUndefined()
    expect((next.nodes[0]!.data as { subFlow?: string }).subFlow).toBe('wait')
  })
})
