import { useMemo, useState } from 'react'
import { useMediaStore } from '../media/mediaStore'
import type { InventoryItem, Scene, SearchHotspot } from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'
import type { ItemState } from './conditionEval'

/**
 * SearchLayer · 玩家侧「找物」交互层
 * ─────────────────────────────────────────────────────────────────────────
 * 叠在播放舞台之上，把 scene.searchLoot 的热点按归一化坐标摆出来：
 *   - 进入搜索模式后光标变放大镜，热点悬停高亮发光 + 标签提示；
 *   - 点击未拾取的热点 → 拾取动画（道具图标向背包飞入感）+ 回调上层加物品；
 *   - 已拾取的热点不再渲染（由上层 lootedKeys 决定）。
 *
 * 坐标系：x/y/r 均为相对舞台「宽度/高度」的 0~1 归一值，r 以宽度为基准。
 */
export interface SearchLayerProps {
  scene: Scene
  items: Record<string, InventoryItem>
  /** 已拾取的热点 key 集合，key = `${sceneId}:${hotspotId}`。 */
  lootedKeys: ReadonlySet<string>
  /** 搜索模式是否开启（放大镜光标 + 热点可点）。 */
  active: boolean
  /** 点击未拾取热点的回调。 */
  onPickup: (hotspot: SearchHotspot) => void
  /** 仅渲染这些热点 id（搜索段限定本段热点）；缺省 = 全场景热点。 */
  hotspotFilter?: ReadonlySet<string>
}

function HotspotMarker({
  hotspot,
  item,
  picking,
  onClick,
}: {
  hotspot: SearchHotspot
  item: InventoryItem | undefined
  picking: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const iconUrl = useMediaStore((s) =>
    item?.iconMediaId ? s.entries[item.iconMediaId]?.url : undefined,
  )
  const sizePct = Math.max(2, (hotspot.r ?? 0.05) * 100)
  return (
    <button
      type="button"
      className={`ks-srch-spot${hover ? ' is-hover' : ''}${picking ? ' is-picking' : ''}`}
      style={{
        left: `${hotspot.x * 100}%`,
        top: `${hotspot.y * 100}%`,
        width: `${sizePct}%`,
        paddingBottom: `${sizePct}%`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      aria-label={item?.name ?? hotspot.label ?? '可疑之处'}
    >
      <span className="ks-srch-ring" aria-hidden />
      <span className="ks-srch-glint" aria-hidden />
      {picking && iconUrl && (
        <img className="ks-srch-fly" src={iconUrl} alt="" aria-hidden />
      )}
      {(hover || picking) && (
        <span className="ks-srch-tip">{item?.name ?? hotspot.label ?? '搜查'}</span>
      )}
    </button>
  )
}

export function SearchLayer({
  scene,
  items,
  lootedKeys,
  active,
  onPickup,
  hotspotFilter,
}: SearchLayerProps) {
  injectStyleOnce('player-search-layer', CSS)
  const [picking, setPicking] = useState<Set<string>>(new Set())

  const visible = useMemo(
    () =>
      (scene.searchLoot ?? []).filter(
        (h) =>
          !lootedKeys.has(`${scene.id}:${h.id}`) &&
          (!hotspotFilter || hotspotFilter.has(h.id)),
      ),
    [scene.searchLoot, scene.id, lootedKeys, hotspotFilter],
  )

  if (!active || visible.length === 0) return null

  function handlePick(h: SearchHotspot): void {
    if (picking.has(h.id)) return
    setPicking((s) => new Set(s).add(h.id))
    // 等飞入动画播一段再真正落袋，给玩家反馈感。
    window.setTimeout(() => onPickup(h), 460)
  }

  return (
    <div className="ks-srch" aria-hidden={false}>
      {visible.map((h) => (
        <HotspotMarker
          key={h.id}
          hotspot={h}
          item={items[h.itemId]}
          picking={picking.has(h.id)}
          onClick={() => handlePick(h)}
        />
      ))}
    </div>
  )
}

/** 背包 HUD + 搜索模式开关。 */
export function InventoryHUD({
  items,
  owned,
  canSearch,
  searching,
  onToggleSearch,
}: {
  items: Record<string, InventoryItem>
  owned: ItemState
  /** 当前场景是否还有可搜索的热点（决定是否显示放大镜按钮）。 */
  canSearch: boolean
  searching: boolean
  onToggleSearch: () => void
}) {
  injectStyleOnce('player-search-layer', CSS)
  const ownedList = useMemo(
    () =>
      Object.entries(owned)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ item: items[id], count: n, id }))
        .filter((x) => x.item),
    [owned, items],
  )

  if (ownedList.length === 0 && !canSearch) return null

  return (
    <div className="ks-inv-hud">
      {canSearch && (
        <button
          type="button"
          className={`ks-inv-search-btn${searching ? ' is-on' : ''}`}
          onClick={onToggleSearch}
          title={searching ? '退出搜查' : '搜查现场'}
        >
          <span aria-hidden>🔍</span>
          {searching ? '搜查中' : '搜查'}
        </button>
      )}
      {ownedList.length > 0 && (
        <div className="ks-inv-bar">
          {ownedList.map(({ item, count, id }) => (
            <InvSlot key={id} item={item!} count={count} />
          ))}
        </div>
      )}
    </div>
  )
}

