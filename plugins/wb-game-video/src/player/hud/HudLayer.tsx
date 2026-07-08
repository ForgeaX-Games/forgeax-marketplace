import { injectInkFilterOnce, injectStyleOnce } from '../../styles/injectStyle'
import { injectBrushFontOnce } from '../../styles/brushFont'
import type { Scenario, Scene, HudElement } from '../../scenario/types'
import { coerceHudRules } from '../../scenario/gameplayTypes'
import type { HudPreset } from '../../scenario/gameplayTypes'
import type { EntitiesState } from '../entities'
import { findPlayer, findBoss } from '../entities'
import { isBattleScene, isQteScene } from '../gameplayGuards'
import { inferHudPreset } from '../gameplayState'
import { HealthBar } from './HealthBar'
import { BossBar } from './BossBar'
import { StatusIcons } from './StatusIcons'
import type { VarState } from '../conditionEval'

/**
 * HudLayer —— 玩法 HUD 叠层总装。Player 在 `isGameplay` 为真时挂一行渲染本组件。
 *
 * 可见性规则:
 *   - 作者在 Scenario.ui.hud 显式配了规则 → 按规则 + 当前上下文(battle/qte)判定;
 *   - 没配 → 走内置兜底(playerHp 常显、bossHp 仅 battle、status 有才显)。
 *
 * M2 为「只读骨架」:实体血量来自 initEntities(满血)，状态恒空。
 * 数据形状(EntitiesState)与 M5 回合结算共用，到时仅需把实时 state 传进来。
 */
export function HudLayer({
  scenario,
  scene,
  entities,
  vars,
  score,
  timerMs,
}: {
  scenario: Scenario
  scene: Scene
  entities: EntitiesState
  /** 运行时数值状态；用于显示气力点等资源。 */
  vars?: VarState
  /** 当前累计 QTE 分数（score 元素显示用）。 */
  score?: number
  /** 倒计时剩余毫秒（timer 元素显示用）；null/缺省 = 无倒计时。 */
  timerMs?: number | null
}) {
  injectStyleOnce('player-hud-layer', HUD_CSS)
  injectInkFilterOnce()
  injectBrushFontOnce()

  const battle = isBattleScene(scene)
  const qte = isQteScene(scene)

  const player = findPlayer(entities)
  const boss = findBoss(entities)
  const accent = scenario.ui?.accentColor
  const qiDef = scenario.variables?.qi
  const qiMax = typeof qiDef?.max === 'number' ? qiDef.max : 5
  const qiCurrent = Math.max(0, Math.min(qiMax, Math.round(vars?.qi ?? qiDef?.initial ?? 0)))
  const qiEnergy = qiDef ? { current: qiCurrent, max: qiMax } : undefined

  const activeStatuses = player
    ? player.statusIds
        .map((id) => scenario.statuses?.[id])
        .filter((s): s is NonNullable<typeof s> => !!s)
    : []

  // 兜底显隐依赖上下文（是否有 Boss / 是否有状态 / 是否有倒计时），集中算一次。
  const ctx = {
    battle,
    qte,
    hasBoss: !!boss,
    hasStatus: activeStatuses.length > 0,
    hasTimer: timerMs != null,
  }
  const show = (el: HudElement) =>
    presetAllows(inferHudPreset(scene), el, ctx) && resolveVisible(scenario, el, ctx)

  return (
    <div className="ks-hud" aria-hidden={false} data-testid="hud-layer">
      {show('bossHp') && boss && <BossBar entity={boss} />}

      {(show('score') || show('timer')) && (
        <div className="ks-hud-topright">
          {show('timer') && timerMs != null && (
            <div className="ks-hud-timer" data-testid="hud-timer">
              {(Math.max(0, timerMs) / 1000).toFixed(1)}s
            </div>
          )}
          {show('score') && (
            <div className="ks-hud-score" data-testid="hud-score">
              {Math.round(score ?? 0)}
            </div>
          )}
        </div>
      )}

      <div className="ks-hud-bottom">
        {show('status') && <StatusIcons statuses={activeStatuses} />}
        {show('playerHp') && player && <HealthBar entity={player} accent={accent} energy={qiEnergy} />}
      </div>
    </div>
  )
}

