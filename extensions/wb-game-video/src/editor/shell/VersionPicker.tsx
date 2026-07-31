/**
 * VersionPicker —— 历史版本切换（game-host 模型）。
 *
 * 「保存 = 打版本」：打版本动作在工具条的 💾 保存 按钮（`store.commit()`）。
 * 这里只提供「历史版本」下拉：选某个 vN = **非破坏式载入**该版内容到编辑器
 * （不改 git 历史、不 checkout），用户再点保存时才在最新之上新增一版。
 * 当前有未保存草稿时，下拉下方 popConfirm 二次确认（portal 到 body，避免被工具条/
 * 上方 chrome 裁切或盖住），不走原生 confirm。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'

const VERSION_PICKER_CSS = `
.gv-version-picker { position: relative; display: inline-flex; align-items: center; }
.gv-version-confirm-pop {
  z-index: 10050;
  display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  width: 240px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid #5a4030;
  background: #2a241c;
  color: #f6f1e9;
  box-shadow: 0 8px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
  font-size: 12px;
}
.gv-version-confirm-pop::before {
  content: '';
  position: absolute; left: 16px;
  width: 8px; height: 8px;
  transform: rotate(45deg);
  background: #2a241c;
}
.gv-version-confirm-pop[data-placement="below"]::before {
  top: -5px;
  border-left: 1px solid #5a4030;
  border-top: 1px solid #5a4030;
}
.gv-version-confirm-pop[data-placement="above"]::before {
  bottom: -5px;
  border-right: 1px solid #5a4030;
  border-bottom: 1px solid #5a4030;
}
.gv-version-confirm-msg { line-height: 1.4; color: #e8e0d4; }
.gv-version-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; }
.gv-version-confirm-actions button {
  all: unset; box-sizing: border-box; cursor: pointer;
  height: 28px; padding: 0 10px; border-radius: 7px;
  border: 1px solid #403830; color: #f6f1e9; font-size: 11.5px;
  background: rgba(255,255,255,.04);
}
.gv-version-confirm-actions button:hover { background: rgba(255,255,255,.08); border-color: #f08840; }
.gv-version-confirm-actions button.is-danger {
  border-color: rgba(248,113,113,.45);
  background: rgba(248,113,113,.16);
  color: #ff9a9a;
}
.gv-version-confirm-actions button.is-danger:hover { background: rgba(248,113,113,.28); }
`

function SupportedVersionPicker(): JSX.Element {
  injectStyleOnce('gv-version-picker', VERSION_PICKER_CSS)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const currentTag = useGraphScenario((s) => s.currentTag)
  const versions = useGraphScenario((s) => s.gameVersions)
  const loadVersion = useGraphScenario((s) => s.loadVersion)
  const refreshVersions = useGraphScenario((s) => s.refreshVersions)

  const [pendingTag, setPendingTag] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectRef = useRef<HTMLSelectElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [popStyle, setPopStyle] = useState<CSSProperties | null>(null)
  const [placement, setPlacement] = useState<'below' | 'above'>('below')

  const cancelPending = () => setPendingTag(null)
  const confirmPending = () => {
    if (!pendingTag) return
    const tag = pendingTag
    setPendingTag(null)
    void loadVersion(tag)
  }

  const requestLoad = (tag: string) => {
    if (isDraft) {
      setPendingTag(tag)
      return
    }
    void loadVersion(tag)
  }

  useLayoutEffect(() => {
    if (!pendingTag) { setPopStyle(null); return }
    const place = () => {
      const trigger = selectRef.current
      if (!trigger || typeof window === 'undefined') return
      const r = trigger.getBoundingClientRect()
      const gap = 8
      const h = popRef.current?.offsetHeight || 88
      const spaceBelow = window.innerHeight - r.bottom
      const above = spaceBelow < h + gap && r.top > spaceBelow
      setPlacement(above ? 'above' : 'below')
      const top = above ? Math.max(8, r.top - h - gap) : r.bottom + gap
      const left = Math.min(Math.max(8, r.left), window.innerWidth - 248)
      setPopStyle({ position: 'fixed', top, left })
    }
    place()
    // 首帧测真实高度后再校正一次（文案换行后高度可能变）。
    requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [pendingTag])

  useEffect(() => {
    if (!pendingTag) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return
      cancelPending()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelPending()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [pendingTag])

  const pop = pendingTag && popStyle ? (
    <div
      ref={popRef}
      className="gv-version-confirm-pop"
      role="dialog"
      aria-label="确认载入版本"
      data-placement={placement}
      style={popStyle}
    >
      <div className="gv-version-confirm-msg">
        载入版本 {pendingTag} 会覆盖当前未保存的修改，继续？
      </div>
      <div className="gv-version-confirm-actions">
        <button type="button" onClick={cancelPending}>取消</button>
        <button type="button" className="is-danger" onClick={confirmPending}>继续</button>
      </div>
    </div>
  ) : null

  return (
    <div className="gv-version-picker" ref={rootRef}>
      <select
        ref={selectRef}
        value={currentTag ?? ''}
        title="载入某个历史版本到编辑器（不改历史；保存后新增一版）"
        onFocus={() => void refreshVersions()}
        onChange={(e) => {
          const tag = e.target.value
          if (tag) requestLoad(tag)
        }}
      >
        <option value="">历史版本…</option>
        {versions.map((v) => (
          <option key={v.tag} value={v.tag}>
            {v.tag}
            {v.tag === currentTag ? '（当前）' : ''}
            {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleString()}` : ''}
          </option>
        ))}
      </select>
      {typeof document !== 'undefined' && pop ? createPortal(pop, document.body) : null}
    </div>
  )
}

export function VersionPicker(): JSX.Element | null {
  const supported = useGraphScenario((s) => s.versioningSupported)
  return supported ? <SupportedVersionPicker /> : null
}
