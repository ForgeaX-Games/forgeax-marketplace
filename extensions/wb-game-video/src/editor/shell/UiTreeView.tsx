import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Overlay } from '../../runtime/schema/graph-schema'
import { injectStyleOnce } from '../../styles/injectStyle'
import { placeAdaptivePop } from './useBlueprintNavActions'

export interface UiTreeViewNode {
  id: string
  kind: 'folder' | 'scheme'
  name?: string
  overlayId?: string
  children?: UiTreeViewNode[]
  readOnly?: boolean
}

export interface UiTreeViewProps {
  nodes: readonly UiTreeViewNode[]
  overlays: Record<string, Overlay>
  usageByOverlay?: Record<string, number>
  selectedTreeNodeId: string | null
  onSelect: (node: UiTreeViewNode) => void
  onAddScheme: (parentId: string, name: string) => void
  onRename: (nodeId: string, name: string) => void
  onDelete: (node: UiTreeViewNode) => void
  /** 起始层级：子树挂在左栏「界面」行下时传 1，使缩进与主树 depth*8 连续。 */
  baseDepth?: number
}

const UI_TREE_CSS = `
.uit-tree { display:flex; flex-direction:column; width:100%; min-width:0; }
.uit-branch { display:flex; flex-direction:column; width:100%; min-width:0; }
.uit-row {
  box-sizing:border-box; width:100%; min-width:0; height:42px;
  display:flex; align-items:center; gap:4px; padding-right:8px;
  border-bottom:1px solid rgba(255,255,255,.10); background:transparent; color:#fff;
}
.uit-row:hover { background:rgba(255,255,255,.05); }
.uit-row.is-selected { background:rgba(255,255,255,.10); }
.uit-main {
  all:unset; box-sizing:border-box; min-width:0; flex:1; display:flex; align-items:center;
  gap:8px; cursor:pointer; height:41px; overflow:hidden;
}
.uit-main:focus-visible,.uit-icon-btn:focus-visible {
  outline:1px solid rgba(255,255,255,.45); outline-offset:-1px;
}
.uit-toggle {
  width:20px; height:20px; flex:none; display:inline-flex; align-items:center; justify-content:center;
  border:0; padding:0; background:transparent; color:var(--ns-text, #fff); cursor:pointer;
  transition:transform .18s ease, color .18s ease;
}
.uit-toggle svg { width:20px; height:20px; display:block; }
/* 收起态变暗，与主树 .ns-chev.is-collapsed 一致。 */
.uit-toggle.is-collapsed { color:var(--ns-text-40, rgba(255,255,255,.40)); transform:rotate(-90deg); }
/* 叶子方案无 chevron：用等宽占位补齐，使同级文件夹与方案的标签左边缘对齐（同主树 .ns-chev-spacer）。 */
.uit-chev-spacer { width:20px; height:20px; flex:none; }
.uit-label {
  min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:16px; line-height:26px;
}
.uit-usage { flex:none; font-size:11px; opacity:.65; }
.uit-row-actions {
  flex:none; display:none; align-items:center; gap:8px; margin-left:8px;
}
.uit-row:hover .uit-row-actions,
.uit-row:focus-within .uit-row-actions,
.uit-row-actions:has(.is-open) { display:inline-flex; }
.uit-icon-btn {
  all:unset; box-sizing:border-box; width:16px; height:16px; flex:none;
  display:inline-flex; align-items:center; justify-content:center; border-radius:3px;
  color:rgba(255,255,255,.40); cursor:pointer;
  transition:color .12s, background .12s;
}
.uit-icon-btn:hover,.uit-icon-btn.is-open { background:rgba(255,255,255,.10); color:#fff; }
.uit-icon-btn.is-danger:hover,.uit-icon-btn.is-danger.is-open { color:#ff8e8e; }
.uit-icon-btn svg { width:14px; height:14px; display:block; }
.uit-children { display:flex; flex-direction:column; width:100%; min-width:0; }
.uit-edit { flex:1; min-width:0; display:flex; gap:4px; }
.uit-edit input {
  min-width:0; flex:1; border:1px solid rgba(255,255,255,.22); border-radius:2px;
  background:#242424; color:#fff; padding:4px 6px;
}
.uit-edit button { flex:none; border:0; border-radius:2px; padding:4px 6px; cursor:pointer; }
.uit-compose-row {
  box-sizing:border-box; width:100%; height:42px; display:flex; align-items:center;
  border-bottom:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.10);
}
.uit-compose-input {
  flex:1; min-width:0; box-sizing:border-box; height:22px; padding:0 4px;
  border:0; border-radius:3px; outline:.4px solid rgba(255,255,255,.6);
  outline-offset:-.4px; background:rgba(44,44,44,.2); color:rgba(255,255,255,.6);
  font-family:inherit; font-size:16px; line-height:22px;
}
.uit-compose-input:focus { outline-color:rgba(255,255,255,.8); }
.ns-empty {
  min-height:42px; display:flex; align-items:center; border-bottom:1px solid rgba(255,255,255,.10);
  color:rgba(255,255,255,.45); font-size:13px; padding-left:8px;
}
`

