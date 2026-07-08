import { describe, expect, it } from 'vitest'
import { scenarioToBlueprint } from '../../blueprint/scenarioToBlueprint'
import { BlueprintRuntime } from '../../blueprint/runtime/engine'
import { getDemoScenario } from '../demoScenario'
import { applyCombatRules, readCombatRules } from '../combatRules'

describe('combatRules', () => {
  it('reads structured combat values from the standalone demo scenario', () => {
    const rules = readCombatRules(getDemoScenario())
    expect(rules.bossMaxHp).toBe(700)
    expect(rules.playerMaxHp).toBe(300)
    expect(rules.playerAttack).toBe(80)
    expect(rules.bossAggression).toBe(0.5)
    expect(rules.qiMax).toBe(5)
    expect(rules.ultQiRequired).toBe(5)
    expect(rules.ultDamage).toBe(240)
  })

  it('updates entity hp so BlueprintRuntime uses edited values', () => {
    const scenario = applyCombatRules(getDemoScenario(), { bossMaxHp: 100 })
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)

    rt.start()

    expect(rt.state.entities['ent-boss']?.maxHp).toBe(100)
    expect(rt.state.entities['ent-boss']?.hp).toBe(100)
  })

  it('stores editable actor attributes and drives initiative via runtime speed compare', () => {
    const scenario = applyCombatRules(getDemoScenario(), {
      playerAttack: 88,
      playerDefense: 44,
      playerCritRate: 12,
      playerSpeed: 10,
      bossAttack: 99,
      bossDefense: 55,
      bossCritRate: 9,
      bossAggression: 0.8,
      bossSpeed: 30,
    })
    const rules = readCombatRules(scenario)

    expect(rules.playerAttack).toBe(88)
    expect(rules.bossAggression).toBe(0.8)
    // 速度写在实体属性（SSOT），不再预排序 init 分支；分支顺序保持静态。
    expect(scenario.entities?.['ent-player']?.speed).toBe(10)
    expect(scenario.entities?.['ent-boss']?.speed).toBe(30)
    expect(scenario.scenes.init?.branches.map((b) => b.targetSceneId)).toEqual(['a_my', 'b_ai'])

    // 运行时按 attrCompare 动态判先手：我方更慢(10<30) → 敌方先手，先进 b_ai。
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()
    rt.onClipEnded()
    expect(rt.state.visited.has('b_ai')).toBe(true)
    expect(rt.state.visited.has('a_my')).toBe(false)
  })

  it('routes initiative to the player when player speed is not slower', () => {
    // demo 默认 player 30 ≥ boss 25 → 我方先手，先进 a_my。
    const scenario = getDemoScenario()
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()
    rt.onClipEnded()
    expect(rt.state.visited.has('a_my')).toBe(true)
    expect(rt.state.visited.has('b_ai')).toBe(false)
  })

  it('re-evaluates initiative when speed changes at runtime via entityStat effect', () => {
    const scenario = getDemoScenario()
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()
    // 运行时给敌方加速，超过我方（25+10 > 30）：此后出手判断应改判敌方先手。
    rt.applyDamagePoint({
      t: 0,
      x: 0,
      y: 0,
      note: 'buff speed',
      effects: [{ id: 'buff-spd', kind: 'entityStat', entityId: 'ent-boss', stat: 'speed', op: 'add', value: 10 }],
    })
    rt.onClipEnded()
    expect(rt.state.entities['ent-boss']?.speed).toBe(35)
    expect(rt.state.visited.has('b_ai')).toBe(true)
    expect(rt.state.visited.has('a_my')).toBe(false)
  })

  it('meditate gains (qi + heal) both settle on the fuzhu-heal cue', () => {
    const scenario = getDemoScenario()
    const fuzhu = scenario.scenes.fuzhu
    // 气力+2 与回血+30 挂在演出时间轴的「回气回血结算」cue 上，到 atMs 才结算。
    const cue = fuzhu?.performance?.cues.find((c) => c.id === 'fuzhu-heal')
    expect(cue?.atMs).toBe(2000)
    const qi = cue?.effects.find((e) => e.kind === 'var' && e.varId === 'qi')
    expect(qi).toMatchObject({ kind: 'var', op: 'add', value: 2 })
    const heal = cue?.effects.find(
      (e) => e.kind === 'entityStat' && e.entityId === 'ent-player' && e.stat === 'hp',
    )
    expect(heal).toMatchObject({ kind: 'entityStat', op: 'add', value: 30 })
    // onEnterEffects 不再承载冥想收益。
    expect(fuzhu?.onEnterEffects ?? []).toHaveLength(0)
    // 冥想分支只负责跳转，不带气力效果。
    const branch = scenario.scenes.wait?.branches.find((b) => b.id === 'my-s3')
    expect(branch?.effects ?? []).toHaveLength(0)
  })

  it('applyCombatRules leaves the meditate cue gains intact', () => {
    // 冥想脱离规则读写：applyCombatRules 后 fuzhu-heal cue 的 qi/heal 不被覆盖或清除。
    const scenario = applyCombatRules(getDemoScenario(), { qiMax: 7 })
    const cue = scenario.scenes.fuzhu?.performance?.cues.find((c) => c.id === 'fuzhu-heal')
    const gains = cue?.effects ?? []
    expect(gains.find((e) => e.kind === 'var' && e.varId === 'qi')).toMatchObject({ value: 2 })
    expect(gains.find((e) => e.kind === 'entityStat' && e.stat === 'hp')).toMatchObject({ value: 30 })
    expect(scenario.scenes.wait?.branches.find((b) => b.id === 'my-s3')?.effects ?? []).toHaveLength(0)
  })

  it('updates qi thresholds and skill damage in scenario data', () => {
    const scenario = applyCombatRules(getDemoScenario(), {
      qiMax: 7,
      qiInitial: 1,
      heavyQiCost: 3,
      ultQiRequired: 7,
      ultDamage: 999,
    })
    const wait = scenario.scenes.wait!
    const heavy = wait.branches.find((b) => b.id === 'my-s2')!
    const ult = wait.branches.find((b) => b.id === 'my-ult')!

    expect(scenario.variables?.qi?.max).toBe(7)
    expect(scenario.variables?.qi?.initial).toBe(1)
    expect(heavy.condition?.all).toEqual([{ type: 'var', varId: 'qi', op: 'gte', value: 3 }])
    expect(heavy.effects).toEqual([{ id: 'qi-add-3', kind: 'var', varId: 'qi', op: 'add', value: -3 }])
    expect(ult.condition?.all).toEqual([{ type: 'var', varId: 'qi', op: 'gte', value: 7 }])
    expect(scenario.scenes.ult?.performance?.cues[0]?.effects[0]).toMatchObject({
      kind: 'entityStat',
      entityId: 'ent-boss',
      stat: 'hp',
      value: -999,
    })
  })
})
