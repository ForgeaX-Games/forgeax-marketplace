/**
 * 叩击 QTE 皮肤（component id: `inkKou`）—— 单点「叩」字拍点，支持多拍点组合。
 *
 * cues 决定拍点数、位置、时序；皮肤提供形状 + 动画 + 默认锚点。
 *  - 运行态：RAF 相对时钟；窗内 ±perfectMs 于 targetAt = 完美，窗内其余 = 成功，窗外/超时 = 失败。
 *  - 预览态：播放头 previewTimeMs 驱动显隐 + CSS 负 delay 冻结入场动画。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePlayerKeyGate, type OverlayProps } from '../rendererRegistry'
import type { OverlayChild } from '../../schema/graph-schema'
import type { ComponentDef } from '../../registry/component-registry'
import { QTE_DEFAULT_EVENTS, QTE_INPUTS, type QteParams } from './Qte'
import { STAGE_FILL_LAYOUT } from '../../schema/layout'
import { injectCss, ensureInkFilters, ensureBrushFont, previewFreezeClass, previewTStyle, resolveTimeoutMs, useDefaultEventTimeout } from './skinRuntime'

/**
 * 组件的注册契约（引擎/编辑器识别用）——与渲染实现同文件，经 EXTRA_COMPONENTS 注册。
 * inputs 复用 qte 系共享表；出口缺省回退 QTE_DEFAULT_EVENTS（preset 会写入 inputs.events）。
 */
export const inkKouComponent: ComponentDef<QteParams> = {
  label: '叩击 QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
}

/** 皮肤默认玩法参数（出口 / 新建预设共用）。 */
export const inkKouDefaults = {
  glyph: '叩',
  events: [
    { id: 'pass', label: '完美' },
    { id: 'fail', label: '失败' },
  ],
  defaultEvent: 'fail',
  cues: [{ id: 'k0', x: 0.5, y: 0.45, appearAt: 0, targetAt: 400, endAt: 1000 }],
}

/** OverlayChild 预设（顶栏 component = 皮肤 id）。 */
export function inkKouPreset(id: string): OverlayChild {
  return {
    id,
    component: 'inkKou',
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    inputs: { ...inkKouDefaults },
  }
}

interface KouCueParam {
  id?: string
  x?: number
  y?: number
  appearAt?: number
  targetAt?: number
  endAt?: number
  durationMs?: number
}
interface KouItem {
  key: string
  x: number
  y: number
  absAppear: number
  absEnd: number
  absTarget?: number
  appear: number
  end: number
}
type HitTier = 'perfect' | 'good'

