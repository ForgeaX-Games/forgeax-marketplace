import { useEffect, useMemo, useState } from 'react'
import type { Branch, Scene } from '../scenario/types'
import { injectInkFilterOnce, injectStyleOnce } from '../styles/injectStyle'
import { injectBrushFontOnce } from '../styles/brushFont'
import {
  describeCondition,
  isBranchAvailable,
  type EntityHpView,
  type ItemState,
  type VarState,
} from './conditionEval'
import { useScenarioStore } from '../scenario/scenarioStore'

interface Props {
  scene: Scene
  onPick: (b: Branch) => void
  vars?: VarState
  visitedSceneIds?: string[]
  ownedItems?: ItemState
  entities?: Record<string, EntityHpView>
  score?: number
}

const SKILL_KEYS = ['X', 'A', 'Y', 'B'] as const

export function isBattleSkillChoice(scene: Scene | undefined): boolean {
  return scene?.choice?.ui === 'battleSkillBar'
}

export function BattleSkillLayer({
  scene,
  onPick,
  vars,
  visitedSceneIds,
  ownedItems,
  entities,
  score,
}: Props) {
  injectStyleOnce('battle-skill-layer', SKILL_CSS)
  injectInkFilterOnce()
  injectBrushFontOnce()
  const scenario = useScenarioStore((s) => s.scenario)
  const [picked, setPicked] = useState<string | null>(null)
  const ctx = useMemo(
    () => ({
      vars: vars ?? {},
      visitedSceneIds: new Set(visitedSceneIds ?? []),
      ownedItems: ownedItems ?? {},
      entities: entities ?? {},
      score: score ?? 0,
    }),
    [vars, visitedSceneIds, ownedItems, entities, score],
  )
  const skills = useMemo(() => {
    return scene.branches
      .filter((b) => b.kind === 'choice')
      .map((branch) => {
        const available = isBranchAvailable(branch, ctx)
        const locked = !available && (branch.gateMode ?? 'hide') === 'lock'
        return { branch, available, locked }
      })
      .filter((s) => s.available || s.locked)
  }, [scene.branches, ctx])

  useEffect(() => {
    setPicked(null)
  }, [scene.id])

  function pick(branch: Branch, locked: boolean): void {
    if (picked || locked) return
    setPicked(branch.id)
    onPick(branch)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (picked) return
      const key = e.key.toUpperCase()
      const index = SKILL_KEYS.findIndex((k) => k === key)
      if (index < 0) return
      const skill = skills[index]
      if (!skill) return
      e.preventDefault()
      pick(skill.branch, skill.locked)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, skills])

  return (
    <div className="pvb-skills enter" aria-label="技能选择">
      {skills.map(({ branch, locked }, index) => {
        const key = SKILL_KEYS[index] ?? String(index + 1)
        const lockHint = locked ? describeCondition(branch, scenario) : ''
        return (
          <button
            key={branch.id}
            type="button"
            className={`pvb-skill ${branch.id.includes('ult') ? 'ult' : ''} ${picked === branch.id ? 'sel' : ''} ${locked ? 'dis' : ''}`}
            onClick={() => pick(branch, locked)}
            disabled={!!picked || locked}
            title={locked && lockHint ? `需要 ${lockHint}` : undefined}
          >
            <span className="pvb-sk-key">{key}</span>
            <span className="pvb-sk-nm">{branch.label ?? branch.id}</span>
          </button>
        )
      })}
    </div>
  )
}

const SKILL_CSS = `
.pvb-skills {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  z-index: 44;
  display: flex;
  flex-wrap: wrap;
  gap: 26px;
  justify-content: center;
  align-items: flex-end;
  min-height: 40px;
  padding: 34px 16px 18px;
  background: linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,.2) 60%, transparent);
  pointer-events: auto;
}
.pvb-skill {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 4px;
  box-shadow: none;
  line-height: 1;
  color: #fbf6ec;
  transition: transform .14s ease, opacity .14s ease;
}
.pvb-sk-key {
  position: relative;
  flex: none;
  width: 36px; height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif;
  font-weight: 800;
  font-size: 1.18rem;
  color: #efe7d6;
  z-index: 1;
  text-shadow: 0 2px 6px rgba(0,0,0,.85);
}
/* 按键水墨圆章（X / A / Y / B）—— 深墨底 + inkRough 毛边，与血条统一 */
.pvb-sk-key::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: 52% 48% 50% 50% / 50% 52% 48% 50%;
  background: linear-gradient(180deg, #2b2620, #0c0a08);
  border: 1.5px solid rgba(239,231,214,.5);
  box-shadow: 0 2px 6px rgba(0,0,0,.5) inset, 0 2px 7px rgba(0,0,0,.6);
  filter: url(#inkRough);
}
.pvb-sk-nm {
  position: relative;
  font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif;
  font-weight: 800;
  font-size: 1.32rem;
  letter-spacing: 2px;
  color: #fbf6ec;
  text-shadow: 0 0 2px rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.8);
  transition: color .12s;
}
/*
 * 技能名下的水墨红「横线」：hover / 选中时从左向右刷开（scaleX .55→1 + 透明度 0→1）。
 * 注意：这里不套 #inkRough 毛边——该滤镜的纵向高频位移(scale≈3)会把这条仅 7px 高、
 * 两端透明的细线打散到几乎不可见（血条是实心厚条所以没事）；横线的毛笔形态改由
 * border-radius 的不规则圆角提供，保证刷开动画清晰可见。
 */
.pvb-sk-nm::after {
  content: '';
  position: absolute;
  left: -3px; right: -5px; bottom: -7px;
  height: 7px;
  border-radius: 60% 40% 55% 45% / 100% 100% 90% 100%;
  opacity: 0;
  transform: scaleX(.55);
  transform-origin: left center;
  background: linear-gradient(90deg, transparent, #b5301f 12%, #e0452e 50%, #b5301f 88%, transparent);
  transition: opacity .15s ease, transform .15s ease;
}
/* 覆盖全局 button:hover:not(:disabled) 的背景/文字色（技能键是透明水墨图标，不要方块底色） */
.pvb-skill:not(.dis):hover,
.pvb-skill:not(.dis):focus,
.pvb-skill:not(.dis):focus-visible { background: none; color: #fbf6ec; }
.pvb-skill:not(.dis):hover { transform: translateY(-2px); }
.pvb-skill:not(.dis):hover .pvb-sk-nm,
.pvb-skill.sel:not(.dis) .pvb-sk-nm { color: #e0452e; }
.pvb-skill:not(.dis):hover .pvb-sk-nm::after,
.pvb-skill.sel:not(.dis) .pvb-sk-nm::after { opacity: 1; transform: scaleX(1); }
.pvb-skill.ult:not(.dis) .pvb-sk-nm { color: #ffd98a; }
.pvb-skill.dis { opacity: .5; cursor: not-allowed; }
@keyframes pvbSkillIn {
  0% { opacity: 0; transform: translateY(20px) scale(.86); }
  60% { opacity: 1; transform: translateY(-3px) scale(1.06); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.pvb-skills.enter .pvb-skill { animation: pvbSkillIn .34s ease both; }
.pvb-skills.enter .pvb-skill:nth-child(1) { animation-delay: .02s; }
.pvb-skills.enter .pvb-skill:nth-child(2) { animation-delay: .09s; }
.pvb-skills.enter .pvb-skill:nth-child(3) { animation-delay: .16s; }
.pvb-skills.enter .pvb-skill:nth-child(4) { animation-delay: .23s; }
`
