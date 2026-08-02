import { describe, expect, it } from 'vitest'
import { GraphSession } from '../engine/session'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { getSubProcess, type GameGraph } from '../schema/graph-schema'
import { node, scnOf } from './test-fixtures'

function overlayChild(snap: ReturnType<GraphSession['start']>, component: string) {
  return snap.overlayMounts.flatMap((m) => m.children).find((c) => c.component === component)
}

describe('GraphSession (playable view model)', () => {
  it('uses the injected session seed for weighted routing', () => {
    const graph: GameGraph = {
      nodes: [node('start', { durationMs: 100 }), node('first'), node('second')],
      edges: [
        { id: 'first-edge', source: 'start', target: 'first', sourceHandle: 'default', targetHandle: 'in', data: { weight: 1 } },
        { id: 'second-edge', source: 'start', target: 'second', sourceHandle: 'default', targetHandle: 'in', data: { weight: 2 } },
      ],
    }
    const scenario = scnOf(graph)

    const first = new GraphSession(scenario, { rngSeed: 0 })
    first.start()
    expect(first.performanceEnd().currentNodeId).toBe('first')

    const second = new GraphSession(scenario, { rngSeed: 1 })
    second.start()
    expect(second.performanceEnd().currentNodeId).toBe('second')
  })

  it('drives nodia to a rendered interaction, then wins', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 30 }))

    session.start() // 起点 = 叙事 n_open
    let snap = session.jump('a_my') // seek 到我方回合容器，立即下钻到 wait
    expect(snap.clip?.nodeId).toBe('wait')
    expect(snap.hud.entities['ent-boss']!.hp).toBe(30)

    const skill = overlayChild(snap, 'BattleSkill')
    expect(skill?.elementId).toBe('wait/skill')

    snap = session.emitEvent('wait/skill', 'light') // → 变招判定 → 轻攻击演出
    snap = session.tick(1000) // 命中 → 结算致死 → rules redirect → win
    expect(snap.hud.entities['ent-boss']!.hp).toBeLessThanOrEqual(0)
    snap = session.performanceEnd() // 结算演出结束后消费死亡路由
    expect(snap.currentNodeId).toBe('win')

    snap = session.performanceEnd() // win 演出结束 → 无出边 & 栈空 → 本局结束
    expect(snap.phase).toBe('ended')
  })

  it('exposes execution state for blueprint visualization (visited/traversed)', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 700 }))
    session.start()
    session.jump('a_my') // → wait（技能）
    session.emitEvent('wait/skill', 'light') // → 轻攻击演出
    session.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    const snap = session.performanceEnd() // returns → a_my → b_ai → tele（防反 QTE）
    expect(snap.visited).toContain('wait')
    expect(snap.visited).toContain('a_my')
    expect(snap.currentNodeId).toBe('tele')
    expect(snap.traversedEdgeIds.length).toBeGreaterThan(0)
  })

  it('returns a fresh snapshot reference each call (so React re-renders)', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 700 }))
    const a = session.start()
    const b = session.performanceEnd()
    expect(a).not.toBe(b) // 不同引用，否则 React setState 会跳过重渲染
  })

  it('jump seeks to any node (debug)', () => {
    const scenario = makeNodiaDemo({ bossHp: 700 })
    const session = new GraphSession(scenario)
    session.start()
    const playerTurn = getSubProcess(scenario.graph.nodes.find((node) => node.id === 'a_my')!.data)!
    const snap = session.jump('wait', { graph: playerTurn.graph, graphPath: ['a_my'] })
    // 跳到战斗待机 → 技能 overlay 可见
    expect(snap.currentNodeId).toBe('wait')
    expect(overlayChild(snap, 'BattleSkill')?.elementId).toBe('wait/skill')
  })

  it('restores an in-memory checkpoint including globals and nested execution cursors', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 700 }))
    session.start()
    const entry = session.jump('a_my')
    expect(entry.currentNodeId).toBe('wait')
    const checkpoint = session.createCheckpoint()

    session.emitEvent('wait/skill', 'light')
    const advanced = session.tick(1000)
    const damagedHp = advanced.hud.entities['ent-boss']!.hp
    expect(damagedHp).toBeLessThan(700)

    const restored = session.restoreCheckpoint(checkpoint)
    expect(restored.currentNodeId).toBe('wait')
    expect(restored.hud.entities['ent-boss']!.hp).toBe(700)
    expect(overlayChild(restored, 'BattleSkill')?.elementId).toBe('wait/skill')

    session.emitEvent('wait/skill', 'light')
    expect(session.tick(1000).hud.entities['ent-boss']!.hp).toBe(damagedHp)
  })
})
