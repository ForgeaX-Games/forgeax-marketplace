import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { AssetLibraryController, ManagedAsset, ManagedAssetKind } from './assetLibraryClient'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif'
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.m4a,.aac'
const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf'

interface BatchUploadState {
  current: number
  total: number
  fileName: string
  status: 'uploading' | 'failed'
}

function kindLabel(kind: ManagedAssetKind): string {
  return kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '字体'
}

function workspaceLabel(kind: ManagedAssetKind): string {
  return kind === 'audio' ? 'BGM 资产' : `${kindLabel(kind)}资产`
}

function formatBytes(value: number | undefined): string {
  if (value == null) return '大小未知'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function AssetUploadTile({
  kind,
  busy,
  disabled,
  onUpload,
}: {
  kind: ManagedAssetKind
  busy: boolean
  disabled: boolean
  onUpload: (kind: ManagedAssetKind, files: File[]) => void
}): JSX.Element {
  const accept = kind === 'image' ? IMAGE_ACCEPT : kind === 'audio' ? AUDIO_ACCEPT : FONT_ACCEPT
  const label = kind === 'image' ? '上传图片' : kind === 'audio' ? '上传 BGM' : '上传字体'
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) onUpload(kind, files)
  }
  return (
    <label className="alp-upload-tile" aria-disabled={disabled || busy}>
      <span className="alp-upload-tile-plus" aria-hidden>+</span>
      <span>{busy ? '上传中…' : label}</span>
      <input type="file" accept={accept} multiple aria-label={label} disabled={disabled || busy} onChange={onChange} />
    </label>
  )
}

