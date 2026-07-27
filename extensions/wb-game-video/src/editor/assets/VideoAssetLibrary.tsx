import {
  useEffect,
  useId,
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
  bundledEntries: VideoLibraryEntry[]
  supplementalEntries?: VideoLibraryEntry[]
  selectedId: string
  boundId?: string
  onSelect: (id: string) => void
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
  bundledEntries,
  supplementalEntries = [],
  selectedId,
  boundId,
  onSelect,
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
  const renameTriggerRef = useRef<HTMLElement | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const batchUploading = batchUpload?.status === 'uploading'
  const actionsBusy = controller.uploading
    || controller.mutating
    || renameBusy
    || deleteBusy
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

  const showUploadStatus = batchUpload != null
    || controller.uploadProgress != null
    || controller.uploadError != null

  const openRenameDialog = (entry: VideoLibraryEntry, trigger: HTMLElement) => {
    setOperationError(null)
    setRenameError(null)
    renameTriggerRef.current = trigger
    setPendingRename(entry)
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
      onDeleted?.(id)
      setPendingDelete(null)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t('videoAssets.deleteFailed'))
    } finally {
      setDeleteBusy(false)
    }
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
        <label
          className="val-head-upload"
          aria-disabled={actionsBusy}
        >
          <span aria-hidden>＋</span>
          <input
            className="val-head-upload-input"
            type="file"
            accept="video/mp4"
            multiple
            aria-label={t('videoAssets.upload')}
            disabled={actionsBusy}
            onChange={(e) => void onFileChange(e)}
          />
        </label>
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

      {controller.error || operationError ? (
        <div className="val-error" role="alert">
          {controller.error ?? operationError}
        </div>
      ) : null}

      <div className="gc-list-body" ref={listBodyRef}>
        {controller.loading && entries.length === 0 ? (
          <div className="val-empty" role="status">{t('videoAssets.loading')}</div>
        ) : null}

        {!controller.loading && entries.length === 0 ? (
          <div className="val-empty">{t('videoAssets.empty')}</div>
        ) : null}

        {entries.map((entry) => {
          const isSelected = entry.id === selectedId
          const isBound = entry.id === boundId
          return (
            <div key={entry.id} className={`val-row${isSelected ? ' is-on' : ''}`}>
              <button
                type="button"
                data-clip-id={entry.id}
                className={`gc-row${isSelected ? ' is-on' : ''}`}
                aria-label={`${entry.group} · ${entry.label}`}
                onClick={() => onSelect(entry.id)}
                onDoubleClick={(event) => {
                  if (entry.fromApi && !actionsBusy) {
                    openRenameDialog(entry, event.currentTarget)
                  }
                }}
              >
                <span className="gc-row-mark" aria-hidden>{isBound ? '✓' : ''}</span>
                <span className="gc-row-label">{entry.group} · {entry.label}</span>
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
              {entry.fromApi ? (
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
    </aside>
  )
}
