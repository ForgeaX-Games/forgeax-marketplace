/**
 * NewSidebar —— 新版左侧栏（按 Figma 15738:86794 视觉稿）。
 *
 * 「蓝图」子树接真实 `blueprints`（扁平：主入口置顶 + 子蓝图排序），资产和规则
 * 同样从项目数据派生；视频按本地一级标签分组真实媒体资源。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'
import { countOverlayReferences } from '../../graph/edit/overlay-edit'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { BASIC_UI_FOLDER_ID, ensureUiTree } from '../persist/ui-tree'
import { broadcastUiTreeIntent } from '../persist/graphUiTreeSync'
import { useUiSelection } from '../persist/uiSelectionStore'
import { useGraphView, type GraphView } from '../persist/graphViewStore'
import { useAssetNav } from '../persist/assetNavStore'
import { useRuleSelection, type RuleSection } from '../persist/ruleSelectionStore'
import { useDocumentNav } from '../persist/documentNavStore'
import { usePendingDocumentTypes } from '../persist/pendingDocumentsStore'
import {
  useVideoLibraryNav,
  type VideoLibraryFolderTarget,
} from '../persist/videoLibraryNavStore'
import { childrenOf, type AssetDirectoryController } from '../assets/asset-directory'
import {
  assetEntryKey,
  assetEntryName,
  assetEntryRoot,
  parentFolderIdForAssetEntry,
  type AssetListEntry,
} from '../assets/asset-entries'
import { useAssetBrowser } from '../assets/use-asset-browser'
import { useVideoAssets, type VideoAssetListItem } from '../assets/useVideoAssets'
import {
  listVideoLibraryFolderNames,
  readVideoLibraryMetadata,
  resolveVideoLibraryEntryTag,
  subscribeVideoLibraryMetadata,
  type VideoLibraryMetadata,
} from '../assets/video-library-metadata'
import type { AssetLibraryRootKind, DocumentType } from '../assets/registry-types'
import { blueprintListItems, BLUEPRINT_NAV_ROOT } from './blueprintNav'
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
  leadingIcon?: 'asset-library'
  assetLocation?: { root: AssetLibraryRootKind, folderId?: string, entryKey?: string }
  ruleTarget?: { section: RuleSection, itemId?: string }
  documentType?: DocumentType
  videoLocation?: { folder: VideoLibraryFolderTarget, entryId?: string }
  children?: NavNode[]
}

const EMPTY_VIDEO_LIBRARY_METADATA: VideoLibraryMetadata = { tagsByEntryId: {}, folderNames: [] }

const AssetLibraryIcon = (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    preserveAspectRatio="none"
    overflow="visible"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      id="Vector"
      d="M1.212 12C0.876 12 0.59 11.882 0.354 11.646C0.118 11.41 0 11.1243 0 10.7888V2.6145C0 2.4685 0.02325 2.331 0.06975 2.202C0.11625 2.073 0.18625 1.95425 0.27975 1.84575L1.44825 0.44325C1.55675 0.29675 1.6925 0.18625 1.8555 0.11175C2.0185 0.0372501 2.19325 0 2.37975 0H9.59175C9.77775 0 9.95475 0.0372501 10.1227 0.11175C10.2907 0.18625 10.429 0.2965 10.5375 0.4425L11.7203 1.875C11.8138 1.9835 11.8837 2.10475 11.9302 2.23875C11.9767 2.37225 12 2.51225 12 2.65875V10.7888C12 11.1238 11.882 11.4095 11.646 11.646C11.41 11.882 11.1243 12 10.7888 12H1.212ZM1.035 2.106H10.95L9.9525 0.9075C9.904 0.8595 9.8485 0.82125 9.786 0.79275C9.7235 0.76425 9.6585 0.75 9.591 0.75H2.394C2.327 0.75 2.262 0.7645 2.199 0.7935C2.136 0.8225 2.081 0.861 2.034 0.909L1.035 2.106ZM8.24925 2.856H3.75V6.9585C3.75 7.1885 3.84475 7.3635 4.03425 7.4835C4.22375 7.6035 4.4195 7.6105 4.6215 7.5045L6 6.822L7.37925 7.5045C7.58075 7.61 7.77625 7.603 7.96575 7.4835C8.15525 7.3635 8.25 7.1885 8.25 6.9585L8.24925 2.856Z"
      fill="currentColor"
    />
  </svg>
)

const SIDEBAR_ASSET_ROOTS: ReadonlyArray<{
  kind: AssetLibraryRootKind
  label: string
  placeholder?: boolean
}> = [
    { kind: 'image', label: '图标' },
    { kind: 'control', label: '控件' },
    { kind: 'video', label: '视频' },
    { kind: 'audio', label: '音频' },
    { kind: 'settings', label: '设定', placeholder: true },
    { kind: 'font', label: '字体' },
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
    buildDocumentNavNode(),
    {
      id: BLUEPRINT_NAV_ROOT.id,
      label: BLUEPRINT_NAV_ROOT.label,
      kind: 'entry',
      view: 'graph',
      canAddChild: true,
      children: bpChildren,
    },
    {
      id: 'ui',
      label: '界面',
      kind: 'entry',
      view: 'ui',
      canAddChild: true,
      externallyExpandable: true,
      // 子树由真实 UiTreeView 渲染；行内加号沿用既有界面新建逻辑。
    },
    assets,
    rules,
  ]
}

function buildDocumentNavNode(): NavNode {
  const DOCUMENT_LABELS: Record<DocumentType, string> = {
    intake: '需求',
    core: '核心',
    inquiry: '问询',
    pillar: '支柱',
  }
  const types: DocumentType[] = ['intake', 'core', 'inquiry', 'pillar']
  return {
    id: 'documents',
    label: '文档',
    kind: 'entry',
    view: 'documents',
    children: types.map((documentType) => ({
      id: `document:${documentType}`,
      label: DOCUMENT_LABELS[documentType],
      kind: 'leaf' as const,
      documentType,
    })),
  }
}

function videoFolderId(folderName: string): string {
  return `video-folder:${encodeURIComponent(folderName)}`
}

function videoEntryId(entryId: string): string {
  return `video-entry:${entryId}`
}

function buildVideoNavNode(
  videos: readonly VideoAssetListItem[],
  metadata: VideoLibraryMetadata,
): NavNode {
  const allVideos = [...videos].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  const leaf = (video: { id: string, label: string }, folder: VideoLibraryFolderTarget): NavNode => ({
    id: videoEntryId(video.id),
    label: video.label,
    kind: 'leaf',
    videoLocation: { folder, entryId: video.id },
  })
  const folders = listVideoLibraryFolderNames(metadata).map((folderName): NavNode => {
    const folder: VideoLibraryFolderTarget = { kind: 'tag', name: folderName }
    return {
      id: videoFolderId(folderName),
      label: folderName,
      kind: 'branch',
      externallyExpandable: true,
      videoLocation: { folder },
      children: allVideos
        .filter((video) => resolveVideoLibraryEntryTag(video.id, metadata) === folderName)
        .map((video) => leaf(video, folder)),
    }
  })
  const untagged: VideoLibraryFolderTarget = { kind: 'untagged' }
  return {
    id: 'asset-root:video',
    label: '视频',
    kind: 'branch',
    view: 'video',
    externallyExpandable: true,
    videoLocation: { folder: { kind: 'all' } },
    children: [
      ...folders,
      ...allVideos
        .filter((video) => resolveVideoLibraryEntryTag(video.id, metadata) === null)
        .map((video) => leaf(video, untagged)),
    ],
  }
}

function buildAssetNavNode(
  directory: AssetDirectoryController,
  entries: readonly AssetListEntry[],
  videoNode: NavNode,
): NavNode {
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
        assetLocation: {
          root,
          folderId: folderId.startsWith('root:') ? undefined : folderId,
          entryKey: assetEntryKey(entry),
        },
      })),
  ]
  return {
    id: 'assets',
    label: '资产库',
    kind: 'entry',
    view: 'assets',
    leadingIcon: 'asset-library',
    children: SIDEBAR_ASSET_ROOTS.map((root) => {
      if (root.kind === 'video') return videoNode
      return {
        id: `asset-root:${root.kind}`,
        label: root.label,
        kind: 'branch',
        externallyExpandable: true,
        assetLocation: root.placeholder ? undefined : { root: root.kind },
        children: root.placeholder ? [] : buildFolder(`root:${root.kind}`, root.kind),
      }
    }),
  }
}

function buildRuleNavNode(_meta: { entities?: Record<string, { id: string, name?: string }>, variables?: Record<string, { id: string, name?: string }>, formulas?: Record<string, { id: string, name?: string }> }): NavNode {
  const section = (
    id: 'entities' | 'variables' | 'formulas',
    label: string,
  ): NavNode => ({
    id: `rule-${id}`,
    label,
    kind: 'leaf',
    ruleTarget: { section: id },
    children: [],
  })
  return {
    id: 'rule',
    label: '规则',
    kind: 'entry',
    view: 'rule',
    children: [
      section('entities', '实体'),
      section('variables', '变量'),
      section('formulas', '公式'),
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
  width: 196px;
  min-width: 196px;
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
.ns-row.is-editing {
  min-height: var(--ns-row-h);
  height: auto;
  padding-top: 8px;
  padding-bottom: 8px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.10);
}
.ns-row:focus-visible { outline: 1px solid rgba(255,255,255,0.45); outline-offset: -1px; }
.ns-sidebar button.ns-chev {
  box-sizing: border-box;
  flex: none;
  width: 20px;
  height: 20px;
  min-width: 0;
  min-height: 0;
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
.ns-sidebar button.ns-chev svg { width: 20px; height: 20px; flex: none; display: block; }
.ns-sidebar button.ns-chev.is-collapsed { color: var(--ns-text-40); transform: rotate(-90deg); }
.ns-chev-spacer {
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 8px;
}
.ns-sidebar button.ns-leading {
  box-sizing: border-box;
  flex: none;
  width: 20px;
  height: 20px;
  min-width: 0;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ns-text-80);
}
.ns-sidebar button.ns-leading { cursor: pointer; }
.ns-sidebar button.ns-leading svg { display: block; width: 12px; height: 12px; flex: none; }
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
.ns-sidebar button.ns-add {
  box-sizing: border-box;
  flex: none;
  width: 20px;
  height: 20px;
  min-width: 0;
  min-height: 0;
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
.ns-sidebar button.ns-add:hover, .ns-sidebar button.ns-add.is-on { color: var(--ns-text); background: rgba(255,255,255,0.10); }
.ns-sidebar button.ns-add svg { width: 14px; height: 14px; flex: none; display: block; }
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
.ns-sidebar button.ns-act {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  min-width: 0;
  min-height: 0;
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
.ns-sidebar button.ns-act:hover, .ns-sidebar button.ns-act.is-on { color: var(--ns-text); background: rgba(255,255,255,0.10); }
.ns-sidebar button.ns-act.is-danger:hover, .ns-sidebar button.ns-act.is-danger.is-on { color: #ff8e8e; }
.ns-sidebar button.ns-act svg { width: 14px; height: 14px; flex: none; display: block; }
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
.ns-pending-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: #f08840;
  flex-shrink: 0;
  vertical-align: middle;
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
.ns-inline-error {
  flex-basis: 100%;
  padding: 4px 4px 0;
  color: #ff8e8e;
  font-size: 12px;
  line-height: 16px;
}
.ns-ui-tree {
  width: 100%;
  min-width: 0;
}
`

function videoMetadataSnapshot(gameId: string): VideoLibraryMetadata {
  if (!gameId) return EMPTY_VIDEO_LIBRARY_METADATA
  const result = readVideoLibraryMetadata(gameId)
  return result.status === 'ready'
    ? { tagsByEntryId: result.tagsByEntryId, folderNames: result.folderNames }
    : EMPTY_VIDEO_LIBRARY_METADATA
}

function useVideoMetadataSnapshot(gameId: string): VideoLibraryMetadata {
  const [metadata, setMetadata] = useState<VideoLibraryMetadata>(() => videoMetadataSnapshot(gameId))
  useEffect(() => {
    setMetadata(videoMetadataSnapshot(gameId))
    if (!gameId) return
    return subscribeVideoLibraryMetadata(gameId, () => setMetadata(videoMetadataSnapshot(gameId)))
  }, [gameId])
  return metadata
}

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

// 默认朝下（展开）；.is-collapsed 旋 -90° → 朝右（收起），对齐 IDE 文件夹箭头。
const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
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
  uiGroupComposing: boolean
  pendingDocumentTypes: readonly DocumentType[]
  onToggle: (id: string) => void
  onExpand: (id: string) => void
  onSelect: (node: NavNode) => void
  onMockAddChild: (node: NavNode) => void
  onMockRename: (node: NavNode) => void
  onMockDelete: (node: NavNode) => void
}

function NsRow({
  node, depth, expanded, activeId, mainId, bp,
  uiGroupComposing,
  pendingDocumentTypes,
  onToggle, onExpand, onSelect, onMockAddChild, onMockRename, onMockDelete,
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
  const isPending = !!(
    node.documentType && pendingDocumentTypes.includes(node.documentType)
  )

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
  } else if (!isBlueprintLeaf && node.kind !== 'entry' && !node.videoLocation) {
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
          if (bp.composing) {
            bp.cancelCompose()
            return
          }
          // IDE 式：文件夹收起时点「+」也会展开并出现新建行。
          onExpand(node.id)
          bp.openCompose()
        }}
      >
        {PlusIcon}
      </button>
    )
    : node.canAddChild
      ? (
        <button
          type="button"
          className={`ns-add${node.id === 'ui' && uiGroupComposing ? ' is-on' : ''}`}
          aria-label={`新增 ${node.label} 子项`}
          title="新增子项"
          aria-expanded={node.id === 'ui' ? uiGroupComposing : undefined}
          onClick={(e) => {
            e.stopPropagation()
            onMockAddChild(node)
          }}
        >
          {PlusIcon}
        </button>
      )
      : null

  const activateRow = (): void => {
    // 文件夹行：只展开/收起展示子项，不切换当前选中视图。
    if (isExpandable) {
      onToggle(node.id)
      // 资产根、分类和文件夹既是目录也是素材页筛选项：点击行时同步进入对应列表。
      const navigatesToAssets = node.id === 'assets'
        || node.assetLocation !== undefined
        || node.videoLocation !== undefined
      if (!navigatesToAssets) return
    }
    onSelect(node)
  }

  return (
    <>
      <div
        className={`ns-row${isActive ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
        role="treeitem"
        aria-expanded={isExpandable ? isExpanded : undefined}
        aria-selected={isActive}
        data-pending={isPending ? 'true' : undefined}
        tabIndex={0}
        style={{ paddingLeft: indent }}
        onClick={activateRow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activateRow()
          }
        }}
      >
        {isExpandable && node.leadingIcon !== 'asset-library' && (
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
        {!isExpandable && node.leadingIcon == null ? (
          <span className="ns-chev-spacer" aria-hidden />
        ) : null}
        {node.leadingIcon === 'asset-library' ? (
          <button
            type="button"
            className="ns-leading"
            aria-label={`${isExpanded ? '折叠' : '展开'} ${node.label}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
            }}
          >
            {AssetLibraryIcon}
          </button>
        ) : null}
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
            {isPending ? <span className="ns-pending-dot" aria-hidden /> : null}
          </span>
        )}
        {rowActions && (
          <span className="ns-row-actions" onClick={(e) => e.stopPropagation()}>
            {rowActions}
          </span>
        )}
        {addChild}
      </div>
      {/* 新建行不挂在子循环里：空库 / 收起态也能出输入框（点 + 会先 expand）。 */}
      {node.id === 'graph' && bp.composing && (
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
      {hasChildren && isExpanded && (
        <>
          {node.children!.map((child) => (
            <NsRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activeId={activeId}
              mainId={mainId}
              bp={bp}
              uiGroupComposing={uiGroupComposing}
              pendingDocumentTypes={pendingDocumentTypes}
              onToggle={onToggle}
              onExpand={onExpand}
              onSelect={onSelect}
              onMockAddChild={onMockAddChild}
              onMockRename={onMockRename}
              onMockDelete={onMockDelete}
            />
          ))}
        </>
      )}
    </>
  )
}