function preview(asset: ManagedAsset | undefined): JSX.Element {
  if (!asset) return <div className="alp-empty">选择一个图片、BGM 或字体查看详情。</div>
  const fontFamily = `asset-font-${asset.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
  return (
    <div className="alp-stage">
      {asset.kind === 'image' && asset.url ? (
        <img className="alp-image" src={asset.url} alt={asset.name} />
      ) : asset.kind === 'audio' && asset.url ? (
        <audio className="alp-audio" controls src={asset.url}>浏览器不支持音频预览。</audio>
      ) : (
        <div className={`alp-preview-icon${asset.kind === 'font' ? ' alp-font-preview' : ''}`} aria-hidden>
          {asset.kind === 'font'
            ? asset.url
              ? <><style>{`@font-face{font-family:${fontFamily};src:url("${asset.url}")}`}</style><span style={{ fontFamily }}>Aa</span></>
              : 'Aa'
            : asset.kind === 'image' ? '图片' : 'BGM'}
        </div>
      )}
      <h2>{asset.name}</h2>
      <div className="alp-meta">
        <div><span>类型</span><strong>{asset.mime ?? kindLabel(asset.kind)}</strong></div>
        <div><span>大小</span><strong>{formatBytes(asset.bytes)}</strong></div>
        <div><span>来源</span><strong>{asset.source ?? '上传资产'}</strong></div>
      </div>
    </div>
  )
}

export function AssetLibraryPanel({
  controller,
}: {
  controller: AssetLibraryController
}): JSX.Element {
  const [activeKind, setActiveKind] = useState<ManagedAssetKind>('image')
  const [selectedId, setSelectedId] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const deleteRef = useRef<ManagedAsset | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ManagedAsset | null>(null)
  const [batchUpload, setBatchUpload] = useState<BatchUploadState | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState<{ current: number, total: number } | null>(null)

  const imageItems = useMemo(
    () => controller.items.filter((item) => item.kind === 'image'),
    [controller.items],
  )
  const audioItems = useMemo(
    () => controller.items.filter((item) => item.kind === 'audio'),
    [controller.items],
  )
  const fontItems = useMemo(
    () => controller.items.filter((item) => item.kind === 'font'),
    [controller.items],
  )
  const activeItems = activeKind === 'image' ? imageItems : activeKind === 'audio' ? audioItems : fontItems
  const selected = activeItems.find((asset) => asset.id === selectedId)
  const previewAsset = activeItems.find((asset) => asset.id === previewId)
  const actionsDisabled = !controller.available || controller.mutating || controller.uploading != null || batchUpload?.status === 'uploading' || batchDeleting != null

  useEffect(() => {
    setSelectedId((current) => (
      activeItems.some((item) => item.id === current) ? current : (activeItems[0]?.id ?? '')
    ))
    setPreviewId((current) => (
      current && activeItems.some((item) => item.id === current) ? current : null
    ))
  }, [activeItems])

  const select = (id: string) => {
    setSelectedId(id)
    setEditingId(null)
  }
  const beginRename = (asset: ManagedAsset) => {
    setEditingId(asset.id)
    setName(asset.name)
  }
  const saveRename = async () => {
    if (!editingId) return
    await controller.rename(editingId, name)
    setEditingId(null)
  }
  const confirmDelete = async () => {
    if (!pendingDelete) return
    await controller.remove(pendingDelete.id)
    if (selectedId === pendingDelete.id) setSelectedId('')
    setPendingDelete(null)
  }
  const toggleBatchSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const confirmBatchDelete = async () => {
    const ids = activeItems.filter((asset) => selectedIds.has(asset.id)).map((asset) => asset.id)
    if (ids.length === 0) return
    setBatchError(null)
    setBatchDeleting({ current: 1, total: ids.length })
    const result = await controller.removeMany(ids, (current, total) => setBatchDeleting({ current, total }))
    setBatchDeleting(null)
    setPendingBatchDelete(false)
    setSelectedIds((current) => {
      const next = new Set(current)
      ids.slice(0, result.completed).forEach((id) => next.delete(id))
      return next
    })
    if (result.failedId) setBatchError(`批量删除在“${result.failedId}”失败，已完成 ${result.completed}/${ids.length} 项。`)
  }
  const uploadFiles = async (kind: ManagedAssetKind, files: File[]) => {
    setBatchError(null)
    setBatchUpload(null)
    for (const [index, file] of files.entries()) {
      if (files.length > 1) {
        setBatchUpload({ current: index + 1, total: files.length, fileName: file.name, status: 'uploading' })
      }
      const asset = await controller.upload(kind, file)
      if (!asset) {
        if (files.length > 1) {
          setBatchUpload({ current: index + 1, total: files.length, fileName: file.name, status: 'failed' })
          setBatchError(`批量上传在“${file.name}”失败，已完成 ${index}/${files.length} 个文件。请处理失败项后重新选择剩余文件。`)
        }
        return
      }
    }
    setBatchUpload(null)
  }

  return (
    <div className="alp-root">
      <div className="alp-shell">
        <nav className="alp-kind-tabs" aria-label="资产类型">
          <button
            type="button"
            className={activeKind === 'image' ? 'is-active' : ''}
            aria-current={activeKind === 'image' ? 'page' : undefined}
            onClick={() => setActiveKind('image')}
          >
            图片 <span>{imageItems.length}</span>
          </button>
          <button
            type="button"
            className={activeKind === 'audio' ? 'is-active' : ''}
            aria-current={activeKind === 'audio' ? 'page' : undefined}
            onClick={() => setActiveKind('audio')}
          >
            音频 <span>{audioItems.length}</span>
          </button>
          <button
            type="button"
            className={activeKind === 'font' ? 'is-active' : ''}
            aria-current={activeKind === 'font' ? 'page' : undefined}
            onClick={() => setActiveKind('font')}
          >
            字体 <span>{fontItems.length}</span>
          </button>
        </nav>
        <section className="alp-workspace" aria-label={workspaceLabel(activeKind)}>
          <header className="alp-workspace-head">
            <div>
              <h2>{workspaceLabel(activeKind)}</h2>
              <span>{activeItems.length} 项</span>
            </div>
            <button type="button" className={selectionMode ? 'is-on' : ''} disabled={actionsDisabled} onClick={() => { setSelectionMode((current) => !current); setSelectedIds(new Set()) }}>{selectionMode ? '完成' : '多选'}</button>
          </header>
          {!controller.available ? <div className="alp-unavailable" role="status">图片、BGM 与字体资源 API 尚未启用。</div> : null}
          {controller.error || batchError ? <div className="alp-error" role="alert">{batchError ?? controller.error}</div> : null}
          {batchUpload ? <div className="alp-loading" role="status" title={batchUpload.fileName}>批量 {batchUpload.current}/{batchUpload.total}</div> : null}
          {batchDeleting ? <div className="alp-loading" role="status">删除 {batchDeleting.current}/{batchDeleting.total}</div> : null}
          {selectionMode ? <div className="alp-loading alp-batch-bar"><span>已选 {selectedIds.size} 项</span><button type="button" disabled={selectedIds.size === 0 || actionsDisabled} onClick={() => setPendingBatchDelete(true)}>删除选中</button></div> : null}
          <div className="alp-list alp-list--grid" aria-label={`${workspaceLabel(activeKind)}列表`}>
            <AssetUploadTile kind={activeKind} busy={controller.uploading === activeKind || batchUpload?.status === 'uploading'} disabled={actionsDisabled} onUpload={(kind, files) => void uploadFiles(kind, files)} />
            {activeItems.map((asset) => (
                <article className={`alp-row${asset.id === selectedId ? ' is-selected' : ''}${selectionMode ? ' is-selecting' : ''}`} key={asset.id}>
                  {selectionMode ? <label className="alp-row-check"><input type="checkbox" checked={selectedIds.has(asset.id)} disabled={actionsDisabled} onChange={() => toggleBatchSelection(asset.id)} aria-label={`选择 ${asset.name}`} /></label> : null}
                  <button type="button" className="alp-row-select" onClick={() => { select(asset.id); setPreviewId(asset.id) }} aria-label={`查看 ${asset.name}`}>
                    <span className="alp-thumbnail" aria-hidden>
                      {asset.kind === 'image' && asset.url ? <img src={asset.url} alt="" /> : <span>{asset.kind === 'font' ? 'Aa' : asset.kind === 'image' ? '图片' : 'BGM'}</span>}
                    </span>
                    <span className="alp-row-copy">
                      <span>{asset.name}</span>
                      <small>{asset.mime ?? kindLabel(asset.kind)}</small>
                    </span>
                  </button>
                  <span className="alp-row-actions">
                    <button type="button" disabled={actionsDisabled} onClick={() => beginRename(asset)} aria-label={`重命名 ${asset.name}`}>改名</button>
                    <button type="button" className="is-danger" disabled={actionsDisabled} onClick={(event) => { deleteRef.current = asset; setPendingDelete(asset); event.currentTarget.focus() }} aria-label={`删除 ${asset.name}`}>删除</button>
                  </span>
                </article>
              ))
            }
          </div>
          {controller.loading ? <div className="alp-loading" role="status">正在加载资产…</div> : null}
        </section>
      </div>
      {previewAsset ? (
        <div className="alp-dialog-backdrop" role="presentation">
          <div className="alp-dialog alp-preview-dialog" role="dialog" aria-modal="true" aria-label="资产预览">
            <div className="alp-dialog-head"><span>资产预览</span><button type="button" onClick={() => setPreviewId(null)} aria-label="关闭预览">关闭</button></div>
            {preview(previewAsset)}
          </div>
        </div>
      ) : null}
      {editingId ? (
        <div className="alp-dialog-backdrop" role="presentation">
          <div className="alp-dialog" role="dialog" aria-modal="true" aria-label="重命名资产">
            <label>资产名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div><button type="button" onClick={() => setEditingId(null)}>取消</button><button type="button" onClick={() => void saveRename()} disabled={!name.trim() || controller.mutating}>保存</button></div>
          </div>
        </div>
      ) : null}
      {pendingDelete ? (
        <div className="alp-dialog-backdrop" role="presentation">
          <div className="alp-dialog" role="dialog" aria-modal="true" aria-label="删除资产">
            <p>确定删除“{pendingDelete.name}”？此操作不可撤销。</p>
            <div><button type="button" onClick={() => { setPendingDelete(null); deleteRef.current = null }}>取消</button><button type="button" onClick={() => void confirmDelete()} disabled={controller.mutating}>确认删除</button></div>
          </div>
        </div>
      ) : null}
      {pendingBatchDelete ? (
        <div className="alp-dialog-backdrop" role="presentation">
          <div className="alp-dialog" role="dialog" aria-modal="true" aria-label="批量删除资产">
            <p>确定删除选中的 {selectedIds.size} 项资产？此操作不可撤销。</p>
            <div><button type="button" onClick={() => setPendingBatchDelete(false)} disabled={batchDeleting != null}>取消</button><button type="button" onClick={() => void confirmBatchDelete()} disabled={batchDeleting != null}>确认删除</button></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
