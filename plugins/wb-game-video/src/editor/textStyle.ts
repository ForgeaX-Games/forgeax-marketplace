/**
 * 文字样式渲染 —— 字幕（DialogueLine.style）与花字（TextOverlayClip）共享的
 * TextStyle → CSSProperties 纯函数（SSOT）。花字的 overlayStyle 在此基础上再叠位置/缩放。
 *
 * 两种模式（`fillDefaults`）：
 *   · true（花字）：独立渲染，缺省项用内置默认值填满（白字 / 7cqh / 700 / 居中）。
 *   · false（字幕微调）：只输出**显式设定**的项，让 DialogueBox 的 CSS 基线透出
 *     ——「默认字幕」预设 = 空 style，什么都不覆盖 = 与历史像素级一致（零回归）。
 */
import type { CSSProperties } from 'react'
import type { TextStyle } from '../scenario/types'
import { resolveFontFamily } from './timeline/fontPresets'

export interface ResolveTextCssOpts {
  /** true=花字独立渲染填满默认；false=字幕只覆盖显式项。默认 false。 */
  fillDefaults?: boolean
  /** 是否叠加投影（花字默认吃 clip.shadow；字幕默认不额外加，靠 CSS 基线）。 */
  dropShadow?: boolean
}

/**
 * 多向 text-shadow 模拟描边（比 -webkit-text-stroke 跨浏览器更稳，且可与投影叠加）。
 * 无描边且不要投影 → 返回 undefined（让调用方不写 textShadow，CSS 基线生效）。
 */
export function textStrokeShadow(
  strokeWidth: number | undefined,
  strokeColor: string | undefined,
  dropShadow: boolean,
): string | undefined {
  const sw = strokeWidth ?? 0
  const stroke = strokeColor ?? '#000000'
  const shadows: string[] = []
  if (sw > 0) {
    for (let a = 0; a < 360; a += 45) {
      const dx = Math.round(Math.cos((a * Math.PI) / 180) * sw)
      const dy = Math.round(Math.sin((a * Math.PI) / 180) * sw)
      shadows.push(`${dx}px ${dy}px 0 ${stroke}`)
    }
  }
  if (dropShadow) shadows.push('0 2px 8px rgba(0,0,0,0.55)')
  return shadows.length ? shadows.join(', ') : undefined
}

/** TextStyle → 视觉 CSS（不含位置/缩放/旋转）。 */
export function resolveTextCss(style: TextStyle, opts: ResolveTextCssOpts = {}): CSSProperties {
  const fill = opts.fillDefaults ?? false
  const has = (v: unknown): boolean => v !== undefined && v !== null
  const out: CSSProperties = {}
  if (has(style.fontFamily) || fill) out.fontFamily = resolveFontFamily(style.fontFamily)
  if (has(style.fontSizePct) || fill) out.fontSize = `${style.fontSizePct ?? 7}cqh`
  if (has(style.fontWeight) || fill) out.fontWeight = style.fontWeight ?? 700
  if (has(style.italic)) out.fontStyle = style.italic ? 'italic' : 'normal'
  if (has(style.underline)) out.textDecoration = style.underline ? 'underline' : 'none'
  if (has(style.color) || fill) out.color = style.color ?? '#ffffff'
  if (has(style.align) || fill) out.textAlign = style.align ?? 'center'
  if (has(style.opacity) || fill) out.opacity = style.opacity ?? 1
  // 显式 style.shadow 优先；否则回退到 opts.dropShadow / fill 默认。
  const wantShadow = style.shadow !== undefined ? style.shadow : (opts.dropShadow ?? fill)
  const shadow = textStrokeShadow(style.strokeWidth, style.strokeColor, wantShadow)
  if (shadow !== undefined) out.textShadow = shadow
  if (has(style.bgColor)) {
    out.background = style.bgColor
    out.padding = '0.15em 0.4em'
    out.borderRadius = '0.15em'
  } else if (fill) {
    out.background = 'transparent'
    out.padding = 0
    out.borderRadius = 0
  }
  return out
}

/** 一段文字是否带了任何显式视觉样式（用于字幕决定走 CSS 基线还是内联覆盖）。 */
export function hasTextStyle(style: TextStyle | undefined): boolean {
  if (!style) return false
  return Object.values(style).some((v) => v !== undefined && v !== null)
}

const TEXT_STYLE_KEYS: (keyof TextStyle)[] = [
  'fontFamily', 'fontWeight', 'italic', 'underline', 'color', 'strokeColor', 'strokeWidth', 'fontSizePct', 'align', 'bgColor', 'opacity', 'shadow',
]

/** 从扁平载体（如 TextOverlayClip）里抽出纯 TextStyle 子集（喂给预设选择器 / 比对）。 */
export function pickTextStyle(src: Partial<TextStyle>): TextStyle {
  const out: TextStyle = {}
  for (const k of TEXT_STYLE_KEYS) {
    const v = src[k]
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  }
  return out
}
