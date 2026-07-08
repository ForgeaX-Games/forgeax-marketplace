import { useEffect, useRef, useState } from 'react'
import type { Scenario } from '../scenario/types'
import type { VarState } from './conditionEval'
import { injectStyleOnce } from '../styles/injectStyle'
import { ensureInkRoughFilter } from './inkRoughFilter'

const STAT_IDS = ['lizhi', 'foxing', 'yezhang', 'chi'] as const

interface Pulse {
  seq: number
  dir: 'up' | 'down'
  delta: number
}

/**
 * 左上四维属性条（对齐原型 .pvm-main-bar / .pvm-stat）——横向顶栏，靠左排列。
 * 数值变化时对应墨章脉冲(升绿/降红) + ±N 浮字，复刻原型 pulseMainStat。
 */
export function NarrativeStatsLayer({ scenario, vars }: { scenario: Scenario; vars: VarState }) {
  const defs = STAT_IDS.map((id) => scenario.variables?.[id])
  const hasAll = defs.every((d) => !!d)
  injectStyleOnce('narrative-stats-layer', STATS_CSS)
  ensureInkRoughFilter()

  const prevRef = useRef<Record<string, number>>({})
  const seqRef = useRef(0)
  const [pulses, setPulses] = useState<Record<string, Pulse>>({})

  useEffect(() => {
    if (!hasAll) return
    const next: Record<string, Pulse> = {}
    for (const id of STAT_IDS) {
      const def = scenario.variables![id]!
      const cur = vars[id] ?? def.initial
      const prev = prevRef.current[id]
      if (prev !== undefined && cur !== prev) {
        next[id] = { seq: ++seqRef.current, dir: cur > prev ? 'up' : 'down', delta: cur - prev }
      }
      prevRef.current[id] = cur
    }
    if (Object.keys(next).length > 0) {
      setPulses((p) => ({ ...p, ...next }))
      // 1.25s 后清除脉冲态(对齐原型动画时长)
      const ids = Object.keys(next)
      const timer = window.setTimeout(() => {
        setPulses((p) => {
          const copy = { ...p }
          for (const id of ids) if (next[id] && copy[id]?.seq === next[id]!.seq) delete copy[id]
          return copy
        })
      }, 1250)
      return () => window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars, hasAll])

  if (!hasAll) return null

  return (
    <div className="pvn-hud-layer pvm-main-extra">
      <div className="pvm-main-bar">
        <div className="pvm-stats" aria-label="四维属性">
          {STAT_IDS.map((id) => {
            const def = scenario.variables![id]!
            const v = vars[id] ?? def.initial
            const pulse = pulses[id]
            const cls = pulse ? ` pvm-stat--changed pvm-stat--pulse-${pulse.dir}` : ''
            return (
              <div key={id} className={`pvm-stat${cls}`} data-stat={id}>
                <span className="pvm-stat-l">{def.name}</span>
                <span className="pvm-stat-v">{v}</span>
                {pulse && pulse.delta !== 0 && (
                  <span key={pulse.seq} className={`pvm-stat-delta ${pulse.dir}`}>
                    {pulse.delta > 0 ? `+${pulse.delta}` : `${pulse.delta}`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// 对齐原型 新影游平台交互原型.html 的 .pvm-main-bar / .pvm-stat / pulse 动画
const STATS_CSS = `
.pvm-main-extra{position:absolute;inset:0;pointer-events:none;z-index:6;}
.pvm-main-bar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;
  padding:6px 10px 10px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,.25) 72%,transparent);pointer-events:none;}
.pvm-stats{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:6px;flex:0 1 auto;min-width:0;margin-right:auto;}
.pvm-stat{position:relative;flex:0 0 auto;display:flex;flex-direction:row;align-items:baseline;justify-content:center;gap:4px;
  padding:3px 8px 4px;white-space:nowrap;}
.pvm-stat::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:6px 7px 5px 6px/5px 6px 6px 5px;
  background:linear-gradient(180deg,rgba(43,38,32,.92),rgba(12,10,8,.88));border:1px solid rgba(239,231,214,.32);
  box-shadow:0 1px 5px rgba(0,0,0,.5) inset,0 1px 4px rgba(0,0,0,.4);filter:url(#inkRoughNarr);}
.pvm-stat-l{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:.67rem;font-weight:800;color:#c8b8a0;letter-spacing:1px;
  text-shadow:0 1px 3px rgba(0,0,0,.85);}
.pvm-stat-v{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:1.01rem;font-weight:800;color:#fbf6ec;letter-spacing:0;line-height:1;
  display:inline-block;text-shadow:0 0 2px rgba(0,0,0,.9),0 1px 3px rgba(0,0,0,.85);transition:color .2s,text-shadow .2s;}
.pvm-stat--changed .pvm-stat-v{color:#ffe3a6;text-shadow:0 0 8px rgba(255,210,120,.55),0 1px 3px rgba(0,0,0,.85);}
.pvm-stat--pulse-up .pvm-stat-v{animation:pvmStatPulseUp 1.25s linear forwards;}
.pvm-stat--pulse-down .pvm-stat-v{animation:pvmStatPulseDown 1.25s linear forwards;}
.pvm-stat--pulse-up::before,.pvm-stat--pulse-down::before{animation:pvmStatChipBump 1.25s linear forwards;}
.pvm-stat-delta{position:absolute;right:-1px;top:-7px;font-family:'HYShangWei','STKaiti','KaiTi',serif;
  font-size:.7rem;font-weight:800;line-height:1;pointer-events:none;white-space:nowrap;z-index:3;
  text-shadow:0 1px 4px rgba(0,0,0,.85);animation:pvmStatDeltaFloat 1.15s linear forwards;}
.pvm-stat-delta.up{color:#8ec498;text-shadow:0 0 8px rgba(120,170,128,.45),0 1px 4px rgba(0,0,0,.85);}
.pvm-stat-delta.down{color:#c8a0a4;text-shadow:0 0 8px rgba(176,130,134,.4),0 1px 4px rgba(0,0,0,.85);}
@keyframes pvmStatChipBump{0%{transform:translateY(0) scale(1);}14%{transform:translateY(-4px) scale(1.07);}100%{transform:translateY(0) scale(1);}}
@keyframes pvmStatDeltaFloat{0%{opacity:0;transform:translateY(6px) scale(.82);}14%{opacity:1;transform:translateY(0) scale(1.12);}100%{opacity:0;transform:translateY(-16px) scale(.92);}}
@keyframes pvmStatPulseUp{0%{transform:scale(1);color:#fbf6ec;}14%{transform:scale(1.18);color:#8ec498;text-shadow:0 0 12px rgba(120,170,128,.58),0 1px 3px rgba(0,0,0,.85);}100%{transform:scale(1);color:#ffe3a6;text-shadow:0 0 8px rgba(255,210,120,.55),0 1px 3px rgba(0,0,0,.85);}}
@keyframes pvmStatPulseDown{0%{transform:scale(1);color:#fbf6ec;}14%{transform:scale(1.14);color:#c8a0a4;text-shadow:0 0 12px rgba(176,130,134,.52),0 1px 3px rgba(0,0,0,.85);}100%{transform:scale(1);color:#ffe3a6;text-shadow:0 0 8px rgba(255,210,120,.55),0 1px 3px rgba(0,0,0,.85);}}
`
