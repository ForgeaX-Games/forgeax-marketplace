import { describe, expect, it } from 'vitest'
import { addNode, connect, disconnect, reconnect, removeNode, setNodePosition } from '../graph-edit'
import type { GameGraph, GameNode } from '../graph-schema'

const n = (id: string): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, timeline: [] },
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
})
