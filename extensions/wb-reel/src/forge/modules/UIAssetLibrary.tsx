import { useMemo, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { blobToDataUrl } from '../../media/assetStore'
import { cutoutToTransparent } from '../../media/cutoutToTransparent'
import { createImageProvider } from '../../llm/providers/GptImageProvider'
import type { ImageClient, ImageReference } from '../../llm/config/types'
import { getAuthoringHint } from '../../llm/config/visualStylePresets'
import type { UIAsset, UIAssetRole, UIBlendMode, UIMatte } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  UI_ROLE_PRESETS,
  generateUIAsset,
  makeUIAsset,
  matteToBlendMode,
  uiBlendModeToCss,
} from './uiAssetArt'
import { generateUISet } from '../../llm/forge/uiCurator'
import { AssetLightbox, type LightboxItem } from '../AssetLightbox'

/** matte 中文标签(下拉用)。 */
const MATTE_LABELS: Record<UIMatte, string> = {
  'screen-black': '纯黑底 · 滤色去背(发光/金色)',
  'multiply-white': '纯白底 · 相乘去背(暗线稿)',
  alpha: '原生透明(仅部分模型)',
  chroma: '洋红底 · 手动抠图',
  opaque: '不去背(整图)',
}

const BLEND_LABELS: Record<UIBlendMode, string> = {
  normal: '正常',
  screen: '滤色 screen',
  multiply: '相乘 multiply',
  overlay: '叠加 overlay',
  'hard-light': '强光 hard-light',
  lighten: '变亮 lighten',
  add: '相加 add',
}

/**
 * UIAssetLibrary —— UI 素材库作者工作台(镜像 InventoryEditor)。
 *
 * 三栏:素材列表(CRUD + 高频类型模板 + AI 生成整套) / 详情(角色·去背·混合·prompt·
 * 参考图·生成·手动抠图) / 实时预览(把素材按 blend 盖到样帧上)。
 *
 * 去背主力 = 图层混合(纯黑+滤色 / 纯白+相乘),chroma 抠图为手动按钮,原生透明预留。
 */
