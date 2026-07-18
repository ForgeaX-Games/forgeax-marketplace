import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Scene, TextOverlayClip } from '../scenario/types'
import { resolveFontFamily } from '../editor/timeline/fontPresets'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * TextOverlayLayer —— 播放器里渲染富文本「文字叠加」（剪映/PR 式贴字）。
 *
 * 与 DialogueBox（固定底栏字幕）并行、独立。按 elapsed 过滤出当前可见的多条
 * overlay，按归一化 x/y 定位，字号用 cqh（容器高度百分比）保证与编辑器一致、
 * 与分辨率无关。
 */
export function pickActiveOverlays(
  overlays: TextOverlayClip[] | undefined,
  elapsedMs: number,
): TextOverlayClip[] {
  if (!overlays?.length) return []
  return overlays.filter((o) => {
    if (elapsedMs < o.startMs) return false
    if (o.endMs === undefined) return true
    return elapsedMs <= o.endMs
  })
}

/** 计算单条 overlay 的内联样式（位置/旋转/缩放/字体/描边/底色等）。 */
export function overlayStyle(o: TextOverlayClip): CSSProperties {
  const sw = o.strokeWidth ?? 0
  const stroke = o.strokeColor ?? '#000000'
  // 用多向 text-shadow 模拟描边（跨浏览器比 -webkit-text-stroke 更稳，且可与投影叠加）。
  const shadows: string[] = []
  if (sw > 0) {
    const r = sw
    for (let a = 0; a < 360; a += 45) {
      const dx = Math.round(Math.cos((a * Math.PI) / 180) * r)
      const dy = Math.round(Math.sin((a * Math.PI) / 180) * r)
      shadows.push(`${dx}px ${dy}px 0 ${stroke}`)
    }
  }
  if (o.shadow !== false) shadows.push('0 2px 8px rgba(0,0,0,0.55)')

  return {
    left: `${(o.x ?? 0.5) * 100}%`,
    top: `${(o.y ?? 0.5) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) scale(${o.scale ?? 1})`,
    fontFamily: resolveFontFamily(o.fontFamily),
    fontSize: `${o.fontSizePct ?? 7}cqh`,
    fontWeight: o.fontWeight ?? 700,
    fontStyle: o.italic ? 'italic' : 'normal',
    textDecoration: o.underline ? 'underline' : 'none',
    color: o.color ?? '#ffffff',
    textAlign: o.align ?? 'center',
    opacity: o.opacity ?? 1,
    textShadow: shadows.length ? shadows.join(', ') : undefined,
    background: o.bgColor ?? 'transparent',
    padding: o.bgColor ? '0.15em 0.4em' : 0,
    borderRadius: o.bgColor ? '0.15em' : 0,
  }
}

export function TextOverlayLayer({ scene, elapsed }: { scene: Scene; elapsed: number }) {
  const active = useMemo(
    () => pickActiveOverlays(scene.textOverlays, elapsed),
    [scene.textOverlays, elapsed],
  )
  if (active.length === 0) return null
  return (
    <div className="ks-txtovl-layer" aria-hidden>
      {active.map((o) => (
        <div key={o.id} className="ks-txtovl-item" style={overlayStyle(o)}>
          {o.text}
        </div>
      ))}
    </div>
  )
}

const css = `
.ks-txtovl-layer {
  position: absolute;
  inset: 0;
  z-index: 19;
  pointer-events: none;
  container-type: size;
  overflow: hidden;
}
.ks-txtovl-item {
  position: absolute;
  white-space: pre-wrap;
  max-width: 90%;
  line-height: 1.2;
  word-break: break-word;
}
`
injectStyleOnce('text-overlay-layer', css)
