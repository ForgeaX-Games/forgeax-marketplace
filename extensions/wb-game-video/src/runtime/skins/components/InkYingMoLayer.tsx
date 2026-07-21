/**
 * 應/默 限时抉择皮肤（component id: `inkYingMo`）—— 从旧 player/InkYingMoLayer 迁移。
 *
 * 读 OverlaySnap.inputs.events（水墨字形取 event.label，如「應」「默」）；点击/键盘(A/E=第0项, B/Q=第1项) → emit(id)。
 * 超时由 useDefaultEventTimeout 到点 emit(defaultEvent)。
 *
 * 预览态：与 inkKou 同一套 --preview-t 负 delay 冻结契约——preview 时加 is-frozen，
 * 入场动画按播放头定帧，且禁键/禁点（不吃提交）。
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { usePlayerKeyGate, type OverlayProps } from '../rendererRegistry'
import { isOptionLocked } from '../optionLock'
import {
  CHOICE_INPUTS,
  validateChoiceEvents,
  type ChoiceParams,
} from './Choice'
import type { ComponentDef } from '../../registry/component-registry'
import type { OverlayChild } from '../../schema/graph-schema'
import { STAGE_FILL_LAYOUT } from '../../schema/layout'
import { injectCss, ensureInkFilters, ensureBrushFont, previewFreezeClass, previewTStyle, useDefaultEventTimeout } from './skinRuntime'

const KEY_LABELS = ['E', 'Q'] as const

/**
 * 组件的注册契约（引擎/编辑器识别用）——与渲染实现同文件，经 EXTRA_COMPONENTS 注册。
 */
export const inkYingMoComponent: ComponentDef<ChoiceParams> = {
  label: '應/默 抉择',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}

/** 皮肤默认玩法参数（样式锁选项 / 新建预设 / 锚点共用）。 */
export const inkYingMoDefaults: Pick<ChoiceParams, 'events' | 'x' | 'y' | 'timeoutMs' | 'defaultEvent'> = {
  events: [
    { id: 'ying', label: '應' },
    { id: 'mo', label: '默' },
  ],
  x: 0.5,
  y: 0.88,
  timeoutMs: 8000,
  defaultEvent: 'mo',
}

/** OverlayChild 预设（顶栏 component = 皮肤 id）。 */
export function inkYingMoPreset(id: string): OverlayChild {
  return {
    id,
    component: 'inkYingMo',
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    inputs: { ...inkYingMoDefaults },
  }
}

export function InkYingMoLayer({ overlay, emit, ctx, preview, previewTimeMs }: OverlayProps) {
  injectCss('ink-yingmo-layer', YINGMO_CSS)
  ensureInkFilters()
  ensureBrushFont()
  useDefaultEventTimeout(emit, overlay.inputs as Record<string, unknown>, preview)
  const keyOk = usePlayerKeyGate()
  const inputs = overlay.inputs as unknown as ChoiceParams
  const events = (inputs.events ?? []).slice(0, 2)
  const x = typeof inputs.x === 'number' ? inputs.x : inkYingMoDefaults.x!
  const y = typeof inputs.y === 'number' ? inputs.y : inkYingMoDefaults.y!
  const pickedRef = useRef(false)

  function pick(id: string, locked: boolean): void {
    if (preview || pickedRef.current || locked) return
    pickedRef.current = true
    emit?.(id)
  }

  useEffect(() => {
    if (preview) return
    function onKey(e: KeyboardEvent): void {
      if (!keyOk()) return
      const k = e.key.toLowerCase()
      let idx = -1
      if (k === 'a' || k === 'e') idx = 0
      else if (k === 'b' || k === 'q') idx = 1
      const target = idx >= 0 ? events[idx] : undefined
      if (!target) return
      e.preventDefault()
      pick(target.id, isOptionLocked(target, ctx))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, ctx, preview])

  const style: CSSProperties = { left: `${x * 100}%`, top: `${y * 100}%` }
  if (preview) Object.assign(style, previewTStyle(previewTimeMs ?? 0))
  return (
    <div
      className={`pvn-opts pvn-opts--yingmo show${previewFreezeClass(preview)}`}
      aria-label="应默抉择"
      style={style}
    >
      <div className="pvn-yingmo-pair">
        {events.map((o, i) => {
          const locked = isOptionLocked(o, ctx)
          return (
          <button
            key={o.id}
            type="button"
            className={`pvn-opt pvn-opt--kou pvn-opt--ying${locked ? ' dis' : ''}`}
            data-key={KEY_LABELS[i] ?? ''}
            aria-label={`${o.label ?? o.id}，${KEY_LABELS[i] ?? ''}键或点击确认`}
            disabled={locked || preview}
            onClick={() => pick(o.id, locked)}
          >
            <span className="pvn-kou-orn" aria-hidden="true">
              <i className="pvn-kou-dot" />
              <i className="pvn-kou-diamond" />
              <i className="pvn-kou-dot" />
            </span>
            <span className="pvn-kou-glyph">{o.label ?? o.id}</span>
            <span className="pvn-kou-hint" aria-hidden="true">
              <span className="pvn-kou-key">{KEY_LABELS[i] ?? ''}</span>
            </span>
          </button>
          )
        })}
      </div>
    </div>
  )
}

// 尺寸用 cqh/cqw/cqmin（相对舞台，见 VideoOverlayStage.tsx 的 containerType:'size'）取代 vw/rem，
// 避免预览小窗和全屏试玩里同一份配置呈现出不同的物理大小。
const YINGMO_CSS = `
.pvn-opts--yingmo{position:absolute;z-index:6;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%);pointer-events:none;}
.pvn-opts--yingmo.show{pointer-events:auto;}
.pvn-opts--yingmo.is-frozen{pointer-events:none!important;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn,.pvn-opts--yingmo.is-frozen .pvn-kou-glyph,.pvn-opts--yingmo.is-frozen .pvn-kou-hint{animation-play-state:paused;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-kou-glyph{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-kou-hint{animation-delay:calc(0.38s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:calc(0.28s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:calc(0.2s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-hint{animation-delay:calc(0.46s - var(--preview-t,0ms));}
.pvn-yingmo-pair{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:clamp(4cqmin,9cqw,9cqmin);}
.pvn-opts--yingmo .pvn-opt--kou{position:relative;padding:0;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-opts--yingmo .pvn-opt--kou:hover:not(.dis):not(:disabled){transform:translateY(-2px) scale(1.03);}
.pvn-opts--yingmo .pvn-opt--kou.dis,.pvn-opts--yingmo .pvn-opt--kou:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.35);}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:.28s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:.2s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-hint{animation-delay:.46s;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnYmKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(4cqh,6cqmin,9cqh);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnYmKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opts--yingmo .pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;opacity:0;animation:pvnYmKouHintIn .5s ease .38s forwards;}
.pvn-kou-key{display:flex;align-items:center;justify-content:center;width:1.42em;height:1.42em;font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:.68rem;font-weight:800;line-height:1;color:rgba(248,244,236,.92);position:relative;filter:url(#inkRoughNarr);}
.pvn-kou-key::before{content:'';position:absolute;inset:0;z-index:0;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.44);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.45);}
@keyframes pvnYmKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnYmKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnYmKouHintIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
`
