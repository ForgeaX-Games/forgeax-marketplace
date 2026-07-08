import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { OverlayClip, Scene } from '../scenario/types'
import { activeOverlays, getStickerPreset } from '../fx/fxPresets'
import { resolveTextCss } from '../editor/textStyle'
import { useMediaStore } from '../media/mediaStore'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * OverlayLayer —— 统一「飘字」渲染层（合并旧 TextOverlayLayer + StickerLayer）。
 *
 * 按 elapsed 过滤当前激活的 overlay，按 kind 渲染：
 *   · text  → content 经 resolveTextCss(style) 排版成文本
 *   · icon  → content 查 FX_STICKERS 预设 glyph
 *   · image → content 取 mediaStore 渲 <img>
 * content 为空 = 纯逻辑结算触发器，渲染层跳过。
 *
 * 结构分两层解耦「定位」与「动画」：外层做 x/y 定位 + rotate + 基础 opacity，
 * 内层跑 enter/exit 关键帧（scale/translateY/opacity 不会干扰外层定位 transform）。
 */

const ENTER_DUR_MS = 350
const EXIT_DUR_MS = 350
/** floatUp（伤害数字上浮淡出）跑满整段生命周期，其余入场动画短促。 */
const FLOAT_UP_CAP_MS = 900

/** 该 overlay 在当前帧是否有可见内容（纯触发器 content='' 跳过）。 */
function hasVisibleContent(o: OverlayClip): boolean {
  return o.content.trim().length > 0
}

/** 外层定位样式（位置 + 旋转 + 基础透明度）。 */
function positionStyle(o: OverlayClip, extraOpacity: number, exitTransform: string): CSSProperties {
  return {
    left: `${(o.x ?? 0.5) * 100}%`,
    top: `${(o.y ?? 0.5) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) ${exitTransform}`.trim(),
    opacity: (o.opacity ?? 1) * extraOpacity,
  }
}

/** 内层入场动画（CSS animation 只在挂载时跑一次）。 */
function enterAnimStyle(o: OverlayClip): CSSProperties {
  if (!o.enter) return {}
  const lifetime = o.endMs !== undefined ? Math.max(1, o.endMs - o.startMs) : 0
  const dur =
    o.enter === 'floatUp'
      ? Math.min(lifetime > 0 ? lifetime : FLOAT_UP_CAP_MS, FLOAT_UP_CAP_MS)
      : ENTER_DUR_MS
  const fill = o.enter === 'floatUp' ? 'forwards' : 'both'
  return { animation: `ovl-${o.enter} ${dur}ms ease-out ${fill}` }
}

/** 出场淡出/位移（floatUp 自带淡出，不额外叠加）。 */
function exitState(o: OverlayClip, elapsed: number): { opacity: number; transform: string } {
  if (!o.exit || o.endMs === undefined || o.enter === 'floatUp') {
    return { opacity: 1, transform: '' }
  }
  const start = o.endMs - EXIT_DUR_MS
  if (elapsed <= start) return { opacity: 1, transform: '' }
  const t = Math.min(1, (elapsed - start) / EXIT_DUR_MS)
  switch (o.exit) {
    case 'slideOut':
      return { opacity: 1 - t, transform: `translateY(${(t * 20).toFixed(1)}%)` }
    case 'zoomOut':
      return { opacity: 1 - t, transform: `scale(${(1 - 0.2 * t).toFixed(3)})` }
    default:
      return { opacity: 1 - t, transform: '' }
  }
}

function OverlayItem({ o, elapsed }: { o: OverlayClip; elapsed: number }) {
  const entries = useMediaStore((s) => s.entries)
  const exit = exitState(o, elapsed)
  const pos = positionStyle(o, exit.opacity, exit.transform)
  const anim = enterAnimStyle(o)

  let inner: React.ReactNode = null
  const innerStyle: CSSProperties = { ...anim }
  if (o.kind === 'text') {
    Object.assign(innerStyle, resolveTextCss(o.style ?? {}, { fillDefaults: true }))
    inner = o.content
  } else if (o.kind === 'icon') {
    innerStyle.fontSize = `${o.sizePct ?? 12}cqh`
    innerStyle.lineHeight = 1
    inner = <span>{getStickerPreset(o.content)?.glyph ?? '★'}</span>
  } else {
    const url = entries[o.content]?.url
    if (!url) return null
    innerStyle.width = `${o.sizePct ?? 12}cqh`
    inner = <img src={url} alt="" draggable={false} style={{ width: '100%', height: 'auto', display: 'block' }} />
  }

  return (
    <div className="ks-ovl-item" style={pos}>
      <div className="ks-ovl-anim" style={innerStyle}>
        {inner}
      </div>
    </div>
  )
}

export function OverlayLayer({ scene, elapsed }: { scene: Scene; elapsed: number }) {
  const active = useMemo(
    () => activeOverlays(scene, elapsed).filter(hasVisibleContent),
    [scene, elapsed],
  )
  if (active.length === 0) return null
  return (
    <div className="ks-ovl-layer" aria-hidden>
      {active.map((o) => (
        <OverlayItem key={o.id} o={o} elapsed={elapsed} />
      ))}
    </div>
  )
}

const css = `
.ks-ovl-layer {
  position: absolute;
  inset: 0;
  z-index: 19;
  pointer-events: none;
  container-type: size;
  overflow: hidden;
}
.ks-ovl-item {
  position: absolute;
  max-width: 90%;
}
.ks-ovl-anim {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: pre-wrap;
  line-height: 1.2;
  word-break: break-word;
}
@keyframes ovl-pop {
  0%   { transform: scale(0.5); opacity: 0; }
  60%  { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes ovl-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes ovl-slide {
  from { transform: translateY(24%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
@keyframes ovl-floatUp {
  0%   { transform: translateY(20%); opacity: 0; }
  20%  { transform: translateY(0); opacity: 1; }
  70%  { opacity: 1; }
  100% { transform: translateY(-60%); opacity: 0; }
}
`
injectStyleOnce('overlay-layer', css)
