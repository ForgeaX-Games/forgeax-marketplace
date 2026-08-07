/**
 * 战斗血条（component id: `battleHpBar`）—— OverlayComponent。
 *   我方（空藏）：右下角、蓝色镜像水墨血条 + 残影 + 气力珠。
 *   敌方：顶部居中、红色微倾水墨血条 + 残影。
 *
 * 作者配置 bind/attr/label/accent；绘制时从 SkinCtx 解析 value/max/qi 再画（resolved inputs）。
 * 子件 layout 须铺满舞台（见 `STAGE_FILL_LAYOUT` / preset）。
 */
import type { ReactNode } from 'react'
import type { OverlayProps, SkinCtx } from '../rendererRegistry'
import type { OverlayChild } from '../../schema/graph-schema'
import type { ComponentDef } from '../../registry/component-registry'
import { STAGE_FILL_LAYOUT } from '../../schema/layout'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

/** 作者配置的入参（落盘）。 */
export interface BattleHpBarParams {
  bind?: string
  attr?: string
  label?: string
  accent?: string
}

/** 绘制时解析后的 props（不落盘）。 */
interface ResolvedHpBar {
  bind: string
  label: string
  accent?: string
  value: number
  max: number
  qi?: number
  missing?: boolean
}

export const battleHpBarComponent: ComponentDef<BattleHpBarParams> = {
  label: '水墨血条',
  inputs: [
    { key: 'bind', label: '绑定对象', valueType: 'string', default: 'ent-player', component: 'entity' },
    { key: 'attr', label: '绑定属性', valueType: 'string', default: 'hp', component: 'attr' },
    { key: 'label', label: '显示名', valueType: 'string', default: '角色' },
    { key: 'accent', label: '强调色', valueType: 'string', component: 'color' },
  ],
  events: [],
}

/** OverlayChild 预设（含舞台铺满 layout）。 */
export function battleHpBarPreset(
  id: string,
  opts: { bind: string; label: string },
): OverlayChild {
  return {
    id,
    component: 'battleHpBar',
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    // 显隐唯一 SSOT = window；HUD 常驻，不写 endMs = 持续到节点结束。
    window: { startMs: 0 },
    inputs: { bind: opts.bind, label: opts.label },
  }
}

/** 绘制时：bind/attr → value/max；我方额外带 qi。 */
export function resolveBattleHpBarInputs(
  inputs: BattleHpBarParams,
  ctx: SkinCtx | undefined,
  fallbackBind: string,
): ResolvedHpBar {
  const bind = typeof inputs.bind === 'string' && inputs.bind ? inputs.bind : fallbackBind
  const label = typeof inputs.label === 'string' && inputs.label ? inputs.label : bind
  const accent = typeof inputs.accent === 'string' ? inputs.accent : undefined
  const e = ctx?.hud.entities[bind]
  if (!e) {
    return { bind, label, accent, value: 0, max: 0, missing: true }
  }
  const attr = inputs.attr?.trim() || 'hp'
  const value = e.attrs?.[attr] ?? (attr === 'hp' ? e.hp : 0)
  const max = e.attrMax?.[attr] ?? (attr === 'hp' ? e.maxHp : value)
  const qi = bind === 'ent-player' && typeof ctx?.hud.vars.qi === 'number' ? ctx.hud.vars.qi : undefined
  return { bind, label, accent, value, max, qi }
}

