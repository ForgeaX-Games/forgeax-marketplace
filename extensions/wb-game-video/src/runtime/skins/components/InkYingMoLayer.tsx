/**
 * 應/默 限时抉择皮肤（component id: `inkYingMo`）—— 从旧 player/InkYingMoLayer 迁移。
 *
 * 读 InteractionSnap.params.options（水墨字形取 option.label，如「應」「默」）；点击/键盘(A/E=第0项, B/Q=第1项) → submit(key)。
 * 超时默认由引擎按 params.timeoutMs/defaultKey 自动 submit(undefined) 处理，皮肤不再自管计时。
 */
import { useEffect, useRef } from 'react'
import { usePlayerKeyGate, type InteractionProps } from '../rendererRegistry'
import type { ChoiceParams } from '../../registry/core-kinds'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

const KEY_LABELS = ['A', 'B'] as const

export function InkYingMoLayer({ interaction, submit }: InteractionProps) {
  injectCss('ink-yingmo-layer', YINGMO_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const keyOk = usePlayerKeyGate()
  const options = ((interaction.params as unknown as ChoiceParams).options ?? []).slice(0, 2)
  const pickedRef = useRef(false)

  function pick(key: string): void {
    if (pickedRef.current) return
    pickedRef.current = true
    submit(key)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!keyOk()) return
      const k = e.key.toLowerCase()
      let idx = -1
      if (k === 'a' || k === 'e') idx = 0
      else if (k === 'b' || k === 'q') idx = 1
      const target = idx >= 0 ? options[idx] : undefined
      if (!target) return
      e.preventDefault()
      pick(target.key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  return (
    <div className="pvn-opts pvn-opts--yingmo show" aria-label="应默抉择">
      <div className="pvn-yingmo-pair">
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            className="pvn-opt pvn-opt--kou pvn-opt--ying"
            data-key={KEY_LABELS[i] ?? ''}
            aria-label={`${o.label ?? o.key}，${KEY_LABELS[i] ?? ''}键或点击确认`}
            onClick={() => pick(o.key)}
          >
            <span className="pvn-kou-orn" aria-hidden="true">
              <i className="pvn-kou-dot" />
              <i className="pvn-kou-diamond" />
              <i className="pvn-kou-dot" />
            </span>
            <span className="pvn-kou-glyph">{o.label ?? o.key}</span>
            <span className="pvn-kou-hint" aria-hidden="true">
              <span className="pvn-kou-key">{KEY_LABELS[i] ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const YINGMO_CSS = `
.pvn-opts--yingmo{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:flex-end;padding:0 8% 16% 0;pointer-events:none;}
.pvn-opts--yingmo.show{pointer-events:auto;}
.pvn-yingmo-pair{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:clamp(32px,9vw,64px);}
.pvn-opts--yingmo .pvn-opt--kou{position:relative;padding:0;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-opts--yingmo .pvn-opt--kou:hover{transform:translateY(-2px) scale(1.03);}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:.28s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:.2s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-hint{animation-delay:.46s;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnYmKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(2rem,5.5vw,3.2rem);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnYmKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opts--yingmo .pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;opacity:0;animation:pvnYmKouHintIn .5s ease .38s forwards;}
.pvn-kou-key{display:flex;align-items:center;justify-content:center;width:1.42em;height:1.42em;font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:.68rem;font-weight:800;line-height:1;color:rgba(248,244,236,.92);position:relative;filter:url(#inkRoughNarr);}
.pvn-kou-key::before{content:'';position:absolute;inset:0;z-index:0;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.44);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.45);}
@keyframes pvnYmKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnYmKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnYmKouHintIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
`
