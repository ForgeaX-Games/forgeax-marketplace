import { beforeAll, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerCoreKinds } from '../registry/core-kinds'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { validateScenario } from '../validate/validate'
import type { BannerDirective } from '../engine/directives'
import { getSubFlow } from '../schema/graph-schema'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

beforeAll(() => registerCoreKinds())

describe('nodia graph e2e (runs on GraphRuntime)', () => {
  it('authored graph passes the validator', () => {
    const scn = makeNodiaDemo()
    const issues = validateScenario(scn)
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('combat turn containers are subflows (我方回合/敌方回合)', () => {
    const scn = makeNodiaDemo()
    const aMy = scn.graph.nodes.find((n) => n.id === 'a_my')
    const bAi = scn.graph.nodes.find((n) => n.id === 'b_ai')
    expect(getSubFlow(aMy!.data)).toBe('wait')
    expect(getSubFlow(bAi!.data)).toBe('tele')
  })

  it('quick win: light skill kills a low-hp boss → victory banner', () => {
    const scn = makeNodiaDemo({ bossHp: 60 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start() // 起点 = 叙事 n_open
    rt.jumpToNode('enter') // 跳过叙事，seek 到战斗入口（保留初始全局态）
    expect(rt.state.currentNodeId).toBe('enter')

    rt.onPerformanceEnd() // enter → a_my(subflow) → wait(等技能)，mineFirst=1
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('ov-wait/skill', 'light') // qi+2 → 变招判定(加权) → 轻攻击演出
    expect(rt.state.vars.qi).toBe(2)

    rt.tick(1000) // 轻攻击命中 → 结算致死 → scenario.reactions 安全点 redirect → win
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeLessThanOrEqual(0)
    expect(rt.state.currentNodeId).toBe('win')

    const dirs = rt.onPerformanceEnd() // win 演出结束 → 胜利横幅
    expect(rt.state.phase).toBe('ended')
    const banner = dirs.find((d): d is BannerDirective => d.type === 'banner')
    expect(banner?.kind).toBe('ending')
  })

  it('scenario.reactions provide win/lose fallback', () => {
    const scn = makeNodiaDemo()
    const gotos = scn.reactions
      ?.flatMap((r) => r.do)
      .filter((a): a is { kind: 'goto'; targetNodeId: string } => a.kind === 'goto')
      .map((a) => a.targetNodeId)
      .sort()
    expect(gotos).toEqual(['lose', 'win'])
  })

  it('turn loop: 我方先手一整回合(我方攻击→敌方回合)存活 → 回到进战待机(enter) (回合循环成立)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // → a_my → wait，mineFirst=1
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])

    rt.submitInteraction('ov-wait/skill', 'light') // qi+2 → 轻攻击演出
    rt.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    rt.onPerformanceEnd() // returns → a_my → b_ai(subflow) → tele(防反QTE)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeGreaterThan(0)
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['b_ai'])
    expect(rt.state.phase).toBe('awaitInteraction')

    rt.submitInteraction('ov-tele/parry', 'pass') // → 受击防反演出 block
    expect(rt.state.currentNodeId).toBe('block')

    rt.onPerformanceEnd() // returns → b_ai 回合结束判定(双方存活+我方先手) → enter
    expect(rt.state.visited.has('block')).toBe(true)
    expect(rt.state.visited.has('a_my')).toBe(true)
    expect(rt.state.visited.has('b_ai')).toBe(true)
    expect(rt.state.currentNodeId).toBe('enter') // 回到进战待机 = 一整回合走完、回合循环成立
    expect(rt.state.callStack).toEqual([])
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
    rt.onPerformanceEnd() // enter → b_ai(subflow) → tele，mineFirst=0
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['b_ai'])
  })
})
