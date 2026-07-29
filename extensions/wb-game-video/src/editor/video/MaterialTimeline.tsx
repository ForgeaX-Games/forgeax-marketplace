import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { injectStyleOnce } from '../../styles/injectStyle'
import { AudioWaveform } from './audioWaveform'
import { resolveSnapGridMs, snapMs } from './timelineMath'
import {
  type AudioItem,
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

/** 素材库卡片 → 时间轴拖放时携带的模板类型 MIME。 */
export const MATERIAL_DND_MIME = 'application/x-fx-material'

/**
 * 材料条渲染最小宽度（px）。= 左手柄 8 + 中间可拖区 ≥6 + 右手柄 8。
 * 极短窗口（几十 ms）按真实比例只有几 px 宽时，两个手柄会叠在一起、起点抓不到，
 * 所以宽度取真实跨度与本下限的较大者——牺牲一点比例真实性，换回可操作性。
 */
const CLIP_MIN_PX = 22
/** 窄于此宽度就不渲染条内文字（文字会压住两侧手柄的可点区；标签仍在 title 里）。 */
const CLIP_LABEL_MIN_PX = 56

/**
 * 视频 tab 与剧情树抽屉共享的「材料时间轴」——
 *   · zIndex 堆叠的材料条（字幕 / 结算 / QTE / 选项 / QTE 窗口）
 *   · Ctrl/⌘ 锚点缩放 + Shift 横滚 + 普通滚轮纵向滚动
 *   · ruler 刻度 + 平滑播放头（宿主每帧喂 playheadMs）
 *   · 拖动 move/start/end（吸附 0.01s=10ms；Alt=0.1s）
 *   · 无限纵向轨：轨数由数据 zIndex 派生并多留一条空投放轨
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
    patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number },
  ) => void
  /** 提供时，选中可删材料后按 Delete/Backspace 或点击控件上的 × 即删除。 */
  onDeleteMaterial?: (item: MaterialItem) => void
  /** 提供时，从素材库把控件卡片拖入时间轴 → 在落点时刻 atMs / 轨 zIndex 新增该模板。 */
  onDropTemplate?: (template: string, atMs: number, zIndex: number) => void
  /** 当前时间轴模式：组件（material）/ 音频（audio）。默认 material。 */
  mode?: 'material' | 'audio'
  /** 提供时，materialbar 出现「组件 / 音频」切换段控件。 */
  onModeChange?: (mode: 'material' | 'audio') => void
  /** 音频模式下展示的音轨条（当前仅显示 + 拖动，不做实际音频编辑）。 */
  audioItems?: AudioItem[]
  /** 音频模式下拖动音轨条的回写（移动 / 换轨）。 */
  onPatchAudio?: (item: AudioItem, patch: { startMs?: number; endMs?: number; zIndex?: number }) => void
}

