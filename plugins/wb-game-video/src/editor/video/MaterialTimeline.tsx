import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { injectStyleOnce } from '../../styles/injectStyle'
import { resolveSnapGridMs, snapMs } from './timelineMath'
import {
  type MaterialItem,
  TIMELINE_LAYER_STEP,
  TIMELINE_LAYER_TOP,
  TIMELINE_MIN_TRACKS,
  ZOOM_MAX,
  ZOOM_MIN,
  buildMaterialTicks,
  canDeleteMaterial,
  clampMs,
  clampZoom,
  fmtDur,
  layerFromPointerY,
  layerTop,
  materialClass,
  materialDisplayLabel,
} from './materialTimelineShared'

/**
 * 视频 tab 与剧情树抽屉共享的「材料时间轴」——
 *   · layer 堆叠的材料条（字幕 / 结算 / QTE / 选项 / QTE 窗口）
 *   · Ctrl/⌘ 锚点缩放 + Shift 横滚 + 普通滚轮纵向滚动
 *   · ruler 刻度 + 平滑播放头（宿主每帧喂 playheadMs）
 *   · 拖动 move/start/end（吸附 100ms，Shift=10ms/Alt=500ms）
 *   · 无限纵向轨：轨数由数据 layer 派生并多留一条空投放轨
 *
 * 组件本身**不碰 scenario**：材料由宿主 `collectMaterials(scene)` 传入，编辑经
 * `onPatchMaterial` 回写。gating 由宿主通过 props 决定（如剧情树关掉某些交互）。
 */
export interface MaterialTimelineProps {
  materials: MaterialItem[]
  maxMs: number
  playheadMs: number
  selectedMaterialKey: string | null
  isTimedQteNode?: boolean
  /** 视频 tab（全交互）或剧情树抽屉（可 gating）。目前仅用于文案，交互差异由下面的开关控制。 */
  context?: 'video' | 'story'
  /** 是否允许拖动编辑材料（剧情树只读预览时可关）。默认 true。 */
  editable?: boolean
  emptyHint?: string
  /** 提供时，点击/拖动 ruler 或画布空白处即 seek 播放头到该时刻（宿主据此暂停播放并同步 <video>）。 */
  onSeek?: (ms: number) => void
  /** 一次手动拖拽（scrub）开始时触发一次 —— 宿主用它把正在播放的视频自动暂停。 */
  onScrubStart?: () => void
  onSelectMaterial: (key: string) => void
  onPatchMaterial: (
    item: MaterialItem,
    patch: { startMs?: number; endMs?: number; layer?: number; markerMs?: number },
  ) => void
  /** 提供时，选中可删材料后按 Delete/Backspace 或点击控件上的 × 即删除。 */
  onDeleteMaterial?: (item: MaterialItem) => void
}

interface DragState {
  key: string
  mode: 'move' | 'start' | 'end' | 'marker'
  pointerX: number
  startMs: number
  endMs: number
  layer: number
}

