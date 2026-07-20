/**
 * 战斗血条 HUD 皮肤（component id: `battleHpBar`）—— **一比一复刻旧 HUD**（HudLayer/HealthBar/BossBar）：
 *   我方（空藏）：右下角、蓝色镜像水墨血条（从左侧消减）+ 残影 + 气力珠（金/灰）。
 *   敌方（小怪）：顶部居中、红色微倾水墨血条 + 残影。
 * 样式/类名/位置与旧版完全一致；毛边走自带 #inkRough 滤镜。按 element 绑定的实体 id 判角色（ent-player=我方，否则敌方）。
 *
 * 注册契约与渲染同文件（对齐 bossHitCheer）：In = bind/label/accent，由 EXTRA_COMPONENTS 注册。
 */
import type { HudProps } from '../rendererRegistry'
import type { OverlayChild } from '../../schema/graph-schema'
import type { ComponentDef } from '../../registry/component-registry'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

/** 组件入参（In）；同类型可有多份实例，各绑不同实体 / 属性。 */
export interface BattleHpBarParams {
  /** 绑定的实体 id（编辑器 EntitySelect 下拉）。 */
  bind?: string
  /** 绑定的属性名（编辑器 AttrSelect 下拉，随 bind 联动；缺省 hp）。 */
  attr?: string
  /** 画面 / 编辑器显示名。 */
  label?: string
  accent?: string
}

/**
 * 组件的注册契约（引擎/编辑器识别用）——与渲染实现同文件，组件即"包"。
 * `surface: 'hud'` 让试玩面走 HUD 渲染表，而非通用 overlay 表。
 * bind/attr 走场景 pickers，不在 core-components 硬编码。
 */
export const battleHpBarComponent: ComponentDef<BattleHpBarParams> = {
  role: 'presentation',
  surface: 'hud',
  label: '水墨血条',
  inputs: [
    { key: 'bind', label: '绑定对象', valueType: 'string', default: 'ent-player', component: 'entity' },
    { key: 'attr', label: '绑定属性', valueType: 'string', default: 'hp', component: 'attr' },
    { key: 'label', label: '显示名', valueType: 'string', default: '角色' },
    { key: 'accent', label: '强调色', valueType: 'string', component: 'color' },
  ],
  events: [],
}

/** OverlayChild 预设（顶栏 component = 皮肤 id）。 */
export function battleHpBarPreset(
  id: string,
  opts: { bind: string; label: string },
): OverlayChild {
  return {
    id,
    component: 'battleHpBar',
    trigger: { when: 'enter' },
    inputs: { bind: opts.bind, label: opts.label },
  }
}

export function BattleHpBar({ element, ctx }: HudProps) {
  injectCss('graph-battle-hud', HUD_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const id = element.bind ?? element.element
  const e = ctx.hud.entities[id]
  // 绑定的实体 id 在本局场景不存在（如内置方案预设的 ent-player/ent-boss 与场景自建实体不同名）——
  // 曾经这里直接 return null 静默消失：调试时肉眼分不清「组件没渲染」还是「渲染了但空」，
  // 容易被误判成 kind/挂载逻辑问题。改为可见提示，定位一眼可见。
  if (!e) {
    return (
      <div className="ks-hud-missing-bind" title={`血条组件找不到绑定实体「${id}」——请检查场景实体列表，或在挂载覆盖里改绑 bind`}>
        ⚠ 血条未绑定：{id}
      </div>
    )
  }
  const attr = element.attr?.trim() || 'hp'
  const cur = e.attrs?.[attr] ?? (attr === 'hp' ? e.hp : 0)
  const max = e.attrMax?.[attr] ?? (attr === 'hp' ? e.maxHp : cur)
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0
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
.ks-hud-missing-bind { position: absolute; top: 44px; left: 12px; z-index: 999; padding: 4px 10px; border-radius: 6px; background: rgba(120,70,10,0.92); border: 1px solid #f0a840; color: #ffe9c2; font-size: 11px; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
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