interface NewSidebarContentProps {
  uiNavMode: 'left' | 'standalone'
  videoItems: readonly VideoAssetListItem[]
}

function NewSidebarContent({ uiNavMode, videoItems }: NewSidebarContentProps): JSX.Element {
  injectStyleOnce('new-sidebar', NEW_SIDEBAR_CSS)
  const view = useGraphView((s) => s.view)
  const setView = useGraphView((s) => s.setView)
  const setAssetLocation = useAssetNav((s) => s.setLocation)
  const ruleSection = useRuleSelection((s) => s.section)
  const ruleItemId = useRuleSelection((s) => s.itemId)
  const videoFolder = useVideoLibraryNav((s) => s.folder)
  const videoEntry = useVideoLibraryNav((s) => s.entryId)
  const setVideoLocation = useVideoLibraryNav((s) => s.setLocation)
  const selectRule = useRuleSelection((s) => s.select)
  const selectDocumentType = useDocumentNav((s) => s.setDocumentType)
  const selectedDocumentType = useDocumentNav((s) => s.documentType)
  const pendingDocumentTypes = usePendingDocumentTypes()
  const gameId = useGraphScenario((s) => s.game)
  const { entries: assetEntries, directory: assetDirectory } = useAssetBrowser(gameId)
  const videoMetadata = useVideoMetadataSnapshot(gameId)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainId = useGraphScenario((s) => s.mainBlueprintId)
  const activeBlueprintId = useGraphScenario((s) => s.activeBlueprintId)
  const selectBlueprint = useGraphScenario((s) => s.selectBlueprint)
  const ruleMeta = useGraphScenario((s) => s.meta)
  // 与蓝图同构：left/center/standalone 都直接读本地 graphScenarioStore，不再走 uiNavSync 的 snapshot 镜像。
  const meta = useGraphScenario((s) => s.meta)
  const createUiScheme = useGraphScenario((s) => s.createUiScheme)
  const createUiFolder = useGraphScenario((s) => s.createUiFolder)
  const renameUiNode = useGraphScenario((s) => s.renameUiNode)
  const removeUiNode = useGraphScenario((s) => s.removeUiNode)
  const selectedTreeNodeId = useUiSelection((s) => s.selectedTreeNodeId)
  const selectUiNode = useUiSelection((s) => s.selectUiNode)
  const clearUiSelection = useUiSelection((s) => s.clearUiSelection)
  const bp = useBlueprintNavActions()

  const localOverlays = meta?.ui?.overlays ?? {}
  // left pane 只展示树结构 + 标题，不渲染 overlay 内容：剥离 children 与右栏共用同一份 meta。
  const overlays = uiNavMode === 'left'
    ? Object.fromEntries(Object.entries(localOverlays).map(([id, overlay]) => [id, { ...overlay, children: [] }]))
    : localOverlays
  const uiTree = ensureUiTree(meta?.uiTree, localOverlays)
  const uiNodes = toViewNodes(uiTree.root)
  const overlayUsage = countOverlayReferences(
    Object.values(blueprints ?? {}).map((doc) => doc.graph).filter((g): g is NonNullable<typeof g> => !!g),
  )

  const navTree = useMemo(
    () => buildNavTree(
      blueprints,
      mainId,
      buildAssetNavNode(
        assetDirectory,
        assetEntries,
        buildVideoNavNode(videoItems, videoMetadata),
      ),
      buildRuleNavNode({
        entities: ruleMeta.entities,
        variables: ruleMeta.variables,
        formulas: ruleMeta.formulas as Record<string, { id: string, name?: string }> | undefined,
      }),
    ),
    [
      assetDirectory,
      assetEntries,
      blueprints,
      mainId,
      ruleMeta.entities,
      ruleMeta.formulas,
      ruleMeta.variables,
      videoItems,
      videoMetadata,
    ],
  )

  // Figma 默认展开资产库与视频；之后只由用户操作改变，数据刷新不重置展开状态。
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['assets', 'asset-root:video']),
  )
  const [uiGroupComposing, setUiGroupComposing] = useState(false)
  const [uiGroupDraft, setUiGroupDraft] = useState('')

  const activeRuleId = ruleItemId
    ? `rule-${ruleSection}:${ruleItemId}`
    : `rule-${ruleSection}`
  const activeId = view === 'graph'
    ? (activeBlueprintId || 'graph')
    : view === 'documents'
      ? `document:${selectedDocumentType}`
      : view === 'rule'
        ? activeRuleId
        : view === 'video'
          ? videoEntry
            ? videoEntryId(videoEntry)
            : videoFolder.kind === 'tag'
              ? videoFolderId(videoFolder.name)
              : 'asset-root:video'
          : view === 'ui'
            // 与蓝图同构：选中具体方案/文件夹时高亮该项（其 id 不在主树 navTree 里 → 主树无行匹配，
            // 只在界面子树内高亮）；未选任何时回退到「界面」父行，表示当前位置。
            ? (selectedTreeNodeId ?? 'ui')
            : (navTree.find((n) => n.view === view)?.id ?? null)

  const onToggle = (id: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onExpand = (id: string): void => {
    setExpanded((cur) => (cur.has(id) ? cur : new Set(cur).add(id)))
  }

  const onSelect = (node: NavNode): void => {
    // 切到任何非界面视图时，清掉界面子树选中态并广播，使界面行高亮随切走而灭
    // （对齐主树 activeId 随 view 变的语义；界面选中态本身不随视图切换记住）。
    const leaveUi = (): void => {
      clearUiSelection()
      broadcastUiTreeIntent({ type: 'select', treeNodeId: null, overlayId: null })
    }
    if (node.videoLocation) {
      leaveUi()
      setExpanded((current) => {
        const next = new Set(current)
        next.add('assets')
        next.add('asset-root:video')
        if (node.videoLocation?.folder.kind === 'tag') {
          next.add(videoFolderId(node.videoLocation.folder.name))
        }
        return next
      })
      setVideoLocation({
        folder: node.videoLocation.folder,
        entryId: node.videoLocation.entryId ?? null,
      })
      setView('video')
      return
    }
    if (node.id === 'assets') {
      // “资产库”是浏览器根入口，不是上一次选中的分类或文件夹。
      leaveUi()
      setAssetLocation({ root: null })
      setView('assets')
      return
    }
    if (node.assetLocation) {
      leaveUi()
      setView('assets')
      setAssetLocation(node.assetLocation)
      return
    }
    if (node.ruleTarget) {
      leaveUi()
      selectRule(node.ruleTarget.section, node.ruleTarget.itemId)
      setView('rule')
      return
    }
    if (node.documentType) {
      leaveUi()
      selectDocumentType(node.documentType)
      setView('documents')
      return
    }
    if (node.blueprint) {
      leaveUi()
      selectBlueprint(node.id)
      setView('graph')
      return
    }
    if (node.view) {
      if (node.view !== 'ui') leaveUi()
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
      setView('ui')
      setUiGroupDraft('')
      setUiGroupComposing((current) => !current)
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
              uiGroupComposing={uiGroupComposing}
              pendingDocumentTypes={pendingDocumentTypes}
              onToggle={onToggle}
              onExpand={onExpand}
              onSelect={onSelect}
              onMockAddChild={onMockAddChild}
              onMockRename={onMockRename}
              onMockDelete={onMockDelete}
            />
            {node.id === 'ui' && uiGroupComposing ? (
              <div className="ns-row is-editing" style={{ paddingLeft: 8 }}>
                <input
                  autoFocus
                  className="ns-inline-edit"
                  aria-label="新建界面组名称"
                  placeholder="新建界面组名称"
                  value={uiGroupDraft}
                  onChange={(event) => setUiGroupDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      const name = uiGroupDraft.trim()
                      if (!name) return
                      createUiFolder(null, name)
                      setUiGroupDraft('')
                      setUiGroupComposing(false)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setUiGroupDraft('')
                      setUiGroupComposing(false)
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setUiGroupDraft('')
                      setUiGroupComposing(false)
                    }, 0)
                  }}
                />
              </div>
            ) : null}
            {node.id === 'ui' && expanded.has(node.id) ? (
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
                    setView('ui')
                    broadcastUiTreeIntent({ type: 'select', treeNodeId: treeNode.id, overlayId })
                  }}
                  onAddScheme={(parentId, name) => {
                    createUiScheme(parentId, name)
                  }}
                  onRename={(nodeId, name) => renameUiNode(nodeId, name)}
                  onDelete={(treeNode) => {
                    if (!treeNode.readOnly) removeUiNode(treeNode.id)
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

export interface NewSidebarProps {
  uiNavMode?: 'left' | 'standalone'
  /** Use the workspace controller's exact list when sidebar and workspace share a React root. */
  videoItems?: readonly VideoAssetListItem[]
}

function NewSidebarWithOwnedVideoList({
  uiNavMode,
}: Pick<NewSidebarProps, 'uiNavMode'>): JSX.Element {
  const gameId = useGraphScenario((state) => state.game)
  const controller = useVideoAssets(gameId)
  return <NewSidebarContent uiNavMode={uiNavMode ?? 'standalone'} videoItems={controller.items} />
}

export function NewSidebar({ uiNavMode, videoItems }: NewSidebarProps = {}): JSX.Element {
  return videoItems === undefined
    ? <NewSidebarWithOwnedVideoList uiNavMode={uiNavMode} />
    : <NewSidebarContent uiNavMode={uiNavMode ?? 'standalone'} videoItems={videoItems} />
}
