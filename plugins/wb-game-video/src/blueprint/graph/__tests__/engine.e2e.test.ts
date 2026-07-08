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

    rt.onPerformanceEnd() // enter → init(先手) → a_my(subFlow) → wait(等技能)
    expect(rt.state.currentNodeId).toBe('wait')
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('skill', 'light') // qi+2 → 变招判定 → 轻攻击演出
    expect(rt.state.vars.qi).toBe(2)

    rt.onPerformanceEnd() // 轻攻击结算(≥80伤害) → boss 死 → my-done→a_my→a_chk→settle→win(演出)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeLessThanOrEqual(0)
    expect(rt.state.currentNodeId).toBe('win')

    const dirs = rt.onPerformanceEnd() // win 演出结束 → 胜利横幅
    expect(rt.state.phase).toBe('ended')
    const banner = dirs.find((d): d is BannerDirective => d.type === 'banner')
    expect(banner?.kind).toBe('victory')
  })

  it('turn loop: survive a round → back to 我方回合(wait) (回合循环成立)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // → wait(等技能)
    expect(rt.state.currentNodeId).toBe('wait')

    rt.submitInteraction('skill', 'light') // qi+2 → 轻攻击演出
    rt.onPerformanceEnd() // 轻攻击结算(boss 掉血, 仍存活) → my-done→a_my→a_chk(boss存活)→a_ai(subFlow)→bt→tele(防反QTE)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeGreaterThan(0)
    expect(rt.state.currentNodeId).toBe('tele')
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('parry', 'pass') // → 受击防反演出 block
    expect(rt.state.currentNodeId).toBe('block')

    rt.onPerformanceEnd() // block 结算(boss-96) → ai-done→a_ai→round(双方存活)→init→a_my→wait
    expect(rt.state.visited.has('block')).toBe(true)
    expect(rt.state.currentNodeId).toBe('wait') // 回到我方回合 = 回合循环成立
  })

  it('initiative: slower player yields enemy-first (敌方回合 tele)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    scn.entities!['ent-player'] = {
      ...(scn.entities!['ent-player'] as object),
      attrs: { attack: 80, defense: 40, speed: 10, hp: 300 },
    } as never
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // enter → init → (player 10 < boss 25 → else) → b_ai(subFlow)→bt→tele
    expect(rt.state.currentNodeId).toBe('tele')
  })
})
