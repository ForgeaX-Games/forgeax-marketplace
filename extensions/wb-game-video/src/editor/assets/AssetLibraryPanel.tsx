import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { AssetLibraryController, ManagedAsset, ManagedAssetKind } from './assetLibraryClient'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif'
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.m4a,.aac'
const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf'

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
  onUpload: (kind: ManagedAssetKind, file: File) => void
}): JSX.Element {
  const accept = kind === 'image' ? IMAGE_ACCEPT : kind === 'audio' ? AUDIO_ACCEPT : FONT_ACCEPT
  const label = kind === 'image' ? '上传图片' : kind === 'audio' ? '上传 BGM' : '上传字体'
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onUpload(kind, file)
  }
  return (
    <label className="alp-upload-tile" aria-disabled={disabled || busy}>
      <span className="alp-upload-tile-plus" aria-hidden>+</span>
      <span>{busy ? '上传中…' : label}</span>
      <input type="file" accept={accept} aria-label={label} disabled={disabled || busy} onChange={onChange} />
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
  const actionsDisabled = !controller.available || controller.mutating || controller.uploading != null

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
          </header>
          {!controller.available ? <div className="alp-unavailable" role="status">图片、BGM 与字体资源 API 尚未启用。</div> : null}
          {controller.error ? <div className="alp-error" role="alert">{controller.error}</div> : null}
          <div className="alp-list alp-list--grid" aria-label={`${workspaceLabel(activeKind)}列表`}>
            <AssetUploadTile kind={activeKind} busy={controller.uploading === activeKind} disabled={actionsDisabled} onUpload={(kind, file) => void controller.upload(kind, file)} />
            {activeItems.map((asset) => (
                <article className={`alp-row${asset.id === selectedId ? ' is-selected' : ''}`} key={asset.id}>
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
    </div>
  )
}
