/**
 * 防反 QTE 皮肤（component id: `battleParry`）—— 复刻旧原型视觉：
 * 右侧纵向居中、A 左下 / B 右上两枚水墨小键，RAF 收圈。
 *
 * 提交：默认 A→pass、B→good；有 inputs.events 时按 events[0]/[1].id 提交。
 * 超时 → defaultEvent ?? 'fail'。键位始终 A/B（不跟 event.label 走，避免长文案撑大按钮）。
 *
 * 预览态：本皮肤用 rAF + performance.now 自计时，CSS `is-paused` 冻不住——preview 时完全不启
 * rAF/超时，改按 previewTimeMs（相对 cues[0].appearAt）静态推导每个键的圈位/armed/sweet，
 * 也不吃点击/键盘。
 */
import { useEffect, useRef, useState } from 'react'
import { usePlayerKeyGate, type OverlayProps } from '../rendererRegistry'
import type { OverlayChild } from '../../schema/graph-schema'
import type { ComponentDef } from '../../registry/component-registry'
import { QTE_DEFAULT_EVENTS, QTE_INPUTS, type QteParams } from './Qte'
import { STAGE_FILL_LAYOUT } from '../../schema/layout'
import { injectCss, ensureInkFilters, ensureBrushFont, resolveTimeoutMs } from './skinRuntime'

/**
 * 组件的注册契约（引擎/编辑器识别用）——与渲染实现同文件，经 EXTRA_COMPONENTS 注册。
 */
export const battleParryComponent: ComponentDef<QteParams> = {
  label: '防反 QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
}

/** 皮肤默认玩法参数（出口 / 样式锁 / 新建预设共用）。 */
export const battleParryDefaults = {
  durationMs: 2600,
  events: [
    { id: 'pass', label: '防反' },
    { id: 'good', label: '闪避' },
    { id: 'fail', label: '受击' },
  ],
  defaultEvent: 'fail' as const,
}

/** OverlayChild 预设（顶栏 component = 皮肤 id）。 */
export function battleParryPreset(id: string): OverlayChild {
  return {
    id,
    component: 'battleParry',
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    // 显隐唯一 SSOT = window（运行时 el.window 存在即忽略 trigger）；收圈时长即默认可见窗。
    window: { startMs: 0, endMs: battleParryDefaults.durationMs },
    inputs: { ...battleParryDefaults },
  }
}

type ExitOpt = { key: string; glyph: 'A' | 'B' }