interface HudCtx {
  battle: boolean
  qte: boolean
  hasBoss: boolean
  hasStatus: boolean
  hasTimer: boolean
}

/** 场景 HUD 方案（原型四档）—— 在全局规则 / 兜底之前做粗粒度门控。 */
function presetAllows(preset: HudPreset, el: HudElement, ctx: HudCtx): boolean {
  switch (preset) {
    case 'hidden':
      return false
    case 'explore':
      return el === 'playerHp'
    case 'narrative':
      // 叙事段:只己方血条;敌方血条/score/倒计时一律不显(四维属性由 NarrativeStatsLayer 独立渲染)。
      return el === 'playerHp'
    case 'main':
      return el === 'playerHp' || el === 'score' || el === 'timer' || (el === 'status' && ctx.hasStatus)
    case 'battle':
      if (el === 'inventory') return false
      if (el === 'bossHp') return ctx.hasBoss
      if (el === 'playerHp') return true
      if (el === 'score' || el === 'timer') return ctx.qte
      if (el === 'status') return ctx.hasStatus
      return false
    default:
      return true
  }
}

/** 某 HUD 元素当前是否可见。作者规则优先；否则按上下文智能兜底。 */
function resolveVisible(scenario: Scenario, el: HudElement, ctx: HudCtx): boolean {
  const rule = coerceHudRules(scenario.ui?.hud).find((r) => r.element === el)
  if (rule) {
    switch (rule.show) {
      case 'always':
        return true
      case 'never':
        return false
      case 'battle':
        return ctx.battle
      case 'qte':
        return ctx.qte
    }
  }
  // 内置兜底（无作者规则时按上下文智能显示）：
  switch (el) {
    case 'playerHp':
      return true // 玩家血条常显
    case 'bossHp':
      return ctx.battle && ctx.hasBoss
    case 'status':
      return ctx.hasStatus // 身上有状态才显
    case 'score':
      return ctx.qte // 节奏/限时交互时显示得分
    case 'timer':
      return ctx.qte && ctx.hasTimer // 有倒计时且处于限时交互
    case 'inventory':
      return false // 背包另由 InventoryHUD 负责
    default:
      return false
  }
}

/*
 * 战斗 HUD 复刻自「新影游平台交互原型」的水墨笔触风（仿黑神话）：
 *   - 敌方（小怪）：顶部居中、红色水墨血条、微倾。
 *   - 我方（空藏）：右下角、蓝色水墨血条（镜像：从左侧消减）+ 气力珠（金/灰圆点）。
 *   血条 = 深墨底(::before) + 残影层(ghost，慢过渡自动产生格斗式掉血残影) + 彩色 fill；
 *   毛边由全局 #inkRough SVG 滤镜 + 两端 mask 渐隐提供。
 */
