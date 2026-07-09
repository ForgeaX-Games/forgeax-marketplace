/**
 * GraphTextStyle → React CSSProperties（图原生，编辑器与播放器共用）。
 * 字号用 cqh（container query height）保证与分辨率无关；描边走 -webkit-text-stroke。
 */
import type { CSSProperties } from 'react'
import type { GraphTextStyle } from '../../runtime/schema/graph-schema'
import { resolveFontFamily } from './font-presets'

export function resolveGraphTextCss(
  style: GraphTextStyle | undefined,
  opts?: { fillDefaults?: boolean; fallbackColor?: string },
): CSSProperties {
  const s = style ?? {}
  const fill = opts?.fillDefaults ?? false
  const strokeColor = s.strokeColor ?? (fill ? '#000000' : undefined)
  const strokeWidth = s.strokeWidth ?? (fill ? 2 : undefined)
  const stroke = strokeColor && strokeWidth ? `${strokeWidth}px ${strokeColor}` : undefined
  return {
    fontFamily: resolveFontFamily(s.fontFamily),
    color: s.color ?? opts?.fallbackColor ?? (fill ? '#ffffff' : undefined),
    fontWeight: s.fontWeight ?? (fill ? 700 : undefined),
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.underline ? 'underline' : undefined,
    fontSize: s.fontSizePct != null ? `${s.fontSizePct}cqh` : undefined,
    textAlign: s.align ?? undefined,
    background: s.bgColor,
    opacity: s.opacity ?? undefined,
    WebkitTextStroke: stroke,
    textShadow: s.shadow === false ? undefined : fill || s.shadow ? '0 2px 6px rgba(0,0,0,0.6)' : undefined,
    padding: s.bgColor ? '2px 8px' : undefined,
    borderRadius: s.bgColor ? 4 : undefined,
  }
}
