import { useCallback, useEffect, useRef } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * PosterCarousel —— 电影海报 cover-flow 轮播。
 *
 * 共用组件：风格选择器 / UI 选择器 / 小游戏选择器三处复用。
 *   - 中间一张大海报，两侧斜置缩小变暗，3D 透视
 *   - 圆角海报 + 柔和阴影，中间卡带品牌色描边光晕
 *   - 切换方式：左右导航按钮 ‹ › / 键盘 ArrowLeft·ArrowRight / 指针拖拽 / 点击侧卡居中
 *   - 中间卡可点主操作（onPrimary + primaryLabel）
 *   - multiSelect 模式：已入池项右上角打勾角标，主按钮高亮
 *   - 海报有图显示图，无图用 swatch 渐变占位并居中显示 label 大字
 */

export interface PosterItem {
  id: string
  label: string
  tagline: string
  /** 就绪的海报 url/dataUrl；无则用 swatch 占位 */
  posterUrl?: string
  /** 占位渐变两色 */
  swatch: [string, string]
  /** 多选模式下是否已入池 */
  selected?: boolean
}

export interface PosterCarouselProps {
  items: PosterItem[]
  /** 当前居中项 */
  activeId: string
  /** 用户切换居中项 */
  onActiveChange: (id: string) => void
  /** 点中间主海报 / 主按钮 */
  onPrimary?: (id: string) => void
  primaryLabel?: (item: PosterItem) => string
  multiSelect?: boolean
  /** 海报画幅方向：portrait=竖版 2:3（默认，风格/小游戏）；landscape=横版 16:9（UI 截图） */
  orientation?: 'portrait' | 'landscape'
  /** 左上角 mono 小标题（如 VISUAL STYLE） */
  title?: string
  /** 标题旁的中文说明 */
  subtitle?: string
  /**
   * 视觉锚点启用态 —— 传入则在标题右侧渲染「已启用 / 未启用」徽标。
   * 用于风格 / 导演风格 / 界面风格这类"选中即作为后续生成锚点"的选择器，
   * 让作者一眼看到当前是否已锁定锚点（undefined = 不渲染徽标，如小游戏池）。
   */
  anchorEnabled?: boolean
  /** 底部附加内容（自定义抽屉 / 计数等），叠在轮播下方 */
  footer?: React.ReactNode
}

