import { useMemo, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { useSceneImageCache } from '../../media/sceneImageCache'
import { blobToDataUrl } from '../../media/assetStore'
import { createImageProvider } from '../../llm/GptImageProvider'
import type { ImageClient, ImageReference } from '../../llm/types'
import { generateItemIcon } from './itemArt'
import { getAuthoringHint } from '../../llm/visualStylePresets'
import type { InventoryItem, Scene, SearchHotspot } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * InventoryEditor —— 背包系统的作者工作台。
 *
 * 三栏：
 *   1. 物品列表（CRUD / 选中）
 *   2. 物品详情（名称 / 描述 / 关联参考道具 / 图标提示词 / 一键生成透明图标 + 预览）
 *   3. 场景搜寻热点（选场景 → 在画面上点击放置「可拾取」热点，关联当前选中物品）
 */
export function InventoryEditor() {
  const items = useScenarioStore((s) => s.scenario.items)
  const upsertItem = useScenarioStore((s) => s.upsertItem)
  const removeItem = useScenarioStore((s) => s.removeItem)
  const itemList = useMemo(() => Object.values(items ?? {}), [items])
  const [selectedId, setSelectedId] = useState<string | null>(itemList[0]?.id ?? null)
  const selected = selectedId ? items?.[selectedId] : undefined

  function addItem(): void {
    const n = itemList.length + 1
    const id = `item_${Date.now().toString(36)}`
    upsertItem({ id, name: `道具${n}` })
    setSelectedId(id)
  }

  return (
    <div className="ks-inv-root">
      {/* 物品列表 */}
      <aside className="ks-inv-list">
        <div className="ks-inv-list-head">
          <span>物品</span>
          <button type="button" className="ks-inv-add" onClick={addItem}>
            ＋
          </button>
        </div>
        {itemList.length === 0 ? (
          <div className="ks-inv-empty">还没有物品 · 点 ＋ 新建</div>
        ) : (
          <ul className="ks-inv-ul">
            {itemList.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className={`ks-inv-li${selectedId === it.id ? ' is-sel' : ''}`}
                  onClick={() => setSelectedId(it.id)}
                >
                  <ItemIcon item={it} size={24} />
                  <span className="ks-inv-li-name">{it.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* 物品详情 */}
      <section className="ks-inv-detail">
        {selected ? (
          <ItemDetail
            key={selected.id}
            item={selected}
            onChange={(patch) => upsertItem({ ...selected, ...patch })}
            onRemove={() => {
              removeItem(selected.id)
              setSelectedId(null)
            }}
          />
        ) : (
          <div className="ks-inv-empty">选择或新建一个物品</div>
        )}
      </section>

      {/* 场景搜寻热点 */}
      <section className="ks-inv-loot">
        <SceneLootPanel selectedItem={selected} />
      </section>
    </div>
  )
}

function ItemIcon({ item, size }: { item: InventoryItem; size: number }) {
  const url = useMediaStore((s) => (item.iconMediaId ? s.entries[item.iconMediaId]?.url : undefined))
  if (url) {
    return (
      <img
        className="ks-inv-icon"
        src={url}
        alt={item.name}
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <span className="ks-inv-icon ks-inv-icon-ph" style={{ width: size, height: size }} aria-hidden>
      ◍
    </span>
  )
}

function ItemDetail({
  item,
  onChange,
  onRemove,
}: {
  item: InventoryItem
  onChange: (patch: Partial<InventoryItem>) => void
  onRemove: () => void
}) {
  const props = useScenarioStore((s) => s.scenario.props)
  const propList = useMemo(() => Object.values(props ?? {}), [props])
  const synopsis = useScenarioStore((s) => s.scenario.synopsis)
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const client = useMemo<ImageClient>(() => createImageProvider(), [])
  const refIds = item.iconRefMediaIds ?? []

  async function genIcon(): Promise<void> {
    setBusy(true)
    setErr(null)
    try {
      const prop = item.propId ? props?.[item.propId] : undefined
      const referenceImages: ImageReference[] = []
      // 1) 关联参考道具的外观锚点
      if (prop?.refImageId) {
        const ref = await mediaToRef(prop.refImageId, `参考道具 · ${prop.name}`)
        if (ref) referenceImages.push(ref)
      }
      // 2) 从素材库挑选的参考图
      for (const mid of refIds) {
        const ref = await mediaToRef(mid, '素材库参考图')
        if (ref) referenceImages.push(ref)
      }
      const mediaId = await generateItemIcon({
        item,
        client,
        propPrompt: prop?.prompt,
        world: {
          worldSynopsis: synopsis,
          styleHint: getAuthoringHint(visualStyle) || undefined,
        },
        referenceImages: referenceImages.length ? referenceImages : undefined,
      })
      onChange({ iconMediaId: mediaId })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图标生成失败')
    } finally {
      setBusy(false)
    }
  }

  function addRef(mid: string): void {
    if (refIds.includes(mid)) return
    onChange({ iconRefMediaIds: [...refIds, mid] })
  }
  function removeRef(mid: string): void {
    const next = refIds.filter((x) => x !== mid)
    onChange({ iconRefMediaIds: next.length ? next : undefined })
  }

  return (
    <div className="ks-inv-detail-scroll">
      <div className="ks-inv-detail-head">
        <ItemIcon item={item} size={64} />
        <div className="ks-inv-detail-headfields">
          <input
            className="ks-inv-input ks-inv-name"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="物品名"
          />
          <button type="button" className="ks-inv-del" onClick={onRemove} title="删除物品">
            删除物品
          </button>
        </div>
      </div>

      <label className="ks-inv-field">
        <span>描述（给玩家看 / 给生成参考）</span>
        <textarea
          className="ks-inv-input"
          rows={2}
          value={item.desc ?? ''}
          onChange={(e) => onChange({ desc: e.target.value || undefined })}
          placeholder="如：一把生锈的黄铜钥匙，齿纹独特"
        />
      </label>

      <label className="ks-inv-field">
        <span>关联参考道具（复用外观生成图标）</span>
        <select
          className="ks-inv-input"
          value={item.propId ?? ''}
          onChange={(e) => onChange({ propId: e.target.value || undefined })}
        >
          <option value="">—— 不关联（仅用提示词） ——</option>
          {propList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ks-inv-field">
        <span>图标提示词（留空则用描述 / 关联道具）</span>
        <textarea
          className="ks-inv-input"
          rows={2}
          value={item.iconPrompt ?? ''}
          onChange={(e) => onChange({ iconPrompt: e.target.value || undefined })}
          placeholder="如：rusty brass key, ornate bow, weathered metal"
        />
      </label>

      <div className="ks-inv-field">
        <span>素材库参考图（图生图锚点，可多张）</span>
        <div className="ks-inv-refrow">
          {refIds.map((mid) => (
            <RefThumb key={mid} mediaId={mid} onRemove={() => removeRef(mid)} />
          ))}
          <button
            type="button"
            className="ks-inv-refadd"
            onClick={() => setPickerOpen(true)}
            title="从素材库挑选参考图"
          >
            ＋ 从素材库
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

      <div className="ks-inv-genrow">
        <button type="button" className="ks-inv-genbtn" onClick={genIcon} disabled={busy}>
          {busy ? '生成中…（生图→抠图透明底）' : item.iconMediaId ? '↻ 重新生成图标' : '✦ 生成透明图标'}
        </button>
        {item.iconMediaId && (
          <button
            type="button"
            className="ks-inv-clearicon"
            onClick={() => onChange({ iconMediaId: undefined })}
            disabled={busy}
            title="清除图标"
          >
            清除
          </button>
        )}
      </div>
      {err && <div className="ks-inv-err">⚠ {err}</div>}
    </div>
  )
}

/** 已选参考图缩略图（带移除）。 */
function RefThumb({ mediaId, onRemove }: { mediaId: string; onRemove: () => void }) {
  const url = useMediaStore((s) => s.entries[mediaId]?.url)
  return (
    <div className="ks-inv-refthumb" title="点 ✕ 移除该参考图">
      {url ? <img src={url} alt="参考图" draggable={false} /> : <span aria-hidden>?</span>}
      <button type="button" className="ks-inv-refdel" onClick={onRemove} aria-label="移除">
        ✕
      </button>
    </div>
  )
}

/** 素材库图片挑选弹层 —— 列出 mediaStore 里的所有图片条目供选择。 */
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
    <div className="ks-inv-picker-mask" onClick={onClose}>
      <div className="ks-inv-picker" onClick={(e) => e.stopPropagation()}>
        <div className="ks-inv-picker-head">
          <span>素材库 · 选一张参考图</span>
          <button type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {images.length === 0 ? (
          <div className="ks-inv-empty">素材库还没有图片素材</div>
        ) : (
          <div className="ks-inv-picker-grid">
            {images.map((e) => (
              <button
                key={e.id}
                type="button"
                className="ks-inv-picker-cell"
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

function SceneLootPanel({ selectedItem }: { selectedItem: InventoryItem | undefined }) {
  const scenes = useScenarioStore((s) => s.scenario.scenes)
  const sceneList = useMemo(() => Object.values(scenes), [scenes])
  const [sceneId, setSceneId] = useState<string>(sceneList[0]?.id ?? '')
  const scene = scenes[sceneId]

  return (
    <div className="ks-inv-loot-inner">
      <div className="ks-inv-loot-head">场景搜寻热点</div>
      <select
        className="ks-inv-input"
        value={sceneId}
        onChange={(e) => setSceneId(e.target.value)}
      >
        {sceneList.length === 0 ? (
          <option value="">—— 还没有场景 ——</option>
        ) : (
          sceneList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.id}
            </option>
          ))
        )}
      </select>
      {scene ? (
        <SceneLootCanvas scene={scene} selectedItem={selectedItem} />
      ) : (
        <div className="ks-inv-empty">先选择一个场景</div>
      )}
    </div>
  )
}

function SceneLootCanvas({
  scene,
  selectedItem,
}: {
  scene: Scene
  selectedItem: InventoryItem | undefined
}) {
  const updateScene = useScenarioStore((s) => s.updateScene)
  const items = useScenarioStore((s) => s.scenario.items)
  const bgUrl = useSceneBackground(scene)
  const loot = scene.searchLoot ?? []

  function addHotspot(x: number, y: number): void {
    if (!selectedItem) return
    const hs: SearchHotspot = {
      id: `loot_${Date.now().toString(36)}`,
      itemId: selectedItem.id,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    }
    updateScene(scene.id, { searchLoot: [...loot, hs] })
  }

  function removeHotspot(id: string): void {
    const next = loot.filter((h) => h.id !== id)
    updateScene(scene.id, { searchLoot: next.length ? next : undefined })
  }

  return (
    <div className="ks-inv-loot-canvaswrap">
      <div
        className="ks-inv-loot-canvas"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          addHotspot((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
        }}
        title={selectedItem ? `点击放置「${selectedItem.name}」搜寻点` : '先在左侧选中一个物品再点击放置'}
      >
        {bgUrl ? (
          <img className="ks-inv-loot-bg" src={bgUrl} alt={scene.title} draggable={false} />
        ) : (
          <div className="ks-inv-loot-bgph">该场景暂无画面（生成场景图后可视化放置更准）</div>
        )}
        {loot.map((h) => {
          const it = items?.[h.itemId]
          return (
            <button
              key={h.id}
              type="button"
              className="ks-inv-hotspot"
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
              title={`${it?.name ?? h.itemId} · 点击移除`}
              onClick={(e) => {
                e.stopPropagation()
                removeHotspot(h.id)
              }}
            >
              {it?.iconMediaId ? <ItemIcon item={it} size={22} /> : <span aria-hidden>✛</span>}
            </button>
          )
        })}
      </div>
      {!selectedItem && (
        <div className="ks-inv-loot-hint">提示：先在左侧选中物品，再点画面放置搜寻点。</div>
      )}
      {loot.length > 0 && (
        <ul className="ks-inv-loot-list">
          {loot.map((h) => (
            <li key={h.id}>
              <span>{items?.[h.itemId]?.name ?? h.itemId}</span>
              <span className="ks-inv-loot-pos">
                {Math.round(h.x * 100)}% , {Math.round(h.y * 100)}%
              </span>
              <button type="button" onClick={() => removeHotspot(h.id)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 解析场景背景预览 url（图像缓存 → 媒体条目 → 无）。 */
function useSceneBackground(scene: Scene): string | undefined {
  const cacheRecord = useSceneImageCache((s) => s.records[scene.id])
  const mediaUrl = useMediaStore((s) =>
    scene.media.ref ? s.entries[scene.media.ref]?.url : undefined,
  )
  if (cacheRecord?.status === 'ready') return cacheRecord.dataUrl
  return mediaUrl
}

/** 把 mediaStore 里的一个条目转成 ImageReference（fetch url → dataUrl）。 */
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
.ks-inv-root {
  display: flex;
  height: 100%;
  min-height: 0;
}
.ks-inv-list {
  flex: 0 1 180px;
  width: 180px;
  min-width: 132px;
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ks-inv-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-subtle);
}
.ks-inv-add {
  width: 22px; height: 22px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-background-base);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.ks-inv-add:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-inv-ul { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1 1 0; min-height: 0; }
.ks-inv-li {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12.5px;
  text-align: left;
  font-family: inherit;
}
.ks-inv-li:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ks-inv-li.is-sel {
  background: var(--color-interaction-selected-brand);
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}
.ks-inv-li-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-inv-icon { object-fit: contain; border-radius: 6px; flex-shrink: 0; }
.ks-inv-icon-ph {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--color-text-tertiary);
  background: var(--color-background-base);
  border: 1px dashed var(--color-border-subtle);
  font-size: 14px;
}
.ks-inv-detail {
  flex: 1 1 260px;
  min-width: 0;
  border-right: 1px solid var(--color-border-default);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ks-inv-detail-scroll { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ks-inv-detail-head { display: flex; gap: 12px; align-items: flex-start; }
.ks-inv-detail-headfields { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ks-inv-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--color-text-tertiary); }
.ks-inv-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  font-size: 12.5px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  font-family: inherit;
  resize: vertical;
}
.ks-inv-name { font-size: 14px; font-weight: 600; }
.ks-inv-del {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-status-danger, #f87171) 45%, transparent);
  background: transparent;
  color: var(--color-status-danger, #f87171);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.ks-inv-genrow { display: flex; gap: 8px; }
.ks-inv-genbtn {
  flex: 1;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent);
  color: var(--color-brand-primary);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.ks-inv-genbtn:disabled { opacity: 0.6; cursor: default; }
.ks-inv-clearicon {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.ks-inv-err { color: var(--color-status-danger, #f87171); font-size: 12px; }
.ks-inv-refrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ks-inv-refthumb {
  position: relative; width: 52px; height: 52px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--color-border-default); background: var(--color-background-base);
  display: inline-flex; align-items: center; justify-content: center;
}
.ks-inv-refthumb img { width: 100%; height: 100%; object-fit: cover; }
.ks-inv-refdel {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
  border-radius: 50%; border: none; cursor: pointer; font-size: 10px; line-height: 1;
  background: rgba(0,0,0,0.62); color: #fff; display: inline-flex; align-items: center; justify-content: center;
}
.ks-inv-refadd {
  width: 52px; height: 52px; border-radius: 8px;
  border: 1px dashed var(--color-border-default); background: transparent;
  color: var(--color-text-secondary); cursor: pointer; font-size: 10.5px; font-family: inherit;
  padding: 2px; line-height: 1.2;
}
.ks-inv-refadd:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-inv-picker-mask {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.ks-inv-picker {
  width: min(760px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  background: var(--color-background-elevated); border: 1px solid var(--color-border-default);
  border-radius: 12px; overflow: hidden;
}
.ks-inv-picker-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--color-border-subtle);
  font-size: 13px; font-weight: 700; color: var(--color-text-primary);
}
.ks-inv-picker-head button {
  border: none; background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 14px;
}
.ks-inv-picker-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px; padding: 16px; overflow: auto;
}
.ks-inv-picker-cell {
  aspect-ratio: 1; border-radius: 8px; overflow: hidden; padding: 0; cursor: pointer;
  border: 1px solid var(--color-border-subtle); background: var(--color-background-base);
}
.ks-inv-picker-cell:hover { border-color: var(--color-brand-primary); }
.ks-inv-picker-cell img { width: 100%; height: 100%; object-fit: cover; }
.ks-inv-empty {
  padding: 16px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  text-align: center;
}
.ks-inv-loot {
  flex: 0 1 360px;
  width: 360px;
  min-width: 260px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ks-inv-loot-inner { display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow: auto; min-height: 0; }
.ks-inv-loot-head { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.ks-inv-loot-canvaswrap { display: flex; flex-direction: column; gap: 8px; }
.ks-inv-loot-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: #07090e;
  border: 1px solid var(--color-border-default);
  cursor: crosshair;
}
.ks-inv-loot-bg { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.ks-inv-loot-bgph {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 16px; text-align: center;
  color: var(--color-text-tertiary); font-size: 11.5px;
}
.ks-inv-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 30px; height: 30px;
  border-radius: 50%;
  border: 2px solid var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 22%, rgba(0,0,0,0.45));
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(0,0,0,0.25);
  padding: 0;
}
.ks-inv-hotspot:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand-primary) 40%, transparent); }
.ks-inv-loot-hint { font-size: 11px; color: var(--color-text-tertiary); }
.ks-inv-loot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ks-inv-loot-list li {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--color-text-secondary);
  padding: 4px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
}
.ks-inv-loot-list li > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-inv-loot-pos { font-variant-numeric: tabular-nums; color: var(--color-text-tertiary); font-size: 10.5px; }
.ks-inv-loot-list li button {
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 10.5px; font-family: inherit;
}

/* ── 缩放适配（容器查询，锚定 ModuleShell .ks-mod-body 的实际宽度）──────────
   宽：列表 180 | 详情 flex | 热点 360
   中：压缩两侧固定列，给详情让出空间
   窄：三栏纵向堆叠 + 整体纵向滚动，任何宽度都不丢内容 */
@container ksmod (max-width: 920px) {
  .ks-inv-list { flex-basis: 152px; width: 152px; }
  .ks-inv-loot { flex-basis: 296px; width: 296px; min-width: 232px; }
}
@container ksmod (max-width: 660px) {
  .ks-inv-root {
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .ks-inv-list {
    flex: 0 0 auto;
    width: 100%;
    min-width: 0;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--color-border-default);
  }
  .ks-inv-detail {
    flex: 0 0 auto;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-default);
    overflow: visible;
  }
  /* 堆叠后由 .ks-inv-root 统一纵向滚动，内层不再各自抢滚动条 */
  .ks-inv-detail-scroll { overflow: visible; }
  .ks-inv-loot {
    flex: 0 0 auto;
    width: 100%;
    min-width: 0;
    overflow: visible;
  }
  .ks-inv-loot-inner { overflow: visible; }
  /* 窄屏热点画布别撑太高，给下方列表留出可视空间 */
  .ks-inv-loot-canvas { max-width: 520px; }
}
`
injectStyleOnce('inventory-editor', css)
