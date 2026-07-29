/**
 * 叩击（component id: `inkKou`）—— 组件只发出「叩」事件。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责显示与交互。
 */
import { useRef } from 'react'
import type { OverlayProps } from '../../rendererRegistry'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export const InkKouManifest: ComponentManifest = {
  id: 'InkKou',
  label: '叩击',
  events: [{ id: 'kou', label: '叩' }],
  inputs: [],
}

export function InkKou({ emit, preview }: OverlayProps) {
  injectCss('ink-kou-layer', KOU_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const knockedRef = useRef(false)

  function knock(): void {
    if (preview || knockedRef.current) return
    knockedRef.current = true
    emit?.('kou')
  }

  return (
    <div className={`pvn-opts pvn-opts--kou show${preview ? ' is-frozen' : ''}`} aria-label="叩击">
      <button type="button" className="pvn-opt pvn-opt--kou" aria-label="叩" disabled={preview} onClick={knock}>
        <span className="pvn-kou-orn" aria-hidden="true">
          <i className="pvn-kou-dot" />
          <i className="pvn-kou-diamond" />
          <i className="pvn-kou-dot" />
        </span>
        <span className="pvn-kou-glyph">叩</span>
        <span className="pvn-kou-hint" aria-hidden="true">
          <i className="pvn-kou-space" />
        </span>
      </button>
    </div>
  )
}

// 「叩」字号用 cqh/cqmin（相对舞台，见 VideoOverlayStage.tsx 的 containerType:'size'）取代 vw，
// vw 相对浏览器视口，预览小窗和全屏试玩里同一份配置会呈现出完全不同的物理大小。
const KOU_CSS = `
.pvn-opts--kou{position:relative;inline-size:100%;block-size:100%;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.pvn-opts--kou.show{pointer-events:auto;}
.pvn-opts--kou.is-frozen{pointer-events:none!important;}
.pvn-opts--kou.is-frozen .pvn-kou-orn,.pvn-opts--kou.is-frozen .pvn-kou-glyph,.pvn-opts--kou.is-frozen .pvn-kou-hint,.pvn-opts--kou.is-frozen .pvn-kou-space{animation-play-state:paused;}
.pvn-opts--kou.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-glyph{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-hint{animation-delay:calc(0.38s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-space{animation-delay:calc(0s - var(--preview-t,0ms));}
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
