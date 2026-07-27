/**
 * 「蓝图」tab 库视图 —— 左 CatalogShell 蓝图列表（+新建/重命名/设为入口/删除）+ 右
 * GraphStudio 编辑当前选中蓝图。主蓝图（游戏入口）置顶且不可重命名/删除/设为入口；
 * 子蓝图被其它蓝图引用时删除会被拦截（见 store `deleteBlueprint`）。
 *
 * 新建不用系统弹窗：点标题栏「＋」→ 按钮旁浮出输入（fixed，躲过列表 overflow），
 * Enter 确认 / Esc·点外 取消。标题冲突时保留浮层并提示。
 * 无依赖删除走内联 ConfirmDialog；有依赖 / 主蓝图仍 alert 拦截。
 */
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react'
import type { BlueprintDoc } from '../../runtime/schema/graph-schema'
import { blueprintsReferencing } from '../../graph/edit/blueprint-refs'
import { CatalogShell } from './CatalogShell'
import { GraphStudio } from './GraphStudio'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { NODIA_DEMO } from '../demo/demo'

const DUPLICATE_TITLE_MSG = '已存在同名蓝图'

/**
 * 蓝图库左列表的纯派生：主蓝图置顶（带「· 入口」标签），其余子蓝图按标题排序。
 * 纯函数，不依赖 store/React——供单测直接验证排序/标签规则，不必渲染整棵组件树。
 */
