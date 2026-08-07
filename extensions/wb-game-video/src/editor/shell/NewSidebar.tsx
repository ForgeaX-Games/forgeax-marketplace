/**
 * NewSidebar —— 新版左侧栏（按 Figma 15195_75500 视觉稿）。
 *
 * 「蓝图」子树接真实 `blueprints`（扁平：主入口置顶 + 子蓝图排序），资产和规则
 * 同样从项目数据派生；视频仍为 mock。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'
import { countOverlayReferences } from '../../graph/edit/overlay-edit'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { BASIC_UI_FOLDER_ID, ensureUiTree, findUiTreeNode } from '../persist/ui-tree'
import { sendUiNavCommand, useUiNavMirror } from '../persist/uiNavSync'
import { useUiSelection } from '../persist/uiSelectionStore'
import { useGraphView, type GraphView } from '../persist/graphViewStore'
import { useAssetNav } from '../persist/assetNavStore'
import { useRuleSelection } from '../persist/ruleSelectionStore'
import { ASSET_DIRECTORY_ROOTS, childrenOf, type AssetDirectoryController } from '../assets/asset-directory'
import {
  assetEntryKey,
  assetEntryName,
  assetEntryRoot,
  parentFolderIdForAssetEntry,
  type AssetListEntry,
} from '../assets/asset-entries'
import { useAssetBrowser } from '../assets/use-asset-browser'
import type { AssetLibraryRootKind } from '../assets/registry-types'
import { blueprintListItems } from './blueprintNav'
import { useBlueprintNavActions, type BlueprintNavActions } from './useBlueprintNavActions'
import { UiTreeView, type UiTreeViewNode } from './UiTreeView'

type NavKind = 'entry' | 'branch' | 'leaf'

export interface NavNode {
  id: string
  label: string
  kind: NavKind
  view?: GraphView
  canAddChild?: boolean
  /** 子项由节点外部组件渲染（如界面 UiTreeView），但本行仍应按可展开节点布局。 */
  externallyExpandable?: boolean
  /** 真实蓝图叶子：走 store CRUD；主蓝图可重命名，不可删除/设为入口。 */
  blueprint?: boolean
  /** 是否为入口蓝图。 */
  isEntry?: boolean
  assetLocation?: { root: AssetLibraryRootKind, folderId?: string, entryKey?: string }
  ruleTarget?: { section: 'entities' | 'variables' | 'formulas', itemId?: string }
  children?: NavNode[]
}

/** 非蓝图顶层 mock（视频/界面/试玩）。 */
const MOCK_ENTRIES: readonly NavNode[] = [
  {
    id: 'video',
    label: '视频',
    kind: 'entry',
    view: 'video',
    canAddChild: true,
    children: [
      {
        id: 'vid-generated',
        label: '生成视频',
        kind: 'branch',
        view: 'video-generate',
        children: [
          { id: 'vid-gen-door', label: 'narr-door.mp4', kind: 'leaf' },
          { id: 'vid-gen-land', label: 'narr-land.mp4', kind: 'leaf' },
        ],
      },
      { id: 'vid-uploaded', label: '上传视频', kind: 'leaf' },
    ],
  },
  {
    id: 'ui',
    label: '界面',
    kind: 'entry',
    view: 'ui',
    canAddChild: true,
    externallyExpandable: true,
    // 子树由真实 UiTreeView 渲染（main #115），不再用 mock children。
    // 行内加号在「自定义界面(ui-folder:custom)」下新建界面方案。
  },
  { id: 'play', label: '试玩', kind: 'entry', view: 'play' },
]

function buildNavTree(
  blueprints: Parameters<typeof blueprintListItems>[0],
  mainId: string,
  assets: NavNode,
  rules: NavNode,
): NavNode[] {
  const bpChildren: NavNode[] = blueprintListItems(blueprints, mainId).map((it) => ({
    id: it.id,
    label: it.label,
    kind: 'leaf',
    blueprint: true,
    isEntry: it.isEntry,
  }))
  return [
    {
      id: 'graph',
      label: '蓝图',
      kind: 'entry',
      view: 'graph',
      canAddChild: true,
      children: bpChildren,
    },
    ...MOCK_ENTRIES,
    assets,
    rules,
  ]
}

