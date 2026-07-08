import type { Branch, Effect, EntityStatEffect, Scenario, Scene, VarEffect } from './types'

export interface CombatRulesDraft {
  playerMaxHp: number
  playerInitialHp: number
  playerAttack: number
  playerDefense: number
  playerCritRate: number
  playerSpeed: number
  bossMaxHp: number
  bossInitialHp: number
  bossAttack: number
  bossDefense: number
  bossCritRate: number
  bossAggression: number
  bossSpeed: number
  qiInitial: number
  qiMax: number
  lightQiGain: number
  heavyQiCost: number
  ultQiRequired: number
  lightDamage: number
  heavyDamage: number
  ultDamage: number
  parryPerfectDamage: number
  parryGoodDamage: number
  parryFailDamageToPlayer: number
  parryGoodQiCost: number
  parryFailQiGain: number
}

export type CombatRulesPatch = Partial<CombatRulesDraft>

const PLAYER_ID = 'ent-player'
const BOSS_ID = 'ent-boss'
const QI_ID = 'qi'
const EXT_KEY = 'combatRules'

interface CombatRulesExt {
  playerAttack?: number
  playerDefense?: number
  playerCritRate?: number
  playerSpeed?: number
  bossAttack?: number
  bossDefense?: number
  bossCritRate?: number
  bossAggression?: number
  bossSpeed?: number
}

export function readCombatRules(scenario: Scenario): CombatRulesDraft {
  const player = scenario.entities?.[PLAYER_ID]
  const boss = scenario.entities?.[BOSS_ID]
  const qi = scenario.variables?.[QI_ID]
  const ext = readCombatRulesExt(scenario)
  const wait = scenario.scenes.wait
  const light = branchById(wait, 'my-s1')
  const heavy = branchById(wait, 'my-s2')
  const ult = branchById(wait, 'my-ult')
  const parryGood = branchById(scenario.scenes.tele, 'ai-qte-good')
  const parryFail = branchById(scenario.scenes.tele, 'ai-qte-fail')

  return {
    playerMaxHp: player?.maxHp ?? 1000,
    playerInitialHp: player?.initialHp ?? player?.maxHp ?? 1000,
    playerAttack: ext.playerAttack ?? 80,
    playerDefense: ext.playerDefense ?? 40,
    playerCritRate: ext.playerCritRate ?? 10,
    playerSpeed: player?.speed ?? ext.playerSpeed ?? 30,
    bossMaxHp: boss?.maxHp ?? 1200,
    bossInitialHp: boss?.initialHp ?? boss?.maxHp ?? 1200,
    bossAttack: ext.bossAttack ?? 75,
    bossDefense: ext.bossDefense ?? 50,
    bossCritRate: ext.bossCritRate ?? 8,
    bossAggression: ext.bossAggression ?? 0.5,
    bossSpeed: boss?.speed ?? ext.bossSpeed ?? 25,
    qiInitial: qi?.initial ?? 0,
    qiMax: qi?.max ?? 5,
    lightQiGain: varEffectValue(light, 'add', 2),
    heavyQiCost: Math.abs(varEffectValue(heavy, 'add', -2)),
    ultQiRequired: ult?.condition?.all.find((c) => c.type === 'var' && c.varId === QI_ID)?.value ?? 5,
    lightDamage: firstDamageToBoss(scenario.scenes.pu, 80),
    heavyDamage: firstDamageToBoss(scenario.scenes.zhong, 144),
    ultDamage: firstDamageToBoss(scenario.scenes.ult, 240),
    parryPerfectDamage: firstDamageToBoss(scenario.scenes.block, 96),
    parryGoodDamage: firstDamageToBoss(scenario.scenes.dodgeP, 64),
    parryFailDamageToPlayer: firstDamageToPlayer(scenario.scenes.hurt, 120),
    parryGoodQiCost: Math.abs(varEffectValue(parryGood, 'add', -1)),
    parryFailQiGain: varEffectValue(parryFail, 'add', 1),
  }
}

