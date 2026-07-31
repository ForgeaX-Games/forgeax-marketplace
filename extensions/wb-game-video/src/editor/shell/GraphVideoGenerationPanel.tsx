import { useState, type ChangeEvent } from 'react'
import {
  deleteReferenceImage,
  gvaImageUrl,
  uploadReferenceImage,
  type ImageReferenceType,
} from '../assets/image-assets'
import type { MediaAsset, StyleAxes } from '../assets/registry-types'

const ART_MEDIA_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['photoreal', '写实'], ['anime', '日系动画'], ['cartoon', '卡通'],
  ['pixelart', '像素'], ['watercolor', '水彩'], ['ink', '水墨'], ['render3d2d', '3D转2D'],
]
const FILM_LOOK_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['teal-orange', '蒂尔橙'], ['noir-lowkey', '黑色低调'], ['warm-nostalgia', '暖怀旧'],
  ['bleach-bypass', '漂白'], ['clinical-scifi', '冷科幻'], ['morandi-muted', '莫兰迪'],
  ['bronze-epic', '青铜史诗'], ['retro-future', '复古未来'], ['baroque-chiaroscuro', '巴洛克明暗'],
  ['pastel-symmetry', '粉彩对称'],
]
const DIRECTOR_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['minimal-epic', '极简史诗'], ['precision-noir', '克制黑色'],
  ['foreknowledge-suspense', '预知悬疑'], ['mood-neon', '情绪霓虹'], ['luminous-anime', '通透动画'],
  ['kinetic-clarity', '动感清晰'], ['cyberpunk-neonoir', '赛博霓虹黑'], ['unseen-horror', '未见恐怖'],
  ['nonlinear-scifi', '非线性科幻'], ['pulp-dialogue', '话痨黑色'],
]

interface GraphVideoGenerationPanelProps {
  game: string
  enabled: boolean
  prompt: string
  styleAxes: StyleAxes
  characterRefs: MediaAsset[]
  sceneRefs: MediaAsset[]
  generationBusy: boolean
  generationError: string | null
  onPromptChange: (prompt: string) => void
  onStyleAxisChange: (axis: keyof StyleAxes, value: string) => void
  onImportRefs: (kind: 'character' | 'scene') => Promise<void>
  onAssetsChanged: () => Promise<void>
  onAssetDeleted: (assetId: string) => void
  onGenerateVideo: () => Promise<void>
  onGenerateStoryboard: () => Promise<void>
}