const CSS = `
.pc-wrap {
  position: relative;
  width: 100%;
  /* 用 vh 钳制保证轮播永远有稳定高度（不依赖会塌陷的父级百分比链）；窗口过矮时由 .ks-forge-wizard-main 的 overflow-y:auto 纵向滚动，绝不裁没 */
  flex: 1 0 auto;
  min-height: clamp(360px, 74vh, 580px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pc-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 14px 20px 6px;
  flex: 0 0 auto;
}
.pc-header-kicker {
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.22em;
  color: var(--ks-amber, #d4f04a);
  font-weight: 600;
  white-space: nowrap;
}
.pc-header-sub {
  font-size: 12px;
  color: var(--ks-text-dim, rgba(255,255,255,0.55));
  line-height: 1.4;
}
.pc-anchor-badge {
  margin-left: auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  padding: 3px 10px 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.18));
  color: var(--ks-text-dim, rgba(255, 255, 255, 0.55));
  background: rgba(255, 255, 255, 0.04);
}
.pc-anchor-badge.is-on {
  color: var(--ks-amber, #d4f04a);
  border-color: color-mix(in srgb, var(--ks-amber, #d4f04a) 50%, transparent);
  background: color-mix(in srgb, var(--ks-amber, #d4f04a) 12%, transparent);
}
.pc-anchor-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.85;
}
.pc-footer {
  flex: 0 0 auto;
  padding: 0 20px 14px;
}
.pc-root {
  position: relative;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  perspective: 1400px;
  user-select: none;
  touch-action: pan-y;
  overflow: hidden;
}
.pc-stage {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}
.pc-card {
  position: absolute;
  top: 50%;
  left: 50%;
  /* 竖版海报 2:3：aspect-ratio 锁死比例（绝不变形）；height 用 vh 钳制（有界、不会太大太小、永不塌成 0）；窄屏由 max-width 收窄、background cover 裁切而非拉伸 */
  height: clamp(240px, 56vh, 420px);
  aspect-ratio: 2 / 3;
  max-width: 86vw;
  border-radius: 18px;
  overflow: hidden;
  cursor: pointer;
  background: var(--color-background-elevated, #1a1a1f);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  transition:
    transform 360ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 360ms ease,
    filter 360ms ease,
    box-shadow 360ms ease,
    border-color 200ms ease;
  will-change: transform, opacity, filter;
}
.pc-card.is-center {
  cursor: pointer;
  border-color: var(--color-brand-primary, #6c8cff);
  box-shadow:
    0 22px 60px rgba(0, 0, 0, 0.5),
    0 0 0 1px var(--color-brand-primary, #6c8cff),
    0 0 28px -4px var(--color-brand-primary, #6c8cff);
}
/* 横版 UI 截图 16:9：同样 aspect-ratio 锁死比例 + clamp 钳制宽度（不变形、有界） */
.pc-root.is-landscape .pc-card {
  height: auto;
  width: clamp(300px, 82vw, 600px);
  aspect-ratio: 16 / 9;
  max-height: 56vh;
}
.pc-poster {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pc-poster-label {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-primary, #fff);
  text-align: center;
  padding: 0 16px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
}
.pc-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.78) 100%);
  pointer-events: none;
}
.pc-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pc-meta-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary, #fff);
}
.pc-meta-tagline {
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-tertiary, rgba(255, 255, 255, 0.6));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc-check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-brand-primary, #6c8cff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  z-index: 2;
}
.pc-primary {
  margin-top: 4px;
  align-self: flex-start;
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.18));
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}
.pc-primary:hover {
  background: rgba(255, 255, 255, 0.16);
}
.pc-primary.is-on {
  background: var(--color-brand-primary, #6c8cff);
  border-color: var(--color-brand-primary, #6c8cff);
  color: #fff;
}
.pc-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.18));
  background: var(--color-background-elevated, rgba(20, 20, 26, 0.85));
  color: var(--color-text-primary, #fff);
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 20;
  transition: background 160ms ease, border-color 160ms ease;
}
.pc-nav:hover {
  border-color: var(--color-brand-primary, #6c8cff);
  background: var(--color-brand-primary, #6c8cff);
}
.pc-nav.is-prev { left: 8px; }
.pc-nav.is-next { right: 8px; }
`

injectStyleOnce('poster-carousel', CSS)