export function UIAssetLibrary() {
  const uiAssets = useScenarioStore((s) => s.scenario.uiAssets)
  const upsertUIAsset = useScenarioStore((s) => s.upsertUIAsset)
  const updateUIAsset = useScenarioStore((s) => s.updateUIAsset)
  const removeUIAsset = useScenarioStore((s) => s.removeUIAsset)
  const list = useMemo(() => Object.values(uiAssets ?? {}), [uiAssets])
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null)
  const selected = selectedId ? uiAssets?.[selectedId] : undefined
  const [tplOpen, setTplOpen] = useState(false)

  const synopsis = useScenarioStore((s) => s.scenario.synopsis)
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)
  const filmLook = useScenarioStore((s) => s.scenario.filmLook)
  const uiStylePrompt = useScenarioStore((s) => s.scenario.uiStyle?.prompt)
  const characters = useScenarioStore((s) => s.scenario.characters)
  const variables = useScenarioStore((s) => s.scenario.variables)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoErr, setAutoErr] = useState<string | null>(null)

  function addRole(role: UIAssetRole): void {
    const id = `ui_${Date.now().toString(36)}`
    upsertUIAsset(makeUIAsset({ id, role }))
    setSelectedId(id)
    setTplOpen(false)
  }

  async function autoGenerate(): Promise<void> {
    setAutoBusy(true)
    setAutoErr(null)
    try {
      const assets = await generateUISet({
        synopsis,
        visualStyle,
        filmLook,
        uiStylePrompt,
        characters: Object.values(characters ?? {}).map((c) => c.name),
        variables: Object.values(variables ?? {}).map((v) => ({
          id: v.id,
          name: v.name,
          kind: v.kind,
        })),
      })
      let firstId: string | null = null
      for (const a of assets) {
        upsertUIAsset(a)
        if (!firstId) firstId = a.id
      }
      if (firstId) setSelectedId(firstId)
    } catch (e) {
      setAutoErr(e instanceof Error ? e.message : 'AI 生成整套失败')
    } finally {
      setAutoBusy(false)
    }
  }

  return (
    <div className="ks-uilib-root">
      <aside className="ks-uilib-list">
        <div className="ks-uilib-list-head">
          <span>UI 素材</span>
          <div className="ks-uilib-headbtns">
            <button
              type="button"
              className="ks-uilib-add"
              onClick={() => setTplOpen((v) => !v)}
              title="按高频类型新建"
            >
              ＋
            </button>
          </div>
        </div>

        {tplOpen && (
          <div className="ks-uilib-tpl">
            {(Object.keys(UI_ROLE_PRESETS) as UIAssetRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className="ks-uilib-tpl-item"
                onClick={() => addRole(role)}
              >
                {UI_ROLE_PRESETS[role].label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="ks-uilib-auto"
          onClick={() => void autoGenerate()}
          disabled={autoBusy}
          title="按当前剧本 + 视觉风格自动产出一套 UI 素材(含提示词，随后可逐个生图)"
        >
          {autoBusy ? '生成中…' : '✦ AI 生成整套'}
        </button>
        {autoErr && <div className="ks-uilib-err ks-uilib-autoerr">⚠ {autoErr}</div>}

        {list.length === 0 ? (
          <div className="ks-uilib-empty">还没有 UI 素材 · 点 ＋ 选类型，或「AI 生成整套」</div>
        ) : (
          <ul className="ks-uilib-ul">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`ks-uilib-li${selectedId === a.id ? ' is-sel' : ''}`}
                  onClick={() => setSelectedId(a.id)}
                >
                  <AssetThumb asset={a} size={28} />
                  <span className="ks-uilib-li-body">
                    <span className="ks-uilib-li-name">{a.name}</span>
                    <span className="ks-uilib-li-role">{UI_ROLE_PRESETS[a.role]?.label ?? a.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="ks-uilib-detail">
        {selected ? (
          <AssetDetail
            key={selected.id}
            asset={selected}
            onChange={(patch) => updateUIAsset(selected.id, patch)}
            onRemove={() => {
              removeUIAsset(selected.id)
              setSelectedId(null)
            }}
            ctx={{
              synopsis,
              styleHint: getAuthoringHint(visualStyle, filmLook) || undefined,
              uiStylePrompt,
            }}
          />
        ) : (
          <div className="ks-uilib-empty">选择或新建一个 UI 素材</div>
        )}
      </section>

      <section className="ks-uilib-preview">
        <PreviewPanel assets={list} selectedId={selectedId} onSelect={setSelectedId} />
      </section>
    </div>
  )
}

/** 素材缩略图 —— 有图按 blend 盖到棋盘格上,无图占位。 */
function AssetThumb({ asset, size }: { asset: UIAsset; size: number }) {
  const url = useMediaStore((s) => (asset.mediaId ? s.entries[asset.mediaId]?.url : undefined))
  if (url) {
    return (
      <span className="ks-uilib-thumb ks-uilib-thumb-checker" style={{ width: size, height: size }}>
        <img
          src={url}
          alt={asset.name}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: uiBlendModeToCss(asset.blendMode) as React.CSSProperties['mixBlendMode'] }}
        />
      </span>
    )
  }
  return (
    <span className="ks-uilib-thumb ks-uilib-thumb-ph" style={{ width: size, height: size }} aria-hidden>
      ◱
    </span>
  )
}

function AssetDetail({
  asset,
  onChange,
  onRemove,
  ctx,
}: {
  asset: UIAsset
  onChange: (patch: Partial<Omit<UIAsset, 'id'>>) => void
  onRemove: () => void
  ctx: { synopsis?: string; styleHint?: string; uiStylePrompt?: string }
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const client = useMemo<ImageClient>(() => createImageProvider(), [])
  const refIds = asset.refMediaIds ?? []
  const mediaUrl = useMediaStore((s) => (asset.mediaId ? s.entries[asset.mediaId]?.url : undefined))

  /** 编辑器(AssetLightbox)保存 → 落一张新图入库并指向它。 */
  function saveEdited(_item: LightboxItem, dataUrl: string): void {
    const mediaId = useMediaStore.getState().ingestDataUrl(dataUrl, {
      promptKind: 'ui-asset',
      tags: [`ui:${asset.id}`, `ui-role:${asset.role}`, 'ui-edited'],
      humanReadableName: `${asset.name} · 编辑`,
      mimeType: 'image/png',
    })
    onChange({ mediaId })
  }

  async function gen(): Promise<void> {
    setBusy(true)
    setErr(null)
    try {
      const referenceImages: ImageReference[] = []
      for (const mid of refIds) {
        const ref = await mediaToRef(mid, '素材库参考图')
        if (ref) referenceImages.push(ref)
      }
      const { mediaId, effectiveMatte, effectiveBlendMode } = await generateUIAsset({
        asset,
        client,
        ctx: {
          worldSynopsis: ctx.synopsis,
          styleHint: ctx.styleHint,
          uiStylePrompt: ctx.uiStylePrompt,
        },
        referenceImages: referenceImages.length ? referenceImages : undefined,
      })
      // effectiveMatte 可能因 alpha 回落变化,同步修正 matte/blendMode。
      onChange({ mediaId, matte: effectiveMatte, blendMode: effectiveBlendMode })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  /** 手动抠图去背(洋红/纯色底)→ 透明 PNG,设 matte=chroma/blend=normal。 */
  async function manualCutout(): Promise<void> {
    if (!mediaUrl) return
    setBusy(true)
    setErr(null)
    try {
      const ref = await mediaToRef(asset.mediaId!, asset.name)
      if (!ref) throw new Error('无法读取当前素材图')
      const cut = await cutoutToTransparent(ref.dataUrl)
      const mediaId = useMediaStore.getState().ingestDataUrl(cut, {
        promptKind: 'ui-asset',
        tags: [`ui:${asset.id}`, `ui-role:${asset.role}`, 'ui-cutout'],
        humanReadableName: `${asset.name} · 抠图`,
        mimeType: 'image/png',
      })
      onChange({ mediaId, matte: 'chroma', blendMode: 'normal' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抠图失败')
    } finally {
      setBusy(false)
    }
  }

  function addRef(mid: string): void {
    if (refIds.includes(mid)) return
    onChange({ refMediaIds: [...refIds, mid] })
  }
  function removeRef(mid: string): void {
    const next = refIds.filter((x) => x !== mid)
    onChange({ refMediaIds: next.length ? next : undefined })
  }

  return (
    <div className="ks-uilib-detail-scroll">
      <div className="ks-uilib-detail-head">
        <AssetThumb asset={asset} size={64} />
        <div className="ks-uilib-detail-headfields">
          <input
            className="ks-uilib-input ks-uilib-name"
            value={asset.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="素材名"
          />
          <button type="button" className="ks-uilib-del" onClick={onRemove} title="删除素材">
            删除素材
          </button>
        </div>
      </div>

      <div className="ks-uilib-row2">
        <label className="ks-uilib-field">
          <span>类型(role)</span>
          <select
            className="ks-uilib-input"
            value={asset.role}
            onChange={(e) => onChange({ role: e.target.value as UIAssetRole })}
          >
            {(Object.keys(UI_ROLE_PRESETS) as UIAssetRole[]).map((r) => (
              <option key={r} value={r}>
                {UI_ROLE_PRESETS[r].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ks-uilib-field">
          <span>生命周期</span>
          <select
            className="ks-uilib-input"
            value={asset.lifecycle}
            onChange={(e) => onChange({ lifecycle: e.target.value as UIAsset['lifecycle'] })}
          >
            <option value="transient">瞬时(显示几秒)</option>
            <option value="scene">单场常驻</option>
            <option value="hud">跨场常驻 HUD</option>
          </select>
        </label>
      </div>

      <div className="ks-uilib-row2">
        <label className="ks-uilib-field">
          <span>去背方式(matte)</span>
          <select
            className="ks-uilib-input"
            value={asset.matte}
            onChange={(e) => {
              const matte = e.target.value as UIMatte
              onChange({ matte, blendMode: matteToBlendMode(matte) })
            }}
          >
            {(Object.keys(MATTE_LABELS) as UIMatte[]).map((m) => (
              <option key={m} value={m}>
                {MATTE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="ks-uilib-field">
          <span>叠加混合(blend)</span>
          <select
            className="ks-uilib-input"
            value={asset.blendMode}
            onChange={(e) => onChange({ blendMode: e.target.value as UIBlendMode })}
          >
            {(Object.keys(BLEND_LABELS) as UIBlendMode[]).map((b) => (
              <option key={b} value={b}>
                {BLEND_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="ks-uilib-field">
        <span>提示词 / 内容(留空用类型模板 + 名称)</span>
        <textarea
          className="ks-uilib-input"
          rows={3}
          value={asset.prompt ?? ''}
          onChange={(e) => onChange({ prompt: e.target.value || undefined })}
          placeholder="如：好感度 +5，金色爱心与光粒子；或 主角血条，青色能量填充"
        />
      </label>

      <div className="ks-uilib-field">
        <span>参考图(图生图锚点，可多张)</span>
        <div className="ks-uilib-refrow">
          {refIds.map((mid) => (
            <RefThumb key={mid} mediaId={mid} onRemove={() => removeRef(mid)} />
          ))}
          <button
            type="button"
            className="ks-uilib-refadd"
            onClick={() => setPickerOpen(true)}
            title="从素材库挑选参考图"
          >
            ＋ 素材库
          </button>
        </div>
      </div>

      {pickerOpen && (
        <MediaPicker
          excludeIds={refIds}
          onPick={(mid) => {
            addRef(mid)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="ks-uilib-genrow">
        <button type="button" className="ks-uilib-genbtn" onClick={() => void gen()} disabled={busy}>
          {busy ? '生成中…' : asset.mediaId ? '↻ 重新生成' : '✦ 生成素材图'}
        </button>
        {asset.mediaId && (
          <>
            <button
              type="button"
              className="ks-uilib-secbtn"
              onClick={() => setLightboxOpen(true)}
              disabled={busy}
              title="全屏编辑/标注当前素材图(画笔/打码/箭头/数字/翻转)"
            >
              ✎ 编辑图
            </button>
            <button
              type="button"
              className="ks-uilib-secbtn"
              onClick={() => void manualCutout()}
              disabled={busy}
              title="对当前图做纯色底抠图(手动去背，产出透明 PNG)"
            >
              ✂ 手动抠图
            </button>
            <button
              type="button"
              className="ks-uilib-secbtn"
              onClick={() => onChange({ mediaId: undefined })}
              disabled={busy}
            >
              清除图
            </button>
          </>
        )}
      </div>
      {err && <div className="ks-uilib-err">⚠ {err}</div>}

      {lightboxOpen && asset.mediaId && mediaUrl && (
        <AssetLightbox
          title={`编辑 · ${asset.name}`}
          items={[{ id: asset.id, mediaId: asset.mediaId, url: mediaUrl, kind: 'image' }]}
          index={0}
          onClose={() => setLightboxOpen(false)}
          onNavigate={() => {}}
          onSaveEdited={(item, dataUrl) => saveEdited(item, dataUrl)}
          saveReplaceLabel="保存到该素材"
          saveNewLabel="另存为新图"
        />
      )}
    </div>
  )
}

function RefThumb({ mediaId, onRemove }: { mediaId: string; onRemove: () => void }) {
  const url = useMediaStore((s) => s.entries[mediaId]?.url)
  return (
    <div className="ks-uilib-refthumb" title="点 ✕ 移除该参考图">
      {url ? <img src={url} alt="参考图" draggable={false} /> : <span aria-hidden>?</span>}
      <button type="button" className="ks-uilib-refdel" onClick={onRemove} aria-label="移除">
        ✕
      </button>
    </div>
  )
}

function MediaPicker({
  excludeIds,
  onPick,
  onClose,
}: {
  excludeIds: string[]
  onPick: (mediaId: string) => void
  onClose: () => void
}) {
  const entries = useMediaStore((s) => s.entries)
  const images = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.mimeType.startsWith('image/') && !excludeIds.includes(e.id))
        .sort((a, b) => b.createdAt - a.createdAt),
    [entries, excludeIds],
  )
  return (
    <div className="ks-uilib-picker-mask" onClick={onClose}>
      <div className="ks-uilib-picker" onClick={(e) => e.stopPropagation()}>
        <div className="ks-uilib-picker-head">
          <span>素材库 · 选一张参考图</span>
          <button type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {images.length === 0 ? (
          <div className="ks-uilib-empty">素材库还没有图片素材</div>
        ) : (
          <div className="ks-uilib-picker-grid">
            {images.map((e) => (
              <button
                key={e.id}
                type="button"
                className="ks-uilib-picker-cell"
                onClick={() => onPick(e.id)}
                title={e.name}
              >
                <img src={e.url} alt={e.name} draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 实时预览:样帧背景 + 选中素材按 blend 叠加 + 全部素材卡片(各自 blend 预览)。 */
function PreviewPanel({
  assets,
  selectedId,
  onSelect,
}: {
  assets: UIAsset[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const bgUrl = useAnySceneBackground()
  const selected = assets.find((a) => a.id === selectedId)
  const selUrl = useMediaStore((s) => (selected?.mediaId ? s.entries[selected.mediaId]?.url : undefined))

  return (
    <div className="ks-uilib-preview-inner">
      <div className="ks-uilib-preview-head">叠加预览(按混合模式盖到样帧)</div>
      <div className="ks-uilib-stage">
        {bgUrl ? (
          <img className="ks-uilib-stage-bg" src={bgUrl} alt="样帧" draggable={false} />
        ) : (
          <div className="ks-uilib-stage-bgph">生成任意场景图后，这里显示叠加效果</div>
        )}
        {selected && selUrl && (
          <img
            className="ks-uilib-stage-ov"
            src={selUrl}
            alt={selected.name}
            draggable={false}
            style={{
              left: `${(selected.defaultAnchor?.x ?? 0.5) * 100}%`,
              top: `${(selected.defaultAnchor?.y ?? 0.5) * 100}%`,
              height: `${selected.defaultAnchor?.scale ?? 24}%`,
              mixBlendMode: uiBlendModeToCss(selected.blendMode) as React.CSSProperties['mixBlendMode'],
            }}
          />
        )}
      </div>
      {assets.length > 0 && (
        <div className="ks-uilib-cards">
          {assets.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`ks-uilib-card${a.id === selectedId ? ' is-sel' : ''}`}
              onClick={() => onSelect(a.id)}
            >
              <CardPreview asset={a} bgUrl={bgUrl} />
              <span className="ks-uilib-card-name">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CardPreview({ asset, bgUrl }: { asset: UIAsset; bgUrl: string | undefined }) {
  const url = useMediaStore((s) => (asset.mediaId ? s.entries[asset.mediaId]?.url : undefined))
  return (
    <span className="ks-uilib-card-stage">
      {bgUrl && <img className="ks-uilib-card-bg" src={bgUrl} alt="" draggable={false} />}
      {url ? (
        <img
          className="ks-uilib-card-ov"
          src={url}
          alt={asset.name}
          draggable={false}
          style={{ mixBlendMode: uiBlendModeToCss(asset.blendMode) as React.CSSProperties['mixBlendMode'] }}
        />
      ) : (
        <span className="ks-uilib-card-ph" aria-hidden>◱</span>
      )}
    </span>
  )
}

/** 取任意一个已有场景背景做样帧(图像缓存优先，退到 media 条目)。 */
function useAnySceneBackground(): string | undefined {
  const scenes = useScenarioStore((s) => s.scenario.scenes)
  const entries = useMediaStore((s) => s.entries)
  return useMemo(() => {
    for (const sc of Object.values(scenes ?? {})) {
      const ref = sc.media?.ref
      if (ref && entries[ref]?.url) return entries[ref].url
    }
    return undefined
  }, [scenes, entries])
}

async function mediaToRef(mediaId: string, label: string): Promise<ImageReference | null> {
  const entry = useMediaStore.getState().entries[mediaId]
  if (!entry) return null
  try {
    const resp = await fetch(entry.url)
    const blob = await resp.blob()
    const dataUrl = await blobToDataUrl(blob)
    return { dataUrl, label }
  } catch {
    return null
  }
}

const css = `
.ks-uilib-root { display: flex; height: 100%; min-height: 0; }
.ks-uilib-list {
  flex: 0 1 208px; width: 208px; min-width: 160px;
  border-right: 1px solid var(--color-border-default);
  display: flex; flex-direction: column; min-height: 0;
}
.ks-uilib-list-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border-subtle);
}
.ks-uilib-add {
  width: 22px; height: 22px; border-radius: 6px;
  border: 1px solid var(--color-border-default); background: var(--color-background-base);
  color: var(--color-text-primary); cursor: pointer; font-size: 14px; line-height: 1;
}
.ks-uilib-add:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-uilib-tpl {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.ks-uilib-tpl-item {
  padding: 6px 6px; border-radius: 6px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--color-border-subtle); background: var(--color-background-base);
  color: var(--color-text-secondary); font-family: inherit; text-align: center;
}
.ks-uilib-tpl-item:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-uilib-auto {
  margin: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  color: var(--color-brand-primary); font-size: 12px; font-weight: 700; font-family: inherit;
}
.ks-uilib-auto:disabled { opacity: 0.6; cursor: default; }
.ks-uilib-autoerr { margin: 0 8px 8px; }
.ks-uilib-ul { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1 1 0; min-height: 0; }
.ks-uilib-li {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 12.5px; text-align: left; font-family: inherit;
}
.ks-uilib-li:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ks-uilib-li.is-sel {
  background: var(--color-interaction-selected-brand); color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}
.ks-uilib-li-body { display: flex; flex-direction: column; min-width: 0; }
.ks-uilib-li-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-uilib-li-role { font-size: 10px; color: var(--color-text-tertiary); }
.ks-uilib-thumb { flex-shrink: 0; border-radius: 6px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; }
.ks-uilib-thumb-checker {
  background-color: #1b1e26;
  background-image: linear-gradient(45deg,#2a2e38 25%,transparent 25%),linear-gradient(-45deg,#2a2e38 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2e38 75%),linear-gradient(-45deg,transparent 75%,#2a2e38 75%);
  background-size: 10px 10px; background-position: 0 0,0 5px,5px -5px,-5px 0;
}
.ks-uilib-thumb-ph {
  color: var(--color-text-tertiary); background: var(--color-background-base);
  border: 1px dashed var(--color-border-subtle); font-size: 15px;
}
.ks-uilib-detail { flex: 1 1 300px; min-width: 0; border-right: 1px solid var(--color-border-default); overflow: hidden; display: flex; flex-direction: column; }
.ks-uilib-detail-scroll { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ks-uilib-detail-head { display: flex; gap: 12px; align-items: flex-start; }
.ks-uilib-detail-headfields { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ks-uilib-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ks-uilib-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--color-text-tertiary); }
.ks-uilib-input {
  width: 100%; box-sizing: border-box; padding: 7px 9px; font-size: 12.5px;
  color: var(--color-text-primary); background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle); border-radius: 8px; font-family: inherit; resize: vertical;
}
.ks-uilib-name { font-size: 14px; font-weight: 600; }
.ks-uilib-del {
  align-self: flex-start; padding: 4px 10px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-status-danger, #f87171) 45%, transparent);
  background: transparent; color: var(--color-status-danger, #f87171); font-size: 11px; cursor: pointer; font-family: inherit;
}
.ks-uilib-genrow { display: flex; gap: 8px; flex-wrap: wrap; }
.ks-uilib-genbtn {
  flex: 1; min-width: 120px; padding: 9px 12px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent);
  color: var(--color-brand-primary); font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.ks-uilib-genbtn:disabled { opacity: 0.6; cursor: default; }
.ks-uilib-secbtn {
  padding: 9px 12px; border-radius: 8px; border: 1px solid var(--color-border-default);
  background: transparent; color: var(--color-text-secondary); cursor: pointer; font-size: 12px; font-family: inherit;
}
.ks-uilib-secbtn:disabled { opacity: 0.6; cursor: default; }
.ks-uilib-err { color: var(--color-status-danger, #f87171); font-size: 12px; }
.ks-uilib-refrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ks-uilib-refthumb {
  position: relative; width: 52px; height: 52px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--color-border-default); background: var(--color-background-base);
  display: inline-flex; align-items: center; justify-content: center;
}
.ks-uilib-refthumb img { width: 100%; height: 100%; object-fit: cover; }
.ks-uilib-refdel {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%;
  border: none; cursor: pointer; font-size: 10px; line-height: 1;
  background: rgba(0,0,0,0.62); color: #fff; display: inline-flex; align-items: center; justify-content: center;
}
.ks-uilib-refadd {
  width: 52px; height: 52px; border-radius: 8px; border: 1px dashed var(--color-border-default);
  background: transparent; color: var(--color-text-secondary); cursor: pointer; font-size: 10.5px; font-family: inherit; padding: 2px; line-height: 1.2;
}
.ks-uilib-refadd:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-uilib-picker-mask { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ks-uilib-picker { width: min(760px, 92vw); max-height: 80vh; display: flex; flex-direction: column; background: var(--color-background-elevated); border: 1px solid var(--color-border-default); border-radius: 12px; overflow: hidden; }
.ks-uilib-picker-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--color-border-subtle); font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.ks-uilib-picker-head button { border: none; background: transparent; color: var(--color-text-secondary); cursor: pointer; font-size: 14px; }
.ks-uilib-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; padding: 16px; overflow: auto; }
.ks-uilib-picker-cell { aspect-ratio: 1; border-radius: 8px; overflow: hidden; padding: 0; cursor: pointer; border: 1px solid var(--color-border-subtle); background: var(--color-background-base); }
.ks-uilib-picker-cell:hover { border-color: var(--color-brand-primary); }
.ks-uilib-picker-cell img { width: 100%; height: 100%; object-fit: cover; }
.ks-uilib-empty { padding: 16px; color: var(--color-text-tertiary); font-size: 12px; text-align: center; }
.ks-uilib-preview { flex: 0 1 380px; width: 380px; min-width: 280px; overflow: hidden; display: flex; flex-direction: column; }
.ks-uilib-preview-inner { display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow: auto; min-height: 0; }
.ks-uilib-preview-head { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.ks-uilib-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; background: #07090e; border: 1px solid var(--color-border-default); }
.ks-uilib-stage-bg { width: 100%; height: 100%; object-fit: cover; }
.ks-uilib-stage-bgph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; text-align: center; color: var(--color-text-tertiary); font-size: 11.5px; }
.ks-uilib-stage-ov { position: absolute; transform: translate(-50%, -50%); width: auto; object-fit: contain; pointer-events: none; }
.ks-uilib-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.ks-uilib-card { display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-base); cursor: pointer; font-family: inherit; }
.ks-uilib-card.is-sel { border-color: var(--color-brand-primary); }
.ks-uilib-card-stage { position: relative; width: 100%; aspect-ratio: 16/9; border-radius: 6px; overflow: hidden; background: #07090e; display: block; }
.ks-uilib-card-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ks-uilib-card-ov { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.ks-uilib-card-ph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); font-size: 18px; }
.ks-uilib-card-name { font-size: 10.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }

@container ksmod (max-width: 960px) {
  .ks-uilib-list { flex-basis: 176px; width: 176px; }
  .ks-uilib-preview { flex-basis: 300px; width: 300px; min-width: 240px; }
}
@container ksmod (max-width: 680px) {
  .ks-uilib-root { flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  .ks-uilib-list, .ks-uilib-detail, .ks-uilib-preview { flex: 0 0 auto; width: 100%; min-width: 0; border-right: none; border-bottom: 1px solid var(--color-border-default); }
  .ks-uilib-list { max-height: 240px; }
  .ks-uilib-detail { overflow: visible; }
  .ks-uilib-detail-scroll { overflow: visible; }
  .ks-uilib-preview { overflow: visible; }
  .ks-uilib-preview-inner { overflow: visible; }
}
`
injectStyleOnce('ui-asset-library', css)