function buildAssetNavNode(directory: AssetDirectoryController, entries: readonly AssetListEntry[]): NavNode {
  const buildFolder = (folderId: string, root: AssetLibraryRootKind): NavNode[] => [
    ...childrenOf(directory.assetLibrary, folderId, root).map((folder) => ({
      id: `asset-folder:${folder.id}`,
      label: folder.name,
      kind: 'branch' as const,
      assetLocation: { root, folderId: folder.id },
      children: buildFolder(folder.id, root),
    })),
    ...entries
      .filter((entry) => assetEntryRoot(entry) === root
        && parentFolderIdForAssetEntry(entry, directory.assetLibrary.placements) === folderId)
      .sort((left, right) => assetEntryName(left).localeCompare(assetEntryName(right), 'zh-CN'))
      .map((entry) => ({
        id: `asset-entry:${assetEntryKey(entry)}`,
        label: assetEntryName(entry),
        kind: 'leaf' as const,
        assetLocation: { root, folderId: folderId.startsWith('root:') ? undefined : folderId, entryKey: assetEntryKey(entry) },
      })),
  ]
  return {
    id: 'assets',
    label: '资产库',
    kind: 'entry',
    view: 'assets',
    children: ASSET_DIRECTORY_ROOTS.map((root) => ({
      id: `asset-root:${root.kind}`,
      label: root.name,
      kind: 'branch',
      assetLocation: { root: root.kind },
      children: buildFolder(root.id, root.kind),
    })),
  }
}

function buildRuleNavNode(meta: { entities?: Record<string, { id: string, name?: string }>, variables?: Record<string, { id: string, name?: string }>, formulas?: Record<string, { id: string, name?: string }> }): NavNode {
  const section = <T extends { id: string, name?: string }>(
    id: 'entities' | 'variables' | 'formulas',
    label: string,
    values: Record<string, T> | undefined,
  ): NavNode => ({
    id: `rule-${id}`,
    label,
    kind: 'branch',
    ruleTarget: { section: id },
    children: Object.entries(values ?? {}).map(([key, value]) => ({
      id: `rule-${id}:${key}`,
      label: value.name?.trim() || value.id || key,
      kind: 'leaf',
      ruleTarget: { section: id, itemId: key },
    })),
  })
  return {
    id: 'rule',
    label: '规则',
    kind: 'entry',
    view: 'rule',
    children: [
      section('entities', '实体', meta.entities),
      section('variables', '变量', meta.variables),
      section('formulas', '公式', meta.formulas),
    ],
  }
}

