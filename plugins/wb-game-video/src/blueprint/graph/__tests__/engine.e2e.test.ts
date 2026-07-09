import { beforeAll, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine'
import { registerCoreKinds } from '../core-kinds'
import { makeNodiaDemo } from '../demo'
import { validateGraph } from '../validate'
import type { BannerDirective } from '../directives'

beforeAll(() => registerCoreKinds())

describe('nodia graph e2e (runs on GraphRuntime)', () => {
  it('authored graph passes the validator', () => {
    const scn = makeNodiaDemo()
    const issues = validateGraph(scn.graph)
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('quick win: light skill kills a low-hp boss → victory banner', () => {
    const scn = makeNodiaDemo({ bossHp: 60 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start() // 起点 = 叙事 n_open
    rt.jumpToNode('enter') // 跳过叙事，seek 到战斗入口（保留初始全局态）
    expect(rt.state.currentNodeId).toBe('enter')

    rt.onPerformanceEnd() // 进战待机 → 出手判断(折进出边: 速度≥→我方先手, 记 mineFirst=1) → 战斗待机(等技能)
    expect(rt.state.currentNodeId).toBe('wait')
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('skill', 'light') // qi+2 → 变招判定(加权) → 轻攻击演出
    expect(rt.state.vars.qi).toBe(2)

    rt.tick(1000) // 轻攻击命中时机(at:1000ms) → 结算(≥80伤害) → boss 死
    rt.onPerformanceEnd() // 演出结束 → 血量判定(折进出边)→win(演出)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeLessThanOrEqual(0)
    expect(rt.state.currentNodeId).toBe('win')

    const dirs = rt.onPerformanceEnd() // win 演出结束 → 胜利横幅
    expect(rt.state.phase).toBe('ended')
    const banner = dirs.find((d): d is BannerDirective => d.type === 'banner')
    expect(banner?.kind).toBe('victory')
  })

  it('turn loop: 我方先手一整回合(我方攻击→敌方回合)存活 → 回到进战待机(enter) (回合循环成立)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // → 战斗待机(等技能)，mineFirst=1
    expect(rt.state.currentNodeId).toBe('wait')

    rt.submitInteraction('skill', 'light') // qi+2 → 轻攻击演出
    rt.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    rt.onPerformanceEnd() // 血量判定(折进出边: 我方先手→敌方回合) → tele(防反QTE)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeGreaterThan(0)
    expect(rt.state.currentNodeId).toBe('tele')
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('parry', 'pass') // → 受击防反演出 block
    expect(rt.state.currentNodeId).toBe('block')

    rt.onPerformanceEnd() // block 结算(boss-96) → 回合结束判定(折进出边: 双方存活+我方先手→回合结束) → 回进战待机
    expect(rt.state.visited.has('block')).toBe(true)
    expect(rt.state.currentNodeId).toBe('enter') // 回到进战待机 = 一整回合走完、回合循环成立
  })

  it('initiative: slower player yields enemy-first (直接进敌方回合 tele)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    scn.entities!['ent-player'] = {
      ...(scn.entities!['ent-player'] as object),
      attrs: { attack: 80, defense: 40, speed: 10, hp: 300 },
    } as never
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // enter → 出手判断(player 10 < boss 25 → else, mineFirst=0) → tele(敌方先手)
    expect(rt.state.currentNodeId).toBe('tele')
  })
})