type RowMode = 'rename' | 'delete' | null

// 默认朝下（展开）；.is-collapsed 旋 -90° → 朝右（收起），与 NewSidebar 主树一致。
const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const PencilIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M10.2083 6.41732L12.5416 4.08398L9.91661 1.45898L7.58327 3.79232L1.75 9.62565V12.2506H4.37494L10.2083 6.41732ZM7.58327 3.79232L10.2083 6.41732" stroke="currentColor" strokeWidth="1.16667" />
  </svg>
)

const PlusIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M0 5.85059L0 7.72559L5.91943 7.6875V13.5H7.79443V7.6875H13.5V5.8125H7.79443V0H5.91943V5.8125L0 5.85059Z" fill="currentColor" />
  </svg>
)

const TrashIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M12.25 2.91602H1.75M2.91667 2.91602H11.0833L10.7917 12.8327H3.20833L2.91667 2.91602ZM4.95833 1.16602H9.04167V2.91602H4.95833V1.16602Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
    <path d="M7 5.25V10.5" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
  </svg>
)

function UiTreeRow({
  node,
  depth,
  overlays,
  usageByOverlay,
  selectedTreeNodeId,
  onSelect,
  onAddScheme,
  onRename,
  onDelete,
}: UiTreeViewProps & { node: UiTreeViewNode; depth: number }): JSX.Element {
  const isFolder = node.kind === 'folder'
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<RowMode>(null)
  const [draft, setDraft] = useState(node.name ?? '')
  const [composingScheme, setComposingScheme] = useState(false)
  const [schemeDraft, setSchemeDraft] = useState('')
  // 删除确认浮层：复用主树 ns-pop-confirm 的 DOM/样式 + placeAdaptivePop 自适应定位。
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletePopRef = useRef<HTMLDivElement | null>(null)
  const [deletePopPlacement, setDeletePopPlacement] = useState<{ style: CSSProperties; side: 'below' | 'above' | 'right' | 'left' } | null>(null)
  const overlay = node.overlayId ? overlays[node.overlayId] : undefined
  const label = isFolder ? (node.name?.trim() || '未命名文件夹') : (overlay?.title?.trim() || node.overlayId || '缺失方案')
  const usage = node.overlayId ? (usageByOverlay?.[node.overlayId] ?? 0) : 0

  useEffect(() => {
    if (mode === 'rename') setDraft(node.name ?? label)
  }, [mode, node.name, label])

  // 删除确认浮层定位：与主树 useBlueprintNavActions 同模式——首次按 fallback 落点，
  // portal 挂上后用真实尺寸校准，并跟随窗口/侧栏滚动。
  useLayoutEffect(() => {
    if (mode !== 'delete') {
      setDeletePopPlacement(null)
      return
    }
    const place = (): void => {
      const trigger = deleteTriggerRef.current
      const pop = deletePopRef.current
      const size = pop
        ? { width: pop.offsetWidth || 180, height: pop.offsetHeight || 96 }
        : { width: 180, height: 96 }
      const p = placeAdaptivePop(trigger, size)
      if (p) setDeletePopPlacement({ style: p.style, side: p.side })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [mode])

  const confirmRename = (): void => {
    const next = draft.trim()
    if (next) onRename(node.id, next)
    setMode(null)
  }
  const confirmScheme = (): void => {
    const name = schemeDraft.trim()
    if (!name) return
    onAddScheme(node.id, name)
    setSchemeDraft('')
    setComposingScheme(false)
    setExpanded(true)
  }

  return (
    <div className="uit-branch" role="treeitem" aria-expanded={isFolder ? expanded : undefined}>
      <div
        className={`uit-row${selectedTreeNodeId === node.id ? ' is-selected' : ''}`}
        style={{ paddingLeft: depth * 8 }}
      >
        <div
          className="uit-main"
          role="button"
          tabIndex={0}
          aria-label={isFolder ? `${label} 文件夹` : `选择界面方案 ${label}`}
          onClick={() => {
            if (mode === 'rename') return
            // 与主树 activateRow 一致：文件夹行只展开/收起，不切换选中视图；
            // 只有叶子方案才选中并进入界面页。
            if (isFolder) {
              setExpanded((value) => !value)
              return
            }
            onSelect(node)
          }}
          onKeyDown={(event) => {
            if (mode === 'rename' || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            if (isFolder) {
              setExpanded((value) => !value)
              return
            }
            onSelect(node)
          }}
        >
          {isFolder ? (
            <button
              type="button"
              className={`uit-toggle${!expanded ? ' is-collapsed' : ''}`}
              aria-label={`${expanded ? '收起' : '展开'}${label}`}
              onClick={(event) => {
                event.stopPropagation()
                setExpanded((value) => !value)
              }}
            >
              {ChevronIcon}
            </button>
          ) : (
            <span className="uit-chev-spacer" aria-hidden />
          )}
          {mode === 'rename' ? (
            <span className="uit-edit" onClick={(event) => event.stopPropagation()}>
              <input
                autoFocus
                aria-label={`重命名${isFolder ? '文件夹' : '方案'}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); confirmRename() }
                  if (event.key === 'Escape') { event.preventDefault(); setMode(null) }
                }}
              />
              <button type="button" onClick={confirmRename}>确定</button>
            </span>
          ) : (
            <span className="uit-label" title={label}>{label}</span>
          )}
          {!isFolder && usage > 0 && <span className="uit-usage" title={`被 ${usage} 个节点引用`}>⇢{usage}</span>}
        </div>
        {!node.readOnly && mode !== 'rename' && (
          <span className="uit-row-actions" onClick={(event) => event.stopPropagation()}>
            {isFolder ? (
              <button
                type="button"
                className={`uit-icon-btn${composingScheme ? ' is-open' : ''}`}
                aria-label={`新增界面 ${label}`}
                title="新建界面"
                aria-expanded={composingScheme}
                onClick={() => {
                  setComposingScheme((current) => !current)
                  setSchemeDraft('')
                  setExpanded(true)
                }}
              >
                {PlusIcon}
              </button>
            ) : null}
            <button
              type="button"
              className="uit-icon-btn"
              aria-label={`重命名 ${label}`}
              title="重命名"
              onClick={() => setMode('rename')}
            >
              {PencilIcon}
            </button>
            <button
              ref={deleteTriggerRef}
              type="button"
              className={`uit-icon-btn is-danger${mode === 'delete' ? ' is-open' : ''}`}
              aria-label={`删除 ${label}`}
              title="删除"
              aria-expanded={mode === 'delete'}
              onClick={() => setMode((value) => (value === 'delete' ? null : 'delete'))}
            >
              {TrashIcon}
            </button>
          </span>
        )}
      </div>
      {isFolder && composingScheme ? (
        <div className="uit-compose-row" style={{ paddingLeft: (depth + 1) * 8 }}>
          <input
            autoFocus
            className="uit-compose-input"
            aria-label={`在${label}中新建界面`}
            placeholder="新建界面名称"
            value={schemeDraft}
            onChange={(event) => setSchemeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmScheme()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setSchemeDraft('')
                setComposingScheme(false)
              }
            }}
            onBlur={() => {
              setTimeout(() => {
                setSchemeDraft('')
                setComposingScheme(false)
              }, 0)
            }}
          />
        </div>
      ) : null}
      {mode === 'delete' && deletePopPlacement && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={deletePopRef}
            className="ns-pop-confirm"
            data-side={deletePopPlacement.side}
            role="dialog"
            aria-label={`删除${label}`}
            style={deletePopPlacement.style}
          >
            <span className="ns-pop-arrow" aria-hidden />
            <div className="ns-pop-confirm-msg">
              确定删除「{label}」？
              {!isFolder && usage > 0 ? ` 当前仍被 ${usage} 个节点引用。` : ''}
            </div>
            <div className="ns-pop-confirm-actions">
              <button type="button" onClick={() => setMode(null)}>取消</button>
              <button
                type="button"
                className="is-danger"
                onClick={() => { onDelete(node); setMode(null) }}
              >
                确认
              </button>
            </div>
          </div>,
          document.body,
        )
        : null}
      {isFolder && expanded && (node.children?.length ?? 0) > 0 && (
        <div className="uit-children" role="group">
          {node.children!.map((child) => (
            <UiTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              nodes={node.children!}
              overlays={overlays}
              usageByOverlay={usageByOverlay}
              selectedTreeNodeId={selectedTreeNodeId}
              onSelect={onSelect}
              onAddScheme={onAddScheme}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function UiTreeView(props: UiTreeViewProps): JSX.Element {
  injectStyleOnce('ui-tree-view', UI_TREE_CSS)
  const baseDepth = props.baseDepth ?? 0
  return (
    <div className="uit-tree" role="tree" aria-label="界面方案树">
      {props.nodes.length > 0 ? props.nodes.map((node) => (
        <UiTreeRow key={node.id} {...props} node={node} depth={baseDepth} />
      )) : <div className="ns-empty">暂无界面方案</div>}
    </div>
  )
}