const NEW_SIDEBAR_CSS = `
.ns-sidebar {
  --ns-bg: #2C2C2C;
  --ns-line: rgba(255, 255, 255, 0.10);
  --ns-text: #FFFFFF;
  --ns-text-40: rgba(255, 255, 255, 0.40);
  --ns-text-60: rgba(255, 255, 255, 0.60);
  --ns-text-80: rgba(255, 255, 255, 0.80);
  --ns-row-h: 42px;
  width: 240px;
  min-width: 220px;
  flex: none;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ns-bg);
  color: var(--ns-text);
  font-family: 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.ns-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.ns-scroll::-webkit-scrollbar { width: 6px; }
.ns-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 3px; }
.ns-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
.ns-row {
  all: unset;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--ns-row-h);
  padding-right: 8px;
  border-bottom: 1px solid var(--ns-line);
  cursor: pointer;
  font-family: inherit;
  transition: background .12s;
}
.ns-row:hover { background: rgba(255, 255, 255, 0.04); }
.ns-row.is-active { background: rgba(255, 255, 255, 0.10); }
.ns-row.is-editing { background: rgba(255, 255, 255, 0.10); }
.ns-row:focus-visible { outline: 1px solid rgba(255,255,255,0.45); outline-offset: -1px; }
.ns-chev {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  margin-right: 8px;
  cursor: pointer;
  color: var(--ns-text);
  transition: transform .18s ease;
}
.ns-chev svg { width: 20px; height: 20px; display: block; }
.ns-chev.is-collapsed { transform: rotate(-90deg); }
.ns-label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 400;
  line-height: 26px;
  color: var(--ns-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ns-add-anchor { flex: none; position: relative; display: inline-flex; }
.ns-add {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ns-text-80);
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: background .12s;
}
.ns-add:hover, .ns-add.is-on { background: rgba(255,255,255,0.10); }
.ns-add svg { width: 14px; height: 14px; display: block; }
.ns-row-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
}
/* 仅 hover 显示操作组；选中态不常驻。浮层打开时（.is-on）保持可见以免 pop 被藏。 */
.ns-row:hover .ns-row-actions,
.ns-row-actions:has(.is-on) { display: inline-flex; }
.ns-act-anchor { position: relative; display: inline-flex; }
.ns-act {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  color: var(--ns-text-40);
  border-radius: 3px;
  transition: color .12s, background .12s;
}
.ns-act:hover, .ns-act.is-on { color: var(--ns-text); background: rgba(255,255,255,0.10); }
.ns-act.is-danger:hover, .ns-act.is-danger.is-on { color: #ff8e8e; }
.ns-act svg { width: 14px; height: 14px; display: block; }
/* portal 到 body 的删除确认；位置 / --ns-arrow 由 placeAdaptivePop 写入。 */
.ns-pop-confirm {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
  max-width: min(240px, calc(100vw - 16px));
  padding: 10px;
  background: #3a3a3a;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  color: #fff;
  font-family: 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.ns-pop-arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #3a3a3a;
  border: 1px solid rgba(255,255,255,0.16);
  transform: rotate(45deg);
  pointer-events: none;
  box-sizing: border-box;
}
/* 浮层在按钮下方 → 箭头在顶边朝上指向按钮 */
.ns-pop-confirm[data-side="below"] .ns-pop-arrow {
  top: -5px;
  left: var(--ns-arrow);
  margin-left: -4px;
  border-right: none;
  border-bottom: none;
}
/* 浮层在按钮上方 → 箭头在底边朝下 */
.ns-pop-confirm[data-side="above"] .ns-pop-arrow {
  bottom: -5px;
  left: var(--ns-arrow);
  margin-left: -4px;
  border-left: none;
  border-top: none;
}
/* 浮层在按钮右侧 → 箭头在左边朝左 */
.ns-pop-confirm[data-side="right"] .ns-pop-arrow {
  left: -5px;
  top: var(--ns-arrow);
  margin-top: -4px;
  border-right: none;
  border-top: none;
}
/* 浮层在按钮左侧 → 箭头在右边朝右 */
.ns-pop-confirm[data-side="left"] .ns-pop-arrow {
  right: -5px;
  top: var(--ns-arrow);
  margin-top: -4px;
  border-left: none;
  border-bottom: none;
}
.ns-pop-confirm-msg {
  font-size: 13px;
  line-height: 1.4;
  color: rgba(255,255,255,0.80);
  word-break: break-word;
}
.ns-pop-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ns-pop-confirm-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 4px;
  background: transparent;
  color: rgba(255,255,255,0.80);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}
.ns-pop-confirm-actions button.is-danger {
  background: rgba(220, 80, 80, 0.25);
  border-color: rgba(255,142,142,0.35);
  color: #ffb4b4;
}
.ns-entry-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 17.80px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: 4px;
  outline: 0.4px solid rgba(255, 255, 255, 0.40);
  outline-offset: -0.4px;
  color: #fff;
  font-size: 11px;
  font-weight: 400;
  font-family: 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif;
  flex-shrink: 0;
  vertical-align: middle;
  line-height: 1;
}
.ns-inline-edit {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 22px;
  padding: 0 4px;
  border: none;
  border-radius: 3px;
  outline: 0.4px solid var(--ns-text-60);
  outline-offset: -0.4px;
  background: rgba(44, 44, 44, 0.20);
  color: var(--ns-text-60);
  font-family: inherit;
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}
.ns-inline-edit:focus { outline-color: rgba(255,255,255,0.80); }
.ns-inline-edit[aria-invalid="true"] { outline-color: #ff8e8e; }
.ns-ui-tree {
  width: 100%;
  min-width: 0;
}
`

