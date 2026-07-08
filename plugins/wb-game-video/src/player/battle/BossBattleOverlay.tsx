import { useEffect, useRef, useState } from 'react'
import type { BossSpec, Scenario } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  advanceRound,
  initBattle,
  isPerfect,
  roundDamage,
  type BattleState,
} from './bossRuntime'

/**
 * BossBattleOverlay —— Boss 回合战交互层(v9 玩法系统 M5)。
 *
 * 两级状态机内层「battle」的可玩实现。Player 在 scene.kind='battle' 且配了
 * scene.boss 时挂载本层,视频作为定格背景,本层逐回合接管:
 *
 *   每回合出现一条「时机条」(timing bar):光标在条上左右扫动,
 *   命中中央高亮区(hit window)= 应用 hitEffects,否则/超时 = 应用 missEffects。
 *
 * 结算全部走 ./bossRuntime 纯函数;本层只负责输入采集 + 把每回合伤害
 * 通过 onDamage 回调同步到 Player 的全局 entities(HUD 实时掉血),并在分出
 * 胜负时回调 onWin(perfect) / onLose。
 *
 * 设计取舍:不复用 QTEOverlay(它与 scene 时间轴强耦合);回合战自带独立节拍器,
 * 既能演示完整的「entities tick + 完美连击 + 胜负路由」闭环,又对现有 QTE 零侵入。
 */
interface Props {
  scenario: Scenario
  boss: BossSpec
  /** 同步一回合的伤害到全局 entities(HUD 掉血)。 */
  onDamage: (toBossEntityId: string, toBoss: number, playerEntityId: string, toPlayer: number) => void
  /** 胜利;perfect=全回合命中且玩家零伤。 */
  onWin: (perfect: boolean) => void
  /** 失败。 */
  onLose: () => void
}

/** 时机条一个来回的周期(ms)。 */
const SWEEP_PERIOD_MS = 1400
/** 命中区半宽(归一化 0~1,中心 0.5)。 */
const HIT_HALF_WIDTH = 0.12

