/**
 * Boss 回合战 · 纯结算核心(v9 玩法系统 M5) —— 离 React/DOM 完全独立。
 *
 * 两级状态机的「内层」之一：scene.kind='battle' 时，Player 把控制权交给
 * BossBattleOverlay，后者逐回合调用这里的纯函数推进战斗：
 *   - 每回合玩家「命中 / 失手」→ 折算成对 Boss / 玩家的伤害
 *   - 任一方 HP 清零即定胜负；回合耗尽且玩家存活 = 险胜
 *   - 全程命中 + 玩家零伤 = 完美通关(perfect)，用于解锁隐藏结局
 *
 * 不读时钟、不持有可变状态：所有推进都是 (state, input) → newState，
 * 可在 vitest 完全确定性验证。HUD 血量另由 entities.ts 的 applyDamage 维护，
 * 二者以「同一份伤害数」驱动，不产生第二套真相。
 */

import type { BossRound } from '../../scenario/types'

export interface BattleState {
  /** 当前回合下标(0-based)。 */
  roundIndex: number
  bossHp: number
  playerHp: number
  /** 截至目前是否「全回合命中」(完美追踪)。 */
  allHit: boolean
  /** 截至目前玩家是否「零伤」(完美追踪)。 */
  playerUnhurt: boolean
  /** 战斗是否结束。 */
  done: boolean
  /** 结束时的结果;进行中为 null。 */
  outcome: BattleOutcome
}

export type BattleOutcome = 'win' | 'lose' | null

export function initBattle(bossHp: number, playerHp: number): BattleState {
  return {
    roundIndex: 0,
    bossHp: Math.max(0, bossHp),
    playerHp: Math.max(0, playerHp),
    allHit: true,
    playerUnhurt: true,
    done: false,
    outcome: null,
  }
}

/** 一回合按命中/失手折算的双方伤害。命中只伤 Boss，失手只伤玩家。 */
export function roundDamage(
  round: BossRound,
  hit: boolean,
): { toBoss: number; toPlayer: number } {
  const effects = hit ? round.hitEffects : round.missEffects
  const damage = (effects ?? [])
    .filter((effect) => effect.kind === 'entityStat' && effect.stat === 'hp' && effect.value < 0)
    .reduce((sum, effect) => sum + Math.abs(effect.value), 0)
  return hit ? { toBoss: damage, toPlayer: 0 } : { toBoss: 0, toPlayer: damage }
}

/**
 * 推进一回合 —— 应用伤害、推进回合下标、若分出胜负则定 outcome。
 * 已结束的 state 原样返回(幂等)。
 *
 * @param totalRounds 全部回合数;用于「回合耗尽 = 险胜」判定。
 */
export function advanceRound(
  state: BattleState,
  round: BossRound,
  hit: boolean,
  totalRounds: number,
): BattleState {
  if (state.done) return state
  const { toBoss, toPlayer } = roundDamage(round, hit)
  const bossHp = Math.max(0, state.bossHp - toBoss)
  const playerHp = Math.max(0, state.playerHp - toPlayer)
  const allHit = state.allHit && hit
  const playerUnhurt = state.playerUnhurt && toPlayer === 0
  const roundIndex = state.roundIndex + 1
  const outcome = battleOutcome(bossHp, playerHp, roundIndex, totalRounds)
  return {
    roundIndex,
    bossHp,
    playerHp,
    allHit,
    playerUnhurt,
    done: outcome !== null,
    outcome,
  }
}

/**
 * 战斗结果判定:
 *   - 玩家 HP 清零 → 'lose'(优先,玩家先死即败)
 *   - Boss HP 清零 → 'win'
 *   - 回合耗尽且双方存活 → 'win'(玩家挺过全部回合 = 险胜)
 *   - 否则进行中 → null
 */
export function battleOutcome(
  bossHp: number,
  playerHp: number,
  roundIndex: number,
  totalRounds: number,
): BattleOutcome {
  if (playerHp <= 0) return 'lose'
  if (bossHp <= 0) return 'win'
  if (roundIndex >= totalRounds) return 'win'
  return null
}

/** 是否完美通关:胜利 + 全回合命中 + 玩家零伤。用于解锁隐藏结局 flag。 */
export function isPerfect(state: BattleState): boolean {
  return state.outcome === 'win' && state.allHit && state.playerUnhurt
}