function toViewNodes(nodes: readonly UiTreeViewNode[]): UiTreeViewNode[] {
  return nodes.map((node) => {
    if (node.kind === 'scheme') {
      return { ...node, readOnly: node.overlayId?.startsWith('base:') ?? false }
    }
    return {
      ...node,
      readOnly: node.id === BASIC_UI_FOLDER_ID,
      children: toViewNodes(node.children ?? []),
    }
  })
}

const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M15 12.5L10 7.5L5 12.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const PlusIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M0 5.85059L0 7.72559L5.91943 7.6875V13.5H7.79443V7.6875H13.5V5.8125H7.79443V0H5.91943V5.8125L0 5.85059Z" fill="currentColor" />
  </svg>
)
const PencilIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M10.2083 6.41732L12.5416 4.08398L9.91661 1.45898L7.58327 3.79232L1.75 9.62565V12.2506H4.37494L10.2083 6.41732ZM7.58327 3.79232L10.2083 6.41732" stroke="currentColor" strokeWidth="1.16667" />
  </svg>
)
const TrashIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M12.25 2.91602H1.75M2.91667 2.91602H11.0833L10.7917 12.8327H3.20833L2.91667 2.91602ZM4.95833 1.16602H9.04167V2.91602H4.95833V1.16602Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
    <path d="M7 5.25V10.5" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
  </svg>
)
const HomeIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M10.2096 8.4589L7.0013 5.25057L3.79297 8.4589M2.91797 2.91724H11.0846M7.0013 5.97974V11.6672" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
  </svg>
)
interface NsRowProps {
  node: NavNode
  depth: number
  expanded: Set<string>
  activeId: string | null
  mainId: string
  bp: BlueprintNavActions
  onToggle: (id: string) => void
  onSelect: (node: NavNode) => void
  onMockAddChild: (node: NavNode) => void
  onMockRename: (node: NavNode) => void
  onMockDelete: (node: NavNode) => void
}

