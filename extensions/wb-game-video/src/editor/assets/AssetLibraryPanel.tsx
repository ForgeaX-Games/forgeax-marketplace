import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import externalToolbarIcon from '../../assets/asset-toolbar-external.svg?url'
import generateToolbarIcon from '../../assets/asset-toolbar-generate.svg?url'
import localToolbarIcon from '../../assets/asset-toolbar-local.svg?url'
import presetToolbarIcon from '../../assets/asset-toolbar-preset.svg?url'
import searchToolbarIcon from '../../assets/asset-toolbar-search.svg?url'
import type { AssetLibraryController, ManagedAssetKind } from './assetLibraryClient'
import {
  assetEntries,
  assetEntryKey,
  assetEntryName,
  assetEntryRoot,
  type AssetListEntry,
  type BrowserAsset,
  type BrowserAssetKind,
} from './asset-entries'
import { AssetDetailPanel } from './AssetDetailPanel'
import { ProjectComponentPreview } from './ProjectComponentPreview'
import {
  ASSET_DIRECTORY_ROOTS,
  childrenOf,
  createDirectoryFolder,
  EMPTY_ASSET_DIRECTORY,
  moveAsset,
  moveDirectoryFolder,
  placeAsset,
  removeDirectoryFolder,
  renameDirectoryFolder,
  rootForFolder,
  rootForId,
  type AssetDirectoryController,
  type AssetDirectoryRoot,
} from './asset-directory'
import type { ProjectComponentAsset } from './project-component-assets'
import type { AssetLibraryFolder, AssetLibraryRootKind } from './registry-types'

export type { BrowserAsset } from './asset-entries'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif'
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.m4a,.aac'
const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf'
const AUDIO_WAVEFORM_BARS = [
  12, 16.177, 16.698, 26.833, 31.479, 29.094, 22.719,
  24.344, 20.615, 11.104, 9.604, 21.125, 27.51, 27.365,
  25.615, 29.625, 27.417, 18.729, 10.521, 13.229, 20.333,
  21.823, 24.542, 31.073, 31.01, 24.198, 19.427, 18,
]

const DEFAULT_ASSET_ROOT = ASSET_DIRECTORY_ROOTS[0]!

interface FolderDialogState {
  mode: 'create' | 'rename' | 'delete'
  folder?: AssetLibraryFolder
}

const EMPTY_DIRECTORY_CONTROLLER: AssetDirectoryController = {
  assetLibrary: EMPTY_ASSET_DIRECTORY,
  loading: false,
  saving: false,
  error: null,
  async refresh() {},
  async save() { return EMPTY_ASSET_DIRECTORY },
}

export function typeLabel(kind: BrowserAssetKind): string {
  return kind === 'image' ? '图片' : kind === 'audio' ? '音频' : kind === 'font' ? '字体' : '视频'
}

function AudioWaveform(): JSX.Element {
  return <span className="alx-audio-waveform" aria-label="音频波形">
    {AUDIO_WAVEFORM_BARS.map((height, index) => <i key={index} style={{ height }} />)}
  </span>
}

function VideoThumbnail({ asset, compact = false }: { asset: BrowserAsset, compact?: boolean }): JSX.Element {
  if (!asset.url) return <>▶</>
  return <video
    aria-label={`${asset.name} 视频缩略图`}
    className={compact ? 'alx-video-thumbnail is-compact' : 'alx-video-thumbnail'}
    src={asset.url}
    muted
    playsInline
    preload="metadata"
    onLoadedMetadata={(event) => {
      const video = event.currentTarget
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(0.1, video.duration / 2)
      }
    }}
  />
}

function folderPath(
  folder: AssetLibraryFolder | undefined,
  folders: readonly AssetLibraryFolder[],
): Array<AssetDirectoryRoot | AssetLibraryFolder> {
  if (!folder) return []
  const chain: AssetLibraryFolder[] = []
  let current: AssetLibraryFolder | undefined = folder
  while (current) {
    chain.unshift(current)
    current = current.parentId ? folders.find((candidate) => candidate.id === current?.parentId) : undefined
  }
  return [rootForFolder(folder), ...chain]
}