export function BattleHpBar({ overlay, ctx }: OverlayProps): ReactNode {
  injectCss('graph-battle-hud', HUD_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const raw = overlay.inputs as BattleHpBarParams
  const p = resolveBattleHpBarInputs(raw, ctx, overlay.elementId)
  if (p.missing) {
    return (
      <div
        className="ks-hud-missing-bind"
        title={`血条组件找不到绑定实体「${p.bind}」——请检查场景实体列表，或在挂载覆盖里改绑 bind`}
      >
        ⚠ 血条未绑定：{p.bind}
      </div>
    )
  }
  const ratio = p.max > 0 ? Math.max(0, Math.min(1, p.value / p.max)) : 0
  const pct = `${ratio * 100}%`
  const isPlayer = p.bind === 'ent-player'

  if (!isPlayer) {
    return (
      <div className="ks-hud-boss ks-hud-foe-unit">
        <div className="ks-hud-boss-name">{p.label}</div>
        <div className="ks-hud-boss-bar">
          <span className="ks-hud-boss-ghost" style={{ width: pct }} />
          <span
            className="ks-hud-boss-fill foe"
            style={{ width: pct, ...(p.accent ? { background: p.accent } : null) }}
          />
        </div>
      </div>
    )
  }

  const low = ratio <= 0.3
  const showQi = typeof p.qi === 'number'
  const qiMax = 5
  const pips = showQi ? Array.from({ length: qiMax }, (_, i) => i < (p.qi as number)) : []
  return (
    <div className="ks-hud-bottom">
      <div className={`ks-hud-hp ks-hud-me-unit${low ? ' is-low' : ''}`}>
        <div className="ks-hud-hp-name">{p.label}</div>
        <div className="ks-hud-hp-bar">
          <span className="ks-hud-hp-ghost" style={{ width: pct }} />
          <span
            className="ks-hud-hp-fill me"
            style={{ width: pct, ...(p.accent ? { background: p.accent } : null) }}
          />
        </div>
        {showQi && (
          <div className="ks-hud-rage" aria-label={`气力 ${p.qi}/${qiMax}`}>
            {pips.map((on, i) => (
              <span key={i} className={`ks-hud-pip${on ? ' on' : ''}`} aria-hidden />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const HUD_CSS = `
.ks-hud-missing-bind { position: absolute; top: 4cqh; left: 1.5cqw; z-index: 999; padding: 4px 10px; border-radius: 6px; background: rgba(120,70,10,0.92); border: 1px solid #f0a840; color: #ffe9c2; font-size: 1.4cqh; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
.ks-hud-bottom { position: absolute; right: 2.5cqw; bottom: 2.5cqh; display: flex; flex-direction: column; gap: 1cqh; align-items: flex-end; max-width: 40%; pointer-events: none; }
.ks-hud-hp { display: flex; flex-direction: column; align-items: flex-end; width: 23cqw; text-align: right; }
.ks-hud-hp-name { font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-size: 2.2cqh; font-weight: 800; color: #efe7d6; letter-spacing: 3px; margin-bottom: 3px; text-shadow: 0 2px 7px rgba(0,0,0,.8); }
.ks-hud-hp-bar { position: relative; width: 100%; height: 1.3cqh; filter: url(#inkRough); transform: rotate(.5deg) scaleX(-1); }
.ks-hud-hp-bar::before { content: ''; position: absolute; inset: 0; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; background: linear-gradient(180deg,#2b2620,#0c0a08); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost, .ks-hud-hp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost { z-index: 1; background: rgba(255,255,255,.5); transition: width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-hp-fill { z-index: 2; transition: width .16s linear; }
.ks-hud-hp-fill.me { background: linear-gradient(90deg,#7398cf,#a6c6ee); }
.ks-hud-hp.is-low .ks-hud-hp-fill.me { background: linear-gradient(90deg,#f87171,#ef4444); animation: ks-hud-lowpulse 1s ease-in-out infinite; }
.ks-hud-rage { display: flex; justify-content: flex-end; gap: 0.8cqh; margin-top: 1cqh; }
.ks-hud-pip { width: 1.6cqmin; height: 1.6cqmin; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #5a5346, #262219); border: 1px solid rgba(0,0,0,.5); box-shadow: 0 1px 2px rgba(0,0,0,.5); transition: all .2s; }
.ks-hud-pip.on { background: radial-gradient(circle at 35% 30%, #ffe49c, #c8902f); border-color: rgba(255,220,150,.7); box-shadow: 0 0 7px rgba(255,190,90,.7), 0 1px 2px rgba(0,0,0,.4); }
@keyframes ks-hud-lowpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.ks-hud-boss { position: absolute; top: 2cqh; left: 50%; transform: translateX(-50%); width: 30cqw; display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; pointer-events: none; }
.ks-hud-boss-name { font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-size: 2.2cqh; font-weight: 800; color: #efe7d6; letter-spacing: 3px; text-shadow: 0 2px 7px rgba(0,0,0,.8); }
.ks-hud-boss-bar { position: relative; width: 100%; height: 1.3cqh; filter: url(#inkRough); transform: rotate(-.7deg); }
.ks-hud-boss-bar::before { content: ''; position: absolute; inset: 0; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; background: linear-gradient(180deg,#2b2620,#0c0a08); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost, .ks-hud-boss-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask: linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost { z-index: 1; background: rgba(255,255,255,.5); transition: width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-boss-fill { z-index: 2; transition: width .16s linear; }
.ks-hud-boss-fill.foe { background: linear-gradient(90deg,#d06d5b,#e89a8d); }
`
