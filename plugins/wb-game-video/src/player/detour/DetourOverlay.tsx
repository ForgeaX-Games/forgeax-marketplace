import { useEffect, useState } from 'react'
import type { HotspotDetour } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * DetourOverlay —— 热点原地对话（seedance detour / 原型 §7）。
 * 多行台词逐行点击推进，结束后回调 onDone。
 */
export function DetourOverlay({
  detour,
  onDone,
}: {
  detour: HotspotDetour
  onDone: () => void
}) {
  injectStyleOnce('player-detour-overlay', DETOUR_CSS)
  const lines = detour.dialogue.filter(Boolean)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (lines.length === 0) onDone()
  }, [lines.length, onDone])

  function advance(): void {
    if (idx + 1 >= lines.length) {
      onDone()
      return
    }
    setIdx((i) => i + 1)
  }

  if (lines.length === 0) return null

  return (
    <div className="ks-detour" data-testid="detour-overlay" onClick={advance} role="dialog">
      <div className="ks-detour-panel" onClick={(e) => e.stopPropagation()}>
        {detour.speaker && <div className="ks-detour-speaker">{detour.speaker}</div>}
        <p className="ks-detour-line">{lines[idx]}</p>
        <button type="button" className="ks-detour-next" onClick={advance}>
          {idx + 1 >= lines.length ? '继续' : '下一句 ›'}
        </button>
      </div>
    </div>
  )
}

const DETOUR_CSS = `
.ks-detour {
  position: absolute; inset: 0;
  z-index: 55;
  display: flex; align-items: flex-end; justify-content: center;
  padding: 0 6vw 8vh;
  background: rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
.ks-detour-panel {
  max-width: 720px; width: 100%;
  padding: 20px 24px 18px;
  border-radius: 12px;
  background: rgba(8, 10, 18, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.ks-detour-speaker {
  font-size: 13px; letter-spacing: 0.12em;
  color: rgba(125, 211, 252, 0.9);
  margin-bottom: 10px;
}
.ks-detour-line {
  margin: 0 0 16px;
  font-size: 18px; line-height: 1.65;
  color: rgba(255, 255, 255, 0.94);
  letter-spacing: 0.04em;
}
.ks-detour-next {
  float: right;
  padding: 6px 16px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.ks-detour-next:hover { background: rgba(255, 255, 255, 0.16); }
`
