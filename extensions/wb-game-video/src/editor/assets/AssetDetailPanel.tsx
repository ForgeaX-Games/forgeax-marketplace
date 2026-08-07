import { useRef } from 'react'
import { previewAsset, type BrowserAsset, typeLabel } from './AssetLibraryPanel'
import { ProjectComponentPreview } from './ProjectComponentPreview'
import type { ProjectComponentAsset } from './project-component-assets'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif'
const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.m4a,.aac'
const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf'

export function AssetDetailPanel({
  asset,
  component,
  assetName,
  actionsDisabled,
  onAssetNameChange,
  onSaveAssetName,
  onDelete,
  onReupload,
  onGenerate,
  onClose,
}: {
  asset: BrowserAsset | null
  component: ProjectComponentAsset | null
  assetName: string
  actionsDisabled: boolean
  onAssetNameChange: (name: string) => void
  onSaveAssetName: () => void
  onDelete: () => void
  onReupload: (file: File | undefined) => void
  onGenerate: () => void
  onClose: () => void
}): JSX.Element {
  const reuploadInputRef = useRef<HTMLInputElement | null>(null)
  return <aside className="alx-detail" aria-label="资产详情">
    <button type="button" className="alx-detail-close" aria-label="关闭资产详情" onClick={onClose}>×</button>
    {asset || component ? <>
      <div className="alx-detail-preview">{component ? <ProjectComponentPreview component={component} variant="detail" /> : previewAsset(asset)}</div>
      <div className="alx-detail-actions">
        <button type="button" onClick={onGenerate}>生成</button>
        {asset ? <>
          <button type="button" disabled={asset.readOnly || actionsDisabled} onClick={onDelete}>删除</button>
          <button type="button" disabled={asset.readOnly || asset.kind === 'video' || actionsDisabled} onClick={() => reuploadInputRef.current?.click()}>重新上传</button>
          <input ref={reuploadInputRef} type="file" hidden accept={asset.kind === 'image' ? IMAGE_ACCEPT : asset.kind === 'audio' ? AUDIO_ACCEPT : FONT_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onReupload(file) }} />
        </> : <p className="alx-detail-readonly">项目控件为只读资产。</p>}
      </div>
      <section className="alx-detail-fields">
        <h2>资产信息</h2>
        <label><span>属性</span><strong>{component ? '控件' : typeLabel(asset!.kind)}</strong></label>
        <label><span>命名</span><input value={component ? component.manifest.label ?? component.componentId : assetName} disabled={component != null || asset!.readOnly || actionsDisabled} onChange={(event) => onAssetNameChange(event.target.value)} onBlur={onSaveAssetName} /></label>
        <label><span>说明</span><textarea value="资产说明将在资源服务接入后保存。" readOnly /></label>
      </section>
    </> : <div className="alx-detail-empty"><span aria-hidden>◇</span><strong>选择一个资产</strong><p>在中间列表中选择资产以查看信息和操作。</p></div>}
  </aside>
}
