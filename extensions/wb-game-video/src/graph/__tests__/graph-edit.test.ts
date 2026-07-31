import { describe, expect, it } from 'vitest'
import { addNode, attachSameGraphSubflow, connect, disconnect, duplicateNodes, insertNodeAfter, makeEmptySubFlowPack, normalizeSubFlowFields, reconnect, removeNode, setLifecycleReactionMs, setNodePosition, setRoutingSettlementMs, updateEventRouteTiming } from '../edit/graph-edit'
import type { GameGraph, GameNode } from '../../runtime/schema/graph-schema'
import { getSubFlow } from '../../runtime/schema/graph-schema'

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
    g = connect(g, { source: 'a', sourceHandle: 'default', target: 'c' })
    g = removeNode(g, 'c')
    expect(g.nodes.some((x) => x.id === 'c')).toBe(false)
    expect(g.edges.length).toBe(0) // 连带删掉 a→c
  })

  it('connect: 拒绝自环 & 去重', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'a' })
    expect(g.edges.length).toBe(0) // 自环拒绝
    g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b' })
    const g2 = connect(g, { source: 'a', sourceHandle: 'default', target: 'b' })
    expect(g2.edges.length).toBe(1) // 重复拒绝
  })

  it('disconnect / reconnect', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e1' })
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
    connect(src, { source: 'a', sourceHandle: 'default', target: 'b' })
    expect(src.edges.length).toBe(0)
  })

  it('updateEventRouteTiming keeps event edges and node settlement in sync', () => {
    let graph = connect(g0(), { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'at', ms: 1200 })
    expect(graph.edges[0]?.data?.transition).toBe('onSettlement')
    expect(graph.nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 1200 })

    graph = updateEventRouteTiming(graph, 'a', 'pass', 'immediate')
    expect(graph.edges[0]?.data?.transition).toBeUndefined()
    expect(graph.nodes[0]?.data.routingSettlement).toBeUndefined()
  })

  it('setRoutingSettlementMs：只平移已存在的固定时刻结算，非 at 一律不动', () => {
    let graph = connect(g0(), { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })

    // 还没有结算点 / 结算=演出结束 时拖标记都不该"顺手"造出一个固定时刻。
    expect(setRoutingSettlementMs(graph, 'a', 800)).toBe(graph)
    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'complete' })
    expect(setRoutingSettlementMs(graph, 'a', 800)).toBe(graph)

    graph = updateEventRouteTiming(graph, 'a', 'pass', 'onSettlement', { type: 'at', ms: 1200 })
    const moved = setRoutingSettlementMs(graph, 'a', 640.7)
    expect(moved.nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 641 }) // 取整
    expect(setRoutingSettlementMs(moved, 'a', -50).nodes[0]?.data.routingSettlement).toEqual({ type: 'at', ms: 0 }) // 夹 0
    expect(setRoutingSettlementMs(moved, 'a', 641)).toBe(moved) // 同值 = 原样返回，不制造新对象
    // 出边跳转方式不受影响。
    expect(moved.edges[0]?.data?.transition).toBe('onSettlement')
  })

  it('setLifecycleReactionMs：拖生命周期菱形落成 at(ms)，非生命周期相位不动', () => {
    const withReactions: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          durationMs: 3000,
          reactions: [
            { when: { type: 'at', ms: 0 }, do: [] },
            { when: { type: 'complete' }, do: [] },
            { when: { type: 'watch', of: 'ent-boss.hp', on: 'dec' }, do: [] },
          ],
        },
      }, n('b')],
      edges: [],
    }

    const moved = setLifecycleReactionMs(withReactions, 'a', 0, 1250.6)
    expect(moved.nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 1251 }) // 取整
    expect(setLifecycleReactionMs(moved, 'a', 0, 1251)).toBe(moved) // 同值不产生新对象
    expect(setLifecycleReactionMs(moved, 'a', 0, -5).nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 0 })

    // 历史 complete 落成 at（与检视器改那一行同义）。
    expect(setLifecycleReactionMs(withReactions, 'a', 1, 2000).nodes[0]?.data.reactions?.[1]?.when)
      .toEqual({ type: 'at', ms: 2000 })
    // watch 没有「时刻」这个维度，拖不到也不该被误改。
    expect(setLifecycleReactionMs(withReactions, 'a', 2, 500)).toBe(withReactions)
    // 越界下标 no-op。
    expect(setLifecycleReactionMs(withReactions, 'a', 9, 500)).toBe(withReactions)
  })

  it('makeEmptySubFlowPack', () => {
    const pack = makeEmptySubFlowPack({ id: 'enemy-turn', title: '敌方回合', version: '1' })
    expect(pack.version).toBe('1')
    expect(pack.entry).toBe('entry')
    expect(pack.graph.nodes[0]?.data.name).toBe('入口')
    expect(pack.graph.nodes[0]?.data.durationMs).toBeUndefined()
  })

  it('attachSameGraphSubflow: creates dedicated entry; does not steal existing main-flow node', () => {
    // a→b 主链：若误把 b 当入口，根视图会把 b 藏进子流程成员。
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b' })
    g = attachSameGraphSubflow(g, 'a')
    const entry = getSubFlow(g.nodes.find((x) => x.id === 'a')!.data)
    expect(entry).toBeTruthy()
    expect(entry).not.toBe('b')
    expect(g.nodes.some((x) => x.id === entry)).toBe(true)
    expect(g.nodes.find((x) => x.id === 'b')).toBeTruthy()
    // 已有 subFlow 时再切一次：保留入口，只清 pack。
    const again = attachSameGraphSubflow(
      {
        ...g,
        nodes: g.nodes.map((x) =>
          x.id === 'a'
            ? { ...x, data: { ...x.data, subFlowPack: { id: 'p', version: '1' } } }
            : x,
        ),
      },
      'a',
    )
    expect(getSubFlow(again.nodes.find((x) => x.id === 'a')!.data)).toBe(entry)
    expect((again.nodes.find((x) => x.id === 'a')!.data as { subFlowPack?: unknown }).subFlowPack).toBeUndefined()
  })

  it('insertNodeAfter: 插入并改接 out 边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
    const { graph: next, nodeId } = insertNodeAfter(g, 'a')
    expect(next.nodes.some((n) => n.id === nodeId)).toBe(true)
    expect(next.edges.some((e) => e.source === 'a' && e.target === nodeId && (e.sourceHandle ?? 'default') === 'default')).toBe(true)
    expect(next.edges.some((e) => e.source === nodeId && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'e-ab')).toBe(false)
  })

  it('duplicateNodes: 多节点 + 内部边', () => {
    let g = connect(g0(), { source: 'a', sourceHandle: 'default', target: 'b', id: 'e-ab' })
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

  it('connect: 回填同名 event reaction 的 advance.edgeId', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{ when: { type: 'event', id: 'pass' }, do: [{ kind: 'effect', effects: [] }] }],
          }],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    const r = g.nodes[0]!.data.overlayNodes![0]!.reactions![0]!
    expect(r.do.some((a) => a.kind === 'advance' && a.edgeId === 'e-pass')).toBe(true)
  })

  it('disconnect: 清除指向该边的 advance；空 event reaction 一并删除', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{ when: { type: 'event', id: 'pass' }, do: [{ kind: 'advance', edgeId: 'e-pass' }] }],
          }],
        },
      }, n('b')],
      edges: [{ id: 'e-pass', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' }],
    }
    const g = disconnect(src, 'e-pass')
    expect(g.edges.length).toBe(0)
    expect(g.nodes[0]!.data.overlayNodes![0]!.reactions).toBeUndefined()
  })

  it('connect: default 口不自动注入 advance', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          reactions: [{ when: { type: 'event', id: 'default' }, do: [{ kind: 'effect', effects: [] }] }],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'default', target: 'b', id: 'e1' })
    expect(g.nodes[0]!.data.reactions![0]!.do.some((a) => a.kind === 'advance')).toBe(false)
  })

  it('connect: 无同名 event reaction 时自动创建含 advance 的 reaction', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: { name: 'a', overlayNodes: [{ overlay: 'ov' }] },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    const rs = g.nodes[0]!.data.overlayNodes![0]!.reactions!
    expect(rs).toHaveLength(1)
    expect(rs[0]).toEqual({
      when: { type: 'event', id: 'pass' },
      do: [{ kind: 'advance', edgeId: 'e-pass' }],
    })
  })

  it('connect: 新建 advance 挂到已有 event reaction 的挂载（非空 HUD）', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [
            { overlay: 'hud' },
            {
              overlay: 'ov-qte',
              reactions: [{ when: { type: 'event', id: 'good' }, do: [{ kind: 'effect', effects: [] }] }],
            },
          ],
        },
      }, n('b')],
      edges: [],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'pass', target: 'b', id: 'e-pass' })
    expect(g.nodes[0]!.data.overlayNodes![0]!.reactions).toBeUndefined()
    const rs = g.nodes[0]!.data.overlayNodes![1]!.reactions!
    expect(rs.some((r) => r.when.type === 'event' && r.when.id === 'pass')).toBe(true)
    expect(rs.find((r) => r.when.type === 'event' && r.when.id === 'pass')!.do).toEqual([
      { kind: 'advance', edgeId: 'e-pass' },
    ])
  })

  it('connect: 同 handle 第二条边时去掉独占 advance（走边池）', () => {
    const src: GameGraph = {
      nodes: [{
        ...n('a'),
        data: {
          name: 'a',
          overlayNodes: [{
            overlay: 'ov',
            reactions: [{
              when: { type: 'event', id: 'light' },
              do: [
                { kind: 'effect', effects: [] },
                { kind: 'advance', edgeId: 'e1' },
              ],
            }],
          }],
        },
      }, n('b'), n('c')],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'light', targetHandle: 'in' }],
    }
    const g = connect(src, { source: 'a', sourceHandle: 'light', target: 'c', id: 'e2' })
    const r = g.nodes[0]!.data.overlayNodes![0]!.reactions![0]!
    expect(r.do.some((a) => a.kind === 'advance')).toBe(false)
    expect(r.do.some((a) => a.kind === 'effect')).toBe(true)
  })
})