export function MaterialTimeline({
  materials,
  maxMs,
  playheadMs,
  selectedMaterialKey,
  isTimedQteNode = false,
  editable = true,
  emptyHint = '打开素材库，把控件加入当前节点时间轴',
  onSeek,
  onScrubStart,
  onSelectMaterial,
  onPatchMaterial,
  onDeleteMaterial,
}: MaterialTimelineProps) {
  injectStyleOnce('material-timeline', MATERIAL_TIMELINE_CSS)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [viewportW, setViewportW] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)

  // 无限轨：可见轨数由数据里最大 layer 派生，并永远多留一条空轨用于「拖到新轨=新增一轨」。
  const dataMaxLayer = materials.reduce((mx, it) => Math.max(mx, it.layer), 0)
  const trackCount = Math.max(TIMELINE_MIN_TRACKS, dataMaxLayer + 2)
  // 缩放：画布宽 = 视口宽 × zoom（zoom=1 恰好铺满，无横向滚动）。
  const canvasPx = Math.max(1, (viewportW || 1) * zoom)
  const pxPerMs = canvasPx / maxMs
  const canvasHeight = TIMELINE_LAYER_TOP + trackCount * TIMELINE_LAYER_STEP + 8
  const ruleTicks = useMemo(() => buildMaterialTicks(maxMs, pxPerMs), [maxMs, pxPerMs])

  // 视口宽度 → canvasPx 基准。ResizeObserver 跟随布局变化。
  useEffect(() => {
    const vp = timelineViewportRef.current
    if (!vp) return
    const measure = () => setViewportW(vp.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  // 滚轮：Ctrl/⌘ = 以光标为锚点缩放；Shift = 横向滚动；普通滚轮 = 原生纵向滚动（轨多时）。
  useEffect(() => {
    const vp = timelineViewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = vp.getBoundingClientRect()
        const localX = e.clientX - rect.left
        const anchorX = localX + vp.scrollLeft
        const ratio = canvasPx > 0 ? anchorX / canvasPx : 0
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        setZoom((z) => {
          const next = clampZoom(z * factor)
          const nextCanvas = Math.max(1, (viewportW || 1) * next)
          requestAnimationFrame(() => {
            if (timelineViewportRef.current) {
              timelineViewportRef.current.scrollLeft = ratio * nextCanvas - localX
            }
          })
          return next
        })
      } else if (e.shiftKey) {
        e.preventDefault()
        vp.scrollLeft += e.deltaY
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [canvasPx, viewportW])

  function onPointerDown(e: React.PointerEvent, item: MaterialItem, mode: 'move' | 'start' | 'end' | 'marker'): void {
    e.preventDefault()
    e.stopPropagation()
    onSelectMaterial(item.key)
    // 让视口拿到焦点，Delete/Backspace 键删除才有落点（不滚动画面）。
    timelineViewportRef.current?.focus({ preventScroll: true })
    if (!editable) return
    timelineRef.current?.setPointerCapture(e.pointerId)
    const anchorMs = mode === 'marker' ? (item.markerMs ?? item.startMs) : item.startMs
    setDrag({ key: item.key, mode, pointerX: e.clientX, startMs: anchorMs, endMs: item.endMs, layer: item.layer })
  }

  // 选中可删材料后，按 Delete/Backspace 删除（焦点在时间轴视口内时生效）。
  function onViewportKeyDown(e: React.KeyboardEvent): void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (!onDeleteMaterial || !selectedMaterialKey) return
    const item = materials.find((m) => m.key === selectedMaterialKey)
    if (!item || !canDeleteMaterial(item.kind)) return
    e.preventDefault()
    onDeleteMaterial(item)
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (!drag) return
    if (drag.key === '__seek__') {
      seekFromPointer(e)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const item = materials.find((m) => m.key === drag.key)
    if (!item) return
    const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
    const nextLayer = drag.mode === 'move' ? layerFromPointerY(e.clientY, rect, trackCount - 1) : drag.layer
    // 吸附：默认 100ms 网格；Shift=10ms 精细，Alt=500ms 粗粒度（复用 A 的 snap 语义）。
    const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
    if (drag.mode === 'marker') {
      // 段内命中判定点（菱形）：只改 markerMs，宿主夹回 [出现, 消失] 内。
      onPatchMaterial(item, { markerMs: clampMs(snapMs(drag.startMs + deltaMs, grid), 0, maxMs) })
      return
    }
    const span = drag.endMs - drag.startMs
    if (drag.mode === 'move') {
      const start = clampMs(snapMs(drag.startMs + deltaMs, grid), 0, Math.max(0, maxMs - span))
      onPatchMaterial(item, { startMs: start, endMs: start + span, layer: nextLayer })
    } else if (drag.mode === 'start') {
      onPatchMaterial(item, { startMs: snapMs(drag.startMs + deltaMs, grid), endMs: drag.endMs })
    } else {
      onPatchMaterial(item, { startMs: drag.startMs, endMs: snapMs(drag.endMs + deltaMs, grid) })
    }
  }

  function onPointerUp(): void {
    setDrag(null)
  }

  // ruler 上按下/拖动即 seek 播放头（宿主可选消费）。
  function seekFromPointer(e: React.PointerEvent): void {
    if (!onSeek) return
    const canvas = timelineRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(clampMs(ratio * maxMs, 0, maxMs))
  }

  // 手动拖拽播放头（scrub）：ruler 与画布空白处按下都进入 seek-drag，拖到哪播放头到哪。
  function beginSeek(e: React.PointerEvent): void {
    if (!onSeek) return
    e.preventDefault()
    e.stopPropagation()
    onScrubStart?.() // 宿主据此暂停正在播放的视频
    timelineRef.current?.setPointerCapture(e.pointerId)
    setDrag({ key: '__seek__', mode: 'move', pointerX: e.clientX, startMs: 0, endMs: 0, layer: 0 })
    seekFromPointer(e)
  }

  // 画布空白处（非控件、非 ruler）按下也可拖拽播放头。控件的 pointerdown 会 stopPropagation，
  // 故只有点到画布本体（e.target === 画布）时才起 scrub。
  function onCanvasPointerDown(e: React.PointerEvent): void {
    if (!onSeek) return
    if (e.target !== e.currentTarget) return
    beginSeek(e)
  }

  return (
    <div className="mtl-root">
      <div className="gc-materialbar">
        <span className="gc-materialbar-meta">时间轴 · {fmtDur(maxMs)}</span>
        {isTimedQteNode ? (
          <span className="gc-materialbar-hint">
            QTE 按键点：左缘 = 出现 · 右缘 = 消失 · 菱形 = 命中判定点（计分锚点）
          </span>
        ) : null}
        <span className="gc-zoombar">
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
            aria-label="时间轴缩放"
            title="Ctrl/⌘ + 滚轮以光标为锚点缩放 · Shift + 滚轮横向滚动"
          />
          <span className="gc-zoom-val">{zoom.toFixed(1)}×</span>
          <button
            type="button"
            className="gc-zoom-fit"
            onClick={() => {
              setZoom(1)
              if (timelineViewportRef.current) timelineViewportRef.current.scrollLeft = 0
            }}
          >
            1× 适配
          </button>
        </span>
      </div>
      <div
        className="gc-mtimeline-viewport"
        ref={timelineViewportRef}
        tabIndex={onDeleteMaterial ? 0 : undefined}
        onKeyDown={onDeleteMaterial ? onViewportKeyDown : undefined}
      >
        <div
          ref={timelineRef}
          className={`gc-mtimeline-canvas${onSeek ? ' is-seekable' : ''}`}
          style={{ width: `${canvasPx}px`, height: `${canvasHeight}px` }}
          onPointerDown={onSeek ? onCanvasPointerDown : undefined}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={onPointerUp}
        >
          <div
            className={`gc-mtimeline-ruler${onSeek ? ' is-seekable' : ''}`}
            style={{ width: `${canvasPx}px` }}
            onPointerDown={onSeek ? beginSeek : undefined}
          >
            {ruleTicks.map((t) => (
              <span key={t.ms} className="gc-mtick" style={{ left: `${t.ms * pxPerMs}px` }}>
                {t.label}
              </span>
            ))}
          </div>
          {Array.from({ length: trackCount }, (_, i) => (
            <div
              key={`trackline-${i}`}
              className="gc-mtrackline"
              style={{ top: `${layerTop(i) - 1}px`, width: `${canvasPx}px` }}
              aria-hidden
            />
          ))}
          <div className="gc-playhead" style={{ left: `${playheadMs * pxPerMs}px` }} aria-hidden />
          {materials.map((m) => {
            const left = m.startMs * pxPerMs
            const width = Math.max(6, (m.endMs - m.startMs) * pxPerMs)
            const selected = selectedMaterialKey === m.key
            return (
              <Fragment key={m.key}>
              <div
                className={`gc-mclip ${materialClass(m.kind)}${selected ? ' is-selected' : ''}`}
                style={{ left: `${left}px`, width: `${width}px`, top: `${layerTop(m.layer)}px` }}
                onPointerDown={(e) => onPointerDown(e, m, 'move')}
                title={`${materialDisplayLabel(m)} · ${fmtDur(m.startMs)} - ${fmtDur(m.endMs)}`}
              >
                {editable ? (
                  <button className="gc-mhandle is-left" onPointerDown={(e) => onPointerDown(e, m, 'start')} aria-label="调整起点" />
                ) : null}
                <span>{materialDisplayLabel(m)}{m.label ? ` · ${m.label}` : ''}</span>
                {editable && selected && onDeleteMaterial && canDeleteMaterial(m.kind) ? (
                  <button
                    type="button"
                    className="gc-mdelete"
                    aria-label="删除控件"
                    title="删除控件（Delete）"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteMaterial(m)
                    }}
                  >
                    ×
                  </button>
                ) : null}
                {editable ? (
                  <button className="gc-mhandle is-right" onPointerDown={(e) => onPointerDown(e, m, 'end')} aria-label="调整终点" />
                ) : null}
              </div>
              {m.markerMs != null ? (
                <button
                  type="button"
                  className={`gc-mmarker${selected ? ' is-selected' : ''}`}
                  style={{ left: `${m.markerMs * pxPerMs}px`, top: `${layerTop(m.layer) + 16}px` }}
                  title={`命中判定点（计分锚点）· ${fmtDur(m.markerMs)}`}
                  aria-label="命中判定点"
                  onPointerDown={(e) => (editable ? onPointerDown(e, m, 'marker') : onSelectMaterial(m.key))}
                />
              ) : null}
              </Fragment>
            )
          })}
          {materials.length === 0 && <div className="gc-mempty">{emptyHint}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * 时间轴自带样式。定义自己的 `--gc-*` 变量（带 VAG 主题回落），使得组件在 `.gc-tab`
 * 之外（剧情树抽屉）也能正常上色，不依赖宿主的变量作用域。
 */
const MATERIAL_TIMELINE_CSS = `
.mtl-root {
  --gc-panel2: var(--panel2, #252019);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
}
.mtl-root .gc-materialbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mtl-root .gc-materialbar-meta { color: var(--gc-faint); font-size: 12px; }
.mtl-root .gc-materialbar-hint { color: rgba(184, 240, 238, 0.72); font-size: 11px; }
.mtl-root .gc-zoombar { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.mtl-root .gc-zoombar input[type="range"] { width: 120px; accent-color: var(--gc-accent); cursor: pointer; }
.mtl-root .gc-zoom-val { color: var(--gc-faint); font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
.mtl-root .gc-zoom-fit {
  border: 1px solid var(--gc-line); background: var(--gc-panel2); color: var(--gc-text);
  border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer;
}
.mtl-root .gc-zoom-fit:hover { border-color: var(--gc-accent-line); }
.mtl-root .gc-mtimeline-viewport {
  position: relative;
  height: var(--gc-timeline-h, 240px);
  min-height: 204px;
  border-radius: 10px;
  border: 1px solid var(--gc-line-soft);
  background: rgba(0,0,0,0.22);
  overflow: auto;
  overscroll-behavior: contain;
}
.mtl-root .gc-mtimeline-canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  touch-action: none;
}
.mtl-root .gc-mtimeline-canvas.is-seekable { cursor: text; }
.mtl-root .gc-mtimeline-viewport:focus-visible { outline: 1px solid var(--gc-accent-line); outline-offset: -1px; }
.mtl-root .gc-mtimeline-ruler {
  position: sticky;
  left: 0; top: 0; height: 22px;
  border-bottom: 1px solid var(--gc-line-soft);
  background: rgba(20,16,12,0.94);
  z-index: 6;
}
.mtl-root .gc-mtimeline-ruler.is-seekable { cursor: pointer; }
.mtl-root .gc-mtrackline {
  position: absolute;
  left: 0;
  height: 0;
  border-top: 1px solid var(--gc-line-soft);
  opacity: 0.5;
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-mtick {
  position: absolute;
  top: 0;
  height: 22px;
  line-height: 22px;
  padding-left: 4px;
  font-size: 10px;
  color: var(--gc-faint);
  font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--gc-line-soft);
  pointer-events: none;
  white-space: nowrap;
}
.mtl-root .gc-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: var(--gc-accent);
  box-shadow: 0 0 12px rgba(240,136,64,.65);
  z-index: 8;
  pointer-events: none;
}
.mtl-root .gc-playhead::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gc-accent);
  box-shadow: 0 0 8px rgba(240,136,64,.85);
}
.mtl-root .gc-mempty {
  position: absolute;
  inset: 22px 0 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
}
.mtl-root .gc-mclip {
  position: absolute;
  top: 42px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  color: #fff;
  font-size: 12px;
  cursor: grab;
  user-select: none;
  background: rgba(18, 14, 11, 0.88);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  overflow: hidden;
}
.mtl-root .gc-mclip::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--gc-accent);
  box-shadow: 0 0 12px currentColor;
}
.mtl-root .gc-mclip:active { cursor: grabbing; }
.mtl-root .gc-mclip.is-selected { outline: 2px solid var(--gc-accent); outline-offset: 2px; overflow: visible; }
.mtl-root .gc-mclip.is-subtitle { border-color: rgba(95,201,128,.58); color: #d6ffe2; }
.mtl-root .gc-mclip.is-subtitle::before { background: #62c980; }
.mtl-root .gc-mclip.is-overlay { border-color: rgba(240,136,64,.58); color: #ffd8bf; }
.mtl-root .gc-mclip.is-overlay::before { background: var(--gc-accent); }
.mtl-root .gc-mclip.is-qte { border-color: rgba(95,163,247,.58); color: #cfe4ff; }
.mtl-root .gc-mclip.is-qte::before { background: #5fa3f7; }
.mtl-root .gc-mmarker {
  position: absolute;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  margin-top: -6px;
  padding: 0;
  transform: rotate(45deg);
  background: #ffd54a;
  border: 1px solid rgba(0,0,0,0.45);
  box-shadow: 0 0 8px rgba(255,213,74,0.75);
  cursor: ew-resize;
  z-index: 7;
}
.mtl-root .gc-mmarker:hover,
.mtl-root .gc-mmarker.is-selected { background: #fff08a; box-shadow: 0 0 10px rgba(255,213,74,0.95); }
.mtl-root .gc-mclip.is-option { border-color: rgba(199,155,242,.58); color: #eadbff; }
.mtl-root .gc-mclip.is-option::before { background: #c79bf2; }
.mtl-root .gc-mhandle {
  position: absolute;
  top: 0; bottom: 0;
  width: 8px;
  border: 0;
  padding: 0;
  background: rgba(255,255,255,0.32);
  cursor: ew-resize;
}
.mtl-root .gc-mhandle.is-left { left: 0; border-radius: 8px 0 0 8px; }
.mtl-root .gc-mhandle.is-right { right: 0; border-radius: 0 8px 8px 0; }
.mtl-root .gc-mdelete {
  position: absolute;
  top: -8px;
  right: -8px;
  z-index: 3;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.4);
  background: #d64545;
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.mtl-root .gc-mdelete:hover { background: #e35a5a; }
`
