/**
 * 玩法实体运行时状态 —— 从 Scenario.entities 派生玩家会话态(血量等)。
 *
 * M2(本轮)只用到 initEntities + 派生读取(HUD 只读展示，实体满血)。
 * applyDamage / setStatus 等纯函数先备好，M5(Boss 回合结算)直接复用，
 * 避免到时再回头改 HUD 的数据形状。
 */

import type { Scenario, EntitySpec, EntityKind } from '../scenario/types'

export interface EntityRuntime {
  id: string
  name: string
  kind: EntityKind
  hp: number
  maxHp: number
  portraitMediaId?: string
  /** 当前生效的状态效果 id 列表(指向 Scenario.statuses)。 */
  statusIds: string[]
}

export type EntitiesState = Record<string, EntityRuntime>

/** 从 Scenario.entities 建立初始运行时状态(hp = initialHp ?? maxHp)。 */
export function initEntities(scenario: Scenario | null | undefined): EntitiesState {
  const out: EntitiesState = {}
  const defs = scenario?.entities ?? {}
  for (const [id, spec] of Object.entries(defs)) {
    out[id] = entityFromSpec(id, spec)
  }
  return out
}

function entityFromSpec(id: string, spec: EntitySpec): EntityRuntime {
  const maxHp = Math.max(0, spec.maxHp)
  const initial = spec.initialHp == null ? maxHp : spec.initialHp
  return {
    id,
    name: spec.name,
    kind: spec.kind,
    maxHp,
    hp: clamp(initial, 0, maxHp),
    portraitMediaId: spec.portraitMediaId,
    statusIds: [],
  }
}

/** 血量比例 0~1(maxHp=0 视为 0)。 */
export function hpRatio(e: EntityRuntime | undefined): number {
  if (!e || e.maxHp <= 0) return 0
  return clamp(e.hp / e.maxHp, 0, 1)
}

/** 取第一个玩家实体(HUD 主血条)。 */
export function findPlayer(state: EntitiesState): EntityRuntime | undefined {
  return Object.values(state).find((e) => e.kind === 'player')
}

/** 取第一个 Boss 实体(HUD 顶部 Boss 条)。 */
export function findBoss(state: EntitiesState): EntityRuntime | undefined {
  return Object.values(state).find((e) => e.kind === 'boss')
}

/** 纯函数:对某实体扣血/加血，返回新 state(M5 回合结算用)。 */
export function applyDamage(
  state: EntitiesState,
  entityId: string,
  amount: number,
): EntitiesState {
  const e = state[entityId]
  if (!e) return state
  const hp = clamp(e.hp - amount, 0, e.maxHp)
  if (hp === e.hp) return state
  return { ...state, [entityId]: { ...e, hp } }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
