import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Scenario } from '../scenario/types'
import { useMediaStore } from '../media/mediaStore'
import { anchorRefMediaId, type AnchorRef } from './assetCards'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * AnchorPicker —— 锚点选择器（与「视觉-参考图库」强关联）。
 *
 * 自由卡 / 视频卡用它挑要作为参考图的角色 / 场景 / 道具（每个可再选变体）。
 *   选中的锚点会被解析成其参考图 mediaId 喂给生图/生视频，保证跨镜一致性。
 *
 * v2（2026-06-16 作者反馈「拉片里能看到锚点缩略图、点击放大」）：
 *   - 每个锚点渲染成一张缩略图卡（角色三视图 / 场景基准图 / 道具图）。
 *   - 点缩略图 → 全屏灯箱放大查看（ESC / 点空白关闭），点右下名称行选用/取消。
 *   - 选中态 = 琥珀描边 + ✓；选中且有变体时下方出现变体下拉，缩略图随变体切换。
 *   - 无参考图的锚点显示「无图」占位，点占位=选用（仅文字 prompt 影响）。
 */
export function AnchorPicker({
  scenario,
  value,
  onChange,
}: {
  scenario: Scenario
  value: AnchorRef[]
  onChange: (next: AnchorRef[]) => void
}) {
  const entries = useMediaStore((s) => s.entries)
  // 灯箱：点缩略图放大查看的当前图（null = 关闭）
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)
  // 分组折叠态（角色/场景/道具），默认全折叠 —— 大幅缩短视频卡高度，点头展开。
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const groups = useMemo(
    () => [
      {
        kind: 'character' as const,
        label: '角色',
        items: Object.values(scenario.characters ?? {}).map((c) => ({
          id: c.id,
          name: c.name,
          variants: (c.appearanceVariants ?? []).map((v) => ({ id: v.id, label: v.label })),
        })),
      },
      {
        kind: 'location' as const,
        label: '场景',
        items: Object.values(scenario.locations ?? {}).map((l) => ({
          id: l.id,
          name: l.name,
          variants: (l.angleRefs ?? []).map((v) => ({ id: v.id, label: v.label })),
        })),
      },
      {
        kind: 'prop' as const,
        label: '道具',
        items: Object.values(scenario.props ?? {}).map((p) => ({
          id: p.id,
          name: p.name,
          variants: (p.variants ?? []).map((v) => ({ id: v.id, label: v.label })),
        })),
      },
    ],
    [scenario],
  )

  function find(kind: AnchorRef['kind'], id: string): AnchorRef | undefined {
    return value.find((r) => r.kind === kind && r.id === id)
  }
  function toggle(kind: AnchorRef['kind'], id: string): void {
    if (find(kind, id)) {
      onChange(value.filter((r) => !(r.kind === kind && r.id === id)))
    } else {
      onChange([...value, { kind, id }])
    }
  }
  function setVariant(kind: AnchorRef['kind'], id: string, variantId: string | undefined): void {
    onChange(
      value.map((r) =>
        r.kind === kind && r.id === id ? { ...r, variantId } : r,
      ),
    )
  }

  return (
    <div className="ks-anchorpick">
      {groups.map((g) => {
        const isOpen = !!open[g.kind]
        const selected = value.filter((r) => r.kind === g.kind)
        const selNames = selected
          .map((r) => g.items.find((it) => it.id === r.id)?.name)
          .filter((n): n is string => !!n)
        return (
          <div key={g.kind} className="ks-anchorpick-group">
            <button
              type="button"
              className="ks-anchorpick-ghead"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [g.kind]: !o[g.kind] }))}
              title={isOpen ? '收起' : '展开'}
            >
              <span className="ks-anchorpick-caret" aria-hidden>
                {isOpen ? '▾' : '▸'}
              </span>
              <span className="ks-anchorpick-glabel">{g.label}</span>
              {selected.length > 0 ? (
                <span className="ks-anchorpick-gcount">已选 {selected.length}</span>
              ) : null}
              {!isOpen && selNames.length > 0 ? (
                <span className="ks-anchorpick-chips">
                  {selNames.map((n, i) => (
                    <span key={i} className="ks-anchorpick-chip">
                      {n}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
            {isOpen ? (
              g.items.length === 0 ? (
                <div className="ks-anchorpick-gempty">
                  暂无{g.label}锚点 · 去「参考图库」创建后可在此选用
                </div>
              ) : (
                <div className="ks-anchorpick-cards">
              {g.items.map((it) => {
                const sel = find(g.kind, it.id)
                const isSel = !!sel
                const mid = anchorRefMediaId(scenario, {
                  kind: g.kind,
                  id: it.id,
                  variantId: sel?.variantId,
                })
                const url = mid ? entries[mid]?.url : undefined
                const hasRef = !!url
                return (
                  <div
                    key={it.id}
                    className={`ks-anchorpick-card ${isSel ? 'is-sel' : ''}`}
                  >
                    <div
                      className={`ks-anchorpick-thumb ${hasRef ? 'has-img' : 'no-img'}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        hasRef
                          ? setLightbox({ url: url!, label: it.name })
                          : toggle(g.kind, it.id)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (hasRef) setLightbox({ url: url!, label: it.name })
                          else toggle(g.kind, it.id)
                        }
                      }}
                      title={
                        hasRef
                          ? '点击放大查看 · 点下方名称选用/取消'
                          : '无参考图（仅文字影响）· 点击选用'
                      }
                    >
                      {hasRef ? (
                        <>
                          <img src={url} alt={it.name} draggable={false} loading="lazy" />
                          <span className="ks-anchorpick-zoom" aria-hidden>⤢</span>
                        </>
                      ) : (
                        <span className="ks-anchorpick-noimg ks-mono">无图</span>
                      )}
                      {isSel ? (
                        <span className="ks-anchorpick-check" aria-hidden>✓</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="ks-anchorpick-name"
                      onClick={() => toggle(g.kind, it.id)}
                      title={isSel ? '已选用作参考 · 点击取消' : '点击选用作参考'}
                    >
                      <span
                        className="ks-anchorpick-dot"
                        data-has={hasRef ? '1' : '0'}
                        aria-hidden
                      >
                        {isSel ? (hasRef ? '⬤' : '◯') : '＋'}
                      </span>
                      <span className="ks-anchorpick-nm">{it.name}</span>
                    </button>
                    {isSel && it.variants.length > 0 ? (
                      <select
                        className="ks-anchorpick-variant"
                        value={sel.variantId ?? ''}
                        onChange={(e) => setVariant(g.kind, it.id, e.target.value || undefined)}
                        onClick={(e) => e.stopPropagation()}
                        title="选择变体"
                      >
                        <option value="">{g.kind === 'location' ? '基准' : '主'}</option>
                        {it.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                )
              })}
                </div>
              )
            ) : null}
          </div>
        )
      })}
      {lightbox ? (
        <AnchorLightbox
          url={lightbox.url}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * AnchorLightbox —— 极简全屏放大查看层。
 *   - createPortal 到 body，避免被卡片/面板的 overflow 裁切。
 *   - 点空白 / ✕ / ESC 关闭；图片本体 contain 居中，最大化利用视口。
 */
function AnchorLightbox({
  url,
  label,
  onClose,
}: {
  url: string
  label: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="ks-anchorpick-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} · 放大查看`}
      onClick={onClose}
    >
      <button
        type="button"
        className="ks-anchorpick-lightbox-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭 (ESC)"
      >
        ✕
      </button>
      <figure className="ks-anchorpick-lightbox-fig" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={label} draggable={false} />
        <figcaption className="ks-anchorpick-lightbox-cap ks-cn">{label}</figcaption>
      </figure>
    </div>,
    document.body,
  )
}

const css = `
.ks-anchorpick {
  display: flex; flex-direction: column; gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--ks-border-soft); border-radius: var(--ks-radius-sm, 5px);
  background: var(--ks-panel-elev);
}
.ks-anchorpick-empty { font-size: 10.5px; color: var(--ks-text-faint); }
.ks-anchorpick-gempty {
  flex: 1; min-width: 0; padding-top: 3px;
  font-size: 10px; color: var(--ks-text-faint);
}
.ks-anchorpick-group { display: flex; flex-direction: column; gap: 6px; }
/* 分组折叠头：caret + 分组名 + 已选数 + 折叠态已选 chip */
.ks-anchorpick-ghead {
  all: unset; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 6px;
  min-width: 0; padding: 2px 0;
}
.ks-anchorpick-ghead:focus-visible {
  outline: none; box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.3)); border-radius: 4px;
}
.ks-anchorpick-caret {
  flex: 0 0 auto; width: 12px; text-align: center;
  font-size: 9px; color: var(--ks-text-faint);
}
.ks-anchorpick-ghead:hover .ks-anchorpick-caret,
.ks-anchorpick-ghead:hover .ks-anchorpick-glabel { color: var(--ks-amber); }
.ks-anchorpick-glabel {
  flex: 0 0 auto; font-size: 11px; font-weight: 600; color: var(--ks-text-soft);
  font-family: var(--ks-font-cn, var(--ks-font-ui));
}
.ks-anchorpick-gcount {
  flex: 0 0 auto; font-size: 9px; line-height: 1;
  padding: 2px 6px; border-radius: 999px;
  color: #15110a; background: var(--ks-amber, #d4ff48);
}
.ks-anchorpick-chips {
  flex: 1 1 auto; min-width: 0;
  display: flex; gap: 4px; overflow: hidden; flex-wrap: nowrap;
}
.ks-anchorpick-chip {
  flex: 0 0 auto;
  font-size: 9.5px; line-height: 1; color: var(--ks-text-soft);
  padding: 2px 7px; border-radius: 999px;
  background: var(--ks-panel-solid); border: 1px solid var(--ks-border-soft);
  white-space: nowrap;
}
/* 锚点缩略图卡网格 —— 自适应列, 窄列也能两三个一排 */
.ks-anchorpick-cards {
  flex: 1; min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
}
.ks-anchorpick-card {
  display: flex; flex-direction: column; gap: 3px;
  min-width: 0;
}
/* 缩略图本体: 方形, 有图=可点放大(zoom-in), 无图=占位 */
.ks-anchorpick-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--ks-radius-sm, 6px);
  border: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  outline: none;
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-anchorpick-thumb.has-img { cursor: zoom-in; }
.ks-anchorpick-thumb.no-img { cursor: pointer; }
.ks-anchorpick-thumb > img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.ks-anchorpick-thumb:hover,
.ks-anchorpick-thumb:focus-visible { border-color: var(--ks-amber); }
.ks-anchorpick-card.is-sel .ks-anchorpick-thumb {
  border-color: var(--ks-amber, #d4ff48);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ks-amber, #d4ff48) 35%, transparent);
}
.ks-anchorpick-noimg {
  font-size: 9px; letter-spacing: 0.14em; color: var(--ks-text-faint);
}
/* 放大角标 ⤢ —— hover 时浮现, 提示「点开看大图」 */
.ks-anchorpick-zoom {
  position: absolute; right: 3px; bottom: 3px;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff;
  background: rgba(0,0,0,0.5); border-radius: 4px;
  opacity: 0; transition: opacity var(--ks-dur-fast) var(--ks-ease);
  pointer-events: none;
}
.ks-anchorpick-thumb.has-img:hover .ks-anchorpick-zoom,
.ks-anchorpick-thumb.has-img:focus-visible .ks-anchorpick-zoom { opacity: 1; }
/* 选中 ✓ 角标 */
.ks-anchorpick-check {
  position: absolute; top: 3px; left: 3px;
  width: 15px; height: 15px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; line-height: 1;
  color: var(--color-text-on-bright-primary, #15110a);
  background: var(--ks-amber, #d4ff48); border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
/* 名称行 = 选用/取消按钮 */
.ks-anchorpick-name {
  all: unset; cursor: pointer;
  display: flex; align-items: center; gap: 3px;
  min-width: 0;
  font-size: 10px; color: var(--ks-text-soft);
  transition: color var(--ks-dur-fast) var(--ks-ease);
}
.ks-anchorpick-name:hover { color: var(--ks-amber); }
.ks-anchorpick-card.is-sel .ks-anchorpick-name { color: var(--ks-text); }
.ks-anchorpick-nm {
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-anchorpick-dot { font-size: 8px; flex: 0 0 auto; }
.ks-anchorpick-dot[data-has='1'] { color: var(--ks-amber, #d4ff48); }
.ks-anchorpick-dot[data-has='0'] { color: var(--ks-text-faint); }
.ks-anchorpick-variant {
  width: 100%; box-sizing: border-box;
  font-size: 10px; color: var(--ks-text-soft);
  background: var(--ks-panel-solid); border: 1px solid var(--ks-border-soft);
  border-radius: 4px; padding: 2px 4px;
}

/* ─── 放大灯箱（点缩略图打开）──────────────────────────────── */
.ks-anchorpick-lightbox {
  position: fixed; inset: 0; z-index: 2200;
  display: flex; align-items: center; justify-content: center;
  padding: 40px;
  background: var(--ks-overlay-scrim, rgba(10,10,12,0.82));
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  animation: ks-anchorpick-lb-in 160ms var(--ks-ease, ease);
}
@keyframes ks-anchorpick-lb-in { from { opacity: 0 } to { opacity: 1 } }
.ks-anchorpick-lightbox-fig {
  margin: 0;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  max-width: 100%; max-height: 100%;
}
.ks-anchorpick-lightbox-fig > img {
  max-width: 100%;
  max-height: calc(100vh - 120px);
  object-fit: contain;
  border-radius: var(--ks-radius-md, 10px);
  box-shadow: 0 18px 60px rgba(0,0,0,0.5);
}
.ks-anchorpick-lightbox-cap {
  font-size: 13px; letter-spacing: 0.04em;
  color: #f2f2f2;
}
.ks-anchorpick-lightbox-close {
  position: absolute; top: 20px; right: 24px;
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; cursor: pointer;
  font-size: 15px; color: #f0f0f0;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  transition: background var(--ks-dur-fast) var(--ks-ease);
}
.ks-anchorpick-lightbox-close:hover { background: rgba(255,255,255,0.2); }
`
injectStyleOnce('anchor-picker', css)
