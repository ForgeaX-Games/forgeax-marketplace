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
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function mapApiItem(item: VideoAssetListItem): VideoLibraryEntry {
  return {
    id: item.id,
    label: item.label,
    url: item.url,
    group: '上传',
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
      <span aria-hidden>{uploading ? '上传中…' : '重新上传'}</span>
      <input
        className="gvv-replace-upload-input"
        type="file"
        accept="video/mp4"
        aria-label={`重新上传 ${entry.label}`}
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
  const [pendingDelete, setPendingDelete] = useState<VideoLibraryEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const actionsBusy = controller.uploading || controller.mutating || deleteBusy

  const apiEntries = useMemo(() => controller.items.map(mapApiItem), [controller.items])

  const entries = useMemo(() => {
    const seen = new Set<string>()
    const out: VideoLibraryEntry[] = []
    for (const entry of [...bundledEntries, ...apiEntries, ...supplementalEntries]) {
      if (seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
      out.push(entry)
    }
    return out
  }, [apiEntries, bundledEntries, supplementalEntries])

  const showUploadStatus = controller.uploadProgress != null || controller.uploadError != null

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
      setOperationError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleteBusy(false)
    }
  }

  const deleteMessage = useMemo(() => {
    if (!pendingDelete) {
      return ''
    }
    const refs = findVideoReferences(scenario, pendingDelete.id, { blueprints, mainPackId })
    if (refs.length === 0) {
      return `确定删除「${pendingDelete.label}」？此操作不可撤销。`
    }
    const lines = refs.map((r) => `${r.graphLabel} · ${r.nodeName} (${r.nodeId})`)
    return `「${pendingDelete.label}」仍被以下节点引用：\n${lines.join('\n')}\n删除后图内绑定不会自动清除，但素材将无法播放。确定删除？`
  }, [pendingDelete, scenario, blueprints, mainPackId])

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    const created = await controller.upload(file)
    if (created) {
      onSelect(created.resource_id)
    }
  }

  return (
    <aside className="gc-list val-library" aria-label="视频素材库">
      <div className="gc-list-head">
        <span className="gc-list-ico" aria-hidden>🎥</span>
        <span className="gc-list-title">视频素材</span>
        <label
          className="val-head-upload"
          aria-disabled={actionsBusy}
        >
          <span aria-hidden>＋</span>
          <input
            className="val-head-upload-input"
            type="file"
            accept="video/mp4"
            aria-label="上传视频"
            disabled={actionsBusy}
            onChange={(e) => void onFileChange(e)}
          />
        </label>
        {showUploadStatus ? (
          <div className="val-head-status" role="status" aria-live="polite">
            {controller.uploadProgress != null ? (
              <span className="val-head-progress">上传 {controller.uploadProgress}%</span>
            ) : null}
            {controller.uploadError ? (
              <>
                <span className="val-head-fail">完成失败</span>
                {controller.canRetryComplete ? (
                  <button
                    type="button"
                    aria-label="重试完成上传"
                    disabled={actionsBusy}
                    onClick={() => void controller.retryComplete()}
                  >
                    重试
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
          aria-label="刷新视频库"
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
          <div className="val-empty" role="status">加载视频素材…</div>
        ) : null}

        {!controller.loading && entries.length === 0 ? (
          <div className="val-empty">暂无视频素材。可上传 MP4 或使用内置 bundle。</div>
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
              >
                <span className="gc-row-mark" aria-hidden>{isBound ? '✓' : ''}</span>
                <span className="gc-row-label">{entry.group} · {entry.label}</span>
                {entry.status && entry.status !== 'ready' ? (
                  <span className={`gvv-row-status is-${entry.status}`}>
                    {entry.status === 'generating' ? '生成中…' : entry.status === 'failed' ? '失败' : '占位'}
                  </span>
                ) : null}
              </button>
              {entry.fromApi ? (
                <button
                  type="button"
                  className="val-row-delete"
                  aria-label={`删除 ${entry.label}`}
                  disabled={actionsBusy}
                  onClick={(event) => {
                    event.stopPropagation()
                    openDeleteDialog(entry, event.currentTarget)
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {controller.hasMore ? (
        <button
          type="button"
          className="val-load-more"
          aria-label="加载更多视频"
          disabled={controller.loading}
          onClick={() => void controller.loadMore()}
        >
          {controller.loading ? '加载中…' : '加载更多'}
        </button>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="删除视频素材"
          message={deleteMessage}
          confirmLabel="确认删除"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          busy={deleteBusy}
          restoreFocus={deleteTriggerRef.current}
        />
      ) : null}
    </aside>
  )
}