export function previewAsset(asset: BrowserAsset | null): JSX.Element {
  if (!asset) return <div className="alx-preview-empty">选择一个资产查看详情。</div>
  if (asset.kind === 'image' && asset.url) {
    return <img className="alx-preview-image" src={asset.url} alt={asset.name} />
  }
  if (asset.kind === 'video' && asset.url) {
    return <video className="alx-preview-video" controls src={asset.url}>浏览器不支持视频预览。</video>
  }
  if (asset.kind === 'audio' && asset.url) {
    return <audio className="alx-preview-audio" controls src={asset.url}>浏览器不支持音频预览。</audio>
  }
  return <div className="alx-preview-empty">{asset.kind === 'font' ? 'Aa' : typeLabel(asset.kind)}</div>
}

export function AssetLibraryPanel({
  controller,
  directory = EMPTY_DIRECTORY_CONTROLLER,
  videoAssets = [],
  projectComponents = [],
  requestedRoot,
  requestedFolderId,
  requestedEntryKey,
  onVideoGenerate,
}: {
  controller: AssetLibraryController
  directory?: AssetDirectoryController
  videoAssets?: BrowserAsset[]
  projectComponents?: ProjectComponentAsset[]
  requestedRoot?: AssetLibraryRootKind | null
  requestedFolderId?: string | null
  requestedEntryKey?: string | null
  onVideoGenerate?: () => void
}): JSX.Element {
  const [currentId, setCurrentId] = useState<string>('root:library')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null)
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null)
  const [folderName, setFolderName] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  const [assetName, setAssetName] = useState('')
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  const [renameAsset, setRenameAsset] = useState<BrowserAsset | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BrowserAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailableAction, setUnavailableAction] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const suppressAssetOpenRef = useRef(false)

  useEffect(() => {
    if (requestedRoot === null) {
      setCurrentId('root:library')
      setSelectedEntryId(null)
      setDetailOpen(false)
    } else if (requestedRoot) {
      setCurrentId(`root:${requestedRoot}`)
    }
  }, [requestedRoot])
  useEffect(() => {
    if (requestedFolderId) setCurrentId(requestedFolderId)
  }, [requestedFolderId])
  useEffect(() => {
    if (requestedEntryKey) {
      setSelectedEntryId(requestedEntryKey)
      setDetailOpen(true)
    }
  }, [requestedEntryKey])
  useEffect(() => {
    if (!menuFolderId) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.alx-folder-menu, .alx-more')) setMenuFolderId(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown)
  }, [menuFolderId])
  const isLibraryHome = currentId === 'root:library'
  const currentFolder = directory.assetLibrary.folders.find((folder) => folder.id === currentId)
  const currentRoot: AssetDirectoryRoot = rootForId(currentId)
    ?? (currentFolder ? rootForFolder(currentFolder) : DEFAULT_ASSET_ROOT)
  const currentFolders = isLibraryHome ? [] : childrenOf(directory.assetLibrary, currentId, currentRoot.kind)
  const entries = useMemo<AssetListEntry[]>(
    () => assetEntries(controller.items, videoAssets, projectComponents),
    [controller.items, projectComponents, videoAssets],
  )
  const searchTerm = query.trim().toLocaleLowerCase()
  const isSearching = searchTerm.length > 0
  const currentEntries = entries.filter((entry) => {
    const placement = directory.assetLibrary.placements[assetEntryKey(entry)]
    const inCurrent = !isLibraryHome && (currentFolder ? placement === currentFolder.id : !placement && assetEntryRoot(entry) === currentRoot.kind)
    return (isSearching || inCurrent) && assetEntryName(entry).toLocaleLowerCase().includes(searchTerm)
  })
  const filteredFolders = (isSearching ? directory.assetLibrary.folders : currentFolders)
    .filter((folder) => folder.name.toLocaleLowerCase().includes(searchTerm))
  const selectedEntry = entries.find((entry) => assetEntryKey(entry) === selectedEntryId) ?? null
  const selectedAsset = selectedEntry?.source === 'media' ? selectedEntry.asset : null
  const selectedComponent = selectedEntry?.source === 'project-component' ? selectedEntry.component : null
  const actionsDisabled = controller.mutating || controller.uploading !== null || directory.saving
  const uploadKind: ManagedAssetKind | null = currentRoot.kind === 'image' || currentRoot.kind === 'audio' || currentRoot.kind === 'font'
    ? currentRoot.kind
    : null
  const accept = uploadKind === 'image' ? IMAGE_ACCEPT : uploadKind === 'audio' ? AUDIO_ACCEPT : uploadKind === 'font' ? FONT_ACCEPT : ''
  const openFolder = (id: string) => {
    setCurrentId(id)
    setQuery('')
    setSelectedIds(new Set())
    setMenuFolderId(null)
  }
  useEffect(() => {
    setAssetName(selectedAsset?.name ?? '')
  }, [selectedAsset?.id, selectedAsset?.name])
  const saveFolder = async () => {
    if (!folderDialog) return
    try {
      const next = folderDialog.mode === 'create'
        ? createDirectoryFolder(directory.assetLibrary, { parentId: currentId, rootKind: currentRoot.kind, name: folderName })
        : folderDialog.mode === 'rename' && folderDialog.folder
          ? renameDirectoryFolder(directory.assetLibrary, folderDialog.folder.id, folderName)
          : folderDialog.mode === 'delete' && folderDialog.folder
            ? removeDirectoryFolder(directory.assetLibrary, folderDialog.folder.id)
            : directory.assetLibrary
      const saved = await directory.save(next)
      if (saved) {
        if (folderDialog.mode === 'delete' && folderDialog.folder?.id === currentId) openFolder(`root:${folderDialog.folder.rootKind}`)
        setFolderDialog(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件夹操作失败')
    }
  }
  const upload = async (files: File[]) => {
    if (!uploadKind) {
      setError('当前资产类型暂不支持本地上传')
      return
    }
    for (const file of files) {
      const asset = await controller.upload(uploadKind, file)
      if (!asset) return
      if (currentFolder) {
        const placed = await directory.save(placeAsset(directory.assetLibrary, asset.id, currentFolder.id))
        if (!placed) return
      }
    }
  }
  const removeAsset = async () => {
    if (!pendingDelete || pendingDelete.readOnly) return
    await controller.remove(pendingDelete.id)
    const placements = { ...directory.assetLibrary.placements }
    delete placements[pendingDelete.id]
    await directory.save({ ...directory.assetLibrary, placements })
    if (selectedEntryId === pendingDelete.id) setSelectedEntryId(null)
    setPendingDelete(null)
  }
  const removeSelected = async () => {
    const removable = currentEntries
      .filter((entry): entry is Extract<AssetListEntry, { source: 'media' }> =>
        entry.source === 'media' && selectedIds.has(entry.asset.id) && !entry.asset.readOnly,
      )
      .map((entry) => entry.asset)
    if (removable.length === 0) return
    await controller.removeMany(removable.map((asset) => asset.id))
    const placements = { ...directory.assetLibrary.placements }
    removable.forEach((asset) => { delete placements[asset.id] })
    await directory.save({ ...directory.assetLibrary, placements })
    setSelectedIds(new Set())
    setSelectionMode(false)
  }
  const saveSelectedAssetName = async () => {
    if (!selectedAsset || selectedAsset.readOnly || !assetName.trim()) return
    await controller.rename(selectedAsset.id, assetName.trim())
  }
  const reuploadSelectedAsset = async (file: File | undefined) => {
    if (!file || !selectedAsset || selectedAsset.readOnly || selectedAsset.kind === 'video') return
    const replacement = await controller.upload(selectedAsset.kind, file)
    if (!replacement) return
    const currentPlacement = directory.assetLibrary.placements[selectedAsset.id]
    const nextDirectory = moveAsset(directory.assetLibrary, replacement.id, currentPlacement)
    const saved = await directory.save(nextDirectory)
    if (!saved) return
    await controller.remove(selectedAsset.id)
    setSelectedEntryId(replacement.id)
    setSelectedEntryId(replacement.id)
    setDetailOpen(true)
  }
  const dropAssetIntoFolder = async (
    event: DragEvent<HTMLElement>,
    rootKind: AssetLibraryRootKind,
    folder?: AssetLibraryFolder,
  ) => {
    event.preventDefault()
    const entry = entries.find((candidate) => assetEntryKey(candidate) === draggingAssetId)
    setDropFolderId(null)
    setDraggingAssetId(null)
    if (!entry || assetEntryRoot(entry) !== rootKind) return
    const targetFolderId = folder ? folder.id : undefined
    const next = moveAsset(directory.assetLibrary, assetEntryKey(entry), targetFolderId)
    await directory.save(next)
  }
  const canDropFolderIntoFolder = (draggingFolder: AssetLibraryFolder, targetFolder: AssetLibraryFolder): boolean => {
    if (draggingFolder.rootKind !== targetFolder.rootKind || draggingFolder.id === targetFolder.id) return false
    let ancestor: AssetLibraryFolder | undefined = targetFolder
    while (ancestor) {
      if (ancestor.id === draggingFolder.id) return false
      ancestor = ancestor.parentId
        ? directory.assetLibrary.folders.find((candidate) => candidate.id === ancestor?.parentId)
        : undefined
    }
    return true
  }
  const dropFolderIntoFolder = async (
    event: DragEvent<HTMLElement>,
    targetFolder: AssetLibraryFolder,
  ) => {
    event.preventDefault()
    const draggingFolder = directory.assetLibrary.folders.find((folder) => folder.id === draggingFolderId)
    setDropFolderId(null)
    setDraggingFolderId(null)
    if (!draggingFolder || !canDropFolderIntoFolder(draggingFolder, targetFolder)) return
    await directory.save(moveDirectoryFolder(directory.assetLibrary, draggingFolder.id, targetFolder.id))
  }

  const previewItemsInFolder = (folderId: string | undefined, rootKind: AssetLibraryRootKind): Array<
    | { type: 'folder'; id: string }
    | { type: 'asset'; entry: AssetListEntry }
  > => [
    ...childrenOf(directory.assetLibrary, folderId ?? `root:${rootKind}`, rootKind)
      .map((folder) => ({ type: 'folder' as const, id: folder.id })),
    ...entries
    .filter((entry) => {
      const placement = directory.assetLibrary.placements[assetEntryKey(entry)]
      return folderId ? placement === folderId : !placement && assetEntryRoot(entry) === rootKind
    })
    .map((entry) => ({ type: 'asset' as const, entry })),
  ].slice(0, 6)

  const renderFolderCard = (
    id: string,
    name: string,
    rootKind: AssetLibraryRootKind,
    folder?: AssetLibraryFolder,
  ): JSX.Element => {
    const previews = previewItemsInFolder(folder?.id, rootKind)
    const draggingEntry = entries.find((entry) => assetEntryKey(entry) === draggingAssetId)
    const draggingFolder = directory.assetLibrary.folders.find((candidate) => candidate.id === draggingFolderId)
    const acceptsAssetDrop = draggingEntry != null && assetEntryRoot(draggingEntry) === rootKind
    const acceptsFolderDrop = folder != null && draggingFolder != null && canDropFolderIntoFolder(draggingFolder, folder)
    const acceptsDrop = acceptsAssetDrop || acceptsFolderDrop
    return (
      <article
        className={`alx-folder-card${dropFolderId === id ? ' is-drop-target' : ''}${acceptsDrop ? ' is-drop-ready' : ''}`}
        key={id}
        draggable={folder != null && !selectionMode}
        onDragStart={(event) => {
          if (!folder) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', folder.id)
          setDraggingFolderId(folder.id)
        }}
        onDragEnd={() => {
          setDraggingFolderId(null)
          setDropFolderId(null)
        }}
        onDragOver={(event) => {
          if (!acceptsDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropFolderId(id)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderId(null)
        }}
        onDrop={(event) => {
          if (draggingFolderId && folder) return void dropFolderIntoFolder(event, folder)
          return void dropAssetIntoFolder(event, rootKind, folder)
        }}
      >
        <button type="button" className="alx-folder-open" onClick={() => openFolder(id)} onDoubleClick={() => {
          if (!folder) return
          setFolderName(folder.name)
          setFolderDialog({ mode: 'rename', folder })
          setMenuFolderId(null)
        }}>
          <span className="alx-folder-visual" aria-hidden>
            <span className="alx-folder-preview">
              {previews.map((item) => (
                <span className={`alx-folder-preview-item${item.type === 'folder' ? ' is-folder' : ''}`} key={item.type === 'folder' ? item.id : assetEntryKey(item.entry)}>
                  {item.type === 'folder'
                    ? <span className="alx-folder-preview-folder" aria-label="子文件夹"><span className="alx-folder-visual" /></span>
                    : item.entry.source === 'project-component' ? <ProjectComponentPreview component={item.entry.component} variant="folder" />
                      : item.entry.asset.kind === 'image' && item.entry.asset.url ? <img src={item.entry.asset.url} alt="" /> : item.entry.asset.kind === 'video' ? <VideoThumbnail asset={item.entry.asset} compact /> : item.entry.asset.kind === 'font' ? 'Aa' : <AudioWaveform />}
                </span>
              ))}
            </span>
          </span>
          <span>{name}</span>
        </button>
        {folder ? <>
          <button type="button" className="alx-more" aria-label={`${folder.name} 菜单`} onClick={() => setMenuFolderId((current) => current === folder.id ? null : folder.id)}>⋯</button>
          {menuFolderId === folder.id ? <div className="alx-folder-menu" role="menu">
            <button type="button" onClick={() => { setFolderName(folder.name); setFolderDialog({ mode: 'rename', folder }); setMenuFolderId(null) }}>重命名</button>
            <button type="button" onClick={() => { setFolderDialog({ mode: 'delete', folder }); setMenuFolderId(null) }}>删除</button>
            <button type="button" onClick={() => { openFolder(folder.id); setFolderName(''); setFolderDialog({ mode: 'create' }); setMenuFolderId(null) }}>新增子文件夹</button>
          </div> : null}
        </> : null}
      </article>
    )
  }

  return (
    <div className="alx-root">
      <section className="alx-workspace" aria-label={isLibraryHome ? '资产库' : `${currentRoot.name}资产`}>
        <header className="alx-toolbar">
          <div className="alx-action-group">
            <button
              type="button"
              onClick={() => {
                if (!isLibraryHome && currentRoot.kind === 'video') {
                  onVideoGenerate?.()
                  return
                }
                setUnavailableAction(`${isLibraryHome ? '资产' : currentRoot.name}生成服务尚未接入`)
              }}
            ><span className="alx-action-icon"><img src={generateToolbarIcon} alt="" /></span>生成</button>
            <button type="button" disabled={actionsDisabled || isLibraryHome} onClick={() => fileInputRef.current?.click()}><span className="alx-action-icon"><img src={localToolbarIcon} alt="" /></span>本地</button>
            <button type="button" onClick={() => setUnavailableAction('外部资产搜索服务尚未接入')}><span className="alx-action-icon"><img src={externalToolbarIcon} alt="" /></span>外部</button>
            <button type="button" className="alx-preset" onClick={() => setUnavailableAction(`${isLibraryHome ? '资产' : currentRoot.name}预设服务尚未接入`)}><span className="alx-action-icon"><img src={presetToolbarIcon} alt="" /></span>{isLibraryHome ? '资产' : currentRoot.name}预设</button>
            <input ref={fileInputRef} type="file" accept={accept} multiple hidden aria-label="上传资产" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files) }} />
          </div>
          <div className="alx-toolbar-end">
            <button type="button" className={selectionMode ? 'is-on' : ''} disabled={actionsDisabled} onClick={() => { setSelectionMode((current) => !current); setSelectedIds(new Set()) }}>{selectionMode ? '完成' : '多选'}</button>
            <button type="button" disabled={actionsDisabled || isLibraryHome} onClick={() => { setFolderName(''); setFolderDialog({ mode: 'create' }) }}>＋ 新增文件夹</button>
            <label className="alx-search"><span className="alx-search-icon"><img src={searchToolbarIcon} alt="" /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产" aria-label="搜索资产" />{query ? <button type="button" className="alx-search-clear" aria-label="清空搜索" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery('')}>×</button> : null}</label>
          </div>
        </header>

        <nav className="alx-breadcrumb" aria-label="当前位置">
          {[
            { id: 'root:library', name: '资产库' },
            ...(isLibraryHome
              ? []
              : (currentFolder
                ? folderPath(currentFolder, directory.assetLibrary.folders)
                : [currentRoot]).map((item) => ({
              id: 'kind' in item ? item.id : item.id,
              name: item.name,
                }))),
          ].map((item, index, all) => {
            const draggingEntry = entries.find((entry) => assetEntryKey(entry) === draggingAssetId)
            const root = rootForId(item.id)
            const acceptsDrop = root != null && draggingEntry != null && root.kind === assetEntryRoot(draggingEntry)
            return <span
              className={dropFolderId === item.id ? 'is-drop-target' : undefined}
              key={item.id}
              onDragOver={(event) => {
                if (!acceptsDrop) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropFolderId(item.id)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderId(null)
              }}
              onDrop={(event) => root ? void dropAssetIntoFolder(event, root.kind) : undefined}
            >{index > 0 ? <span aria-hidden>›</span> : null}<button type="button" disabled={index === all.length - 1} onClick={() => openFolder(item.id)}>{item.name}</button></span>
          })}
        </nav>

        {directory.error || controller.error || error ? <div className="alx-message is-error" role="alert">{error ?? directory.error ?? controller.error}</div> : null}
        {unavailableAction ? <div className="alx-message" role="status">{unavailableAction}<button type="button" onClick={() => setUnavailableAction(null)}>关闭</button></div> : null}
        {directory.loading ? <div className="alx-message" role="status">正在加载资产目录…</div> : null}
        {selectionMode ? <div className="alx-selection-bar">已选 {selectedIds.size} 项 <button type="button" disabled={actionsDisabled || selectedIds.size === 0} onClick={() => setPendingBatchDelete(true)}>删除选中</button></div> : null}

        <div className="alx-grid" aria-label={isLibraryHome ? '资产库内容' : `${currentRoot.name}内容`}>
          {isLibraryHome && !isSearching ? ASSET_DIRECTORY_ROOTS.map((root) => renderFolderCard(root.id, root.name, root.kind)) : null}
          {filteredFolders.map((folder) => renderFolderCard(folder.id, folder.name, folder.rootKind, folder))}
          {currentEntries.map((entry) => {
            const key = assetEntryKey(entry)
            const isMedia = entry.source === 'media'
            const asset = isMedia ? entry.asset : null
            const name = assetEntryName(entry)
            return (
            <article
              className={`alx-asset-card${selectedIds.has(key) || selectedEntryId === key ? ' is-selected' : ''}${draggingAssetId === key ? ' is-dragging' : ''}`}
              draggable={!selectionMode}
              key={key}
              onDoubleClick={() => {
                if (asset && !asset.readOnly && !selectionMode) setRenameAsset(asset)
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', key)
                suppressAssetOpenRef.current = true
                setDraggingAssetId(key)
              }}
              onDragEnd={() => {
                setDraggingAssetId(null)
                setDropFolderId(null)
                window.setTimeout(() => { suppressAssetOpenRef.current = false }, 0)
              }}
            >
              {selectionMode ? <label className="alx-check"><input type="checkbox" checked={selectedIds.has(key)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })} aria-label={`选择 ${name}`} /></label> : null}
              <div
                className="alx-asset-open"
                role="button"
                tabIndex={0}
                aria-label={`查看 ${name}`}
                onClick={(event) => {
                  if ((event.target as Element).closest('button, input, select, textarea, a')) return
                if (suppressAssetOpenRef.current) {
                  suppressAssetOpenRef.current = false
                  return
                }
                setSelectedEntryId(key)
                setDetailOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setSelectedEntryId(key)
                  setDetailOpen(true)
                }}
              >
                <span className="alx-asset-thumb">{entry.source === 'project-component' ? <ProjectComponentPreview component={entry.component} variant="card" /> : asset?.kind === 'image' && asset.url ? <img src={asset.url} alt="" /> : asset?.kind === 'video' ? <VideoThumbnail asset={asset} /> : asset?.kind === 'font' ? 'Aa' : <AudioWaveform />}</span>
                <span>{name}</span><small>{entry.source === 'project-component' ? '控件' : typeLabel(asset!.kind)}</small>
              </div>
              {asset && !asset.readOnly && !selectionMode ? <button type="button" className="alx-card-close" aria-label={`删除 ${name}`} onClick={() => setPendingDelete(asset)}>×</button> : null}
            </article>
          )})}
        </div>
        {!isLibraryHome && !directory.loading && filteredFolders.length === 0 && currentEntries.length === 0 ? <div className="alx-empty"><span aria-hidden>✦</span><strong>暂无{currentRoot.name}资产</strong><p>可通过本地上传、生成或外部导入来添加资产。</p><div><button type="button" onClick={() => setUnavailableAction(`${currentRoot.name}生成服务尚未接入`)}>生成</button><button type="button" disabled={actionsDisabled} onClick={() => fileInputRef.current?.click()}>本地</button><button type="button" onClick={() => setUnavailableAction('外部资产搜索服务尚未接入')}>外部</button></div></div> : null}
      </section>

      {detailOpen ? <AssetDetailPanel
        asset={selectedAsset}
        component={selectedComponent}
        assetName={assetName}
        actionsDisabled={actionsDisabled}
        onAssetNameChange={setAssetName}
        onSaveAssetName={() => void saveSelectedAssetName()}
        onDelete={() => selectedAsset && setPendingDelete(selectedAsset)}
        onReupload={(file) => void reuploadSelectedAsset(file)}
        onGenerate={() => setUnavailableAction(`${selectedComponent ? '控件' : selectedAsset ? typeLabel(selectedAsset.kind) : '资产'}生成服务尚未接入`)}
        onClose={() => {
          setDetailOpen(false)
          setSelectedEntryId(null)
        }}
      /> : null}

      {folderDialog ? <div className="alx-dialog-backdrop"><form className="alx-dialog" role="dialog" aria-label={folderDialog.mode === 'create' ? '新增文件夹' : folderDialog.mode === 'rename' ? '重命名文件夹' : '删除文件夹'} onSubmit={(event) => { event.preventDefault(); void saveFolder() }}>
        <h2>{folderDialog.mode === 'create' ? '新增文件夹' : folderDialog.mode === 'rename' ? '重命名文件夹' : '删除文件夹'}</h2>
        {folderDialog.mode === 'delete' ? <p>确定删除“{folderDialog.folder?.name}”？仅空文件夹可以删除。</p> : <label>文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>}
        <div><button type="button" onClick={() => setFolderDialog(null)}>取消</button><button type="submit" disabled={directory.saving || (folderDialog.mode !== 'delete' && !folderName.trim())}>{folderDialog.mode === 'delete' ? '删除' : '保存'}</button></div>
      </form></div> : null}
      {renameAsset ? <div className="alx-dialog-backdrop"><form className="alx-dialog" role="dialog" aria-label="重命名资产" onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement; void controller.rename(renameAsset.id, input.value).then(() => setRenameAsset(null)) }}>
        <h2>重命名资产</h2><label>资产名称<input name="name" autoFocus defaultValue={renameAsset.name} /></label><div><button type="button" onClick={() => setRenameAsset(null)}>取消</button><button type="submit">保存</button></div>
      </form></div> : null}
      {pendingDelete ? <div className="alx-dialog-backdrop"><div className="alx-dialog" role="dialog" aria-label="删除资产"><p>确定删除“{pendingDelete.name}”？此操作不可撤销。</p><div><button type="button" onClick={() => setPendingDelete(null)}>取消</button><button type="button" onClick={() => void removeAsset()}>删除</button></div></div></div> : null}
      {pendingBatchDelete ? <div className="alx-dialog-backdrop"><div className="alx-dialog" role="dialog" aria-label="批量删除资产"><p>确定删除选中的 {selectedIds.size} 项资产？此操作不可撤销。</p><div><button type="button" onClick={() => setPendingBatchDelete(false)}>取消</button><button type="button" disabled={actionsDisabled} onClick={() => { setPendingBatchDelete(false); void removeSelected() }}>删除</button></div></div></div> : null}
    </div>
  )
}
