/**
 * 默认交互/表现层共用的定位与按钮样式（choice / qte / hotspot / dialogue）。
 * 与编辑器预览锚点语义对齐：归一化 0~1，中心 0.5,0.5 → translate(-50%,-50%)。
 */
import type { CSSProperties } from 'react'

export const defaultBtn = (bg: string): CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 10,
  border: 'none',
  background: bg,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
})

export const bottomRow: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '7%',
  display: 'flex',
  gap: 10,
  justifyContent: 'center',
  flexWrap: 'wrap',
  pointerEvents: 'auto',
}

/** 归一化锚点 → 居中于该点的绝对定位。 */
export function anchorStyle(x: number, y: number, extra?: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: 'translate(-50%, -50%)',
    maxWidth: '84%',
    ...extra,
  }
}

/** x/y 均为有限数字才算「有锚点」。 */
export function hasAnchor(x: unknown, y: unknown): x is number {
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
}