const HUD_CSS = `
.ks-hud {
  position: absolute; inset: 0;
  pointer-events: none;
  z-index: 25;
}
.ks-hud-bottom {
  position: absolute;
  right: 32px; bottom: 18px;
  display: flex; flex-direction: column; gap: 9px;
  align-items: flex-end;
  max-width: 40%;
}
/* 分数 / 倒计时(右上) */
.ks-hud-topright {
  position: absolute;
  right: 4%; top: 5%;
  display: flex; align-items: center; gap: 10px;
}
.ks-hud-score, .ks-hud-timer {
  font-variant-numeric: tabular-nums;
  padding: 4px 12px;
  border-radius: 6px;
  background: rgba(0,0,0,0.46);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.14);
  letter-spacing: 0.06em;
}
.ks-hud-score {
  font-size: 18px; font-weight: 600;
  color: #fbbf24;
}
.ks-hud-timer {
  font-size: 15px;
  color: rgba(255,255,255,0.9);
}

/* ===== 我方血条（空藏）· 水墨风 ===== */
.ks-hud-hp {
  display: flex; flex-direction: column;
  align-items: flex-end;
  width: min(23vw, 250px);
  text-align: right;
}
.ks-hud-hp-name {
  font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif;
  font-size: 1.3rem; font-weight: 800;
  color: #efe7d6; letter-spacing: 3px;
  margin-bottom: 3px;
  text-shadow: 0 2px 7px rgba(0,0,0,.8);
}
.ks-hud-hp-bar {
  position: relative; width: 100%; height: 11px;
  filter: url(#inkRough);
  transform: rotate(.5deg) scaleX(-1); /* 己方镜像：扣血从左侧消减 */
}
.ks-hud-hp-bar::before {
  content: ''; position: absolute; inset: 0;
  border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px;
  background: linear-gradient(180deg,#2b2620,#0c0a08);
  box-shadow: 0 2px 6px rgba(0,0,0,.5) inset;
  -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
  mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
}
.ks-hud-hp-ghost, .ks-hud-hp-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 100%;
  border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px;
  -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
  mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
}
/* 残影层：慢过渡 + 延迟，扣血时落后于 fill → 格斗游戏式掉血残影 */
.ks-hud-hp-ghost {
  z-index: 1;
  background: rgba(255,255,255,.5);
  transition: width .6s cubic-bezier(.2,.7,.3,1) .22s;
}
.ks-hud-hp-fill {
  z-index: 2;
  transition: width .16s linear;
}
.ks-hud-hp-fill.me { background: linear-gradient(90deg,#7398cf,#a6c6ee); }
.ks-hud-hp.is-low .ks-hud-hp-fill.me {
  background: linear-gradient(90deg,#f87171,#ef4444);
  animation: ks-hud-lowpulse 1s ease-in-out infinite;
}
/* 气力珠（金/灰） */
.ks-hud-rage {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 9px;
}
.ks-hud-pip {
  width: 13px; height: 13px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #5a5346, #262219);
  border: 1px solid rgba(0,0,0,.5);
  box-shadow: 0 1px 2px rgba(0,0,0,.5);
  transition: all .2s;
}
.ks-hud-pip.on {
  background: radial-gradient(circle at 35% 30%, #ffe49c, #c8902f);
  border-color: rgba(255,220,150,.7);
  box-shadow: 0 0 7px rgba(255,190,90,.7), 0 1px 2px rgba(0,0,0,.4);
}
@keyframes ks-hud-lowpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* ===== 敌方血条（小怪）· 水墨风，顶部居中 ===== */
.ks-hud-boss {
  position: absolute;
  top: 18px; left: 50%;
  transform: translateX(-50%);
  width: min(30%, 320px);
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  text-align: center;
}
.ks-hud-boss-name {
  font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif;
  font-size: 1.3rem; font-weight: 800;
  color: #efe7d6; letter-spacing: 3px;
  text-shadow: 0 2px 7px rgba(0,0,0,.8);
}
.ks-hud-boss-bar {
  position: relative; width: 100%; height: 11px;
  filter: url(#inkRough);
  transform: rotate(-.7deg);
}
.ks-hud-boss-bar::before {
  content: ''; position: absolute; inset: 0;
  border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px;
  background: linear-gradient(180deg,#2b2620,#0c0a08);
  box-shadow: 0 2px 6px rgba(0,0,0,.5) inset;
  -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
  mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
}
.ks-hud-boss-ghost, .ks-hud-boss-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 100%;
  border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px;
  -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
  mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%);
}
.ks-hud-boss-ghost {
  z-index: 1;
  background: rgba(255,255,255,.5);
  transition: width .6s cubic-bezier(.2,.7,.3,1) .22s;
}
.ks-hud-boss-fill {
  z-index: 2;
  transition: width .16s linear;
}
.ks-hud-boss-fill.foe { background: linear-gradient(90deg,#d06d5b,#e89a8d); }

/* 状态图标行 */
.ks-hud-status {
  display: flex; gap: 6px; flex-wrap: wrap;
  justify-content: flex-end;
}
.ks-hud-status-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: rgba(0,0,0,0.42);
  border: 1px solid rgba(255,255,255,0.16);
  color: rgba(255,255,255,0.9);
}
.ks-hud-status-chip.ks-buff { border-color: rgba(52,211,153,0.6); }
.ks-hud-status-chip.ks-debuff { border-color: rgba(248,113,113,0.6); }
`
