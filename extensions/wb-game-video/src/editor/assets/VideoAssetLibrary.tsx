import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import type { BlueprintDoc, GameScenario } from '../../runtime/schema/graph-schema'
import { tf, useT } from '../../i18n'
import type { MediaStatus } from './registry-types'
import { findVideoReferences } from './video-references'
import type { VideoAssetsController, VideoAssetListItem } from './useVideoAssets'
import {
  listVideoLibraryFolderNames,
  normalizeVideoLibraryFolderName,
  readVideoLibraryMetadata,
  resolveVideoLibraryEntryTag,
  writeVideoLibraryFolderName,
  writeVideoLibraryEntryTag,
  type VideoLibraryMetadata,
} from './video-library-metadata'

export interface VideoLibraryEntry {
  id: string
  label: string
  url: string
  group: string
  bundled?: boolean
  fromApi?: boolean
  fromRegistry?: boolean
  status?: MediaStatus
  durMs?: number
  type?: string
  updatedAt?: number
  /** Optional future server-provided tag; current Kino resources use local metadata instead. */
  tag?: string
}

export type { VideoAssetsController }

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  restoreFocus,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
  restoreFocus: HTMLElement | null
}): JSX.Element {
  const t = useT()
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
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
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
    <div className="val-dialog-backdrop" role="presentation">
      <div
        className="val-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId} style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
        <div className="val-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? t('common.processing') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function RenameDialog({
  entry,
  onConfirm,
  onCancel,
  busy,
  error,
  restoreFocus,
}: {
  entry: VideoLibraryEntry
  onConfirm: (name: string) => void
  onCancel: () => void
  busy: boolean
  error: string | null
  restoreFocus: HTMLElement | null
}): JSX.Element {
  const t = useT()
  const titleId = useId()
  const inputId = useId()
  const [name, setName] = useState(entry.label)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const nextName = name.trim()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => {
      restoreFocus?.focus()
    }
  }, [restoreFocus])

  return (
    <div className="val-dialog-backdrop" role="presentation">
      <form
        className="val-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          if (nextName && nextName !== entry.label && !busy) {
            onConfirm(nextName)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 id={titleId}>{t('videoAssets.renameTitle')}</h2>
        <label htmlFor={inputId}>{t('videoAssets.name')}</label>
        <input
          ref={inputRef}
          id={inputId}
          value={name}
          disabled={busy}
          aria-invalid={!nextName}
          onChange={(event) => setName(event.target.value)}
        />
        {!nextName ? <div className="val-dialog-error">{t('videoAssets.emptyName')}</div> : null}
        {error ? <div className="val-dialog-error" role="alert">{error}</div> : null}
        <div className="val-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" disabled={!nextName || nextName === entry.label || busy}>
            {busy ? t('common.processing') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

function FolderDialog({
  title,
  label,
  initialValue,
  submitLabel,
  existingFolders,
  allowClear,
  onConfirm,
  onCancel,
  busy,
  error,
  restoreFocus,
}: {
  title: string
  label: string
  initialValue: string
  submitLabel: string
  existingFolders?: readonly string[]
  allowClear?: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
  busy: boolean
  error: string | null
  restoreFocus: HTMLElement | null
}): JSX.Element {
  const t = useT()
  const titleId = useId()
  const inputId = useId()
  const [name, setName] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedName = name.trim()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => restoreFocus?.focus()
  }, [restoreFocus])

  return (
    <div className="val-dialog-backdrop" role="presentation">
      <form
        className="val-dialog val-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          if ((allowClear || normalizedName.length > 0) && !busy) onConfirm(normalizedName)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <label htmlFor={inputId}>{label}</label>
        <input
          ref={inputRef}
          id={inputId}
          value={name}
          maxLength={32}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {existingFolders && existingFolders.length > 0 ? (
          <div className="val-folder-suggestions" aria-label="已有文件夹">
            {existingFolders.map((folder) => (
              <button key={folder} type="button" disabled={busy} onClick={() => setName(folder)}>
                {folder}
              </button>
            ))}
          </div>
        ) : null}
        {allowClear ? (
          <button type="button" className="val-folder-clear" disabled={busy} onClick={() => onConfirm('')}>
            {t('videoAssets.folder.removeTag')}
          </button>
        ) : null}
        {!allowClear && normalizedName.length === 0 ? (
          <div className="val-dialog-error">{t('videoAssets.folder.emptyName')}</div>
        ) : null}
        {normalizedName.length > 32 ? <div className="val-dialog-error">{t('videoAssets.folder.nameTooLong')}</div> : null}
        {error ? <div className="val-dialog-error" role="alert">{error}</div> : null}
        <div className="val-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" disabled={busy || (!allowClear && (normalizedName.length === 0 || normalizedName.length > 32))}>
            {busy ? t('common.processing') : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function mapApiItem(item: VideoAssetListItem, group: string): VideoLibraryEntry {
  return {
    id: item.id,
    label: item.label,
    url: item.url,
    group,
    fromApi: true,
    durMs: item.durMs,
    type: item.type,
    updatedAt: item.updatedAt,
  }
}

function displayLabel(entry: VideoLibraryEntry): string {
  return entry.fromApi ? entry.label : `${entry.group} · ${entry.label}`
}

export interface VideoReplaceUploadProps {
  entry?: VideoLibraryEntry
  uploading: boolean
  onReplace: (resourceId: string, file: File) => Promise<unknown>
}

export function VideoReplaceUpload({
  entry,
  uploading,
  onReplace,
}: VideoReplaceUploadProps): JSX.Element | null {
  const t = useT()
  if (!entry?.fromApi) {
    return null
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void onReplace(entry.id, file)
    }
  }

  return (
    <label className="gvv-replace-upload" aria-disabled={uploading}>
      <span aria-hidden>{uploading ? t('videoAssets.replacing') : t('videoAssets.replace')}</span>
      <input
        className="gvv-replace-upload-input"
        type="file"
        accept="video/mp4"
        aria-label={tf('videoAssets.replaceAria', { name: entry.label })}
        disabled={uploading}
        onChange={onFileChange}
      />
    </label>
  )
}

export interface VideoAssetLibraryProps {
  gameId: string
  scenario: GameScenario
  /** Blueprint library used when resolving delete-reference warnings across packs. */
  blueprints?: Record<string, BlueprintDoc>
  mainPackId?: string
  bundledEntries?: VideoLibraryEntry[]
  supplementalEntries?: VideoLibraryEntry[]
  selectedId: string
  boundId?: string
 onSelect: (id: string) => void
  onOpenPreview?: (id: string) => void
  onOpenGenerate?: () => void
  /** Opens the host-owned external-video import dialog when that integration is available. */
  onOpenExternalImport?: () => void
  onDeleted?: (id: string) => void
  controller: VideoAssetsController
  listBodyRef?: Ref<HTMLDivElement>
}

interface BatchUploadState {
  current: number
  total: number
  fileName: string
  status: 'uploading' | 'failed'
}

export function VideoAssetLibrary({
  gameId,
  scenario,
  blueprints,
  mainPackId,
  bundledEntries = [],
  supplementalEntries = [],
  selectedId,
 boundId,
 onSelect,
  onOpenPreview,
  onOpenGenerate,
  onOpenExternalImport,
  onDeleted,
  controller,
  listBodyRef,
}: VideoAssetLibraryProps): JSX.Element {
  const t = useT()
  const uploadGroup = t('videoAssets.group.upload')
  const [pendingRename, setPendingRename] = useState<VideoLibraryEntry | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<VideoLibraryEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [batchUpload, setBatchUpload] = useState<BatchUploadState | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [batchSelection, setBatchSelection] = useState<Set<string>>(() => new Set())
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  const renameTriggerRef = useRef<HTMLElement | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const folderTriggerRef = useRef<HTMLElement | null>(null)
  const tagTriggerRef = useRef<HTMLElement | null>(null)
  const initialMetadata = useMemo(() => readVideoLibraryMetadata(gameId), [gameId])
  const [metadata, setMetadata] = useState<VideoLibraryMetadata>(() => (
    initialMetadata.status === 'ready'
      ? { tagsByEntryId: initialMetadata.tagsByEntryId, folderNames: initialMetadata.folderNames }
      : { tagsByEntryId: {}, folderNames: [] }
  ))
  const [metadataError, setMetadataError] = useState<string | null>(
    initialMetadata.status === 'ready' ? null : '本地文件夹状态不可用，标签不会被持久化。',
  )
  const [activeFolder, setActiveFolder] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingFolder, setPendingFolder] = useState(false)
  const [pendingTag, setPendingTag] = useState<VideoLibraryEntry | null>(null)
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [metadataOperationError, setMetadataOperationError] = useState<string | null>(null)
  const folderContentId = useId()
  const batchUploading = batchUpload?.status === 'uploading'
  const actionsBusy = controller.uploading
    || controller.mutating
    || renameBusy
    || deleteBusy
    || metadataBusy
    || batchUploading

  const apiEntries = controller.items.map((item) => mapApiItem(item, uploadGroup))

  const entries = (() => {
    const seen = new Set<string>()
    const out: VideoLibraryEntry[] = []
    for (const entry of [...apiEntries, ...bundledEntries, ...supplementalEntries]) {
      if (seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
      out.push(entry)
    }
    return out
  })()

  useEffect(() => {
    const result = readVideoLibraryMetadata(gameId)
    if (result.status === 'ready') {
      setMetadata({ tagsByEntryId: result.tagsByEntryId, folderNames: result.folderNames })
      setMetadataError(null)
    } else {
      setMetadata({ tagsByEntryId: {}, folderNames: [] })
      setMetadataError('本地文件夹状态不可用，标签不会被持久化。')
    }
    setActiveFolder('all')
  }, [gameId])

  const folderNames = useMemo(
    () => listVideoLibraryFolderNames(metadata),
    [metadata],
  )
  const entryTag = (entry: VideoLibraryEntry): string | null => (
    normalizeVideoLibraryFolderName(entry.tag)
      ?? resolveVideoLibraryEntryTag(entry.id, metadata)
  )
  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      const tag = entryTag(entry)
      if (activeFolder === 'untagged' && tag !== null) return false
      if (activeFolder !== 'all' && activeFolder !== 'untagged' && tag !== activeFolder) return false
      if (!query) return true
      return `${entry.label} ${entry.group} ${tag ?? ''}`.toLocaleLowerCase().includes(query)
    })
  }, [activeFolder, entries, metadata, searchQuery])
  const selectedLibraryEntry = entries.find((entry) => entry.id === selectedId)

  const showUploadStatus = batchUpload != null
    || controller.uploadProgress != null
    || controller.uploadError != null

  const applyEntryTag = (entry: VideoLibraryEntry, rawTag: string): boolean => {
    const tag = rawTag.trim()
    setMetadataBusy(true)
    setMetadataOperationError(null)
    try {
      const result = writeVideoLibraryEntryTag(gameId, entry.id, tag)
      if (result.status !== 'written') {
        setMetadataOperationError('文件夹状态无法保存，请检查浏览器本地存储权限。')
        return false
      }
      setMetadata({ tagsByEntryId: result.tagsByEntryId, folderNames: result.folderNames })
      return true
    } catch (error) {
      setMetadataOperationError(error instanceof Error ? error.message : '文件夹状态无法保存。')
      return false
    } finally {
      setMetadataBusy(false)
    }
  }

  const clearEntryTag = (entry: VideoLibraryEntry): void => {
    const result = writeVideoLibraryEntryTag(gameId, entry.id, null)
    if (result.status === 'written') {
      setMetadata({ tagsByEntryId: result.tagsByEntryId, folderNames: result.folderNames })
    }
  }

  const confirmTag = (tag: string): void => {
    if (!pendingTag || !applyEntryTag(pendingTag, tag)) return
    setPendingTag(null)
  }

  const confirmFolder = (name: string): void => {
    const folderName = normalizeVideoLibraryFolderName(name)
    if (!folderName) return
    setMetadataBusy(true)
    setMetadataOperationError(null)
    try {
      const result = writeVideoLibraryFolderName(gameId, folderName)
      if (result.status !== 'written') {
        setMetadataOperationError('文件夹状态无法保存，请检查浏览器本地存储权限。')
        return
      }
      setMetadata({ tagsByEntryId: result.tagsByEntryId, folderNames: result.folderNames })
    } catch (error) {
      setMetadataOperationError(error instanceof Error ? error.message : '文件夹状态无法保存。')
      return
    } finally {
      setMetadataBusy(false)
    }
    setActiveFolder(folderName)
    setPendingFolder(false)
  }

  const openRenameDialog = (entry: VideoLibraryEntry, trigger: HTMLElement) => {
    setOperationError(null)
    setRenameError(null)
    renameTriggerRef.current = trigger
    setPendingRename(entry)
  }

  const openTagDialog = (entry: VideoLibraryEntry, trigger: HTMLElement) => {
    setMetadataOperationError(null)
    tagTriggerRef.current = trigger
    setPendingTag(entry)
  }

  const confirmRename = async (name: string) => {
    if (!pendingRename?.fromApi) {
      return
    }
    setRenameBusy(true)
    setRenameError(null)
    try {
      await controller.renameResource(pendingRename.id, name)
      setPendingRename(null)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t('videoAssets.renameFailed'))
    } finally {
      setRenameBusy(false)
    }
  }

  const openDeleteDialog = (entry: VideoLibraryEntry, trigger: HTMLElement) => {
    setOperationError(null)
    deleteTriggerRef.current = trigger
    setPendingDelete(entry)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) {
      return
    }
    const id = pendingDelete.id
    if (!pendingDelete.fromApi) {
      return
    }
    setDeleteBusy(true)
    setOperationError(null)
    try {
      await controller.deleteResource(id)
      clearEntryTag(pendingDelete)
      onDeleted?.(id)
      setPendingDelete(null)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t('videoAssets.deleteFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }
  const toggleBatchSelection = (id: string) => {
    setBatchSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const confirmBatchDelete = async () => {
    const ids = entries.filter((entry) => entry.fromApi && batchSelection.has(entry.id)).map((entry) => entry.id)
    if (ids.length === 0) return
    setDeleteBusy(true)
    setOperationError(null)
    const result = await controller.deleteResources(ids)
    if (result.failedId) setOperationError(`批量删除在“${result.failedId}”失败，已完成 ${result.completed}/${ids.length} 项。`)
    else ids.forEach((id) => {
      const entry = entries.find((candidate) => candidate.id === id)
      if (entry) clearEntryTag(entry)
      onDeleted?.(id)
    })
    setBatchSelection(new Set())
    setDeleteBusy(false)
    setPendingBatchDelete(false)
  }

  const deleteMessage = (() => {
    if (!pendingDelete) {
      return ''
    }
    const refs = findVideoReferences(scenario, pendingDelete.id, { blueprints, mainPackId })
    if (refs.length === 0) {
      return tf('videoAssets.deleteUnused', { name: pendingDelete.label })
    }
    const lines = refs.map((r) => `${r.graphLabel} · ${r.nodeName} (${r.nodeId})`)
    return tf('videoAssets.deleteReferenced', {
      name: pendingDelete.label,
      references: lines.join('\n'),
    })
  })()

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) {
      return
    }

    setOperationError(null)
    setBatchUpload(null)
    for (const [index, file] of files.entries()) {
      if (files.length > 1) {
        setBatchUpload({
          current: index + 1,
          total: files.length,
          fileName: file.name,
          status: 'uploading',
        })
      }
      const created = await controller.upload(file)
      if (!created) {
        if (files.length > 1) {
          setBatchUpload({
            current: index + 1,
            total: files.length,
            fileName: file.name,
            status: 'failed',
          })
          setOperationError(
            tf('videoAssets.batchFailed', {
              name: file.name,
              completed: index,
              total: files.length,
            }),
          )
        }
        return
      }
      onSelect(created.resource_id)
    }
    setBatchUpload(null)
  }

  const retryComplete = async () => {
    const created = await controller.retryComplete()
    if (!created) {
      return
    }
    onSelect(created.resource_id)
    setBatchUpload(null)
    setOperationError(null)
  }

  return (
    <aside className="gc-list val-library" aria-label={t('videoAssets.libraryAria')}>
      <div className="gc-list-head">
        <span className="gc-list-ico" aria-hidden>🎥</span>
        <span className="gc-list-title">{t('videoAssets.title')}</span>
        <div className="val-library-sources" aria-label="视频素材入口">
          <button
            type="button"
            className="val-source-action val-source-generate"
            disabled={!onOpenGenerate}
            onClick={onOpenGenerate}
          >
            <span aria-hidden>✨</span> {t('videoAssets.generate.entry')}
          </button>
          <label className="val-head-upload val-source-action" aria-disabled={actionsBusy}>
            <span aria-hidden>＋</span> {t('videoAssets.localUpload')}
            <input
              className="val-head-upload-input"
              type="file"
              accept="video/mp4"
              multiple
              aria-label={t('videoAssets.upload')}
              disabled={actionsBusy}
              onChange={(event) => void onFileChange(event)}
            />
          </label>
          <button
            type="button"
            className="val-source-action val-source-external"
            disabled={!onOpenExternalImport}
            title={onOpenExternalImport ? undefined : '外部视频导入即将接入'}
            onClick={onOpenExternalImport}
          >
            <span aria-hidden>↗</span> 外部视频导入
          </button>
        </div>
        <button type="button" className={`val-head-select${selectionMode ? ' is-on' : ''}`} aria-label={selectionMode ? '退出多选' : '多选视频'} disabled={actionsBusy} onClick={() => { setSelectionMode((current) => !current); setBatchSelection(new Set()) }}>☑</button>
        {showUploadStatus ? (
          <div className="val-head-status" role="status" aria-live="polite">
            {batchUpload ? (
              <span
                className="val-head-batch"
                title={batchUpload.fileName}
              >
                {tf('videoAssets.batchProgress', {
                  current: batchUpload.current,
                  total: batchUpload.total,
                })}
              </span>
            ) : null}
            {controller.uploadProgress != null ? (
              <span className="val-head-progress">
                {tf('videoAssets.uploadProgress', { progress: controller.uploadProgress })}
              </span>
            ) : null}
            {controller.uploadError ? (
              <>
                <span className="val-head-fail">{t('videoAssets.completeFailed')}</span>
                {controller.canRetryComplete ? (
                  <button
                    type="button"
                    aria-label={t('videoAssets.retryComplete')}
                    disabled={actionsBusy}
                    onClick={() => void retryComplete()}
                  >
                    {t('videoAssets.retry')}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        <span className="gc-list-count">{entries.length}</span>
        <button
          type="button"
          className="val-head-refresh"
          aria-label={t('videoAssets.refresh')}
          onClick={() => void controller.refresh()}
          disabled={controller.loading || actionsBusy}
        >
          ↻
        </button>
      </div>
      {selectionMode ? <div className="val-batch-bar"><span>已选 {batchSelection.size} 项</span><button type="button" disabled={batchSelection.size === 0 || actionsBusy} onClick={() => setPendingBatchDelete(true)}>删除选中</button><button type="button" disabled={actionsBusy} onClick={() => { setSelectionMode(false); setBatchSelection(new Set()) }}>完成</button></div> : null}

      {controller.error || operationError ? (
        <div className="val-error" role="alert">
          {controller.error ?? operationError}
        </div>
      ) : null}

      <div className="val-library-layout">
        <nav className="val-folder-rail" aria-label={t('videoAssets.folder.aria')} role="tablist" aria-orientation="vertical">
          <div className="val-folder-rail-head">
            <span>{t('videoAssets.folder.title')}</span>
            <button
              type="button"
              className="val-folder-add"
              aria-label={t('videoAssets.folder.create')}
              disabled={actionsBusy}
              onClick={(event) => {
                folderTriggerRef.current = event.currentTarget
                setPendingFolder(true)
              }}
            >
              ＋
            </button>
          </div>
          <button
            type="button"
            role="tab"
            className={`val-folder-item${activeFolder === 'all' ? ' is-on' : ''}`}
            aria-controls={folderContentId}
            aria-selected={activeFolder === 'all'}
            onClick={() => setActiveFolder('all')}
          >
            <span aria-hidden>▦</span>
            <span>{t('videoAssets.folder.all')}</span>
            <span className="val-folder-count">{entries.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`val-folder-item${activeFolder === 'untagged' ? ' is-on' : ''}`}
            aria-controls={folderContentId}
            aria-selected={activeFolder === 'untagged'}
            onClick={() => setActiveFolder('untagged')}
          >
            <span aria-hidden>□</span>
            <span>{t('videoAssets.folder.untagged')}</span>
            <span className="val-folder-count">{entries.filter((entry) => entryTag(entry) === null).length}</span>
          </button>
          {folderNames.map((folder) => (
            <button
              key={folder}
              type="button"
              role="tab"
              className={`val-folder-item${activeFolder === folder ? ' is-on' : ''}`}
              aria-controls={folderContentId}
              aria-selected={activeFolder === folder}
              onClick={() => setActiveFolder(folder)}
            >
              <span aria-hidden>▰</span>
              <span className="val-folder-label">{folder}</span>
              <span className="val-folder-count">{entries.filter((entry) => entryTag(entry) === folder).length}</span>
            </button>
          ))}
        </nav>

        <section id={folderContentId} className="val-library-content" role="tabpanel" aria-label={t('videoAssets.folder.contentAria')}>
          <div className="val-library-toolbar">
            <div className="val-breadcrumb" aria-label={t('videoAssets.folder.breadcrumbAria')}>
              <span>{t('videoAssets.folder.root')}</span>
              <span aria-hidden>/</span>
              <strong>{activeFolder === 'all' ? t('videoAssets.title') : activeFolder === 'untagged' ? t('videoAssets.folder.untagged') : activeFolder}</strong>
            </div>
            <input
              className="val-library-search"
              type="search"
              value={searchQuery}
              placeholder={t('videoAssets.folder.searchPlaceholder')}
              aria-label={t('videoAssets.folder.searchAria')}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {selectedLibraryEntry ? (
              <button
                type="button"
                className="val-tag-action"
                disabled={actionsBusy}
                onClick={(event) => openTagDialog(selectedLibraryEntry, event.currentTarget)}
              >
                {entryTag(selectedLibraryEntry) ? t('videoAssets.folder.changeTag') : t('videoAssets.folder.setTag')}
              </button>
            ) : null}
          </div>
          {metadataError || metadataOperationError ? (
            <div className="val-meta-warning" role="status">{metadataOperationError ?? metadataError}</div>
          ) : null}
          <div className="gc-list-body" ref={listBodyRef}>
            {controller.loading && entries.length === 0 ? (
              <div className="val-empty" role="status">{t('videoAssets.loading')}</div>
            ) : null}

            {!controller.loading && entries.length === 0 ? (
              <div className="val-empty">{t('videoAssets.empty')}</div>
            ) : null}

            {!controller.loading && entries.length > 0 && filteredEntries.length === 0 ? (
              <div className="val-empty">{t('videoAssets.folder.empty')}</div>
            ) : null}

            {filteredEntries.map((entry) => {
              const isSelected = entry.id === selectedId
              const isBound = entry.id === boundId
              const label = displayLabel(entry)
              const tag = entryTag(entry)
              return (
                <div key={entry.id} className={`val-row${isSelected ? ' is-on' : ''}${selectionMode ? ' is-selecting' : ''}`}>
                  <button
                    type="button"
                    data-clip-id={entry.id}
                    className={`gc-row${isSelected ? ' is-on' : ''}`}
                    aria-label={label}
                    onClick={() => { onSelect(entry.id); onOpenPreview?.(entry.id) }}
                    onDoubleClick={(event) => {
                      if (entry.fromApi && !actionsBusy) {
                        openRenameDialog(entry, event.currentTarget)
                      }
                    }}
                  >
                    {isBound ? <span className="gc-row-mark" aria-hidden>✓</span> : null}
                    <span className="val-card-thumb" aria-hidden>
                      {entry.url ? <video src={entry.url} muted playsInline preload="metadata" /> : <span>▶</span>}
                    </span>
                    <span className="val-card-copy">
                      <span className="gc-row-label" title={label}>{label}</span>
                      <span className="val-card-meta" aria-hidden>
                        {tag ? <span className="val-card-tag">{tag}</span> : <span>{t('videoAssets.folder.untagged')}</span>}
                        {entry.type ? <span>{entry.type}</span> : null}
                      </span>
                    </span>
                    {entry.status && entry.status !== 'ready' ? (
                      <span className={`gvv-row-status is-${entry.status}`}>
                        {entry.status === 'generating'
                          ? t('videoAssets.status.generating')
                          : entry.status === 'failed'
                            ? t('videoAssets.status.failed')
                            : t('videoAssets.status.placeholder')}
                      </span>
                    ) : null}
                  </button>
                  {entry.fromApi && !selectionMode ? (
                    <>
                      <button
                        type="button"
                        className="val-row-action val-row-rename"
                        aria-label={tf('videoAssets.renameAria', { name: entry.label })}
                        disabled={actionsBusy}
                        onClick={(event) => {
                          event.stopPropagation()
                          openRenameDialog(entry, event.currentTarget)
                        }}
                      >
                        {t('videoAssets.rename')}
                      </button>
                      <button
                        type="button"
                        className="val-row-action val-row-delete"
                        aria-label={tf('videoAssets.deleteAria', { name: entry.label })}
                        disabled={actionsBusy}
                        onClick={(event) => {
                          event.stopPropagation()
                          openDeleteDialog(entry, event.currentTarget)
                        }}
                      >
                        {t('videoAssets.delete')}
                      </button>
                    </>
                  ) : null}
                  {selectionMode && entry.fromApi ? <label className="val-row-select"><input type="checkbox" checked={batchSelection.has(entry.id)} disabled={actionsBusy} onChange={() => toggleBatchSelection(entry.id)} aria-label={`选择 ${entry.label}`} /></label> : null}
                </div>
              )
            })}
          </div>

          {controller.hasMore ? (
            <button
              type="button"
              className="val-load-more"
              aria-label={t('videoAssets.loadMore')}
              disabled={controller.loading}
              onClick={() => void controller.loadMore()}
            >
              {controller.loading ? t('videoAssets.loadingMore') : t('videoAssets.loadMore')}
            </button>
          ) : null}
        </section>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={t('videoAssets.deleteTitle')}
          message={deleteMessage}
          confirmLabel={t('videoAssets.confirmDelete')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          busy={deleteBusy}
          restoreFocus={deleteTriggerRef.current}
        />
      ) : null}
      {pendingBatchDelete ? <ConfirmDialog title="批量删除视频" message={`确定删除选中的 ${batchSelection.size} 个视频？此操作不可撤销。`} confirmLabel="确认删除" onConfirm={() => void confirmBatchDelete()} onCancel={() => setPendingBatchDelete(false)} busy={deleteBusy} restoreFocus={deleteTriggerRef.current} /> : null}

      {pendingRename ? (
        <RenameDialog
          entry={pendingRename}
          onConfirm={(name) => void confirmRename(name)}
          onCancel={() => setPendingRename(null)}
          busy={renameBusy}
          error={renameError}
          restoreFocus={renameTriggerRef.current}
        />
      ) : null}
      {pendingFolder ? (
        <FolderDialog
          title={t('videoAssets.folder.createTitle')}
          label={t('videoAssets.folder.name')}
          initialValue=""
          submitLabel={t('videoAssets.folder.create')}
          onConfirm={confirmFolder}
          onCancel={() => setPendingFolder(false)}
          busy={metadataBusy}
          error={metadataOperationError}
          restoreFocus={folderTriggerRef.current}
        />
      ) : null}
      {pendingTag ? (
        <FolderDialog
          title={tf('videoAssets.folder.setTagTitle', { name: pendingTag.label })}
          label={t('videoAssets.folder.tagName')}
          initialValue={entryTag(pendingTag) ?? ''}
          submitLabel={t('common.save')}
          existingFolders={folderNames}
          allowClear
          onConfirm={confirmTag}
          onCancel={() => setPendingTag(null)}
          busy={metadataBusy}
          error={metadataOperationError}
          restoreFocus={tagTriggerRef.current}
        />
      ) : null}
    </aside>
  )
}
