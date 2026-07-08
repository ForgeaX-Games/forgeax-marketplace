import { describe, expect, test } from 'vitest'
import { scenarioToBlueprint } from '../scenarioToBlueprint'
import { BlueprintRuntime, type RuntimeState } from '../runtime/engine'
import type { RuntimeDirective } from '../runtime/directives'
import { makeDemoScenario, makeSubflowScenario } from './fixtures'

function makeRuntime(): BlueprintRuntime {
  return new BlueprintRuntime(scenarioToBlueprint(makeDemoScenario()), makeDemoScenario())
}

function find<T extends RuntimeDirective['type']>(
  directives: RuntimeDirective[],
  type: T,
): Extract<RuntimeDirective, { type: T }> | undefined {
  return directives.find((d): d is Extract<RuntimeDirective, { type: T }> => d.type === type)
}

describe('BlueprintRuntime — 状态机走法', () => {
  test('start plays the root clip with Loop + 转场 and is render-agnostic', () => {
    const rt = makeRuntime()
    const out = rt.start()
    const play = find(out, 'playClip')
    expect(play?.nodeId).toBe('start')
    expect(play?.loop).toBe(true)
    expect(play?.transition?.kind).toBe('crossfade')
    expect(rt.state.phase).toBe('playing')
  })

  test('auto edge advances to the choice node on clip end', () => {
    const rt = makeRuntime()
    rt.start()
    const out = rt.onClipEnded()
    const choice = find(out, 'openChoice')
    expect(choice?.nodeId).toBe('choose')
    expect(choice?.options?.map((o) => o.key)).toEqual(['opt-qte', 'opt-rush'])
    expect(rt.state.phase).toBe('awaitChoice')
  })

  test('full happy path: choose QTE → pass → boss → win → ended', () => {
    const rt = makeRuntime()
    rt.start()
    rt.onClipEnded()
    let out = rt.chooseOption('opt-qte')
    expect(find(out, 'openQte')?.nodeId).toBe('qte')
    expect(rt.state.phase).toBe('awaitQte')

    out = rt.submitQte(2)
    expect(find(out, 'openBossRound')?.roundIndex).toBe(0)
    expect(rt.state.phase).toBe('awaitBoss')

    rt.submitBossRound(true) // foe 150 -> 50
    out = rt.submitBossRound(true) // foe -> 0 → win → goodEnd (end)
    expect(rt.state.entities.foe?.hp).toBe(0)
    expect(rt.state.phase).toBe('ended')
    expect(rt.state.visited.has('goodEnd')).toBe(true)
    expect(find(out, 'banner')?.kind).toBe('ending')
  })

  test('QTE fail routes to the bad ending', () => {
    const rt = makeRuntime()
    rt.start()
    rt.onClipEnded()
    rt.chooseOption('opt-qte')
    const out = rt.submitQte(0)
    expect(rt.state.visited.has('badEnd')).toBe(true)
    expect(rt.state.phase).toBe('ended')
    expect(find(out, 'banner')).toBeTruthy()
  })

  test('choice applies edge effects (勇气+1) and reaches boss directly', () => {
    const rt = makeRuntime()
    rt.start()
    rt.onClipEnded()
    const out = rt.chooseOption('opt-rush')
    expect(rt.state.vars.brave).toBe(1)
    expect(find(out, 'openBossRound')).toBeTruthy()
    expect(rt.state.phase).toBe('awaitBoss')
  })

  test('choice refuses unavailable edge even if called directly', () => {
    const scenario = makeDemoScenario()
    const rush = scenario.scenes.choose?.branches.find((b) => b.id === 'opt-rush')
    if (!rush) throw new Error('missing opt-rush fixture branch')
    rush.condition = { all: [{ type: 'var', varId: 'brave', op: 'gte', value: 99 }] }
    rush.gateMode = 'lock'
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)

    rt.start()
    rt.onClipEnded()
    const out = rt.chooseOption('opt-rush')

    expect(out).toEqual([])
    expect(rt.state.phase).toBe('awaitChoice')
    expect(rt.state.currentNodeId).toBe('choose')
    expect(rt.state.visited.has('boss')).toBe(false)
  })

  test('boss defeat (player HP 0) routes to lose target', () => {
    const scenario = makeDemoScenario()
    // 把玩家血量调到一回合即死，验证失败分支。
    scenario.entities!.hero!.maxHp = 50
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()
    rt.onClipEnded()
    rt.chooseOption('opt-rush')
    rt.submitBossRound(false) // hero 50 -> -? (60 dmg) → 0 → lose → badEnd
    const state: RuntimeState = rt.state
    expect(state.entities.hero?.hp).toBe(0)
    expect(state.visited.has('badEnd')).toBe(true)
    expect(state.phase).toBe('ended')
  })

  test('auto-enters a subflow and resumes the parent outgoing edge when the child graph ends', () => {
    const scenario = makeSubflowScenario()
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)

    let out = rt.start()
    expect(find(out, 'playClip')?.nodeId).toBe('start')

    out = rt.onClipEnded()
    expect(find(out, 'playClip')?.nodeId).toBe('innerStart')
    expect(rt.state.currentNodeId).toBe('innerStart')

    out = rt.onClipEnded()
    expect(find(out, 'playClip')?.nodeId).toBe('innerEnd')

    out = rt.onClipEnded()
    expect(find(out, 'playClip')?.nodeId).toBe('after')
    expect(rt.state.currentNodeId).toBe('after')
    expect(find(out, 'banner')?.nodeId).toBe('after')
    expect(rt.state.phase).toBe('ended')
  })
})
