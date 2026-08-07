/**
 * 「蓝图」tab 库视图 —— 左 CatalogShell 蓝图列表（+新建/重命名/设为入口/删除）+ 右
 * GraphStudio 编辑当前选中蓝图。主蓝图（游戏入口）置顶且不可重命名/删除/设为入口；
 * 子蓝图被其它蓝图引用时删除会被拦截（见 store `deleteBlueprint`）。
 *
 * 新建 / 重命名不用系统弹窗：点「＋」或 ✎ → 按钮旁浮出输入（fixed，躲过列表 overflow），
 * Enter 确认 / Esc·点外 取消。标题冲突时保留浮层并提示。
 * 无依赖删除走按钮旁 popConfirm；有依赖 / 主蓝图仍 alert 拦截。
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties,
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

/** fixed 贴触发按钮右侧（躲过 .gc-list overflow:hidden）。 */
function placeBeside(trigger: HTMLElement | null): CSSProperties | null {
  if (!trigger) return null
  const r = trigger.getBoundingClientRect()
  return {
    position: 'fixed',
    top: r.top + r.height / 2,
    left: r.right + 8,
    transform: 'translateY(-50%)',
  }
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
  const composeTriggerRef = useRef<HTMLElement | null>(null)
  const [composePopStyle, setComposePopStyle] = useState<CSSProperties | null>(null)

  /** 行内重命名浮层。 */
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameRootRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameTriggerRef = useRef<HTMLElement | null>(null)
  const [renamePopStyle, setRenamePopStyle] = useState<CSSProperties | null>(null)

  /** 行内删除 popConfirm。 */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deleteRootRef = useRef<HTMLDivElement | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const [deletePopStyle, setDeletePopStyle] = useState<CSSProperties | null>(null)

  const cancelCompose = () => {
    setDraftName(null)
    setComposeError(null)
  }
  const cancelRename = () => {
    setRenameId(null)
    setRenameDraft('')
    setRenameError(null)
  }
  const cancelDelete = () => {
    setPendingDeleteId(null)
  }

  const openCompose = () => {
    cancelRename()
    cancelDelete()
    setComposeError(null)
    setDraftName('新蓝图')
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

  const openRename = (id: string, trigger: HTMLElement) => {
    cancelCompose()
    cancelDelete()
    renameTriggerRef.current = trigger
    setRenameError(null)
    setRenameId(id)
    setRenameDraft(blueprints[id]?.title ?? '')
  }
  const confirmRename = () => {
    if (!renameId) return
    const t = renameDraft.trim()
    if (!t) { cancelRename(); return }
    const r = rename(renameId, t)
    if (!r.ok && r.reason === 'duplicate_title') {
      setRenameError(DUPLICATE_TITLE_MSG)
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
      return
    }
    cancelRename()
  }

  const openDelete = (id: string, trigger: HTMLElement) => {
    if (id === mainId) {
      alert('主蓝图不可删')
      return
    }
    const refs = blueprintsReferencing(authoringProject(), id)
    if (refs.length) {
      alert(`被引用，无法删除：${refs.join(', ')}`)
      return
    }
    cancelCompose()
    cancelRename()
    deleteTriggerRef.current = trigger
    setPendingDeleteId(id)
  }
  const confirmDelete = () => {
    if (!pendingDeleteId) return
    const r = del(pendingDeleteId)
    cancelDelete()
    if (!r.ok) {
      alert(
        r.blockedBy?.includes('__main__')
          ? '主蓝图不可删'
          : `被引用，无法删除：${r.blockedBy?.join(', ')}`,
      )
    }
  }

  // 贴触发钮右侧定位（fixed）。
  useLayoutEffect(() => {
    if (!composing) { setComposePopStyle(null); return }
    const place = () => {
      const btn = composeTriggerRef.current
        ?? composeRootRef.current?.querySelector('.gc-list-add')
      if (!(btn instanceof HTMLElement)) return
      composeTriggerRef.current = btn
      setComposePopStyle(placeBeside(btn))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [composing])

  useLayoutEffect(() => {
    if (!renameId) { setRenamePopStyle(null); return }
    const place = () => setRenamePopStyle(placeBeside(renameTriggerRef.current))
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [renameId])

  useLayoutEffect(() => {
    if (!pendingDeleteId) { setDeletePopStyle(null); return }
    const place = () => setDeletePopStyle(placeBeside(deleteTriggerRef.current))
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [pendingDeleteId])

  useEffect(() => {
    if (!composing) return
    composeInputRef.current?.focus()
    composeInputRef.current?.select()
  }, [composing])

  useEffect(() => {
    if (!renameId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renameId])

  useEffect(() => {
    if (!composing) return
    const onPointer = (e: PointerEvent) => {
      const root = composeRootRef.current
      if (root && !root.contains(e.target as Node)) cancelCompose()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [composing])

  useEffect(() => {
    if (!renameId) return
    const onPointer = (e: PointerEvent) => {
      const root = renameRootRef.current
      if (root && !root.contains(e.target as Node)) cancelRename()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [renameId])

  useEffect(() => {
    if (!pendingDeleteId) return
    const onPointer = (e: PointerEvent) => {
      const root = deleteRootRef.current
      if (root && !root.contains(e.target as Node)) cancelDelete()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelDelete()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [pendingDeleteId])

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
            {composing && composePopStyle && (
              <div
                className="gc-list-compose-pop"
                role="dialog"
                aria-label="新建蓝图"
                style={composePopStyle}
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
              <div
                className="gc-row-act-anchor"
                ref={renameId === id ? renameRootRef : undefined}
              >
                <button
                  type="button"
                  className={`gc-row-act${renameId === id ? ' is-on' : ''}`}
                  title="重命名"
                  aria-expanded={renameId === id}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    if (renameId === id) cancelRename()
                    else openRename(id, e.currentTarget)
                  }}
                >
                  ✎
                </button>
                {renameId === id && renamePopStyle && (
                  <div
                    className="gc-list-compose-pop"
                    role="dialog"
                    aria-label="重命名蓝图"
                    style={renamePopStyle}
                  >
                    <input
                      ref={renameInputRef}
                      value={renameDraft}
                      placeholder="蓝图名称"
                      aria-label="蓝图名称"
                      aria-invalid={!!renameError}
                      onChange={(e) => {
                        setRenameDraft(e.target.value)
                        if (renameError) setRenameError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                      }}
                    />
                    <button type="button" className="gc-list-compose-ok" onClick={confirmRename}>确定</button>
                    {renameError && (
                      <div className="gc-list-compose-error" role="alert">{renameError}</div>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="gc-row-act" title="设为入口" onClick={() => setMain(id)}>⌂</button>
              <div
                className="gc-row-act-anchor"
                ref={pendingDeleteId === id ? deleteRootRef : undefined}
              >
                <button
                  type="button"
                  className={`gc-row-act is-danger${pendingDeleteId === id ? ' is-on' : ''}`}
                  title="删除"
                  aria-expanded={pendingDeleteId === id}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    if (pendingDeleteId === id) cancelDelete()
                    else openDelete(id, e.currentTarget)
                  }}
                >
                  🗑
                </button>
                {pendingDeleteId === id && deletePopStyle && (
                  <div
                    className="gc-list-compose-pop gc-list-confirm-pop"
                    role="dialog"
                    aria-label="删除蓝图"
                    style={deletePopStyle}
                  >
                    <div className="gc-list-confirm-msg">
                      确定删除「{pendingTitle}」？此操作不可撤销。
                    </div>
                    <div className="gc-list-confirm-actions">
                      <button type="button" onClick={cancelDelete}>取消</button>
                      <button type="button" className="is-danger" onClick={confirmDelete}>确认删除</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        }
        renderPreview={() => (
          <div style={{ display: 'flex', height: '100%', flex: 1, minWidth: 0 }}>
            <GraphStudio scenario={NODIA_DEMO} />
          </div>
        )}
      />
    </div>
  )
}
