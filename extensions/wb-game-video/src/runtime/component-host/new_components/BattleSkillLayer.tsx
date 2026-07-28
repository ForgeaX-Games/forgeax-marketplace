/**
 * 战斗技能条（component id: `battleSkillBar`）—— 固定展示轻攻击、重攻击、冥想、灭世。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责显示与点击交互。
 */
import { useRef, useState } from 'react'
import type { OverlayProps } from '../rendererRegistry'
import type { ComponentDef } from '../../registry/component-registry'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export const battleSkillBarComponent: ComponentDef = {
  label: '战斗技能条',
  events: [
    { id: 'light', label: '轻攻击' },
    { id: 'heavy', label: '重攻击' },
    { id: 'medit', label: '冥想' },
    { id: 'ult', label: '灭世' },
  ],
  inputs: [],
}

export function BattleSkillLayer({ emit, preview }: OverlayProps) {
  injectCss('battle-skill-layer', SKILL_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const pickedRef = useRef(false)
  const [picked, setPicked] = useState<string | null>(null)

  function pick(id: string): void {
    if (preview || pickedRef.current) return
    pickedRef.current = true
    setPicked(id)
    emit?.(id)
  }

  return (
    <div className="pvb-skills" aria-label="技能选择">
      <button type="button" className={`pvb-skill${picked === 'light' ? ' selected' : ''}`} aria-label="轻攻击" disabled={preview || !!picked} onClick={() => pick('light')}>
        <span className="pvb-sk-nm">轻攻击</span>
      </button>
      <button type="button" className={`pvb-skill${picked === 'heavy' ? ' selected' : ''}`} aria-label="重攻击" disabled={preview || !!picked} onClick={() => pick('heavy')}>
        <span className="pvb-sk-nm">重攻击</span>
      </button>
      <button type="button" className={`pvb-skill${picked === 'medit' ? ' selected' : ''}`} aria-label="冥想" disabled={preview || !!picked} onClick={() => pick('medit')}>
        <span className="pvb-sk-nm">冥想</span>
      </button>
      <button type="button" className={`pvb-skill${picked === 'ult' ? ' selected' : ''}`} aria-label="灭世" disabled={preview || !!picked} onClick={() => pick('ult')}>
        <span className="pvb-sk-nm">灭世</span>
      </button>
    </div>
  )
}

const SKILL_CSS = `
.pvb-skills{position:relative;inline-size:100%;block-size:100%;z-index:44;display:flex;gap:2.4cqmin;justify-content:center;align-items:center;pointer-events:none}
.pvb-skill{position:relative;display:flex;align-items:center;justify-content:center;min-inline-size:5cqmin;min-block-size:5cqmin;cursor:pointer;background:none;border:none;padding:4px;color:#fbf6ec;transition:transform .14s ease,opacity .14s ease;pointer-events:auto}
.pvb-skill::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.5);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.6);filter:url(#inkRough)}
.pvb-skill:hover:not(:disabled){transform:translateY(-2px) scale(1.03)}
.pvb-skill.selected{transform:translateY(-3px) scale(1.04)}
.pvb-skill.selected::before{border-color:#5fe08a;background:linear-gradient(180deg,#234a32,#0e2417);box-shadow:0 0 20px rgba(95,224,138,.8),0 2px 6px rgba(0,0,0,.5) inset}
.pvb-skill:disabled{opacity:.38;cursor:not-allowed}
.pvb-sk-nm{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:2.1cqh;letter-spacing:.06em;text-shadow:0 2px 5px rgba(0,0,0,.85)}
`