function NsRow({
  node, depth, expanded, activeId, mainId, bp,
  onToggle, onSelect, onMockAddChild, onMockRename, onMockDelete,
}: NsRowProps): JSX.Element {
  const hasChildren = !!(node.children && node.children.length > 0)
  const isExpandable = hasChildren || !!node.externallyExpandable
  const isExpanded = expanded.has(node.id)
  const isActive = activeId === node.id
  const indent = depth * 8
  const isBlueprintLeaf = !!node.blueprint
  const isMainBp = isBlueprintLeaf && (node.isEntry || node.id === mainId)
  const isEditing = !!isBlueprintLeaf && bp.renameId === node.id
  const inlineRenameRef = useRef<HTMLInputElement>(null!)

  useEffect(() => {
    if (isEditing && inlineRenameRef.current) {
      inlineRenameRef.current.focus()
      inlineRenameRef.current.select()
    }
  }, [isEditing])

  let rowActions: ReactNode = null
  if (isBlueprintLeaf) {
    rowActions = (
      <>
        <button
          type="button"
          className={`ns-act${isEditing ? ' is-on' : ''}`}
          aria-label={`重命名 ${node.label}`}
          title="重命名"
          onClick={() => {
            if (isEditing) bp.cancelRename()
            else bp.openRename(node.id)
          }}
        >
          {PencilIcon}
        </button>
        {!isMainBp && (
          <>
            <button
              type="button"
              className="ns-act"
              aria-label={`设为入口 ${node.label}`}
              title="设为入口"
              onClick={() => bp.setMain(node.id)}
            >
              {HomeIcon}
            </button>
            <button
              type="button"
              className={`ns-act is-danger${bp.pendingDeleteId === node.id ? ' is-on' : ''}`}
              aria-label={`删除 ${node.label}`}
              title="删除"
              aria-expanded={bp.pendingDeleteId === node.id}
              onClick={(e) => {
                if (bp.pendingDeleteId === node.id) bp.cancelDelete()
                else bp.openDelete(node.id, e.currentTarget)
              }}
            >
              {TrashIcon}
            </button>
          </>
        )}
      </>
    )
  } else if (!isBlueprintLeaf && node.kind !== 'entry') {
    rowActions = (
      <>
        <button type="button" className="ns-act" aria-label={`重命名 ${node.label}`} title="重命名" onClick={() => onMockRename(node)}>
          {PencilIcon}
        </button>
        <button type="button" className="ns-act" aria-label={`删除 ${node.label}`} title="删除" onClick={() => onMockDelete(node)}>
          {TrashIcon}
        </button>
      </>
    )
  }

  const addChild = node.id === 'graph'
    ? (
      <button
        type="button"
        className={`ns-add${bp.composing ? ' is-on' : ''}`}
        aria-label="新增 蓝图 子项"
        title="新建蓝图"
        aria-expanded={bp.composing}
        onClick={(e) => {
          e.stopPropagation()
          if (bp.composing) bp.cancelCompose()
          else bp.openCompose()
        }}
      >
        {PlusIcon}
      </button>
    )
    : node.canAddChild
      ? (
        <button
          type="button"
          className="ns-add"
          aria-label={`新增 ${node.label} 子项`}
          title="新增子项"
          onClick={(e) => {
            e.stopPropagation()
            onMockAddChild(node)
          }}
        >
          {PlusIcon}
        </button>
      )
      : null

  return (
    <>
      <div
        className={`ns-row${isActive ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
        role="treeitem"
        aria-expanded={isExpandable ? isExpanded : undefined}
        aria-selected={isActive}
        tabIndex={0}
        style={{ paddingLeft: indent }}
        onClick={() => onSelect(node)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(node)
          }
        }}
      >
        {isExpandable && (
          <button
            type="button"
            className={`ns-chev${isExpanded ? '' : ' is-collapsed'}`}
            aria-label={`${isExpanded ? '折叠' : '展开'} ${node.label}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
            }}
          >
            {ChevronIcon}
          </button>
        )}
        {isEditing ? (
          <input
            ref={inlineRenameRef}
            className="ns-inline-edit"
            aria-label="重命名蓝图"
            aria-invalid={!!bp.renameError}
            value={bp.renameDraft}
            placeholder="蓝图名称"
            onChange={(e) => {
              bp.setRenameDraft(e.target.value)
              if (bp.renameError) bp.clearRenameError()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); bp.confirmRename() }
              else if (e.key === 'Escape') { e.preventDefault(); bp.cancelRename() }
            }}
            onBlur={() => {
              setTimeout(() => {
                if (bp.renameId === node.id) bp.cancelRename()
              }, 0)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="ns-label" title={node.label}>
            {node.label}
            {node.isEntry && (
              <span
                className="ns-entry-badge"
                aria-label="入口"
              >
                入口
              </span>
            )}
          </span>
        )}
        {rowActions && (
          <span className="ns-row-actions" onClick={(e) => e.stopPropagation()}>
            {rowActions}
          </span>
        )}
        {addChild}
      </div>
      {hasChildren && isExpanded && (
        <>
          {node.children!.map((child, i) => (
            <Fragment key={child.id}>
              {node.id === 'graph' && bp.composing && i === 0 && (
                <div
                  className="ns-row is-editing"
                  style={{ paddingLeft: (depth + 1) * 8 }}
                >
                  <input
                    ref={bp.composeInputRef}
                    className="ns-inline-edit"
                    aria-label="新建蓝图名称"
                    aria-invalid={!!bp.composeError}
                    value={bp.draftName ?? ''}
                    placeholder="新建蓝图名称"
                    onChange={(e) => {
                      bp.setDraftName(e.target.value)
                      if (bp.composeError) bp.clearComposeError()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); bp.confirmCompose() }
                      else if (e.key === 'Escape') { e.preventDefault(); bp.cancelCompose() }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (bp.composing) bp.cancelCompose()
                      }, 0)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <NsRow
                node={child}
                depth={depth + 1}
                expanded={expanded}
                activeId={activeId}
                mainId={mainId}
                bp={bp}
                onToggle={onToggle}
                onSelect={onSelect}
                onMockAddChild={onMockAddChild}
                onMockRename={onMockRename}
                onMockDelete={onMockDelete}
              />
            </Fragment>
          ))}
        </>
      )}
    </>
  )
}