export function PosterCarousel(props: PosterCarouselProps): JSX.Element {
  const { items, activeId, onActiveChange, onPrimary, primaryLabel, multiSelect, orientation, title, subtitle, anchorEnabled, footer } =
    props
  const isLandscape = orientation === 'landscape'

  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragStartX = useRef<number | null>(null)

  const activeIdx = (() => {
    const i = items.findIndex((it) => it.id === activeId)
    return i < 0 ? 0 : i
  })()

  const go = useCallback(
    (dir: -1 | 1) => {
      if (items.length === 0) return
      const next = activeIdx + dir
      if (next < 0 || next >= items.length) return
      const target = items[next]
      if (target) onActiveChange(target.id)
    },
    [items, activeIdx, onActiveChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      }
    },
    [go],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartX.current = e.clientX
  }, [])

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartX.current
      dragStartX.current = null
      if (start == null) return
      const dx = e.clientX - start
      if (dx > 40) go(-1)
      else if (dx < -40) go(1)
    },
    [go],
  )

  useEffect(() => {
    const el = rootRef.current
    if (el) el.focus({ preventScroll: true })
  }, [])

  return (
    <div className="pc-wrap">
      {(title || subtitle || typeof anchorEnabled === 'boolean') && (
        <div className="pc-header">
          {title && <span className="pc-header-kicker">{title}</span>}
          {subtitle && <span className="pc-header-sub">{subtitle}</span>}
          {typeof anchorEnabled === 'boolean' && (
            <span
              className={`pc-anchor-badge ${anchorEnabled ? 'is-on' : ''}`}
              title={anchorEnabled ? '已锁定该视觉锚点（点中间卡可再次点击取消）' : '尚未启用该视觉锚点'}
            >
              <span className="pc-anchor-dot" aria-hidden />
              {anchorEnabled ? '已启用' : '未启用'}
            </span>
          )}
        </div>
      )}
      <div
        ref={rootRef}
        className={`pc-root ${isLandscape ? 'is-landscape' : ''}`}
        tabIndex={0}
        role="listbox"
        aria-label="海报轮播"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
      <button
        type="button"
        className="pc-nav is-prev"
        aria-label="上一张"
        disabled={activeIdx <= 0}
        onClick={() => go(-1)}
      >
        ‹
      </button>

      <div className="pc-stage">
        {items.map((item, i) => {
          const offset = i - activeIdx
          if (Math.abs(offset) > 2) return null

          const isCenter = offset === 0
          const dist = Math.abs(offset)
          const scale = isCenter ? 1 : Math.max(0.78 - (dist - 1) * 0.1, 0.5)
          const rotateY = isCenter ? 0 : offset > 0 ? -32 : 32
          const opacity = isCenter ? 1 : Math.max(0.85 - dist * 0.18, 0.3)
          const brightness = isCenter ? 1 : Math.max(0.85 - dist * 0.18, 0.45)

          const cardStyle: React.CSSProperties = {
            transform: `translate(-50%, -50%) translateX(${offset * 56}%) scale(${scale}) rotateY(${rotateY}deg)`,
            zIndex: 100 - dist,
            opacity,
            filter: `brightness(${brightness})`,
          }

          const posterStyle: React.CSSProperties = item.posterUrl
            ? {
                backgroundImage: `url(${item.posterUrl})`,
                // 兜底：图片若加载失败仍露出 swatch 底色而非空白
                backgroundColor: item.swatch[0],
              }
            : {
                background: `linear-gradient(135deg, ${item.swatch[0]} 0%, ${item.swatch[1]} 100%)`,
              }

          const showCheck = Boolean(multiSelect && item.selected)
          const primaryText = primaryLabel ? primaryLabel(item) : '选择'

          const onCardClick = () => {
            if (isCenter) {
              onPrimary?.(item.id)
            } else {
              onActiveChange(item.id)
            }
          }

          return (
            <div
              key={item.id}
              className={`pc-card ${isCenter ? 'is-center' : ''}`}
              style={cardStyle}
              role="option"
              aria-selected={isCenter}
              onClick={onCardClick}
            >
              <div className="pc-poster" style={posterStyle}>
                {!item.posterUrl && <span className="pc-poster-label">{item.label}</span>}
              </div>
              <div className="pc-scrim" aria-hidden />
              {showCheck && (
                <span className="pc-check" aria-hidden>
                  ✓
                </span>
              )}
              <div className="pc-meta">
                <span className="pc-meta-title">{item.label}</span>
                <span className="pc-meta-tagline">{item.tagline}</span>
                {isCenter && (
                  <button
                    type="button"
                    className={`pc-primary ${multiSelect && item.selected ? 'is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPrimary?.(item.id)
                    }}
                  >
                    {primaryText}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="pc-nav is-next"
        aria-label="下一张"
        disabled={activeIdx >= items.length - 1}
        onClick={() => go(1)}
      >
        ›
      </button>
      </div>
      {footer && <div className="pc-footer">{footer}</div>}
    </div>
  )
}
