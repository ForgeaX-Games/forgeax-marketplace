import { describe, expect, it } from 'vitest'
import {
  advanceRound,
  battleOutcome,
  initBattle,
  isPerfect,
  roundDamage,
} from '../bossRuntime'
import type { BossRound } from '../../../scenario/types'

const hp = (id: string, value: number) => ({
  id,
  kind: 'entityStat' as const,
  entityId: id.includes('player') ? 'player' : 'boss',
  stat: 'hp' as const,
  op: 'add' as const,
  value: -value,
})

const round = (over: Partial<BossRound> = {}): BossRound => ({
  id: 'r',
  hitEffects: [hp('boss-hit', 30)],
  missEffects: [hp('player-miss', 20)],
  ...over,
})

describe('roundDamage', () => {
  it('命中只伤 Boss', () => {
    expect(roundDamage(round(), true)).toEqual({ toBoss: 30, toPlayer: 0 })
  })
  it('失手只伤玩家', () => {
    expect(roundDamage(round(), false)).toEqual({ toBoss: 0, toPlayer: 20 })
  })
  it('缺省伤害视为 0', () => {
    expect(roundDamage(round({ hitEffects: undefined }), true)).toEqual({
      toBoss: 0,
      toPlayer: 0,
    })
  })
})

describe('battleOutcome', () => {
  it('玩家 HP 清零 → lose（优先于 Boss 死）', () => {
    expect(battleOutcome(0, 0, 1, 3)).toBe('lose')
  })
  it('Boss HP 清零且玩家存活 → win', () => {
    expect(battleOutcome(0, 50, 1, 3)).toBe('win')
  })
  it('回合耗尽双方存活 → win（险胜）', () => {
    expect(battleOutcome(20, 50, 3, 3)).toBe('win')
  })
  it('进行中 → null', () => {
    expect(battleOutcome(20, 50, 1, 3)).toBeNull()
  })
})

describe('advanceRound + isPerfect', () => {
  it('全回合命中、玩家零伤、Boss 清零 → win + perfect', () => {
    let s = initBattle(60, 100)
    const rounds = [round(), round()]
    s = advanceRound(s, rounds[0]!, true, rounds.length)
    expect(s.done).toBe(false)
    s = advanceRound(s, rounds[1]!, true, rounds.length)
    expect(s.outcome).toBe('win')
    expect(s.bossHp).toBe(0)
    expect(isPerfect(s)).toBe(true)
  })

  it('中途失手扣玩家血 → 不再 perfect', () => {
    let s = initBattle(100, 50)
    const rounds = [round(), round({ hitEffects: [hp('boss-finish', 100)] })]
    s = advanceRound(s, rounds[0]!, false, rounds.length) // 失手：玩家 -20
    expect(s.playerHp).toBe(30)
    s = advanceRound(s, rounds[1]!, true, rounds.length) // 命中：Boss -100 → 死
    expect(s.outcome).toBe('win')
    expect(isPerfect(s)).toBe(false)
  })

  it('玩家被打死 → lose', () => {
    let s = initBattle(100, 30)
    const r = round({ missEffects: [hp('player-lethal', 30)] })
    s = advanceRound(s, r, false, 3)
    expect(s.playerHp).toBe(0)
    expect(s.outcome).toBe('lose')
    expect(s.done).toBe(true)
  })

  it('已结束的 state 再推进保持幂等', () => {
    let s = initBattle(100, 30)
    s = advanceRound(s, round({ missEffects: [hp('player-lethal', 30)] }), false, 3)
    const after = advanceRound(s, round(), true, 3)
    expect(after).toBe(s)
  })
})
