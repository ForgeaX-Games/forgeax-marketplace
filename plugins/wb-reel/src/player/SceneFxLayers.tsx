import type { CSSProperties } from 'react'
import { useMediaStore } from '../media/mediaStore'
import { injectStyleOnce } from '../styles/injectStyle'
import type { Scene, StickerClip } from '../scenario/types'
import {
  activeStickers,
  getStickerPreset,
  stickerAnimAt,
  type StageFxFrame,
} from '../fx/fxPresets'

/**
 * SceneFxLayers —— 剪映式后期效果的「实时渲染叠层」，编辑器预览与播放器共用。
 *
 * 包含：
 *   · FxOverlayLayer —— 暗角 / 颗粒 / 光效 / 故障 / 虚化（叠在媒体之上）
 *   · FadeLayer      —— 闪黑 / 闪白 / 渐显渐隐 的纯色遮罩（默认黑底）
 *   · StickerLayer   —— 贴纸（数值花字 / 图标 / emoji / 图片），静态渲染
 *
 * 媒体元素的 filter / transform 由 composeStageFx 产出，由调用方直接套在
 * <video>/<img> 上（见 StagePane / Player）。
 */

// ── 暗角 / 颗粒 / 特效叠层 ──────────────────────────────────────────────
export function FxOverlayLayer({ frame }: { frame: StageFxFrame }) {
  const { vignette, grain, effects } = frame
  if (vignette <= 0 && grain <= 0 && effects.length === 0) return null
  return (
    <div className="ks-fxovl" aria-hidden>
      {vignette > 0 && (
        <div
          className="ks-fxovl-vignette"
          style={{ opacity: vignette }}
        />
      )}
      {grain > 0 && (
        <div className="ks-fxovl-grain" style={{ opacity: grain * 0.5 }} />
      )}
      {effects.map((e) => {
        const op = e.intensity
        switch (e.preset.kind) {
          case 'lightLeak':
            return <div key={e.id} className="ks-fxovl-lightleak" style={{ opacity: op }} />
          case 'glitch':
            return <div key={e.id} className="ks-fxovl-glitch" style={{ opacity: op }} />
          case 'bokeh':
            return <div key={e.id} className="ks-fxovl-bokeh" style={{ opacity: op * 0.8 }} />
          case 'mosaic':
            return (
              <div
                key={e.id}
                className="ks-fxovl-mosaic"
                style={{ backdropFilter: `blur(${(4 + op * 10).toFixed(1)}px)`, WebkitBackdropFilter: `blur(${(4 + op * 10).toFixed(1)}px)` }}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}

// ── 纯色遮罩（闪黑/闪白/渐显渐隐）──────────────────────────────────────
export function FadeLayer({ color, opacity }: { color: string; opacity: number }) {
  if (opacity <= 0) return null
  return (
    <div
      className="ks-fxfade"
      aria-hidden
      style={{ background: color, opacity }}
    />
  )
}

// ── 贴纸样式 ──────────────────────────────────────────────────────────
/**
 * 贴纸定位 + 入/出场动画样式。
 *
 * ms 省略时返回"完全显示"基准样式（编辑器拖拽 / 静态取用），传入 ms 时叠加
 * stickerAnimAt 算出的入/出场偏移（弹入/淡入/滑动…）。平移用 cqw/cqh —— 贴纸层
 * 容器 container-type:size，与 fontSize 的 cqh 同一基准。
 */
export function stickerStyle(c: StickerClip, ms?: number): CSSProperties {
  const anim = stickerAnimAt(c, ms)
  const scale = (c.scale ?? 1) * anim.scaleMul
  return {
    position: 'absolute',
    left: `${(c.x ?? 0.5) * 100}%`,
    top: `${(c.y ?? 0.5) * 100}%`,
    transform: `translate(calc(-50% + ${anim.translateXPct}cqw), calc(-50% + ${anim.translateYPct}cqh)) rotate(${c.rotation ?? 0}deg) scale(${scale})`,
    fontSize: `${c.sizePct ?? 12}cqh`,
    opacity: (c.opacity ?? 1) * anim.opacity,
    color: c.color ?? '#ffd24a',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  }
}

/** 单个贴纸的内容（图标/花字/图片）。 */
export function StickerContent({ clip }: { clip: StickerClip }) {
  const entries = useMediaStore((s) => s.entries)
  if (clip.kind === 'image') {
    const url = clip.mediaId ? entries[clip.mediaId]?.url : undefined
    if (!url) return null
    return <img src={url} alt="" draggable={false} style={{ width: '1em', height: 'auto' }} />
  }
  if (clip.kind === 'builtin') {
    return <span>{getStickerPreset(clip.presetId ?? '')?.glyph ?? '★'}</span>
  }
  if (clip.kind === 'numeric') {
    return <span className="ks-fxsticker-numeric">{clip.text ?? ''}</span>
  }
  return <span>{clip.text ?? ''}</span>
}

// ── 贴纸层（静态，播放器用）─────────────────────────────────────────────
export function StickerLayer({ scene, ms }: { scene: Scene; ms: number }) {
  const stickers = activeStickers(scene, ms)
  if (stickers.length === 0) return null
  return (
    <div className="ks-fxsticker-layer" aria-hidden>
      {stickers.map((c) => (
        <div key={c.id} className="ks-fxsticker" style={stickerStyle(c, ms)}>
          <StickerContent clip={c} />
        </div>
      ))}
    </div>
  )
}

const css = `
.ks-fxovl, .ks-fxfade, .ks-fxsticker-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ks-fxsticker-layer { container-type: size; z-index: 19; }
.ks-fxfade { z-index: 22; }
.ks-fxovl { z-index: 17; overflow: hidden; }
.ks-fxovl > div { position: absolute; inset: 0; }
.ks-fxovl-vignette {
  background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.9) 130%);
}
.ks-fxovl-grain {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}
.ks-fxovl-lightleak {
  background: linear-gradient(115deg, transparent 30%, rgba(255,170,90,0.55) 50%, rgba(255,90,160,0.4) 62%, transparent 78%);
  mix-blend-mode: screen;
  animation: ks-fx-leak 4s ease-in-out infinite;
}
@keyframes ks-fx-leak {
  0%,100% { transform: translateX(-12%); opacity: 0.6; }
  50%     { transform: translateX(12%);  opacity: 1; }
}
.ks-fxovl-bokeh {
  background:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0 3%, transparent 4%),
    radial-gradient(circle at 70% 60%, rgba(255,255,255,0.25) 0 2.5%, transparent 3.5%),
    radial-gradient(circle at 45% 80%, rgba(255,240,200,0.3) 0 3.5%, transparent 4.5%);
  filter: blur(2px);
  mix-blend-mode: screen;
  animation: ks-fx-bokeh 6s ease-in-out infinite alternate;
}
@keyframes ks-fx-bokeh {
  from { opacity: 0.6; }
  to   { opacity: 1; }
}
.ks-fxovl-glitch {
  background: repeating-linear-gradient(0deg, rgba(255,0,80,0.05) 0 2px, rgba(0,200,255,0.05) 2px 4px);
  mix-blend-mode: screen;
  animation: ks-fx-glitch 0.5s steps(2) infinite;
}
@keyframes ks-fx-glitch {
  0% { transform: translate(0,0); }
  25% { transform: translate(-2px, 1px); }
  50% { transform: translate(2px, -1px); }
  75% { transform: translate(-1px, -1px); }
  100% { transform: translate(0,0); }
}
/* 抖动：作用在媒体 wrapper 上 */
.ks-fx-shake { animation: ks-fx-shake 0.32s linear infinite; }
@keyframes ks-fx-shake {
  0%,100% { transform: translate(0,0); }
  20% { transform: translate(-3px, 2px); }
  40% { transform: translate(3px, -2px); }
  60% { transform: translate(-2px, -3px); }
  80% { transform: translate(2px, 3px); }
}
.ks-fxsticker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ks-fxsticker-numeric {
  font-weight: 900;
  -webkit-text-stroke: 0.06em rgba(0,0,0,0.55);
  text-shadow: 0 2px 6px rgba(0,0,0,0.45);
  font-family: var(--ks-font-cn, var(--ks-font-ui));
}
`
injectStyleOnce('scene-fx-layers', css)
