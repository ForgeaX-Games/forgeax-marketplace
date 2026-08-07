import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'

export interface VideoFullscreenDialogProps {
  open: boolean
  src?: string | null
  label: string
  durationMs?: number
  onClose: () => void
  onImport?: () => void | Promise<void>
  children?: ReactNode
}

export const VIDEO_FULLSCREEN_DIALOG_CSS = `
.vfd-backdrop {
  position: fixed;
  z-index: var(--z-top, 9999);
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(16px, 4vw, 48px);
  background: rgba(10, 11, 15, .86);
  backdrop-filter: blur(12px);
}
.vfd-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: min(800px, 100%);
  min-height: 280px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 16px;
  background: #17191f;
  color: #f5f6f8;
  box-shadow: 0 28px 80px rgba(0, 0, 0, .55), 0 0 0 1px rgba(0, 0, 0, .22);
}
.vfd-header,
.vfd-footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #20232b;
}
.vfd-header { border-bottom: 1px solid rgba(255, 255, 255, .08); }
.vfd-footer { justify-content: flex-end; border-top: 1px solid rgba(255, 255, 255, .08); }
.vfd-title {
  min-width: 0;
  overflow: hidden;
  color: #f8f9fb;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vfd-duration {
  flex: none;
  color: #9da4b5;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.vfd-close,
.vfd-import {
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}
.vfd-close {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  margin-left: auto;
  padding: 0;
  place-items: center;
  background: transparent;
  color: #c5cad5;
  font-size: 20px;
  line-height: 1;
}
.vfd-close:hover { background: rgba(255, 255, 255, .09); color: #fff; }
.vfd-import {
  padding: 8px 12px;
  background: #f2a65a;
  color: #24170b;
  font-size: 13px;
  font-weight: 650;
}
.vfd-import:hover { background: #ffb76d; }
.vfd-close:focus-visible,
.vfd-import:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
.vfd-stage {
  --gc-panel2: #252019;
  --gc-line-soft: #2e2924;
  --gc-text: #f6f1e9;
  --gc-muted: #b8aea0;
  --gc-faint: #8c8377;
  --gc-accent: #f08840;
  --gc-accent-soft: rgba(240, 136, 64, .16);
  --gc-accent-line: rgba(240, 136, 64, .42);
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  place-items: center;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, .018) 25%, transparent 25%) 0 0 / 20px 20px,
    linear-gradient(-45deg, rgba(255, 255, 255, .018) 25%, transparent 25%) 0 0 / 20px 20px,
  #0d0f14;
}
.vfd-stage > .gvv-video-col {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: clamp(12px, 2vw, 24px);
}
.vfd-stage > .gvv-video-col .gc-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: none;
  aspect-ratio: auto;
  flex: 1 1 0;
}
.vfd-stage > .gvv-video-col .gvv-controls { flex: none; }
.vfd-video {
  display: block;
  width: 100%;
  height: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #050608;
}
.vfd-empty {
  max-width: 360px;
  padding: 24px;
  color: #aeb5c4;
  font-size: 14px;
  line-height: 1.55;
  text-align: center;
}
.vfd-empty strong { display: block; margin-bottom: 6px; color: #f5f6f8; font-size: 15px; }
@media (max-width: 560px) {
  .vfd-backdrop { padding: 0; }
  .vfd-dialog { width: 100%; height: 100%; border-radius: 0; }
}
`

injectStyleOnce('wb-game-video-fullscreen-dialog', VIDEO_FULLSCREEN_DIALOG_CSS)

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function VideoFullscreenDialog({
  open,
  src,
  label,
  durationMs,
  onClose,
  onImport,
  children,
}: VideoFullscreenDialogProps): JSX.Element | null {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeElementRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    const activeElement = document.activeElement
    activeElementRef.current = activeElement instanceof HTMLElement ? activeElement : null
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      activeElementRef.current?.focus()
      activeElementRef.current = null
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const hasSource = Boolean(src?.trim())
  return createPortal(
    <div
      className="vfd-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="vfd-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vfd-header">
          <span id={titleId} className="vfd-title">{label}</span>
          {durationMs != null ? <span className="vfd-duration">{formatDuration(durationMs)}</span> : null}
          <button ref={closeButtonRef} type="button" className="vfd-close" onClick={onClose} aria-label="关闭视频预览" title="关闭">
            ×
          </button>
        </header>
        <div className="vfd-stage">
          {children != null ? children : hasSource ? (
            <video className="vfd-video" src={src!} controls playsInline aria-label={`${label} 视频预览`} />
          ) : (
            <div className="vfd-empty" role="status">
              <strong>暂无可预览的视频</strong>
              请先选择或生成一个视频资产，然后再次打开预览。
            </div>
          )}
        </div>
        {onImport ? (
          <footer className="vfd-footer">
            <button type="button" className="vfd-import" onClick={() => { void onImport() }}>
              导入资产
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