function exitsOf(inputs: Record<string, unknown>): ExitOpt[] {
  const events = inputs.events
  if (Array.isArray(events) && events.length >= 2) {
    const ids = events
      .filter((e): e is { id: string } => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string')
      .slice(0, 2)
      .map((e) => e.id)
    if (ids.length >= 2) {
      return [
        { key: ids[0]!, glyph: 'A' },
        { key: ids[1]!, glyph: 'B' },
      ]
    }
  }
  return [
    { key: 'pass', glyph: 'A' },
    { key: 'good', glyph: 'B' },
  ]
}

/** 本皮肤唯一一个 cue——挂着「整段窗口」的出现/消失时刻（时间轴左右缘直接落这两个字段）。 */
function firstCue(params: Record<string, unknown>): { appearAt?: unknown; endAt?: unknown } | undefined {
  const cues = params.cues
  return Array.isArray(cues) ? (cues[0] as { appearAt?: unknown; endAt?: unknown } | undefined) : undefined
}

/** cues[0].appearAt——preview 时把 previewTimeMs（绝对播放头）折成「防反窗自己的 now」。 */
function firstCueAppearAt(params: Record<string, unknown>): number {
  const first = firstCue(params)
  return typeof first?.appearAt === 'number' ? first.appearAt : 0
}

/**
 * 收圈总时长 —— 唯一 SSOT 是本皮肤那个 cue 的 [appearAt, endAt]（时间轴拖左右缘直接改的就是它）。
 * `inputs.durationMs`/`inputs.timeoutMs`/`inputs.windowMs` 仅在没有 cue 时才顶上，
 * 避免拖时间轴改了窗口、动画时长却纹丝不动。
 */
function resolveDurationMs(inputs: Record<string, unknown>): number {
  const cue = firstCue(inputs)
  if (typeof cue?.appearAt === 'number' && typeof cue?.endAt === 'number' && cue.endAt > cue.appearAt) {
    return cue.endAt - cue.appearAt
  }
  return (typeof inputs.durationMs === 'number' ? inputs.durationMs : undefined)
    ?? resolveTimeoutMs(inputs)
    ?? 2600
}

/** 单帧圈位/armed/sweet 计算——rAF 实跑与 preview 静态推导共用，避免两套判定漂移。 */
function applyKeyFrame(el: HTMLButtonElement, now: number, center: number, approach: number, tol: number): void {
  const ring = el.querySelector<HTMLElement>('.pvb-key-ring')
  const setRing = (scale: number): void => {
    if (ring) ring.style.transform = `scale(${scale.toFixed(3)})`
  }
  if (now < center - approach) {
    el.classList.remove('armed', 'sweet')
    setRing(2.4)
    return
  }
  if (now <= center + tol + 160) {
    el.classList.add('armed')
    const s = now <= center ? 1 + 1.4 * ((center - now) / approach) : 1 - 0.3 * Math.min(1, (now - center) / (tol + 160))
    setRing(s)
    if (now >= center - tol && now <= center + tol) el.classList.add('sweet')
    else el.classList.remove('sweet')
    return
  }
  el.classList.remove('armed', 'sweet')
  setRing(1)
}

export function BattleParryLayer({ overlay, emit, preview, previewTimeMs }: OverlayProps) {
  injectCss('battle-parry-layer', PARRY_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const keyOk = usePlayerKeyGate()
  const inputs = overlay.inputs as Record<string, unknown>
  const durationMs = resolveDurationMs(inputs)
  const options = exitsOf(inputs)
  const missKey = typeof inputs.defaultEvent === 'string' ? inputs.defaultEvent : 'fail'
  const resolvedRef = useRef(false)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [settled, setSettled] = useState<{ kind: 'hit'; index: number } | { kind: 'miss' } | null>(null)
  const previewNow = preview ? Math.max(0, (previewTimeMs ?? 0) - firstCueAppearAt(inputs)) : 0

  function finish(outcome: string): void {
    if (resolvedRef.current) return
    resolvedRef.current = true
    emit?.(outcome)
  }
  function hit(index: number): void {
    if (preview || resolvedRef.current) return
    setSettled({ kind: 'hit', index })
    window.setTimeout(() => finish(options[index]?.key ?? missKey), 180)
  }

  // 预览态：不启 rAF/超时——每次播放头/参数变化按 previewNow 静态定帧，供 scrub 精确对齐。
  useEffect(() => {
    if (!preview) return
    const D = durationMs
    const approach = Math.min(750, D * 0.24)
    const tol = Math.min(240, D * 0.13)
    btnRefs.current.forEach((el, i) => {
      if (!el) return
      const center = i === 0 ? D * 0.32 : D * 0.72
      applyKeyFrame(el, previewNow, center, approach, tol)
    })
  }, [preview, previewNow, durationMs, options.length])

  useEffect(() => {
    if (preview) return
    const D = durationMs
    const approach = Math.min(750, D * 0.24)
    const tol = Math.min(240, D * 0.13)
    const centers = options.map((_, i) => (i === 0 ? D * 0.32 : D * 0.72))
    const start = performance.now()
    let raf = 0
    function loop(): void {
      if (resolvedRef.current) return
      const now = performance.now() - start
      btnRefs.current.forEach((el, i) => {
        if (!el) return
        applyKeyFrame(el, now, centers[i] ?? D * 0.5, approach, tol)
      })
      if (now >= D + 200) {
        setSettled({ kind: 'miss' })
        window.setTimeout(() => finish(missKey), 180)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    function onKeyDown(e: KeyboardEvent): void {
      if (!keyOk()) return
      const index = options.findIndex((o) => o.glyph.toLowerCase() === e.key.toLowerCase())
      if (index < 0) return
      e.preventDefault()
      hit(index)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, missKey, preview])

  return (
    <div className={`pvb-parry show${preview ? ' is-frozen' : ''}`} aria-label="防反 QTE">
      <div className="pvb-parry-keys">
        {options.map((option, index) => {
          const hitHere = settled?.kind === 'hit' && settled.index === index
          const missed = settled?.kind === 'miss'
          const cls = hitHere ? 'good hit' : missed ? 'miss' : ''
          return (
            <button
              key={option.key}
              ref={(el) => {
                btnRefs.current[index] = el
              }}
              type="button"
              className={`pvb-key ${cls}`}
              aria-label={option.glyph}
              onClick={() => hit(index)}
              disabled={!!settled || preview}
            >
              <span className="pvb-key-ring" />
              <span className="pvb-key-label">{option.glyph}</span>
              {hitHere && <span className="pvb-key-spark" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 严格复刻旧 Hud/BattleParry：右侧居中、水墨键、A 左下 / B 右上。尺寸用 cqmin（容器查询单位，
 * 取舞台宽高中较小一边——见 VideoOverlayStage.tsx 的 containerType:'size'）而非固定 px，
 * 使键区在预览小窗和全屏试玩里保持同一个相对舞台的比例，不再是两套绝对像素。
 */
const PARRY_CSS = `
.pvb-parry{position:absolute;right:8%;top:48%;transform:translateY(-50%);z-index:46;display:none;flex-direction:column;align-items:center;gap:1.3cqh;cursor:pointer;user-select:none;pointer-events:auto}
.pvb-parry.show{display:flex}
.pvb-parry.is-frozen{pointer-events:none!important;cursor:default}
.pvb-parry-keys{position:relative;width:18cqmin;height:15cqmin}
.pvb-parry-keys .pvb-key:nth-child(1){position:absolute;left:0;bottom:0}
.pvb-parry-keys .pvb-key:nth-child(2){position:absolute;right:0;top:0}
.pvb-key{position:relative;width:7cqmin;height:7cqmin;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.5;transform:scale(.86);transition:opacity .14s,transform .14s,filter .14s;background:none;border:none;padding:0}
.pvb-key::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.5);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.6);filter:url(#inkRough);transition:border-color .14s,background-color .14s}
.pvb-key.armed{opacity:1;transform:scale(1)}
.pvb-key.armed::before{border-color:#ffd9a8;box-shadow:0 0 16px rgba(255,200,120,.5),0 2px 6px rgba(0,0,0,.5) inset}
.pvb-key-ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(243,234,216,.55);transform:scale(2.4);transform-origin:center;pointer-events:none;opacity:0;z-index:1}
.pvb-key.armed .pvb-key-ring{opacity:.9}
.pvb-key.sweet .pvb-key-ring{border-color:rgba(95,224,138,.9);box-shadow:0 0 12px rgba(95,224,138,.6)}
.pvb-key.sweet{transform:scale(1.08)}
.pvb-key.sweet::before{border-color:#5fe08a;box-shadow:0 0 20px rgba(95,224,138,.8),0 2px 6px rgba(0,0,0,.5) inset}
.pvb-key.good{opacity:1;transform:scale(1.16)}
.pvb-key.good::before{border-color:#5fe08a;background:linear-gradient(180deg,#234a32,#0e2417);box-shadow:0 0 22px rgba(95,224,138,.95)}
.pvb-key.hit{animation:pvbKeyHit .4s ease}
@keyframes pvbKeyHit{0%{transform:scale(1.5)}45%{transform:scale(.92)}100%{transform:scale(1.16)}}
.pvb-key-spark{position:absolute;inset:-12px;border-radius:50%;border:2.5px solid #7dffae;pointer-events:none;z-index:3;box-shadow:0 0 18px rgba(125,255,174,.8);animation:pvbKeySpark .5s ease forwards}
@keyframes pvbKeySpark{0%{transform:scale(.45);opacity:.95}100%{transform:scale(2);opacity:0}}
.pvb-key.miss{opacity:.4}
.pvb-key.miss::before{border-color:#ff6a5a;background:linear-gradient(180deg,#3a201d,#16100e)}
.pvb-key-label{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:2.6cqh;font-weight:800;color:#efe7d6;z-index:2;text-shadow:0 2px 6px rgba(0,0,0,.85);pointer-events:none}
`