export function blueprintListItems(
  blueprints: Record<string, BlueprintDoc>,
  mainId: string,
): { id: string; label: string }[] {
  const main = blueprints[mainId]
  const subs = Object.values(blueprints)
    .filter((d) => d.id !== mainId)
    .sort((a, b) => a.title.localeCompare(b.title))
  const items: { id: string; label: string }[] = []
  if (main) items.push({ id: main.id, label: `${main.title} · 入口` })
  for (const d of subs) items.push({ id: d.id, label: d.title })
  return items
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  restoreFocus,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  restoreFocus: HTMLElement | null
}): JSX.Element {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    return () => {
      restoreFocus?.focus()
    }
  }, [restoreFocus])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const active = document.activeElement
    if (event.shiftKey && active === cancelRef.current) {
      event.preventDefault()
      confirmRef.current?.focus()
    } else if (!event.shiftKey && active === confirmRef.current) {
      event.preventDefault()
      cancelRef.current?.focus()
    }
  }

  return (
    <div className="val-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="val-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId} style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
        <div className="val-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>取消</button>
          <button ref={confirmRef} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function BlueprintLibraryView(): JSX.Element {
  const blueprints = useGraphScenario((s) => s.blueprints)
  const activeId = useGraphScenario((s) => s.activeBlueprintId)
  const mainId = useGraphScenario((s) => s.mainBlueprintId)
  const select = useGraphScenario((s) => s.selectBlueprint)
  const create = useGraphScenario((s) => s.createBlueprint)
  const rename = useGraphScenario((s) => s.renameBlueprint)
  const del = useGraphScenario((s) => s.deleteBlueprint)
  const setMain = useGraphScenario((s) => s.setMainBlueprint)
  const authoringProject = useGraphScenario((s) => s.authoringProject)

  const items = useMemo(() => blueprintListItems(blueprints, mainId), [blueprints, mainId])

  /** 浮层新建：null = 收起；字符串 = 正在输入的名称。 */
  const [draftName, setDraftName] = useState<string | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const composing = draftName !== null
  const composeRootRef = useRef<HTMLDivElement | null>(null)
  const composeInputRef = useRef<HTMLInputElement | null>(null)
  const [popStyle, setPopStyle] = useState<CSSProperties | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)

  const openCompose = () => {
    setComposeError(null)
    setDraftName('新蓝图')
  }
  const cancelCompose = () => {
    setDraftName(null)
    setComposeError(null)
  }
  const confirmCompose = () => {
    const t = draftName?.trim()
    if (!t) { cancelCompose(); return }
    const r = create(t)
    if (!r.ok) {
      setComposeError(DUPLICATE_TITLE_MSG)
      composeInputRef.current?.focus()
      composeInputRef.current?.select()
      return
    }
    cancelCompose()
  }

  // 贴「＋」右侧定位（fixed，避免 .gc-list overflow:hidden 裁切）。
  useLayoutEffect(() => {
    if (!composing) { setPopStyle(null); return }
    const place = () => {
      const btn = composeRootRef.current?.querySelector('.gc-list-add')
      if (!(btn instanceof HTMLElement)) return
      const r = btn.getBoundingClientRect()
      setPopStyle({
        position: 'fixed',
        top: r.top + r.height / 2,
        left: r.right + 8,
        transform: 'translateY(-50%)',
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [composing])

  useEffect(() => {
    if (!composing) return
    composeInputRef.current?.focus()
    composeInputRef.current?.select()
  }, [composing])

  useEffect(() => {
    if (!composing) return
    const onPointer = (e: PointerEvent) => {
      const root = composeRootRef.current
      if (root && !root.contains(e.target as Node)) cancelCompose()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [composing])

  const handleRename = (id: string) => {
    const t = prompt('重命名', blueprints[id]?.title)
    if (!t?.trim()) return
    const r = rename(id, t)
    if (!r.ok && r.reason === 'duplicate_title') alert(DUPLICATE_TITLE_MSG)
  }

  const handleDelete = (id: string, trigger: HTMLElement | null) => {
    if (id === mainId) {
      alert('主蓝图不可删')
      return
    }
    const refs = blueprintsReferencing(authoringProject(), id)
    if (refs.length) {
      alert(`被引用，无法删除：${refs.join(', ')}`)
      return
    }
    deleteTriggerRef.current = trigger
    setPendingDeleteId(id)
  }

  const confirmDelete = () => {
    if (!pendingDeleteId) return
    const r = del(pendingDeleteId)
    setPendingDeleteId(null)
    if (!r.ok) {
      alert(
        r.blockedBy?.includes('__main__')
          ? '主蓝图不可删'
          : `被引用，无法删除：${r.blockedBy?.join(', ')}`,
      )
    }
  }

  const pendingTitle = pendingDeleteId ? (blueprints[pendingDeleteId]?.title ?? pendingDeleteId) : ''

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <CatalogShell
        icon="🧩"
        title="蓝图"
        items={items}
        selectedId={activeId}
        onSelect={select}
        headAction={
          <div className="gc-list-compose-anchor" ref={composeRootRef}>
            <button
              type="button"
              className={`gc-list-add${composing ? ' is-on' : ''}`}
              title="新建蓝图"
              aria-expanded={composing}
              aria-haspopup="dialog"
              onClick={() => (composing ? cancelCompose() : openCompose())}
            >
              ＋
            </button>
            {composing && popStyle && (
              <div
                className="gc-list-compose-pop"
                role="dialog"
                aria-label="新建蓝图"
                style={popStyle}
              >
                <input
                  ref={composeInputRef}
                  value={draftName ?? ''}
                  placeholder="蓝图名称"
                  aria-label="新蓝图名称"
                  aria-invalid={!!composeError}
                  onChange={(e) => {
                    setDraftName(e.target.value)
                    if (composeError) setComposeError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmCompose() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelCompose() }
                  }}
                />
                <button type="button" className="gc-list-compose-ok" onClick={confirmCompose}>添加</button>
                {composeError && (
                  <div className="gc-list-compose-error" role="alert">{composeError}</div>
                )}
              </div>
            )}
          </div>
        }
        // 主蓝图不可重命名/删除/设为入口；子蓝图动作行内 hover/选中才显。
        // 「设为入口」用 ⌂（主页/入口），不用 ★（收藏语义）。
        renderRowActions={(id) =>
          id === mainId ? null : (
            <>
              <button type="button" className="gc-row-act" title="重命名" onClick={() => handleRename(id)}>✎</button>
              <button type="button" className="gc-row-act" title="设为入口" onClick={() => setMain(id)}>⌂</button>
              <button
                type="button"
                className="gc-row-act is-danger"
                title="删除"
                onClick={(e) => handleDelete(id, e.currentTarget)}
              >
                🗑
              </button>
            </>
          )
        }
        renderPreview={() => (
          <div style={{ display: 'flex', height: '100%', flex: 1, minWidth: 0 }}>
            <GraphStudio scenario={NODIA_DEMO} />
          </div>
        )}
      />
      {pendingDeleteId && (
        <ConfirmDialog
          title="删除蓝图"
          message={`确定删除「${pendingTitle}」？此操作不可撤销。`}
          confirmLabel="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
          restoreFocus={deleteTriggerRef.current}
        />
      )}
    </div>
  )
}