interface DragState {
  key: string
  mode: 'move' | 'start' | 'end' | 'marker'
  pointerX: number
  startMs: number
  endMs: number
  zIndex: number
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
  onDropTemplate,
  mode,
  onModeChange,
  audioItems,
  onPatchAudio,
}: MaterialTimelineProps) {
  injectStyleOnce('material-timeline', MATERIAL_TIMELINE_CSS)
  const activeMode: 'material' | 'audio' = mode ?? 'material'
  const audioList = audioItems ?? []
  // 当前活动条目列表（几何 + key 通用；只有它们的字段被 drag/render 用到）。
  const activeList: Array<{ key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number }> =
    activeMode === 'audio' ? audioList : materials
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [viewportW, setViewportW] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropHint, setDropHint] = useState<{ ms: number; zIndex: number } | null>(null)

  // 无限轨：可见轨数由数据里最大 zIndex 派生，并永远多留一条空轨用于「拖到新轨=新增一轨」。
  const dataMaxLayer = activeList.reduce((mx, it) => Math.max(mx, it.zIndex), 0)
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

  // 把当前拖拽的 patch 派发给对应回写（组件→onPatchMaterial / 音频→onPatchAudio）。
  function dispatchPatch(key: string, patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number }): void {
    if (activeMode === 'audio') {
      const a = audioList.find((x) => x.key === key)
      if (a) onPatchAudio?.(a, patch)
      return
    }
    const m = materials.find((x) => x.key === key)
    if (m) onPatchMaterial(m, patch)
  }

  function onPointerDown(
    e: React.PointerEvent,
    item: { key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number },
    dragMode: 'move' | 'start' | 'end' | 'marker',
  ): void {
    e.preventDefault()
    e.stopPropagation()
    // 音频条仅显示 + 拖动，不进 material 选中/检视器流。
    if (activeMode === 'material') onSelectMaterial(item.key)
    // 让视口拿到焦点，Delete/Backspace 键删除才有落点（不滚动画面）。
    timelineViewportRef.current?.focus({ preventScroll: true })
    if (!editable) return
    timelineRef.current?.setPointerCapture(e.pointerId)
    const anchorMs = dragMode === 'marker' ? (item.markerMs ?? item.startMs) : item.startMs
    setDrag({ key: item.key, mode: dragMode, pointerX: e.clientX, startMs: anchorMs, endMs: item.endMs, zIndex: item.zIndex })
  }

  // 选中可删材料后，按 Delete/Backspace 删除（焦点在时间轴视口内时生效）。
  function onViewportKeyDown(e: React.KeyboardEvent): void {
    if (activeMode !== 'material') return
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
    if (!activeList.some((m) => m.key === drag.key)) return
    const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
    const nextLayer = drag.mode === 'move' ? layerFromPointerY(e.clientY, rect, trackCount - 1) : drag.zIndex
    // 吸附：默认 0.01s（10ms）；Alt=0.1s 粗粒度。
    const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
    if (drag.mode === 'marker') {
      // 段内命中判定点（菱形）：只改 markerMs，宿主夹回 [出现, 消失] 内。
      dispatchPatch(drag.key, { markerMs: clampMs(snapMs(drag.startMs + deltaMs, grid), 0, maxMs) })
      return
    }
    const span = drag.endMs - drag.startMs
    if (drag.mode === 'move') {
      const start = clampMs(snapMs(drag.startMs + deltaMs, grid), 0, Math.max(0, maxMs - span))
      dispatchPatch(drag.key, { startMs: start, endMs: start + span, zIndex: nextLayer })
    } else if (drag.mode === 'start') {
      dispatchPatch(drag.key, { startMs: snapMs(drag.startMs + deltaMs, grid), endMs: drag.endMs })
    } else {
      dispatchPatch(drag.key, { startMs: drag.startMs, endMs: snapMs(drag.endMs + deltaMs, grid) })
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
    setDrag({ key: '__seek__', mode: 'move', pointerX: e.clientX, startMs: 0, endMs: 0, zIndex: 0 })
    seekFromPointer(e)
  }

  // 画布空白处（非控件、非 ruler）按下也可拖拽播放头。控件的 pointerdown 会 stopPropagation，
  // 故只有点到画布本体（e.target === 画布）时才起 scrub。
  function onCanvasPointerDown(e: React.PointerEvent): void {
    if (!onSeek) return
    if (e.target !== e.currentTarget) return
    beginSeek(e)
  }

  // 素材库卡片拖入：x → 时刻（吸附 0.01s）、y → 轨。
  function dropPosFromEvent(e: React.DragEvent): { ms: number; zIndex: number } {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return { ms: 0, zIndex: 0 }
    const ratio = (e.clientX - rect.left) / rect.width
    const ms = clampMs(snapMs(ratio * maxMs, 10), 0, maxMs)
    const zIndex = layerFromPointerY(e.clientY, rect, trackCount - 1)
    return { ms, zIndex }
  }

  function onCanvasDragOver(e: React.DragEvent): void {
    if (!onDropTemplate || !e.dataTransfer.types.includes(MATERIAL_DND_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropHint(dropPosFromEvent(e))
  }

  function onCanvasDrop(e: React.DragEvent): void {
    if (!onDropTemplate) return
    const template = e.dataTransfer.getData(MATERIAL_DND_MIME)
    setDropHint(null)
    if (!template) return
    e.preventDefault()
    const { ms, zIndex } = dropPosFromEvent(e)
    onDropTemplate(template, ms, zIndex)
  }

  return (
    <div className="mtl-root">
      <div className="gc-materialbar">
        <span className="gc-materialbar-meta">时间轴 · {fmtDur(maxMs)}</span>
        {onModeChange ? (
          <span className="gc-tl-modeseg" role="group" aria-label="时间轴模式切换">
            <button
              type="button"
              className={activeMode === 'material' ? 'is-on' : ''}
              aria-pressed={activeMode === 'material'}
              onClick={() => onModeChange('material')}
            >
              组件
            </button>
            <button
              type="button"
              className={activeMode === 'audio' ? 'is-on' : ''}
              aria-pressed={activeMode === 'audio'}
              onClick={() => onModeChange('audio')}
            >
              音频
            </button>
          </span>
        ) : null}
        {activeMode === 'material' && isTimedQteNode ? (
          <span className="gc-materialbar-hint">
            QTE 按键点：左缘 = 出现 · 右缘 = 消失 · 菱形 = 命中判定点（计分锚点）
          </span>
        ) : null}
        {activeMode === 'audio' ? (
          <span className="gc-materialbar-hint">音频轨（仅显示 / 可拖动）· 第 1 轨为素材自带声道</span>
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
          onDragOver={onDropTemplate && activeMode === 'material' ? onCanvasDragOver : undefined}
          onDrop={onDropTemplate && activeMode === 'material' ? onCanvasDrop : undefined}
          onDragLeave={onDropTemplate && activeMode === 'material' ? () => setDropHint(null) : undefined}
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
          {dropHint ? (
            <div
              className="gc-mdrop"
              style={{ left: `${dropHint.ms * pxPerMs}px`, top: `${layerTop(dropHint.zIndex)}px` }}
              aria-hidden
            >
              <span className="gc-mdrop-time">{fmtDur(dropHint.ms)}</span>
            </div>
          ) : null}
          {activeMode === 'audio'
            ? audioList.map((a) => {
                const left = a.startMs * pxPerMs
                const width = Math.max(6, (a.endMs - a.startMs) * pxPerMs)
                // 音频条：仅显示 + 整体拖动（换轨 / 移时刻），无裁剪把手 / 删除 / marker。
                return (
                  <div
                    key={a.key}
                    className={`gc-mclip is-audio${a.builtin ? ' is-builtin' : ''}`}
                    style={{ left: `${left}px`, width: `${width}px`, top: `${layerTop(a.zIndex)}px` }}
                    onPointerDown={(e) => onPointerDown(e, a, 'move')}
                    title={`${a.label} · ${fmtDur(a.startMs)} - ${fmtDur(a.endMs)}`}
                  >
                    <AudioWaveform src={a.src} width={width} height={TIMELINE_LAYER_STEP - 2} />
                    <span className="gc-audio-label">
                      <span className="gc-audio-ico" aria-hidden>♪</span>
                      {a.label}
                    </span>
                  </div>
                )
              })
            : materials.map((m) => {
                const left = m.startMs * pxPerMs
                // 下限必须容得下「左手柄 + 中间可拖区 + 右手柄」，否则两个 8px 手柄在窄条上完全重叠，
                // 只有 DOM 靠后的右手柄能被抓到 → 起点永远调不了（CLIP_MIN_PX 见常量注释）。
                const width = Math.max(CLIP_MIN_PX, (m.endMs - m.startMs) * pxPerMs)
                const selected = selectedMaterialKey === m.key
                return (
                  <Fragment key={m.key}>
                    <div
                      className={`gc-mclip ${materialClass(m.kind)}${selected ? ' is-selected' : ''}${m.overridden ? ' is-overridden' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px`, top: `${layerTop(m.zIndex)}px` }}
                      onPointerDown={(e) => onPointerDown(e, m, 'move')}
                      title={`${materialDisplayLabel(m)} · ${fmtDur(m.startMs)} - ${fmtDur(m.endMs)}${m.overridden ? ' · 已脱离方案跟随' : ''}`}
                    >
                      {editable ? (
                        <button className="gc-mhandle is-left" onPointerDown={(e) => onPointerDown(e, m, 'start')} aria-label="调整起点" />
                      ) : null}
                      {/* 窄条上不渲染文字：否则会盖住两侧手柄的点击区（文案仍在 title 里可悬停看）。 */}
                      {width >= CLIP_LABEL_MIN_PX ? (
                        <span className="gc-mclip-label">
                          {materialDisplayLabel(m)}{m.label ? ` · ${m.label}` : ''}
                        </span>
                      ) : null}
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
                        style={{ left: `${m.markerMs * pxPerMs}px`, top: `${layerTop(m.zIndex) + 16}px` }}
                        title={`命中判定点（计分锚点）· ${fmtDur(m.markerMs)}`}
                        aria-label="命中判定点"
                        onPointerDown={(e) => (editable ? onPointerDown(e, m, 'marker') : onSelectMaterial(m.key))}
                      />
                    ) : null}
                  </Fragment>
                )
              })}
          {activeList.length === 0 && <div className="gc-mempty">{activeMode === 'audio' ? '当前素材无音轨' : emptyHint}</div>}
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
.mtl-root .gc-tl-modeseg { display: inline-flex; border: 1px solid var(--gc-accent-line); border-radius: 7px; overflow: hidden; }
.mtl-root .gc-tl-modeseg button {
  border: 0; background: rgba(240,136,64,.12); color: var(--gc-faint);
  padding: 4px 12px; font-size: 11px; line-height: 1; cursor: pointer;
}
.mtl-root .gc-tl-modeseg button + button { border-left: 1px solid var(--gc-accent-line); }
.mtl-root .gc-tl-modeseg button:hover { background: rgba(240,136,64,.24); color: var(--gc-text); }
.mtl-root .gc-tl-modeseg button.is-on { background: var(--gc-accent); color: #1a1206; font-weight: 700; }
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
.mtl-root .gc-mdrop {
  position: absolute;
  width: 3px;
  height: 32px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--gc-accent);
  box-shadow: 0 0 10px rgba(240,136,64,.85);
  z-index: 9;
  pointer-events: none;
}
.mtl-root .gc-mdrop::before {
  content: "＋";
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 16px;
  line-height: 15px;
  text-align: center;
  border-radius: 50%;
  background: var(--gc-accent);
  color: #1b1206;
  font-size: 12px;
  font-weight: 700;
}
.mtl-root .gc-mdrop-time {
  position: absolute;
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(20,16,12,0.94);
  color: var(--gc-accent);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
.mtl-root .gc-mclip.is-overridden { overflow: visible; }
.mtl-root .gc-mclip.is-overridden::after {
  content: "";
  position: absolute;
  top: -3px;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffd54a;
  box-shadow: 0 0 6px rgba(255,213,74,.85), 0 0 0 1px rgba(0,0,0,.4);
  pointer-events: none;
}
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
.mtl-root .gc-mclip.is-audio {
  border-color: rgba(96,214,196,.55); color: #cdfff4;
  /* 波形未解出/无音轨时的兜底底纹 */
  background: linear-gradient(rgba(16,34,32,.94), rgba(16,34,32,.94)),
    repeating-linear-gradient(90deg, rgba(20,40,38,.9) 0 6px, rgba(26,52,49,.9) 6px 12px);
  justify-content: flex-start;
  padding: 0 6px;
}
.mtl-root .gc-mclip.is-audio::before { background: #4fd6c0; z-index: 2; }
.mtl-root .gc-mclip.is-audio.is-builtin { border-style: dashed; }
.mtl-root .gc-audio-wave {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-audio-label {
  position: relative; z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  max-width: calc(100% - 8px);
  padding: 1px 7px; border-radius: 6px;
  background: rgba(6,20,18,.5);
  font-size: 11px; line-height: 1.5;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.mtl-root .gc-audio-ico { font-size: 12px; opacity: .85; }
.mtl-root .gc-mclip.is-filter { border-color: rgba(126,214,122,.6); color: #d9ffd0; }
.mtl-root .gc-mclip.is-filter::before { background: #7ed67a; }
.mtl-root .gc-mclip.is-fx { border-color: rgba(255,138,196,.6); color: #ffd9ee; }
.mtl-root .gc-mclip.is-fx::before { background: #ff8ac4; }
.mtl-root .gc-mclip.is-component { border-color: rgba(180,190,210,.55); color: #e2e8f0; }
.mtl-root .gc-mclip.is-component::before { background: #94a3b8; }
.mtl-root .gc-mclip.is-mount { border-color: rgba(240,136,64,.6); color: #ffe6d2; background: rgba(240,136,64,.14); }
.mtl-root .gc-mclip.is-mount::before { background: var(--gc-accent); }
/* 条内文字自持裁剪（父层 padding 收窄时省略号，而不是溢出压住手柄）。 */
.mtl-root .gc-mclip-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
/* 手柄必须压在文字之上（z-index）才保证窄条上也能抓到；hover 提亮给出可拖提示。 */
.mtl-root .gc-mhandle {
  position: absolute;
  top: 0; bottom: 0;
  width: 8px;
  border: 0;
  padding: 0;
  z-index: 4;
  background: rgba(255,255,255,0.32);
  cursor: ew-resize;
}
.mtl-root .gc-mhandle:hover { background: rgba(255,255,255,0.62); }
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