export function InkKouLayer({ overlay, emit, preview, previewTimeMs }: OverlayProps) {
  injectCss('ink-kou-layer', KOU_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const keyOk = usePlayerKeyGate()
  const p = overlay.inputs as {
    glyph?: string
    anchorX?: number
    anchorY?: number
    durationMs?: number
    timeoutMs?: number
    windowMs?: number
    perfectMs?: number
    defaultEvent?: string
    cues?: KouCueParam[]
    passingHits?: number
    events?: Array<{ id: string; label?: string }>
  }
  const glyph = p.glyph ?? '叩'
  const passLabel = p.events?.find((e) => e.id === 'pass')?.label
  const passHint = passLabel ?? `${glyph}，空格键或点击确认`
  const hasCues = Array.isArray(p.cues) && p.cues.length > 0
  useDefaultEventTimeout(emit, hasCues ? undefined : (p as Record<string, unknown>), preview)
  const perfectMs = typeof p.perfectMs === 'number' && p.perfectMs > 0 ? p.perfectMs : undefined

  const items = useMemo<KouItem[]>(() => {
    const raw =
      hasCues && p.cues
        ? p.cues
        : [{ x: p.anchorX ?? 0.58, y: p.anchorY ?? 0.39, durationMs: p.durationMs }]
    const base = Math.min(...raw.map((c) => c.appearAt ?? 0))
    return raw.map((c, i) => {
      const absAppear = c.appearAt ?? 0
      const dur = c.durationMs ?? p.durationMs ?? 1500
      const absEnd = c.endAt != null ? Math.max(absAppear + 200, c.endAt) : absAppear + dur
      return {
        key: c.id ?? `kou${i}`,
        x: c.x ?? p.anchorX ?? 0.58,
        y: c.y ?? p.anchorY ?? 0.39,
        absAppear,
        absEnd,
        absTarget: c.targetAt,
        appear: Math.max(0, absAppear - base),
        end: Math.max(0, absEnd - base),
      }
    })
  }, [p, hasCues])

  const baseAbs = useMemo(() => Math.min(...items.map((c) => c.absAppear)), [items])
  const need = p.passingHits ?? items.length
  const timeoutCap = resolveTimeoutMs(p as Record<string, unknown>)
  const maxEnd = useMemo(() => {
    const skinEnd = Math.max(...items.map((c) => c.end))
    return timeoutCap ? Math.min(skinEnd, Math.max(200, timeoutCap)) : skinEnd
  }, [items, timeoutCap])
  const startRef = useRef(0)
  const hitRef = useRef<Map<string, HitTier>>(new Map())
  const resolvedRef = useRef(false)
  const [nowMs, setNowMs] = useState(0)

  function classifyHit(tAbs: number, c: KouItem): HitTier | null {
    if (tAbs < c.absAppear || tAbs > c.absEnd) return null
    if (perfectMs != null && c.absTarget != null && Math.abs(tAbs - c.absTarget) <= perfectMs) return 'perfect'
    if (perfectMs != null && c.absTarget != null) return 'good'
    return 'perfect'
  }

  /** 档位映射到已声明 events（inkKou 默认只有 pass/fail；无 good 时半成功落 pass）。 */
  function finish(tier: 'pass' | 'good' | 'fail'): void {
    if (resolvedRef.current) return
    resolvedRef.current = true
    const declared = new Set(
      (Array.isArray(p.events) ? p.events : [])
        .map((e) => (e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' ? (e as { id: string }).id : ''))
        .filter(Boolean),
    )
    let outcome: string = tier
    if (tier === 'good' && !declared.has('good')) {
      outcome = declared.has('pass') ? 'pass' : (typeof p.defaultEvent === 'string' && p.defaultEvent ? p.defaultEvent : 'fail')
    } else if (tier === 'pass' && declared.size > 0 && !declared.has('pass')) {
      outcome = [...declared][0]!
    } else if (tier === 'fail' && declared.size > 0 && !declared.has('fail')) {
      outcome = typeof p.defaultEvent === 'string' && p.defaultEvent ? p.defaultEvent : [...declared][declared.size - 1]!
    }
    emit?.(outcome)
  }

  function resolveOutcome(hits: Map<string, HitTier>): void {
    const n = hits.size
    const allPerfect = n >= items.length && items.every((c) => hits.get(c.key) === 'perfect')
    if (allPerfect) finish('pass')
    else if (n >= need) finish('good')
    else finish('fail')
  }

  useEffect(() => {
    if (preview) return
    resolvedRef.current = false
    hitRef.current = new Map()
    startRef.current = performance.now()
    let raf = 0
    const tick = (): void => {
      const t = performance.now() - startRef.current
      setNowMs(t)
      if (t >= maxEnd && !resolvedRef.current) {
        resolveOutcome(hitRef.current)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxEnd, preview])

  function hitCue(key: string, tAbs: number): void {
    if (preview || resolvedRef.current) return
    const c = items.find((x) => x.key === key)
    if (!c || hitRef.current.has(key)) return
    const tier = classifyHit(tAbs, c)
    if (!tier) return
    hitRef.current.set(key, tier)
    if (hitRef.current.size >= items.length) resolveOutcome(hitRef.current)
    setNowMs(tAbs - baseAbs)
  }

  useEffect(() => {
    if (preview) return
    function onKeyDown(e: KeyboardEvent): void {
      if (!keyOk()) return
      if (e.key !== ' ' && e.key !== 'Enter') return
      e.preventDefault()
      const tRel = performance.now() - startRef.current
      const tAbs = baseAbs + tRel
      const c = items.find((x) => {
        if (hitRef.current.has(x.key)) return false
        return classifyHit(tAbs, x) != null
      })
      if (c) hitCue(c.key, tAbs)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, preview, perfectMs, baseAbs])

  const t = preview ? (previewTimeMs ?? 0) : 0
  return (
    <div className={`pvn-opts pvn-opts--kou pvn-opts--anchored show${previewFreezeClass(preview)}`} aria-label="叩 QTE">
      {items.map((c) => {
        const hit = hitRef.current.has(c.key)
        const active = preview
          ? t >= c.absAppear && t <= c.absEnd
          : nowMs >= c.appear && nowMs <= c.end && !hit
        if (!active) return null
        const anchorStyle: Record<string, string> = {
          ['--pvn-opt-x']: `${c.x * 100}%`,
          ['--pvn-opt-y']: `${c.y * 100}%`,
        }
        if (preview) Object.assign(anchorStyle, previewTStyle(t - c.absAppear))
        return (
          <button
            key={c.key}
            type="button"
            className="pvn-opt pvn-opt--kou"
            style={anchorStyle as CSSProperties}
            aria-label={passHint}
            onClick={() => hitCue(c.key, preview ? t : baseAbs + (performance.now() - startRef.current))}
          >
            <span className="pvn-kou-orn" aria-hidden="true">
              <i className="pvn-kou-dot" />
              <i className="pvn-kou-diamond" />
              <i className="pvn-kou-dot" />
            </span>
            <span className="pvn-kou-glyph">{glyph}</span>
            <span className="pvn-kou-hint" aria-hidden="true">
              <i className="pvn-kou-space" />
            </span>
          </button>
        )
      })}
    </div>
  )
}

// 「叩」字号用 cqh/cqmin（相对舞台，见 VideoOverlayStage.tsx 的 containerType:'size'）取代 vw，
// vw 相对浏览器视口，预览小窗和全屏试玩里同一份配置会呈现出完全不同的物理大小。
const KOU_CSS = `
.pvn-opts--kou{position:absolute;inset:0;z-index:6;pointer-events:none;}
.pvn-opts--kou.show{pointer-events:auto;}
.pvn-opts--kou.is-frozen{pointer-events:none!important;}
.pvn-opts--kou.is-frozen .pvn-kou-orn,.pvn-opts--kou.is-frozen .pvn-kou-glyph,.pvn-opts--kou.is-frozen .pvn-kou-hint,.pvn-opts--kou.is-frozen .pvn-kou-space{animation-play-state:paused;}
.pvn-opts--kou.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-glyph{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-hint{animation-delay:calc(0.38s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-space{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--kou.pvn-opts--anchored .pvn-opt--kou{position:absolute;left:var(--pvn-opt-x,58%);top:var(--pvn-opt-y,39%);transform:translate(-50%,-86%);}
.pvn-opts--kou.pvn-opts--anchored .pvn-opt--kou:hover{transform:translate(-50%,calc(-86% - 2px)) scale(1.03);}
.pvn-opt--kou{border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(4cqh,6cqmin,9cqh);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;opacity:0;animation:pvnKouHintIn .5s ease .38s forwards;}
.pvn-kou-space{display:block;width:2.85em;height:.58em;position:relative;background:transparent;border:none;filter:url(#inkRoughNarr);animation:pvnKouSpacePulse 2.6s ease-in-out infinite;}
.pvn-kou-space::before{content:'';position:absolute;left:0;right:0;bottom:0;top:0;box-sizing:border-box;border-left:2px solid rgba(232,224,208,.86);border-right:2px solid rgba(232,224,208,.86);border-bottom:2.5px solid rgba(244,239,228,.94);border-top:none;border-radius:1px 1px 3px 3px/1px 1px 2px 2px;box-shadow:0 1px 0 rgba(255,252,244,.06) inset,0 0 10px rgba(255,248,235,.06);}
@keyframes pvnKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnKouHintIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes pvnKouSpacePulse{0%,100%{filter:url(#inkRoughNarr) brightness(1);}50%{filter:url(#inkRoughNarr) brightness(1.12);}}
`