export function applyCombatRules(scenario: Scenario, patch: CombatRulesPatch): Scenario {
  const current = readCombatRules(scenario)
  const next: CombatRulesDraft = { ...current, ...patch }
  const entities = { ...(scenario.entities ?? {}) }
  const player = entities[PLAYER_ID]
  if (player) {
    entities[PLAYER_ID] = {
      ...player,
      maxHp: next.playerMaxHp,
      initialHp: patch.playerInitialHp ?? (patch.playerMaxHp != null ? next.playerMaxHp : next.playerInitialHp),
      speed: next.playerSpeed,
    }
  }
  const boss = entities[BOSS_ID]
  if (boss) {
    entities[BOSS_ID] = {
      ...boss,
      maxHp: next.bossMaxHp,
      initialHp: patch.bossInitialHp ?? (patch.bossMaxHp != null ? next.bossMaxHp : next.bossInitialHp),
      speed: next.bossSpeed,
    }
  }

  const variables = { ...(scenario.variables ?? {}) }
  variables[QI_ID] = {
    ...(variables[QI_ID] ?? { id: QI_ID, name: '气力', kind: 'number' as const }),
    initial: next.qiInitial,
    min: 0,
    max: next.qiMax,
  }

  // 出手判断不再靠预排序 init 分支——速度写在实体属性上，运行时由 init 的
  // attrCompare 条件（ent-player.speed ≥ ent-boss.speed）动态判先手。
  const scenes = { ...scenario.scenes }
  scenes.wait = updateSceneBranch(scenes.wait, 'my-s1', {
    effects: qiEffects('add', next.lightQiGain),
  })
  scenes.wait = updateSceneBranch(scenes.wait, 'my-s2', {
    condition: { all: [{ type: 'var', varId: QI_ID, op: 'gte', value: next.heavyQiCost }] },
    gateMode: 'lock',
    effects: qiEffects('add', -next.heavyQiCost),
  })
  // 冥想（my-s3）不再由规则读写——气力+2 与回血+30 都挂在 fuzhu 的「回气回血结算」
  // cue 上，到 atMs 才结算；SSOT 落在演出时间轴，在 cue 面板编辑。
  scenes.wait = updateSceneBranch(scenes.wait, 'my-ult', {
    condition: { all: [{ type: 'var', varId: QI_ID, op: 'gte', value: next.ultQiRequired }] },
    gateMode: 'lock',
    effects: qiEffects('set', 0),
  })

  scenes.pu = updateFirstCueDamage(scenes.pu, BOSS_ID, next.lightDamage)
  scenes.zhong = updateFirstCueDamage(scenes.zhong, BOSS_ID, next.heavyDamage)
  scenes.ult = updateFirstCueDamage(scenes.ult, BOSS_ID, next.ultDamage)
  scenes.block = updateFirstCueDamage(scenes.block, BOSS_ID, next.parryPerfectDamage)
  scenes.dodgeP = updateFirstCueDamage(scenes.dodgeP, BOSS_ID, next.parryGoodDamage)
  scenes.hurt = updateFirstCueDamage(scenes.hurt, PLAYER_ID, next.parryFailDamageToPlayer)
  scenes.tele = updateSceneBranch(scenes.tele, 'ai-qte-good', {
    effects: qiEffects('add', -next.parryGoodQiCost),
  })
  scenes.tele = updateSceneBranch(scenes.tele, 'ai-qte-fail', {
    effects: qiEffects('add', next.parryFailQiGain),
  })

  return {
    ...scenario,
    entities,
    variables,
    scenes,
    ext: {
      ...(scenario.ext ?? {}),
      // 注意：speed 的 SSOT 是实体属性（entities[*].speed），不再写进 ext，避免双源。
      [EXT_KEY]: {
        playerAttack: next.playerAttack,
        playerDefense: next.playerDefense,
        playerCritRate: next.playerCritRate,
        bossAttack: next.bossAttack,
        bossDefense: next.bossDefense,
        bossCritRate: next.bossCritRate,
        bossAggression: next.bossAggression,
      } satisfies CombatRulesExt,
    },
  }
}

function readCombatRulesExt(scenario: Scenario): CombatRulesExt {
  const raw = scenario.ext?.[EXT_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as CombatRulesExt) : {}
}

function branchById(scene: Scene | undefined, id: string): Branch | undefined {
  return scene?.branches.find((b) => b.id === id)
}

function varEffectValue(branch: Branch | undefined, op: VarEffect['op'], fallback: number): number {
  return branch?.effects?.find((e): e is VarEffect => e.kind === 'var' && e.varId === QI_ID && e.op === op)?.value ?? fallback
}

function firstDamageToBoss(scene: Scene | undefined, fallback: number): number {
  return firstHpDamage(scene, BOSS_ID, fallback)
}

function firstDamageToPlayer(scene: Scene | undefined, fallback: number): number {
  return firstHpDamage(scene, PLAYER_ID, fallback)
}

function qiEffects(op: VarEffect['op'], value: number): VarEffect[] {
  return [{ id: `qi-${op}-${Math.abs(value)}`, kind: 'var', varId: QI_ID, op, value }]
}

function firstHpDamage(scene: Scene | undefined, entityId: string, fallback: number): number {
  const effect = scene?.performance?.cues
    .flatMap((cue) => cue.effects)
    .find((e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp' && e.entityId === entityId && e.value < 0)
  return effect ? Math.abs(effect.value) : fallback
}

function updateSceneBranch(scene: Scene | undefined, branchId: string, patch: Partial<Branch>): Scene {
  if (!scene) throw new Error(`missing scene for branch ${branchId}`)
  return {
    ...scene,
    branches: scene.branches.map((b) => (b.id === branchId ? { ...b, ...patch } : b)),
  }
}

function updateFirstCueDamage(scene: Scene | undefined, entityId: string, damage: number): Scene {
  if (!scene) throw new Error('missing scene for cue update')
  const cues = scene.performance?.cues ?? []
  const [first, ...rest] = cues.length > 0 ? cues : [{ id: `${scene.id}-rule`, atMs: 1000, effects: [] }]
  const nextEffect: EntityStatEffect = {
    id: `${first.id}-${entityId}-hp`,
    kind: 'entityStat',
    entityId,
    stat: 'hp',
    op: 'add',
    value: -Math.abs(damage),
  }
  const effects: Effect[] = first.effects.some((e) => e.kind === 'entityStat' && e.stat === 'hp' && e.entityId === entityId)
    ? first.effects.map((e) => (e.kind === 'entityStat' && e.stat === 'hp' && e.entityId === entityId ? nextEffect : e))
    : [nextEffect, ...first.effects]
  return {
    ...scene,
    performance: {
      cues: [{ ...first, effects }, ...rest],
    },
  }
}