export function BossBattleOverlay({ scenario, boss, onDamage, onWin, onLose }: Props) {
  injectStyleOnce('boss-battle-overlay', BATTLE_CSS)

  const bossEntity = scenario.entities?.[boss.entityId]
  const playerEntityId =
    boss.playerEntityId ??
    Object.entries(scenario.entities ?? {}).find(([, e]) => e.kind === 'player')?.[0]
  const playerEntity = playerEntityId ? scenario.entities?.[playerEntityId] : undefined

  const totalRounds = boss.rounds.length

  const [battle, setBattle] = useState<BattleState>(() =>
    initBattle(bossEntity?.maxHp ?? 0, playerEntity?.maxHp ?? 0),
  )
  const battleRef = useRef(battle)
  battleRef.current = battle

  /** 光标当前位置(0~1),由 RAF 扫动。 */
  const [cursor, setCursor] = useState(0.5)
  /** 本回合刚结算的反馈(命中/失手),用于飘字。 */
  const [flash, setFlash] = useState<{ hit: boolean; key: number } | null>(null)
  const resolvedRef = useRef(false)

  const round = boss.rounds[battle.roundIndex]

  // 扫动光标 + 回合超时(一个完整来回未点 = 失手)。
  useEffect(() => {
    if (battle.done || !round) return
    resolvedRef.current = false
    const start = performance.now()
    let raf = 0
    function tick(now: number): void {
      const t = ((now - start) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS
      // 三角波:0→1→0,让光标来回扫
      const pos = t < 0.5 ? t * 2 : 2 - t * 2
      setCursor(pos)
      // 超时:一个完整周期结束仍未命中 → 自动失手
      if (now - start >= SWEEP_PERIOD_MS && !resolvedRef.current) {
        resolve(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.roundIndex, battle.done])

  // 分出胜负 → 回调上层路由(延迟一拍让飘字播完)。
  useEffect(() => {
    if (!battle.done || !battle.outcome) return
    const t = window.setTimeout(() => {
      if (battle.outcome === 'win') onWin(isPerfect(battle))
      else onLose()
    }, 720)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.done, battle.outcome])

  function resolve(forceMiss?: boolean): void {
    if (resolvedRef.current || battleRef.current.done || !round) return
    resolvedRef.current = true
    const hit = forceMiss ? false : Math.abs(cursorRef.current - 0.5) <= HIT_HALF_WIDTH
    setFlash({ hit, key: battleRef.current.roundIndex })
    // 同步伤害到全局 entities(HUD 掉血)
    const dmg = roundDamage(round, hit)
    if (playerEntityId) onDamage(boss.entityId, dmg.toBoss, playerEntityId, dmg.toPlayer)
    setBattle((s) => advanceRound(s, round, hit, totalRounds))
  }

  // cursor 的 ref(resolve 在 RAF/事件里读最新值)
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  if (!bossEntity || !playerEntity) return null

  return (
    <div
      className="ks-battle"
      data-testid="boss-battle"
      onClick={() => resolve(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          resolve(false)
        }
      }}
    >
      <div className="ks-battle-prompt">
        <span className="ks-battle-round">
          回合 {Math.min(battle.roundIndex + 1, totalRounds)} / {totalRounds}
        </span>
        {round?.label && <span className="ks-battle-label">{round.label}</span>}
        <span className="ks-battle-hint">点击 / 空格 在高亮区命中</span>
      </div>

      {!battle.done && (
        <div className="ks-battle-bar">
          <div
            className="ks-battle-hitzone"
            style={{
              left: `${(0.5 - HIT_HALF_WIDTH) * 100}%`,
              width: `${HIT_HALF_WIDTH * 2 * 100}%`,
            }}
          />
          <div className="ks-battle-cursor" style={{ left: `${cursor * 100}%` }} />
        </div>
      )}

      {flash && (
        <div
          key={flash.key}
          className={`ks-battle-flash ${flash.hit ? 'is-hit' : 'is-miss'}`}
        >
          {flash.hit ? '命中!' : '失手!'}
        </div>
      )}

      {battle.done && (
        <div className={`ks-battle-result ${battle.outcome === 'win' ? 'is-win' : 'is-lose'}`}>
          {battle.outcome === 'win' ? (isPerfect(battle) ? '完美胜利' : '胜利') : '战败'}
        </div>
      )}
    </div>
  )
}

const BATTLE_CSS = `
.ks-battle {
  position: absolute; inset: 0;
  z-index: 70;
  display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end;
  padding-bottom: 16%;
  gap: 18px;
  cursor: pointer;
  user-select: none;
  background: radial-gradient(120% 90% at 50% 100%, rgba(120,10,10,0.28), transparent 60%);
}
.ks-battle-prompt {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-shadow: 0 2px 10px rgba(0,0,0,0.7);
}
.ks-battle-round {
  font-size: 13px; letter-spacing: 0.22em;
  color: rgba(255,255,255,0.7);
}
.ks-battle-label {
  font-size: 22px; letter-spacing: 0.08em;
  color: #fff; font-weight: 500;
}
.ks-battle-hint {
  font-size: 11px; letter-spacing: 0.12em;
  color: rgba(255,255,255,0.5);
}
.ks-battle-bar {
  position: relative;
  width: min(60%, 560px); height: 14px;
  border-radius: 8px;
  background: rgba(0,0,0,0.55);
  border: 1px solid rgba(255,255,255,0.18);
  overflow: hidden;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
}
.ks-battle-hitzone {
  position: absolute; top: 0; bottom: 0;
  background: linear-gradient(90deg, rgba(52,211,153,0.5), rgba(16,185,129,0.85), rgba(52,211,153,0.5));
  box-shadow: 0 0 16px rgba(16,185,129,0.6);
}
.ks-battle-cursor {
  position: absolute; top: -3px; bottom: -3px;
  width: 4px; margin-left: -2px;
  background: #fff;
  box-shadow: 0 0 10px rgba(255,255,255,0.9);
  border-radius: 2px;
}
.ks-battle-flash {
  font-size: 40px; font-weight: 700; letter-spacing: 0.1em;
  animation: ks-battle-pop 700ms ease-out forwards;
}
.ks-battle-flash.is-hit { color: #34d399; text-shadow: 0 0 24px rgba(52,211,153,0.7); }
.ks-battle-flash.is-miss { color: #f87171; text-shadow: 0 0 24px rgba(248,113,113,0.7); }
@keyframes ks-battle-pop {
  0% { opacity: 0; transform: scale(0.6); }
  30% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0; transform: scale(1); }
}
.ks-battle-result {
  font-size: 56px; font-weight: 800; letter-spacing: 0.14em;
  animation: ks-battle-pop 900ms ease-out forwards;
}
.ks-battle-result.is-win { color: #fbbf24; text-shadow: 0 0 36px rgba(251,191,36,0.7); }
.ks-battle-result.is-lose { color: #ef4444; text-shadow: 0 0 36px rgba(239,68,68,0.7); }
`
