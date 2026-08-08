import { useEffect, useState } from 'react'
import type { Overlay } from '../../runtime/schema/graph-schema'
import { injectStyleOnce } from '../../styles/injectStyle'

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
  border:0; padding:0; background:transparent; color:#fff; cursor:pointer;
  transition:transform .18s ease;
}
.uit-toggle svg { width:20px; height:20px; display:block; }
.uit-toggle.is-collapsed { transform:rotate(-90deg); }
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
.uit-menu {
  box-sizing:border-box; width:calc(100% - 24px); min-width:0;
  margin:4px 0 4px 24px; padding:5px; display:flex; flex-wrap:wrap; gap:4px;
  border:1px solid rgba(255,255,255,.12); border-radius:2px; background:#353535;
}
.uit-menu button {
  border:0; border-radius:2px; padding:5px 7px; background:rgba(255,255,255,.08);
  color:#fff; cursor:pointer; font-size:12px;
}
.uit-menu button:hover { background:rgba(255,255,255,.15); }
.uit-menu button.is-danger { color:#ffb4ae; }
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
.uit-confirm { display:flex; flex-direction:column; gap:6px; width:100%; font-size:12px; line-height:1.4; }
.uit-confirm-actions { display:flex; justify-content:flex-end; gap:5px; }
.ns-empty {
  min-height:42px; display:flex; align-items:center; border-bottom:1px solid rgba(255,255,255,.10);
  color:rgba(255,255,255,.45); font-size:13px; padding-left:8px;
}
`

type RowMode = 'rename' | 'delete' | null

const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M15 12.5L10 7.5L5 12.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
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
  const overlay = node.overlayId ? overlays[node.overlayId] : undefined
  const label = isFolder ? (node.name?.trim() || '未命名文件夹') : (overlay?.title?.trim() || node.overlayId || '缺失方案')
  const usage = node.overlayId ? (usageByOverlay?.[node.overlayId] ?? 0) : 0

  useEffect(() => {
    if (mode === 'rename') setDraft(node.name ?? label)
  }, [mode, node.name, label])

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
          aria-label={isFolder ? `选择文件夹 ${label}` : `选择界面方案 ${label}`}
          onClick={() => {
            if (mode === 'rename') return
            onSelect(node)
            if (isFolder) setExpanded(true)
          }}
          onKeyDown={(event) => {
            if (mode === 'rename' || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            onSelect(node)
            if (isFolder) setExpanded(true)
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
          ) : null}
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
      {mode === 'delete' && (
        <div className="uit-menu" role="dialog" aria-label={`删除${label}`}>
          <div className="uit-confirm">
            <span>
              确定删除「{label}」？
              {!isFolder && usage > 0 ? ` 当前仍被 ${usage} 个节点引用。` : ''}
            </span>
            <span className="uit-confirm-actions">
              <button type="button" onClick={() => setMode(null)}>取消</button>
              <button type="button" className="is-danger" onClick={() => { onDelete(node); setMode(null) }}>确认删除</button>
            </span>
          </div>
        </div>
      )}
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
