/**
 * 战斗技能条皮肤（component id: `battleSkillBar`）—— 从旧 player/BattleSkillLayer 迁移。
 *
 * 读 InteractionSnap.inputs.events；门控用 ChoiceOption.condition + 实时 SkinCtx（方案 B）。
 * 含 'ult' 的 id 用金色高亮。
 */
import { useEffect, useState } from 'react'
import { usePlayerKeyGate, type InteractionProps } from '../rendererRegistry'
import { isOptionLocked } from '../optionLock'
import type { ChoiceParams } from '../../registry/core-components'
import type { OverlayChild } from '../../schema/graph-schema'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

const SKILL_KEYS = ['X', 'A', 'Y', 'B'] as const

/** 皮肤默认玩法参数（样式锁选项 / 新建预设 / 锚点共用）。 */
export const battleSkillBarDefaults: Pick<ChoiceParams, 'events' | 'x' | 'y'> = {
  events: [
    { id: 'a', label: '斩' },
    { id: 'b', label: '突' },
    { id: 'c', label: '守' },
  ],
  x: 0.5,
  y: 0.88,
}

/** OverlayChild 预设（顶栏 component = 皮肤 id）。 */
export function battleSkillBarPreset(id: string): OverlayChild {
  return {
    id,
    component: 'battleSkillBar',
    trigger: { when: 'enter' },
    inputs: { ...battleSkillBarDefaults },
  }
}

export function BattleSkillLayer({ interaction, submit, ctx }: InteractionProps) {
  injectCss('battle-skill-layer', SKILL_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const keyOk = usePlayerKeyGate()
  const inputs = interaction.inputs as unknown as ChoiceParams
  const events = inputs.events ?? []
  const x = typeof inputs.x === 'number' ? inputs.x : battleSkillBarDefaults.x!
  const y = typeof inputs.y === 'number' ? inputs.y : battleSkillBarDefaults.y!
  const [picked, setPicked] = useState<string | null>(null)

  function pick(id: string, locked: boolean): void {
    if (picked || locked) return
    setPicked(id)
    submit(id)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!keyOk() || picked) return
      const index = SKILL_KEYS.findIndex((k) => k === e.key.toUpperCase())
      if (index < 0) return
      const ev = events[index]
      if (!ev) return
      e.preventDefault()
      pick(ev.id, isOptionLocked(ev, ctx))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, events, ctx])

  return (
    <div
      className="pvb-skills enter"
      aria-label="技能选择"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      {events.map((ev, index) => {
        const key = SKILL_KEYS[index] ?? String(index + 1)
        const isUlt = ev.id.includes('ult')
        const locked = isOptionLocked(ev, ctx)
        return (
          <button
            key={ev.id}
            type="button"
            className={`pvb-skill ${isUlt ? 'ult' : ''} ${picked === ev.id ? 'sel' : ''} ${locked ? 'dis' : ''}`}
            onClick={() => pick(ev.id, locked)}
            disabled={!!picked || locked}
          >
            <span className="pvb-sk-key">{key}</span>
            <span className="pvb-sk-nm">{ev.label ?? ev.id}</span>
          </button>
        )
      })}
    </div>
  )
}

const SKILL_CSS = `
.pvb-skills { position: absolute; z-index: 44; display: flex; flex-wrap: wrap; gap: 26px; justify-content: center; align-items: flex-end; min-height: 40px; padding: 8px 16px; transform: translate(-50%, -50%); pointer-events: auto; }
.pvb-skill { position: relative; display: flex; align-items: center; gap: 9px; cursor: pointer; background: none; border: none; padding: 4px; box-shadow: none; line-height: 1; color: #fbf6ec; transition: transform .14s ease, opacity .14s ease; }
.pvb-sk-key { position: relative; flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-weight: 800; font-size: 1.18rem; color: #efe7d6; z-index: 1; text-shadow: 0 2px 6px rgba(0,0,0,.85); }
.pvb-sk-key::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: 52% 48% 50% 50% / 50% 52% 48% 50%; background: linear-gradient(180deg, #2b2620, #0c0a08); border: 1.5px solid rgba(239,231,214,.5); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset, 0 2px 7px rgba(0,0,0,.6); filter: url(#inkRough); }
.pvb-sk-nm { font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif; font-size: 1.05rem; letter-spacing: .06em; text-shadow: 0 2px 5px rgba(0,0,0,.85); }
.pvb-skill.ult .pvb-sk-key { color: #ffe7a0; }
.pvb-skill.ult .pvb-sk-key::before { border-color: rgba(255,214,120,.75); box-shadow: 0 2px 6px rgba(0,0,0,.5) inset, 0 0 10px rgba(255,196,80,.35); }
.pvb-skill.ult .pvb-sk-nm { color: #ffe7a0; }
.pvb-skill:hover:not(.dis):not(:disabled) { transform: translateY(-2px); }
.pvb-skill.sel { transform: translateY(-3px) scale(1.04); }
.pvb-skill.dis, .pvb-skill:disabled { opacity: .38; cursor: not-allowed; filter: grayscale(.35); }
`
