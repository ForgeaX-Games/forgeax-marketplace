import { beforeAll, describe, expect, it } from 'vitest'
import { GraphRuntime } from '../engine/engine'
import { registerCoreSkins } from '../component-host/components'
import { makeNodiaDemo } from '../../editor/demo/demo'
import { validateScenario } from '../validate/validate'
import { getSubProcess } from '../schema/graph-schema'

const callers = (rt: GraphRuntime) => rt.state.callStack.map((f) => f.callerNodeId)

// registerCoreSkins 一并注册组件包自带 Component，供校验/派发识别。
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
    expect(getSubProcess(aMy!.data)?.entry).toBe('wait')
    expect(getSubProcess(bAi!.data)?.entry).toBe('tele')
  })

  it('quick win: light skill kills a low-hp boss → flow ends (no forced banner)', () => {
    // fx-dmg 公式（防御减免 + rand()*0.3 随机浮动，参见 nodia.graph.json）保证轻攻击伤害
    // 下限 ≈45（80 攻 / 50 防），30 留足安全余量确保任意随机数下都能一击必杀。
    const scn = makeNodiaDemo({ bossHp: 30 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start() // 起点 = 叙事 n_open
    rt.jumpToNode('a_my') // 跳过叙事，seek 到我方回合容器（保留初始全局态）
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

  it('turn loop: 我方攻击→敌方回合后回到我方待机（回合循环成立）', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)

    rt.start()
    rt.jumpToNode('a_my') // → wait
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])

    rt.emitComponentEvent('wait/skill', 'light') // qi+2 → 轻攻击演出
    rt.tick(1000) // 命中时机(at:1000ms) → 结算(boss 掉 80, 仍存活)
    rt.onPerformanceEnd() // returns → a_my → b_ai(subflow) → tele(防反QTE)
    expect(rt.state.entities['ent-boss']!.attrs.hp).toBeGreaterThan(0)
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['b_ai'])
    expect(rt.state.phase).toBe('playing')

    rt.emitComponentEvent('tele/parry', 'parry') // → 受击防反演出 block
    expect(rt.state.currentNodeId).toBe('block')

    rt.onPerformanceEnd() // returns → b_ai → a_my → wait
    expect(rt.state.visited.has('block')).toBe(true)
    expect(rt.state.visited.has('a_my')).toBe(true)
    expect(rt.state.visited.has('b_ai')).toBe(true)
    expect(rt.state.currentNodeId).toBe('wait')
    expect(callers(rt)).toEqual(['a_my'])
  })

  it('can seek directly into the enemy turn container', () => {
    const scn = makeNodiaDemo({ bossHp: 700 })
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.jumpToNode('b_ai')
    expect(rt.state.currentNodeId).toBe('tele')
    expect(callers(rt)).toEqual(['b_ai'])
  })
})