export function GraphVideoGenerationPanel({
  game,
  enabled,
  prompt,
  styleAxes,
  characterRefs,
  sceneRefs,
  generationBusy,
  generationError,
  onPromptChange,
  onStyleAxisChange,
  onImportRefs,
  onAssetsChanged,
  onAssetDeleted,
  onGenerateVideo,
  onGenerateStoryboard,
}: GraphVideoGenerationPanelProps): JSX.Element {
  const [imageUpload, setImageUpload] = useState<{
    kind: ImageReferenceType
    progress: number
  } | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)

  async function uploadImageReference(
    kind: ImageReferenceType,
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || imageUpload) return
    setImageUploadError(null)
    setImageUpload({ kind, progress: 0 })
    try {
      await uploadReferenceImage(file, kind, (progress) => {
        setImageUpload((current) => current?.kind === kind ? { kind, progress } : current)
      })
      await onAssetsChanged()
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : '图片上传失败')
    } finally {
      setImageUpload(null)
    }
  }

  async function deleteImageReference(asset: MediaAsset): Promise<void> {
    if (deletingImageId || asset.meta?.upload !== true) return
    if (!window.confirm(`确定删除图片「${asset.label ?? asset.id}」？此操作不可撤销。`)) return
    setImageUploadError(null)
    setDeletingImageId(asset.id)
    try {
      await deleteReferenceImage(asset.id)
      onAssetDeleted(asset.id)
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : '图片删除失败')
    } finally {
      setDeletingImageId(null)
    }
  }

  return (
    <div className="gvv-config-panels">
      <label className="gc-prompt">
        <span>提示词</span>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          disabled={!enabled}
          placeholder="写给视频生成模型的镜头、动作、氛围提示词"
        />
        <div className="gvv-axes" role="group" aria-label="风格三轴">
          <label>
            <span>渲染媒介</span>
            <select value={styleAxes.artMedia ?? ''} onChange={(event) => onStyleAxisChange('artMedia', event.target.value)}>
              {ART_MEDIA_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>导演流派</span>
            <select value={styleAxes.director ?? ''} onChange={(event) => onStyleAxisChange('director', event.target.value)}>
              {DIRECTOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>电影调色</span>
            <select value={styleAxes.filmLook ?? ''} onChange={(event) => onStyleAxisChange('filmLook', event.target.value)}>
              {FILM_LOOK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="gvv-gen">
          <div className="gvv-gen-row">
            <button
              type="button"
              disabled={!enabled || generationBusy}
              onClick={() => void onGenerateVideo()}
            >
              {generationBusy ? '生成中…' : '▶ 生成视频'}
            </button>
            <button
              type="button"
              className="gvv-gen-alt"
              disabled={!enabled || generationBusy}
              title="生成 6 面板黑白 previs 故事板（分镜图分支，落素材层）"
              onClick={() => void onGenerateStoryboard()}
            >
              ▦ 分镜故事板
            </button>
          </div>
          {generationError ? <span className="gvv-gen-hint is-error">{generationError}</span> : null}
        </div>
      </label>
      <section className="gvv-reference-panel" aria-label="图片参考">
        <span>图片参考</span>
        <div className="gvv-toolseg" role="group" aria-label="导入参考图">
          <button type="button" onClick={() => void onImportRefs('character')} disabled={generationBusy}>
            导入角色图 ({characterRefs.length})
          </button>
          <button type="button" onClick={() => void onImportRefs('scene')} disabled={generationBusy}>
            导入场景图 ({sceneRefs.length})
          </button>
        </div>
        <div className="gvv-image-upload" role="group" aria-label="上传图片参考">
          <label>
            <span>上传角色图</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={imageUpload !== null}
              onChange={(event) => void uploadImageReference('character', event)}
            />
          </label>
          <label>
            <span>上传场景图</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={imageUpload !== null}
              onChange={(event) => void uploadImageReference('scene', event)}
            />
          </label>
        </div>
        {imageUpload ? (
          <span className="gvv-gen-hint">上传{imageUpload.kind === 'character' ? '角色图' : '场景图'} {imageUpload.progress}%</span>
        ) : null}
        {imageUploadError ? <span className="gvv-gen-hint is-error">{imageUploadError}</span> : null}
        <div className="gvv-reference-thumbs" aria-label="已上传图片参考">
          {[...characterRefs, ...sceneRefs].filter((asset) => asset.status === 'ready').map((asset) => (
            <div key={asset.id} className="gvv-reference-thumb">
              <img
                src={gvaImageUrl(asset.id, asset.updatedAt)}
                alt={asset.label ?? asset.id}
                title={`${asset.productionType === 'character_ref' ? '角色' : '场景'} · ${asset.label ?? asset.id}`}
              />
              {asset.meta?.upload === true ? (
                <button
                  type="button"
                  aria-label={`删除图片 ${asset.label ?? asset.id}`}
                  title="删除上传图片"
                  disabled={deletingImageId !== null}
                  onClick={() => void deleteImageReference(asset)}
                >
                  {deletingImageId === asset.id ? '…' : '×'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <span className="gvv-gen-hint">
          参考图：角色 {characterRefs.length} · 场景 {sceneRefs.length}（视频生成必传各 ≥1；缺则先「导入」）
        </span>
      </section>
    </div>
  )
}