function InvSlot({ item, count }: { item: InventoryItem; count: number }) {
  const [hover, setHover] = useState(false)
  const url = useMediaStore((s) => (item.iconMediaId ? s.entries[item.iconMediaId]?.url : undefined))
  return (
    <div
      className="ks-inv-slot"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {url ? <img src={url} alt={item.name} /> : <span className="ks-inv-ph" aria-hidden>◈</span>}
      {count > 1 && <span className="ks-inv-cnt">{count}</span>}
      {hover && (
        <div className="ks-inv-pop">
          <div className="ks-inv-pop-name">{item.name}</div>
          {item.desc && <div className="ks-inv-pop-desc">{item.desc}</div>}
        </div>
      )}
    </div>
  )
}

const CSS = `
.ks-srch{position:absolute;inset:0;z-index:42;cursor:zoom-in;}
.ks-srch-spot{position:absolute;transform:translate(-50%,-50%);margin:0;padding:0;border:0;
  background:transparent;cursor:zoom-in;border-radius:999px;height:0;}
.ks-srch-ring{position:absolute;inset:0;border-radius:999px;
  box-shadow:0 0 0 1.5px rgba(255,255,255,.18) inset;transition:box-shadow .2s,background .2s;}
.ks-srch-spot.is-hover .ks-srch-ring{
  box-shadow:0 0 0 2px rgba(255,214,120,.9) inset,0 0 26px 6px rgba(255,200,90,.45);
  background:radial-gradient(circle,rgba(255,214,120,.22),transparent 70%);}
.ks-srch-glint{position:absolute;left:50%;top:50%;width:8px;height:8px;transform:translate(-50%,-50%);
  border-radius:999px;background:rgba(255,235,180,.0);transition:.25s;}
.ks-srch-spot.is-hover .ks-srch-glint{background:rgba(255,235,180,.95);
  box-shadow:0 0 14px 5px rgba(255,210,110,.8);}
.ks-srch-tip{position:absolute;left:50%;bottom:108%;transform:translateX(-50%);
  white-space:nowrap;background:rgba(12,12,16,.92);color:#ffe9bd;font-size:12px;
  padding:3px 9px;border-radius:7px;border:1px solid rgba(255,210,120,.4);pointer-events:none;}
.ks-srch-fly{position:absolute;left:50%;top:50%;width:48px;height:48px;object-fit:contain;
  transform:translate(-50%,-50%);animation:ks-srch-fly .46s cubic-bezier(.4,.8,.3,1) forwards;
  filter:drop-shadow(0 4px 12px rgba(0,0,0,.5));}
@keyframes ks-srch-fly{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.4);}
  35%{opacity:1;transform:translate(-50%,-50%) scale(1.15);}
  100%{opacity:0;transform:translate(-50%,-220%) scale(.55);}
}

.ks-inv-hud{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:44;
  display:flex;align-items:center;gap:12px;pointer-events:none;}
.ks-inv-hud>*{pointer-events:auto;}
.ks-inv-search-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;
  padding:7px 14px;border-radius:999px;cursor:pointer;color:#f1e6cf;
  background:rgba(18,18,24,.78);border:1px solid rgba(255,210,120,.35);
  backdrop-filter:blur(8px);transition:.18s;}
.ks-inv-search-btn:hover{border-color:rgba(255,210,120,.7);color:#fff2d6;}
.ks-inv-search-btn.is-on{background:rgba(255,200,90,.92);color:#1a1408;border-color:transparent;
  box-shadow:0 4px 18px rgba(255,190,80,.45);}
.ks-inv-bar{display:flex;gap:8px;padding:7px 10px;border-radius:14px;
  background:rgba(14,14,20,.74);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(8px);}
.ks-inv-slot{position:relative;width:42px;height:42px;border-radius:10px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  display:flex;align-items:center;justify-content:center;}
.ks-inv-slot img{width:90%;height:90%;object-fit:contain;}
.ks-inv-ph{color:rgba(255,255,255,.4);font-size:18px;}
.ks-inv-cnt{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 3px;
  border-radius:8px;background:#ffca5a;color:#1a1408;font-size:11px;font-weight:700;
  display:flex;align-items:center;justify-content:center;}
.ks-inv-pop{position:absolute;left:50%;bottom:120%;transform:translateX(-50%);width:max-content;
  max-width:220px;background:rgba(12,12,16,.95);border:1px solid rgba(255,210,120,.4);
  border-radius:9px;padding:7px 10px;}
.ks-inv-pop-name{color:#ffe9bd;font-size:13px;font-weight:600;}
.ks-inv-pop-desc{color:rgba(255,255,255,.7);font-size:11px;margin-top:3px;line-height:1.45;}
`
