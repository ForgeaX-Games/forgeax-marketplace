import { beforeAll, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerCoreSkins } from '../skins/components'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { validateScenario } from '../validate/validate'
import type { RenderOverlayDirective } from '../engine/directives'
import { isRenderOverlay } from '../engine/directives'
import { getSubFlow } from '../schema/graph-schema'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

// registerCoreSkins 一并注册组件包自带 Component（panelA/panelB/bossHitCheer），供校验/派发识别。
beforeAll(() => { registerCoreSkins() })

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

  it('quick win: light skill kills a low-hp boss → flow ends (no forced banner)', () => {
    const scn = makeNodiaDemo({ bossHp: 60 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start() // 起点 = 叙事 n_open
    rt.jumpToNode('enter') // 跳过叙事，seek 到战斗入口（保留初始全局态）
    expect(rt.state.currentNodeId).toBe('enter')

    rt.onPerformanceEnd() // enter → a_my(subflow) → wait(等技能)，mineFirst=1
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])
    expect(rt.state.phase).toBe('playing')

    rt.emitComponentEvent('wait/skill', 'light') // qi+2 → 变招判定(加权) → 轻攻击演出
    expect(rt.state.vars.qi).toBe(2)

    rt.tick(1000) // 轻攻击命中 → 结算致死（无局级 reactions；回合容器出边条件判胜）
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeLessThanOrEqual(0)
    rt.onPerformanceEnd() // 技能结束弹回 a_my → e-amy-win（boss hp≤0）
    expect(rt.state.currentNodeId).toBe('win')

    rt.onPerformanceEnd() // win 演出结束 → 无出边 & 栈空 → 本局结束
    expect(rt.state.phase).toBe('ended')
  })

  it('turn loop: 我方先手一整回合(我方攻击→敌方回合)存活 → 回到进战待机(enter) (回合循环成立)', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // → a_my → wait，mineFirst=1
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])

    rt.emitComponentEvent('wait/skill', 'light') // qi+2 → 轻攻击演出
    rt.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    rt.onPerformanceEnd() // returns → a_my → b_ai(subflow) → tele(防反QTE)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeGreaterThan(0)
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['b_ai'])
    expect(rt.state.phase).toBe('playing')

    rt.emitComponentEvent('tele/parry', 'pass') // → 受击防反演出 block
    expect(rt.state.currentNodeId).toBe('block')

    rt.onPerformanceEnd() // returns → b_ai 回合结束判定(双方存活+我方先手) → enter
    expect(rt.state.visited.has('block')).toBe(true)
    expect(rt.state.visited.has('a_my')).toBe(true)
    expect(rt.state.visited.has('b_ai')).toBe(true)
    expect(rt.state.currentNodeId).toBe('enter') // 回到进战待机 = 一整回合走完、回合循环成立
    expect(rt.state.callStack).toEqual([])
  })

  it('我方回合技能命中 boss 掉血 → 弹 bossHitCheer 加油横幅（demo 容器 watch 生效）', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.jumpToNode('enter')
    rt.onPerformanceEnd() // enter → a_my(subflow) → wait
    expect(rt.state.currentNodeId).toBe('wait')

    rt.emitComponentEvent('wait/skill', 'light') // → 轻攻击演出（a_my 在调用栈）
    expect(callers(rt)).toEqual(['a_my'])

    const dirs = rt.tick(1000) // 命中扣 boss 血 → a_my 容器 watch → spawn 横幅
    const spawn = dirs.find((d): d is RenderOverlayDirective => isRenderOverlay(d) && d.component === 'bossHitCheer')
    expect(spawn).toBeTruthy()
    expect(spawn!.inputs.dmg as number).toBeGreaterThan(0)
    expect(spawn!.inputs.heroName).toBe('空藏')
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
