/**
 * 應/默抉择（component id: `InkYingMo`）—— 组件只发出「應」或「默」事件。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责显示与点击交互。
 */
import { useRef } from 'react'
import type { OverlayProps } from '../../rendererRegistry'
import type { ComponentManifest } from '@/runtime/schema/node-config-schema'
import { injectCss, ensureInkFilters, ensureBrushFont, previewTStyle } from './skinRuntime'

export const InkYingMoManifest: ComponentManifest = {
  id: 'InkYingMo',
  label: '應/默 抉择',
  events: [{ id: 'ying', label: '應' }, { id: 'mo', label: '默' }],
  inputs: [],
}

export function InkYingMo({ emit, preview, previewTimeMs }: OverlayProps) {
  injectCss('ink-yingmo-layer', YINGMO_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const pickedRef = useRef(false)

  function pick(id: 'ying' | 'mo'): void {
    if (preview || pickedRef.current) return
    pickedRef.current = true
    emit?.(id)
  }

  return (
    <div
      className={`pvn-opts pvn-opts--yingmo show${preview ? ' is-frozen' : ''}`}
      style={preview ? previewTStyle(previewTimeMs ?? 0) : undefined}
      aria-label="应默抉择"
    >
      <div className="pvn-yingmo-pair" data-overlay-fit-target>
        <ChoiceButton label="應" event="ying" preview={preview} onPick={pick} />
        <ChoiceButton label="默" event="mo" preview={preview} onPick={pick} />
      </div>
    </div>
  )
}

function ChoiceButton({ label, event, preview, onPick }: { label: string; event: 'ying' | 'mo'; preview?: boolean; onPick: (event: 'ying' | 'mo') => void }) {
  return (
    <button type="button" className="pvn-opt pvn-opt--kou pvn-opt--ying" aria-label={label} disabled={preview} onClick={() => onPick(event)}>
      <span className="pvn-kou-orn" aria-hidden="true">
        <i className="pvn-kou-dot" />
        <i className="pvn-kou-diamond" />
        <i className="pvn-kou-dot" />
      </span>
      <span className="pvn-kou-glyph">{label}</span>
    </button>
  )
}

// 尺寸用 cqh/cqw/cqmin（相对舞台，见 VideoOverlayStage.tsx 的 containerType:'size'）取代 vw/rem，
// 避免预览小窗和全屏试玩里同一份配置呈现出不同的物理大小。
const YINGMO_CSS = `
.pvn-opts--yingmo{position:relative;inline-size:100%;block-size:100%;min-inline-size:180px;min-block-size:96px;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.pvn-opts--yingmo.show{pointer-events:auto;}
.pvn-opts--yingmo.is-frozen{pointer-events:none!important;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn,.pvn-opts--yingmo.is-frozen .pvn-kou-glyph{animation-play-state:paused;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-kou-glyph{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:calc(0.28s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:calc(0.2s - var(--preview-t,0ms));}
.pvn-yingmo-pair{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:clamp(4cqmin,9cqw,9cqmin);}
.pvn-opts--yingmo .pvn-opt--kou{position:relative;padding:0;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-opts--yingmo .pvn-opt--kou:hover:not(.dis):not(:disabled){transform:translateY(-2px) scale(1.03);}
.pvn-opts--yingmo .pvn-opt--kou.dis,.pvn-opts--yingmo .pvn-opt--kou:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.35);}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:.28s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:.2s;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnYmKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(4cqh,6cqmin,9cqh);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnYmKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opts--yingmo .pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
@keyframes pvnYmKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnYmKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
`
