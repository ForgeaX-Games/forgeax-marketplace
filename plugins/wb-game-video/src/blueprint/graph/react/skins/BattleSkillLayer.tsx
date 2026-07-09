/**
 * 战斗技能条皮肤（component id: `battleSkillBar`）—— 从旧 player/BattleSkillLayer 迁移。
 *
 * 读 InteractionSnap.params.options，底部一排水墨技能键（X/A/Y/B）+ 技能名；点击/键盘 → submit(key)。
 * 旧的「条件门控/锁定」暂不迁移（新 choice 选项无逐项条件）；含 'ult' 的 key 用金色高亮。
 */
import { useEffect, useState } from 'react'
import type { InteractionProps } from '../rendererRegistry'
import type { ChoiceParams } from '../../core-kinds'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

const SKILL_KEYS = ['X', 'A', 'Y', 'B'] as const

export function BattleSkillLayer({ interaction, submit }: InteractionProps) {
  injectCss('battle-skill-layer', SKILL_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const options = ((interaction.params as unknown as ChoiceParams).options ?? []) as Array<{ key: string; label?: string; _locked?: boolean }>
  const [picked, setPicked] = useState<string | null>(null)

  function pick(key: string, locked: boolean): void {
    if (picked || locked) return
    setPicked(key)
    submit(key)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (picked) return
      const index = SKILL_KEYS.findIndex((k) => k === e.key.toUpperCase())
      if (index < 0) return
      const opt = options[index]
      if (!opt) return
      e.preventDefault()
      pick(opt.key, !!opt._locked)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, options])

  return (
    <div className="pvb-skills enter" aria-label="技能选择">
      {options.map((opt, index) => {
        const key = SKILL_KEYS[index] ?? String(index + 1)
        const isUlt = opt.key.includes('ult')
        const locked = !!opt._locked
        return (
          <button
            key={opt.key}
            type="button"
            className={`pvb-skill ${isUlt ? 'ult' : ''} ${picked === opt.key ? 'sel' : ''} ${locked ? 'dis' : ''}`}
            onClick={() => pick(opt.key, locked)}
            disabled={!!picked || locked}
          >
            <span className="pvb-sk-key">{key}</span>
            <span className="pvb-sk-nm">{opt.label ?? opt.key}</span>
          </button>
        )
      })}
    </div>
  )
}

const SKILL_CSS = `
.pvb-skills { position: absolute; left: 0; right: 0; bottom: 0; z-index: 44; display: flex; flex-wrap: wrap; gap: 26px; justify-content: center; align-items: flex-end; min-height: 40px; padding: 34px 16px 18px; background: linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,.2) 60%, transparent); pointer-events: auto; }
.pvb-skill { position: relative; display: flex; align-items: center; gap: 9px; cursor: pointer; background: none; border: none; padding: 4px; box-shadow: none; line-height: 1; color: #fbf6ec; transition: transform .14s ease, opacity .14s ease; }
.pvb-sk-key { position: relative; flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-weight: 800; font-size: 1.18rem; color: #efe7d6; z-index: 1; text-shadow: 0 2px 6px rgba(0,0,0,.85); }
.pvb-sk-key::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: 52% 48% 50% 50% / 50% 52% 48% 50%; background: linear-gradient(180deg, #2b2620, #0c0a08); border: 1.5px solid rgba(239,231,214,.5); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset, 0 2px 7px rgba(0,0,0,.6); filter: url(#inkRough); }
.pvb-sk-nm { position: relative; font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-weight: 800; font-size: 1.32rem; letter-spacing: 2px; color: #fbf6ec; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.8); transition: color .12s; }
.pvb-sk-nm::after { content: ''; position: absolute; left: -3px; right: -5px; bottom: -7px; height: 7px; border-radius: 60% 40% 55% 45% / 100% 100% 90% 100%; opacity: 0; transform: scaleX(.55); transform-origin: left center; background: linear-gradient(90deg, transparent, #b5301f 12%, #e0452e 50%, #b5301f 88%, transparent); transition: opacity .15s ease, transform .15s ease; }
.pvb-skill:not(.dis):hover, .pvb-skill:not(.dis):focus, .pvb-skill:not(.dis):focus-visible { background: none; color: #fbf6ec; }
.pvb-skill:not(.dis):hover { transform: translateY(-2px); }
.pvb-skill:not(.dis):hover .pvb-sk-nm, .pvb-skill.sel:not(.dis) .pvb-sk-nm { color: #e0452e; }
.pvb-skill:not(.dis):hover .pvb-sk-nm::after, .pvb-skill.sel:not(.dis) .pvb-sk-nm::after { opacity: 1; transform: scaleX(1); }
.pvb-skill.ult:not(.dis) .pvb-sk-nm { color: #ffd98a; }
.pvb-skill.dis { opacity: .5; cursor: not-allowed; }
@keyframes pvbSkillIn { 0% { opacity: 0; transform: translateY(20px) scale(.86); } 60% { opacity: 1; transform: translateY(-3px) scale(1.06); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
.pvb-skills.enter .pvb-skill { animation: pvbSkillIn .34s ease both; }
.pvb-skills.enter .pvb-skill:nth-child(1) { animation-delay: .02s; }
.pvb-skills.enter .pvb-skill:nth-child(2) { animation-delay: .09s; }
.pvb-skills.enter .pvb-skill:nth-child(3) { animation-delay: .16s; }
.pvb-skills.enter .pvb-skill:nth-child(4) { animation-delay: .23s; }
`
