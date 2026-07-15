/**
 * 叩击 QTE 皮肤（component id: `inkKou`）—— 从旧 player/InkKouLayer 迁移。
 *
 * 单点：点击/空格/回车 → submit('pass')；超时未叩 → submit('fail')。
 * 时限同源：interaction.timeoutMs（引擎从 timeoutMs/windowMs/durationMs 归一）>
 * params.timeoutMs > params.windowMs > params.durationMs > 1500。
 * 引擎已挂 timeoutMs 时由 Player 自动 submit(undefined)→fail，皮肤不再自管超时。
 */
import { useEffect, useRef } from 'react'
import { usePlayerKeyGate, type InteractionProps } from '../rendererRegistry'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export function InkKouLayer({ interaction, submit }: InteractionProps) {
  injectCss('ink-kou-layer', KOU_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const keyOk = usePlayerKeyGate()
  const p = interaction.params as {
    glyph?: string
    anchorX?: number
    anchorY?: number
    durationMs?: number
    timeoutMs?: number
    windowMs?: number
    outcomeLabels?: Record<string, string>
  }
  const glyph = p.glyph ?? '叩'
  const passHint = p.outcomeLabels?.pass ?? `${glyph}，空格键或点击确认`
  const anchorX = p.anchorX ?? 0.58
  const anchorY = p.anchorY ?? 0.39
  const engineTimeout = interaction.timeoutMs
  const durationMs =
    engineTimeout
    ?? (typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined)
    ?? (typeof p.windowMs === 'number' ? p.windowMs : undefined)
    ?? (typeof p.durationMs === 'number' ? p.durationMs : undefined)
    ?? 1500
  const resolvedRef = useRef(false)

  function finish(outcome: 'pass' | 'fail'): void {
    if (resolvedRef.current) return
    resolvedRef.current = true
    submit(outcome)
  }

  useEffect(() => {
    // 引擎已管超时（Player 到时 submit(undefined)→fail）时皮肤只响应命中，不双开定时器。
    const timeout = engineTimeout
      ? undefined
      : window.setTimeout(() => finish('fail'), durationMs)
    function onKeyDown(e: KeyboardEvent): void {
      if (!keyOk()) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        finish('pass')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, engineTimeout])

  const anchorStyle = {
    ['--pvn-opt-x' as string]: `${anchorX * 100}%`,
    ['--pvn-opt-y' as string]: `${anchorY * 100}%`,
  }
  return (
    <div className="pvn-opts pvn-opts--kou pvn-opts--anchored show" style={anchorStyle} aria-label="叩 QTE">
      <button type="button" className="pvn-opt pvn-opt--kou" aria-label={passHint} onClick={() => finish('pass')}>
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
    </div>
  )
}

const KOU_CSS = `
.pvn-opts--kou{position:absolute;inset:0;z-index:6;pointer-events:none;}
.pvn-opts--kou.show{pointer-events:auto;}
.pvn-opts--kou.pvn-opts--anchored .pvn-opt--kou{position:absolute;left:var(--pvn-opt-x,58%);top:var(--pvn-opt-y,39%);transform:translate(-50%,-86%);}
.pvn-opts--kou.pvn-opts--anchored .pvn-opt--kou:hover{transform:translate(-50%,calc(-86% - 2px)) scale(1.03);}
.pvn-opt--kou{border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(2rem,5.5vw,3.2rem);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;opacity:0;animation:pvnKouHintIn .5s ease .38s forwards;}
.pvn-kou-space{display:block;width:2.85em;height:.58em;position:relative;background:transparent;border:none;filter:url(#inkRoughNarr);animation:pvnKouSpacePulse 2.6s ease-in-out infinite;}
.pvn-kou-space::before{content:'';position:absolute;left:0;right:0;bottom:0;top:0;box-sizing:border-box;border-left:2px solid rgba(232,224,208,.86);border-right:2px solid rgba(232,224,208,.86);border-bottom:2.5px solid rgba(244,239,228,.94);border-top:none;border-radius:1px 1px 3px 3px/1px 1px 2px 2px;box-shadow:0 1px 0 rgba(255,252,244,.06) inset,0 0 10px rgba(255,248,235,.06);}
@keyframes pvnKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnKouHintIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes pvnKouSpacePulse{0%,100%{filter:url(#inkRoughNarr) brightness(1);}50%{filter:url(#inkRoughNarr) brightness(1.12);}}
`
