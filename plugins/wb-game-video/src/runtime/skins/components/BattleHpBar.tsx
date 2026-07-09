/**
 * 战斗血条 HUD 皮肤（component id: `battleHpBar`）—— **一比一复刻旧 HUD**（HudLayer/HealthBar/BossBar）：
 *   我方（空藏）：右下角、蓝色镜像水墨血条（从左侧消减）+ 残影 + 气力珠（金/灰）。
 *   敌方（小怪）：顶部居中、红色微倾水墨血条 + 残影。
 * 样式/类名/位置与旧版完全一致；毛边走自带 #inkRough 滤镜。按 element 绑定的实体 id 判角色（ent-player=我方，否则敌方）。
 */
import type { HudProps } from '../rendererRegistry'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export function BattleHpBar({ element, ctx }: HudProps) {
  injectCss('graph-battle-hud', HUD_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const id = element.bind ?? element.element
  const e = ctx.hud.entities[id]
  if (!e) return null
  const ratio = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0
  const pct = `${ratio * 100}%`
  const isPlayer = id === 'ent-player'
  const name = element.label ?? id

  if (!isPlayer) {
    // 敌方（小怪）：顶部居中，红色
    return (
      <div className="ks-hud-boss ks-hud-foe-unit">
        <div className="ks-hud-boss-name">{name}</div>
        <div className="ks-hud-boss-bar">
          <span className="ks-hud-boss-ghost" style={{ width: pct }} />
          <span className="ks-hud-boss-fill foe" style={{ width: pct, ...(element.accent ? { background: element.accent } : null) }} />
        </div>
      </div>
    )
  }

  // 我方（空藏）：右下角，蓝色镜像 + 气力珠
  const low = ratio <= 0.3
  const qi = ctx.hud.vars.qi
  const showQi = typeof qi === 'number'
  const qiMax = 5
  const pips = showQi ? Array.from({ length: qiMax }, (_, i) => i < qi) : []
  return (
    <div className="ks-hud-bottom">
      <div className={`ks-hud-hp ks-hud-me-unit${low ? ' is-low' : ''}`}>
        <div className="ks-hud-hp-name">{name}</div>
        <div className="ks-hud-hp-bar">
          <span className="ks-hud-hp-ghost" style={{ width: pct }} />
          <span className="ks-hud-hp-fill me" style={{ width: pct, ...(element.accent ? { background: element.accent } : null) }} />
        </div>
        {showQi && (
          <div className="ks-hud-rage" aria-label={`气力 ${qi}/${qiMax}`}>
            {pips.map((on, i) => (
              <span key={i} className={`ks-hud-pip${on ? ' on' : ''}`} aria-hidden />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 复刻自旧 HudLayer 的 HUD_CSS（血条子集，逐字对齐；去掉 score/timer/status，那些走内置列/其它皮肤）。
const HUD_CSS = `
.ks-hud-bottom { position: absolute; right: 32px; bottom: 18px; display: flex; flex-direction: column; gap: 9px; align-items: flex-end; max-width: 40%; pointer-events: none; }
/* ===== 我方血条（空藏）· 水墨风 ===== */
.ks-hud-hp { display: flex; flex-direction: column; align-items: flex-end; width: min(23vw, 250px); text-align: right; }
.ks-hud-hp-name { font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-size: 1.3rem; font-weight: 800; color: #efe7d6; letter-spacing: 3px; margin-bottom: 3px; text-shadow: 0 2px 7px rgba(0,0,0,.8); }
.ks-hud-hp-bar { position: relative; width: 100%; height: 11px; filter: url(#inkRough); transform: rotate(.5deg) scaleX(-1); }
.ks-hud-hp-bar::before { content: ''; position: absolute; inset: 0; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; background: linear-gradient(180deg,#2b2620,#0c0a08); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost, .ks-hud-hp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost { z-index: 1; background: rgba(255,255,255,.5); transition: width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-hp-fill { z-index: 2; transition: width .16s linear; }
.ks-hud-hp-fill.me { background: linear-gradient(90deg,#7398cf,#a6c6ee); }
.ks-hud-hp.is-low .ks-hud-hp-fill.me { background: linear-gradient(90deg,#f87171,#ef4444); animation: ks-hud-lowpulse 1s ease-in-out infinite; }
.ks-hud-rage { display: flex; justify-content: flex-end; gap: 7px; margin-top: 9px; }
.ks-hud-pip { width: 13px; height: 13px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #5a5346, #262219); border: 1px solid rgba(0,0,0,.5); box-shadow: 0 1px 2px rgba(0,0,0,.5); transition: all .2s; }
.ks-hud-pip.on { background: radial-gradient(circle at 35% 30%, #ffe49c, #c8902f); border-color: rgba(255,220,150,.7); box-shadow: 0 0 7px rgba(255,190,90,.7), 0 1px 2px rgba(0,0,0,.4); }
@keyframes ks-hud-lowpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
/* ===== 敌方血条（小怪）· 水墨风，顶部居中 ===== */
.ks-hud-boss { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); width: min(30%, 320px); display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; pointer-events: none; }
.ks-hud-boss-name { font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-size: 1.3rem; font-weight: 800; color: #efe7d6; letter-spacing: 3px; text-shadow: 0 2px 7px rgba(0,0,0,.8); }
.ks-hud-boss-bar { position: relative; width: 100%; height: 11px; filter: url(#inkRough); transform: rotate(-.7deg); }
.ks-hud-boss-bar::before { content: ''; position: absolute; inset: 0; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; background: linear-gradient(180deg,#2b2620,#0c0a08); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost, .ks-hud-boss-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost { z-index: 1; background: rgba(255,255,255,.5); transition: width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-boss-fill { z-index: 2; transition: width .16s linear; }
.ks-hud-boss-fill.foe { background: linear-gradient(90deg,#d06d5b,#e89a8d); }
`
