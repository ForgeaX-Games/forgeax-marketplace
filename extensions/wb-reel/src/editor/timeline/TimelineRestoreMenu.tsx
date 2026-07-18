import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  clearTrash,
  listTrash,
  restoreSnapshot,
  type TrashSnapshot,
} from '../../scenario/scenarioTrash'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useToastStore } from '../../ui/toastStore'

/**
 * TimelineRestoreMenu —— 时间轴工具条里的「恢复 / 回收站」入口（误删保护）。
 *
 * 撤销栈刷新即清空；这里读的是持久化的删除快照（scenarioTrash），刷新/重开都在。
 * 点开列出「删除前自动备份」的版本（时间 + 删了什么），一键回滚到删除前那一份。
 * 只展示与「当前正在编辑的这本剧本」同源的快照，避免一键换成别的剧本造成困惑。
 */
export function TimelineRestoreMenu() {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const [snaps, setSnaps] = useState<TrashSnapshot[]>([])
  const btnRef = useRef<HTMLButtonElement | null>(null)
  // 订阅整本 scenario：每次删除都会改 scenario 引用 → 重算徽章数（保持实时、跨刷新准确）。
  const scenario = useScenarioStore((s) => s.scenario)
  const currentId = scenario.id

  function refresh(): void {
    setSnaps(listTrash().filter((s) => s.scenarioId === currentId))
  }

  // 挂载 / 切剧本 / 任意删除后刷新徽章（listTrash 读 localStorage，开销极小）。
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, currentId])

  function toggle(): void {
    if (open) {
      setOpen(false)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    refresh()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if ((t as HTMLElement)?.closest?.('.ks-trash-pop')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function doRestore(id: string): void {
    const ok = restoreSnapshot(id)
    useToastStore
      .getState()
      .fire(ok ? '已恢复到删除前的版本（此次恢复也可再撤销）' : '恢复失败：快照可能已失效', {
        kind: ok ? 'success' : 'error',
      })
    if (ok) setOpen(false)
    else refresh()
  }

  function doClear(): void {
    if (!window.confirm('清空回收站？\n（清空后这些「删除前备份」将无法再恢复）')) return
    clearTrash()
    refresh()
  }

  const count = snaps.length

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="ks-tltb-btn"
        onClick={toggle}
        title="恢复 · 回收站：列出「删除前自动备份」，一键回滚到删除前的版本（刷新也不丢）"
        aria-label="恢复"
        aria-expanded={open}
      >
        <span className="ks-tltb-btn-icon" aria-hidden>
          ↺
        </span>
        <span className="ks-tltb-btn-label">恢复</span>
        {count > 0 && <span className="ks-tltb-restore-badge ks-mono">{count}</span>}
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            className="ks-trash-pop"
            style={{ top: anchor.top, right: anchor.right }}
            role="menu"
          >
            <div className="ks-trash-pop-head">
              <span className="ks-trash-pop-title">误删恢复 · 回收站</span>
              {count > 0 && (
                <button type="button" className="ks-trash-pop-clear" onClick={doClear}>
                  清空
                </button>
              )}
            </div>
            {count === 0 ? (
              <div className="ks-trash-pop-empty">
                暂无可恢复的删除记录。
                <br />
                删除场景 / 镜头 / 台词等会自动在这里留一份「删除前备份」。
              </div>
            ) : (
              <ul className="ks-trash-pop-list">
                {snaps.map((s) => (
                  <li key={s.id} className="ks-trash-pop-item">
                    <div className="ks-trash-pop-meta">
                      <span className="ks-trash-pop-reason">{s.reason}</span>
                      <span className="ks-trash-pop-time ks-mono">{relativeTime(s.takenAt)}</span>
                    </div>
                    <button
                      type="button"
                      className="ks-trash-pop-restore"
                      onClick={() => doRestore(s.id)}
                      title="回滚到这份「删除前」的版本"
                    >
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/** 极简相对时间：刚刚 / X分钟前 / X小时前 / X天前（含具体时刻兜底）。 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 30) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 1) return `${s}秒前`
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}天前`
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return `${d}天前`
  }
}

const css = `
.ks-tltb-restore-badge {
  margin-left: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  color: #15110a;
  background: var(--ks-amber, #d4ff48);
}
.ks-trash-pop {
  position: fixed;
  z-index: 9999;
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ks-border-strong, rgba(255,255,255,0.16));
  border-radius: var(--ks-radius-md, 10px);
  background: var(--ks-panel-solid, #14161c);
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  overflow: hidden;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
}
.ks-trash-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ks-border-soft, rgba(255,255,255,0.08));
}
.ks-trash-pop-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ks-text, #e8eaed);
}
.ks-trash-pop-clear {
  all: unset;
  cursor: pointer;
  font-size: 11px;
  color: var(--ks-text-faint, #8a8f98);
  padding: 2px 6px;
  border-radius: 4px;
}
.ks-trash-pop-clear:hover { color: var(--ks-rose, #f0779d); }
.ks-trash-pop-empty {
  padding: 16px 14px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ks-text-faint, #8a8f98);
}
.ks-trash-pop-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
}
.ks-trash-pop-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
}
.ks-trash-pop-item:hover { background: var(--ks-panel-elev, rgba(255,255,255,0.05)); }
.ks-trash-pop-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ks-trash-pop-reason {
  font-size: 12px;
  color: var(--ks-text, #e8eaed);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-trash-pop-time {
  font-size: 10px;
  color: var(--ks-text-faint, #8a8f98);
}
.ks-trash-pop-restore {
  all: unset;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--ks-radius-pill, 999px);
  color: var(--ks-amber, #d4ff48);
  border: 1px solid rgba(212, 255, 72, 0.4);
  background: rgba(212, 255, 72, 0.08);
}
.ks-trash-pop-restore:hover { background: rgba(212, 255, 72, 0.18); }
`
injectStyleOnce('timeline-restore-menu', css)
