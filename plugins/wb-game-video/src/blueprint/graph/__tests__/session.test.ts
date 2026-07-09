import { describe, expect, it } from 'vitest'
import { GraphSession } from '../session'
import { makeNodiaDemo } from '../demo'

describe('GraphSession (playable view model)', () => {
  it('drives nodia to a rendered interaction, then wins', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 60 }))

    session.start() // 起点 = 叙事 n_open
    let snap = session.jump('enter') // seek 到战斗入口
    expect(snap.clip?.nodeId).toBe('enter')
    expect(snap.hud.entities['ent-boss']!.hp).toBe(60)

    snap = session.performanceEnd() // enter → 出手判断(折进出边) → wait（技能交互）
    expect(snap.interaction?.kind).toBe('skill')
    expect(snap.interaction?.handles).toEqual(['opt:light', 'opt:heavy', 'opt:medit', 'opt:ult'])

    snap = session.submit('light') // → 变招判定 → 轻攻击演出
    snap = session.tick(1000) // 命中时机(at:1000ms) → 结算 → boss 死
    snap = session.performanceEnd() // 演出结束 → win 演出
    expect(snap.hud.entities['ent-boss']!.hp).toBeLessThanOrEqual(0)
    expect(snap.currentNodeId).toBe('win')

    snap = session.performanceEnd() // win 演出结束 → 胜利横幅
    expect(snap.banner?.kind).toBe('victory')
    expect(snap.phase).toBe('ended')
  })

  it('exposes execution state for blueprint visualization (visited/traversed)', () => {
    const session = new GraphSession(makeNodiaDemo({ bossHp: 700 }))
    session.start()
    session.jump('enter')
    session.performanceEnd() // → wait（技能）
    session.submit('light') // → 轻攻击演出
    session.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    const snap = session.performanceEnd() // boss 存活 + 我方先手 → 敌方回合 tele（防反 QTE）
    expect(snap.visited).toContain('wait')
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
    const session = new GraphSession(makeNodiaDemo({ bossHp: 700 }))
    session.start()
    const snap = session.jump('wait')
    // 跳到战斗待机 → 技能交互挂起
    expect(snap.currentNodeId).toBe('wait')
    expect(snap.interaction?.kind).toBe('skill')
  })
})