export function NewSidebar({ uiNavMode = 'standalone' }: { uiNavMode?: 'left' | 'standalone' }): JSX.Element {
  injectStyleOnce('new-sidebar', NEW_SIDEBAR_CSS)
  const view = useGraphView((s) => s.view)
  const setView = useGraphView((s) => s.setView)
  const setAssetLocation = useAssetNav((s) => s.setLocation)
  const selectRule = useRuleSelection((s) => s.select)
  const gameId = useGraphScenario((s) => s.game)
  const { entries: assetEntries, directory: assetDirectory } = useAssetBrowser(gameId)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainId = useGraphScenario((s) => s.mainBlueprintId)
  const activeBlueprintId = useGraphScenario((s) => s.activeBlueprintId)
  const selectBlueprint = useGraphScenario((s) => s.selectBlueprint)
  const ruleMeta = useGraphScenario((s) => s.meta)
  const meta = useGraphScenario((s) => (uiNavMode === 'left' ? null : s.meta))
  const remoteSnapshot = useUiNavMirror((s) => s.snapshot)
  const selectedTreeNodeId = useUiSelection((s) => s.selectedTreeNodeId)
  const selectUiNode = useUiSelection((s) => s.selectUiNode)
  const bp = useBlueprintNavActions()

  const localOverlays = meta?.ui?.overlays ?? {}
  const overlays = uiNavMode === 'left'
    ? Object.fromEntries(Object.entries(remoteSnapshot?.overlays ?? {}).map(([id, overlay]) => [
      id,
      { ...overlay, children: [] },
    ]))
    : localOverlays
  const uiTree = uiNavMode === 'left'
    ? ensureUiTree(remoteSnapshot?.uiTree, overlays)
    : ensureUiTree(meta?.uiTree, localOverlays)
  const uiNodes = toViewNodes(uiTree.root)
  const overlayUsage = uiNavMode === 'left'
    ? (remoteSnapshot?.usage ?? {})
    : countOverlayReferences(Object.values(blueprints ?? {}).map((doc) => doc.graph))

  const navTree = useMemo(
    () => buildNavTree(blueprints, mainId, buildAssetNavNode(assetDirectory, assetEntries), buildRuleNavNode({
      entities: ruleMeta.entities,
      variables: ruleMeta.variables,
      formulas: ruleMeta.formulas as Record<string, { id: string, name?: string }> | undefined,
    })),
    [assetDirectory, assetEntries, blueprints, mainId, ruleMeta.entities, ruleMeta.formulas, ruleMeta.variables],
  )

  // 目录默认全部收起。展开状态只由用户点箭头（或明确的新建操作）改变；
  // 不能在资产/规则数据刷新时把已收起的分支重新打开。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const activeId = view === 'graph'
    ? (activeBlueprintId || 'graph')
    : (navTree.find((n) => n.view === view)?.id ?? null)

  const onToggle = (id: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSelect = (node: NavNode): void => {
    if (node.id === 'assets') {
      // “资产库”是浏览器根入口，不是上一次选中的分类或文件夹。
      setAssetLocation({ root: null })
      setView('assets')
      return
    }
    if (node.assetLocation) {
      setView('assets')
      setAssetLocation(node.assetLocation)
      return
    }
    if (node.ruleTarget) {
      selectRule(node.ruleTarget.section, node.ruleTarget.itemId)
      setView('rule')
      return
    }
    if (node.blueprint) {
      selectBlueprint(node.id)
      setView('graph')
      return
    }
    if (node.view) {
      setView(node.view)
      if (node.view === 'graph' && activeBlueprintId) {
        // 点「蓝图」入口：保持当前蓝图选中
        return
      }
    }
  }

  const onMockAddChild = (node: NavNode): void => {
    setExpanded((cur) => new Set(cur).add(node.id))
    if (node.id === 'ui') {
      // 未进入文件夹时先创建根文件夹；选中可编辑文件夹后，顶层加号新建方案；
      // 选中方案时则在其父文件夹继续新建方案。
      // 文件夹行尾只保留重命名 / 删除，与其它导航树分支一致。
      setView('ui')
      const selectedNode = selectedTreeNodeId ? findUiTreeNode(uiTree, selectedTreeNodeId) : undefined
      let targetFolderId = selectedNode?.kind === 'folder' ? selectedNode.id : null
      if (selectedNode?.kind === 'scheme') {
        const findParentFolderId = (nodes: readonly UiTreeViewNode[], targetId: string, parentId: string | null = null): string | null => {
          for (const item of nodes) {
            if (item.id === targetId) return parentId
            if (item.kind === 'folder') {
              const found = findParentFolderId(item.children ?? [], targetId, item.id)
              if (found) return found
            }
          }
          return null
        }
        targetFolderId = findParentFolderId(uiNodes, selectedNode.id)
      }
      if (targetFolderId && targetFolderId !== BASIC_UI_FOLDER_ID) {
        sendUiNavCommand({ type: 'add-scheme', parentId: targetFolderId }, uiNavMode)
      } else {
        sendUiNavCommand({ type: 'add-root-folder' }, uiNavMode)
      }
      return
    }
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] add child for', node.id)
  }
  const onMockRename = (node: NavNode): void => {
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] rename', node.id)
  }
  const onMockDelete = (node: NavNode): void => {
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] delete', node.id)
  }

  return (
    <aside className="ns-sidebar" aria-label="视频游戏工坊（新版侧栏）">
      <div className="ns-scroll" role="tree" aria-label="工坊导航树">
        {navTree.map((node) => (
          <Fragment key={node.id}>
            <NsRow
              node={node}
              depth={0}
              expanded={expanded}
              activeId={activeId}
              mainId={mainId}
              bp={bp}
              onToggle={onToggle}
              onSelect={onSelect}
              onMockAddChild={onMockAddChild}
              onMockRename={onMockRename}
              onMockDelete={onMockDelete}
            />
            {node.id === 'ui' && view === 'ui' && expanded.has(node.id) ? (
              <div className="ns-ui-tree" role="group" aria-label="界面子项">
                <UiTreeView
                  nodes={uiNodes}
                  overlays={overlays}
                  usageByOverlay={overlayUsage}
                  selectedTreeNodeId={selectedTreeNodeId}
                  baseDepth={1}
                  onSelect={(treeNode) => {
                    const overlayId = treeNode.kind === 'scheme' ? (treeNode.overlayId ?? null) : null
                    selectUiNode(treeNode.id, overlayId)
                    sendUiNavCommand({ type: 'select', treeNodeId: treeNode.id, overlayId }, uiNavMode)
                  }}
                  onRename={(nodeId, name) => sendUiNavCommand({ type: 'rename', nodeId, name }, uiNavMode)}
                  onDelete={(treeNode) => {
                    if (!treeNode.readOnly) sendUiNavCommand({ type: 'remove', nodeId: treeNode.id }, uiNavMode)
                  }}
                />
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
      {bp.pendingDeleteId && bp.deletePopStyle && bp.deletePopSide && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={bp.deletePopRef}
            className="ns-pop-confirm"
            data-side={bp.deletePopSide}
            role="dialog"
            aria-label="删除蓝图"
            style={bp.deletePopStyle}
          >
            <span className="ns-pop-arrow" aria-hidden />
            <div className="ns-pop-confirm-msg">
              确定删除「{bp.pendingTitle}」？
            </div>
            <div className="ns-pop-confirm-actions">
              <button type="button" onClick={bp.cancelDelete}>取消</button>
              <button type="button" className="is-danger" onClick={bp.confirmDelete}>确认</button>
            </div>
          </div>,
          document.body,
        )
        : null}
    </aside>
  )
}
