import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MinigameClip } from '../scenario/types'
import { getMinigame } from '../minigames/registry'
import { injectStyleOnce } from '../styles/injectStyle'
import { parseMinigameMessage, type MinigameEvent } from './minigameMessage'

/**
 * MinigameOverlay —— 在 Player 之上全屏挂一个 iframe，加载指定小游戏。
 *
 * 与小游戏的通信契约见 `minigameMessage.ts`：
 *   - 收到 'minigame-win'      → 调用 onWin，由 Player 决定是否走 qte_pass 分支或直接继续
 *   - 收到 'minigame-lose'     → 调用 onLose，Player 决定是否走 qte_fail 分支
 *   - 收到 'minigame-continue' → 等价于 'win'，兼容小游戏胜利 UI 里的"继续剧情"按钮
 *   - 收到 'minigame-ready'    → 仅上报，用于 UI"loading"→"in-game"过渡
 *
 * 不对 iframe 做 sandbox 隔离（dev 阶段信任源码）——将来上 CDN 时
 * 再加 `sandbox="allow-scripts allow-same-origin"` 之类的 attr。
 */
export interface MinigameOverlayProps {
  clip: MinigameClip
  onWin: (event: MinigameEvent) => void
  onLose: (event: MinigameEvent) => void
  onAbort: () => void
}

export function MinigameOverlay({
  clip,
  onWin,
  onLose,
  onAbort,
}: MinigameOverlayProps) {
  const desc = getMinigame(clip.minigameId)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const ev = parseMinigameMessage(e.data)
      if (!ev) return
      if (desc && ev.id !== desc.id) return
      if (ev.type === 'minigame-ready') {
        setReady(true)
        return
      }
      if (ev.type === 'minigame-win' || ev.type === 'minigame-continue') {
        onWin(ev)
        return
      }
      if (ev.type === 'minigame-lose') {
        onLose(ev)
        return
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [desc, onWin, onLose])

  if (!desc) {
    return createPortal(
      <div className="ks-mg-overlay ks-mg-overlay-missing" style={FALLBACK_OVERLAY_STYLE}>
        <div className="ks-mg-missing-box">
          <div className="ks-mg-missing-title">小游戏未注册</div>
          <div className="ks-mg-missing-id ks-mono">{clip.minigameId}</div>
          <button className="ks-mg-btn" onClick={onAbort}>
            跳过
          </button>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="ks-mg-overlay" role="dialog" aria-label={desc.title} style={FALLBACK_OVERLAY_STYLE}>
      <div className="ks-mg-frame-wrap" style={FALLBACK_FRAME_WRAP_STYLE}>
        {!ready && (
          <div className="ks-mg-loading" style={FALLBACK_LOADING_STYLE}>
            <div className="ks-mg-spinner" aria-hidden />
            <div>{desc.title} · 加载中…</div>
          </div>
        )}
        <iframe
          key={reloadTick}
          ref={iframeRef}
          src={desc.src}
          className="ks-mg-iframe"
          title={desc.title}
          allow="fullscreen"
          style={FALLBACK_IFRAME_STYLE}
        />
      </div>
      <div className="ks-mg-topbar">
        <span className="ks-mg-topbar-title">{desc.title}</span>
        <span className="ks-mg-topbar-spacer" />
        <button
          className="ks-mg-btn ks-mg-btn-ghost"
          onClick={() => {
            setReady(false)
            setReloadTick((n) => n + 1)
          }}
          title="重新开始"
        >
          ↻ 重开
        </button>
        <button
          className="ks-mg-btn ks-mg-btn-ghost"
          onClick={onAbort}
          title="放弃并进入失败分支"
        >
          × 放弃
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 兜底 inline 样式 —— 防止因 HMR / CSS 注入时序 / 父容器 transform 等原因导致
 * `.ks-mg-overlay` class 的 fixed+inset 规则不生效时，小游戏 overlay 仍然能
 * 以一张全黑的全屏盖住父画布。这些 style 只复制关键布局属性，装饰性 class
 * 规则（圆角 / 边框 / 渐变等）仍由 CSS 决定。
 */
const FALLBACK_OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(5, 2, 10, 0.96)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
}

const FALLBACK_FRAME_WRAP_STYLE: CSSProperties = {
  flex: 1,
  position: 'relative',
}

const FALLBACK_IFRAME_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 0,
  background: '#0a0008',
}

const FALLBACK_LOADING_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  color: '#d4b0e8',
  fontSize: 14,
  zIndex: 1,
  pointerEvents: 'none',
}

injectStyleOnce(
  'minigame-overlay',
  `
.ks-mg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 2, 10, 0.92);
  z-index: 120;
  display: flex;
  flex-direction: column;
}
.ks-mg-topbar {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 2;
  pointer-events: none;
}
.ks-mg-topbar > * {
  pointer-events: auto;
}
.ks-mg-topbar-title {
  color: #ffcf80;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.04em;
  text-shadow: 0 2px 10px rgba(0,0,0,0.6);
  padding: 6px 14px;
  background: rgba(16, 10, 14, 0.68);
  border: 1px solid rgba(255, 181, 80, 0.32);
  border-radius: 999px;
  backdrop-filter: blur(6px);
}
.ks-mg-topbar-spacer { flex: 1; }
.ks-mg-btn {
  border: 1px solid rgba(255, 181, 80, 0.45);
  background: rgba(32, 20, 28, 0.65);
  color: #ffcf80;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  letter-spacing: 0.06em;
  transition: background 0.15s ease, transform 0.15s ease;
  backdrop-filter: blur(4px);
}
.ks-mg-btn:hover {
  background: rgba(64, 38, 56, 0.8);
  transform: translateY(-1px);
}
.ks-mg-btn-ghost {
  background: rgba(10, 6, 12, 0.5);
}
.ks-mg-frame-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ks-mg-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0a0008;
}
.ks-mg-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #d4b0e8;
  font-size: 14px;
  letter-spacing: 0.12em;
  z-index: 1;
  pointer-events: none;
}
.ks-mg-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #ffcf80;
  /* 保留加载转圈 —— 全局 Motion Reset 不禁用非 ks-* 的 spinner；这里明确标记 */
  animation: ks-mg-spin 0.85s linear infinite;
}
@keyframes ks-mg-spin {
  to { transform: rotate(360deg); }
}
.ks-mg-overlay-missing {
  align-items: center;
  justify-content: center;
}
.ks-mg-missing-box {
  background: rgba(32, 20, 28, 0.85);
  border: 1px solid rgba(255, 100, 100, 0.4);
  border-radius: 12px;
  padding: 28px 36px;
  text-align: center;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.ks-mg-missing-title {
  font-size: 18px;
  font-weight: 600;
  color: #ff9999;
}
.ks-mg-missing-id {
  font-size: 12px;
  color: #c878b8;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(0,0,0,0.3);
}
`,
)
