import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'
import { formatTimeCode } from './timelineFormat'
import type { Branch, DialogueLine, QTECue } from '../../scenario/types'

/**
 * 时间轴右键菜单
 *
 * 三个上下文：
 *   1. empty   —— 在轨道空白处右键 → 「插入台词 / QTE / 分支」
 *   2. dialogue/cue/branch —— 在已有元素上右键 → 「复制 / 删除」+ 「拷贝时间码」
 *
 * 菜单关闭：
 *   - 点击菜单外
 *   - ESC
 *   - 滚轮 / 滚动条变化（避免菜单浮在错位的位置）
 *   - 任意菜单项被点击后
 *
 * v3.9.3：用 React Portal 把菜单挂到 document.body，
 *        避免被 .ks-timeline-tracks 的 overflow:hidden 裁切；
 *        x / y 一律用 e.clientX / e.clientY（视口坐标）。
 */

export type ContextTarget =
  | { kind: 'empty'; ms: number }
  | { kind: 'dialogue'; ms: number; line: DialogueLine }
  | { kind: 'cue'; ms: number; cue: QTECue }
  | { kind: 'branch'; ms: number; branch: Branch }

export interface TimelineContextMenuProps {
  /** 鼠标点击位置（viewport 坐标，clientX / clientY） */
  x: number
  y: number
  target: ContextTarget
  onClose: () => void
  onInsertDialogue: (ms: number) => void
  onInsertCue: (ms: number) => void
  onInsertBranch: (ms: number) => void
  onDuplicateDialogue: (line: DialogueLine, ms: number) => void
  onRemoveDialogue: (id: string) => void
  onRemoveCue: (id: string) => void
  onRemoveBranch: (id: string) => void
  onCopyTimecode: (ms: number) => void
}

export function TimelineContextMenu({
  x,
  y,
  target,
  onClose,
  onInsertDialogue,
  onInsertCue,
  onInsertBranch,
  onDuplicateDialogue,
  onRemoveDialogue,
  onRemoveCue,
  onRemoveBranch,
  onCopyTimecode,
}: TimelineContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent): void {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    function onScroll(): void {
      onClose()
    }
    // setTimeout 让本次冒泡的 contextmenu 事件先走完，再注册外点关闭
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onClick)
    }, 0)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  function close<T extends (...args: never[]) => void>(fn: T) {
    return ((...a: Parameters<T>) => {
      fn(...a)
      onClose()
    }) as T
  }

  return createPortal(
    <div
      ref={ref}
      className="ks-tl-ctxmenu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ks-tl-ctxmenu-header ks-mono">
        @{formatTimeCode(target.ms)}
      </div>

      {target.kind === 'empty' && (
        <>
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onInsertDialogue(target.ms))}
          >
            <span className="ks-tl-ctxmenu-glyph">+</span>
            <span>插入台词</span>
          </button>
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onInsertCue(target.ms))}
          >
            <span className="ks-tl-ctxmenu-glyph">◆</span>
            <span>插入 QTE</span>
          </button>
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onInsertBranch(target.ms))}
          >
            <span className="ks-tl-ctxmenu-glyph">↗</span>
            <span>插入分支选项</span>
          </button>
          <div className="ks-tl-ctxmenu-sep" />
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onCopyTimecode(target.ms))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>拷贝时间码</span>
          </button>
        </>
      )}

      {target.kind === 'dialogue' && (
        <>
          <div className="ks-tl-ctxmenu-info ks-cn">
            「{truncate(target.line.text, 18)}」
          </div>
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onDuplicateDialogue(target.line, 1500))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>复制台词（+1.5s 偏移）</span>
          </button>
          <button
            type="button"
            className="ks-tl-ctxmenu-item is-danger"
            onClick={close(() => onRemoveDialogue(target.line.id))}
          >
            <span className="ks-tl-ctxmenu-glyph">×</span>
            <span>删除台词</span>
          </button>
          <div className="ks-tl-ctxmenu-sep" />
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onCopyTimecode(target.line.startMs))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>拷贝起始时间码</span>
          </button>
        </>
      )}

      {target.kind === 'cue' && (
        <>
          <div className="ks-tl-ctxmenu-info ks-mono">
            QTE · {target.cue.shape}
            {target.cue.label ? ` · ${target.cue.label}` : ''}
          </div>
          <button
            type="button"
            className="ks-tl-ctxmenu-item is-danger"
            onClick={close(() => onRemoveCue(target.cue.id))}
          >
            <span className="ks-tl-ctxmenu-glyph">×</span>
            <span>删除 QTE</span>
          </button>
          <div className="ks-tl-ctxmenu-sep" />
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onCopyTimecode(target.cue.targetAt))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>拷贝目标点时间码</span>
          </button>
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onCopyTimecode(target.cue.appearAt))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>拷贝出现点时间码</span>
          </button>
        </>
      )}

      {target.kind === 'branch' && (
        <>
          <div className="ks-tl-ctxmenu-info ks-cn">
            ↗ {target.branch.label ?? target.branch.targetSceneId}
          </div>
          <button
            type="button"
            className="ks-tl-ctxmenu-item is-danger"
            onClick={close(() => onRemoveBranch(target.branch.id))}
          >
            <span className="ks-tl-ctxmenu-glyph">×</span>
            <span>删除分支</span>
          </button>
          <div className="ks-tl-ctxmenu-sep" />
          <button
            type="button"
            className="ks-tl-ctxmenu-item"
            onClick={close(() => onCopyTimecode(target.branch.showAt ?? target.ms))}
          >
            <span className="ks-tl-ctxmenu-glyph">⎘</span>
            <span>拷贝出现时间码</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

const ctxCss = `
.ks-tl-ctxmenu {
  position: fixed;
  z-index: 1000;
  min-width: 220px;
  padding: 6px 0;
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-lift);
  font-family: var(--ks-font-ui);
  font-size: 12.5px;
  color: var(--ks-text);
  user-select: none;
  animation: ks-tl-ctx-in 140ms var(--ks-ease);
}
@keyframes ks-tl-ctx-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.ks-tl-ctxmenu-header {
  padding: 6px 14px 8px;
  font-family: var(--ks-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-faint);
  border-bottom: 1px solid var(--ks-border-soft);
  text-transform: uppercase;
}
.ks-tl-ctxmenu-info {
  padding: 6px 14px 8px;
  font-size: 11.5px;
  color: var(--ks-text-dim);
  border-bottom: 1px solid var(--ks-border-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-tl-ctxmenu-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--ks-border-soft);
}
.ks-tl-ctxmenu-item {
  all: unset;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
  margin: 0 4px;
  border-radius: var(--ks-radius-sm);
}
.ks-tl-ctxmenu-item:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-tl-ctxmenu-item:active { background: rgba(255, 123, 61, 0.22); }
.ks-tl-ctxmenu-item.is-danger:hover {
  background: rgba(240, 119, 157, 0.12);
  color: #b1335a;
}
.ks-tl-ctxmenu-glyph {
  display: inline-flex; justify-content: center;
  width: 16px;
  font-family: var(--ks-font-mono);
  font-size: 13px;
  color: var(--ks-amber);
}
.ks-tl-ctxmenu-item.is-danger .ks-tl-ctxmenu-glyph { color: var(--ks-rose); }
`
injectStyleOnce('timeline-ctxmenu', ctxCss)
