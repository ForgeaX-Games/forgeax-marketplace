import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { injectStyleOnce } from '../../styles/injectStyle'
import { AudioWaveform } from './audioWaveform'
import { resolveSnapGridMs, snapMs } from './timelineMath'
import {
  type AudioItem,
  type MaterialItem,
  type TimelineConditionMarker,
  type TimelinePointMarker,
  type TimelineSegment,
  type TimelineSpawnGroup,
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
  spawnBarTrack,
  spawnGroupsMaxRow,
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
/** 旋转后的菱形半宽约 9px；仅偏移两端的头部，时刻竖线仍精确落在 0/max。 */
const POINT_EDGE_OFFSET_PX = 9
/** 为横向滚动条预留空间，避免它挤占第 6 轨后误触发纵向滚动条。 */
const TIMELINE_SCROLLBAR_RESERVE_PX = 18
function pointHeadOffsetPx(ms: number, maxMs: number): number {
  if (ms <= 0) return POINT_EDGE_OFFSET_PX
  if (ms >= maxMs) return -POINT_EDGE_OFFSET_PX
  return 0
}

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
  /** 独立于节点逻辑播放头的媒体局部指针；循环视频回绕时只在对应视频条内回绕。 */
  mediaPlayhead?: { materialKey: string; localMs: number }
  selectedMaterialKey: string | null
  isTimedQteNode?: boolean
  /** 视频 tab（全交互）或剧情树抽屉（可 gating）。目前仅用于文案，交互差异由下面的开关控制。 */
  context?: 'video' | 'story'
  /** 是否允许拖动编辑材料（剧情树只读预览时可关）。默认 true。 */
  editable?: boolean
  /** 是否允许点选材料/结算标记。默认 true；流程预览关闭以避免联动编辑表单。 */
  selectable?: boolean
  /** 全流程预览的节点片段背景与边界；省略时保持单节点时间轴外观。 */
  segments?: TimelineSegment[]
  /** fit=总时长始终铺满视口；append=首段铺满视口，后续片段按同一 px/ms 向右追加。 */
  widthMode?: 'fit' | 'append'
  emptyHint?: string
  /** 提供时，点击/拖动 ruler 或画布空白处即 seek 播放头到该时刻（宿主据此暂停播放并同步 <video>）。 */
  onSeek?: (ms: number) => void
  /** 一次手动拖拽（scrub）开始时触发一次 —— 宿主用它把正在播放的视频自动暂停。 */
  onScrubStart?: () => void
  /** 一次手动拖拽结束时触发一次 —— 宿主恢复播放头的自动滚动策略。 */
  onScrubEnd?: () => void
  /** 持续拖动播放头的灵敏度；1 = 指针与时间轴等比例，默认 1。按下定位不受影响。 */
  seekDragSensitivity?: number
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
  /**
   * 节点级时刻点（定时结算 / 由界面窗口推导的结算时刻）——见 `TimelinePointMarker`。
   * 空数组或省略 = 不画。刻意不走 MaterialItem/`markerMs`：这些时刻不属于任何材料。
   */
  pointMarkers?: TimelinePointMarker[]
  /** 无确定毫秒坐标的结算条件，以贯穿节点时长的条件条显示。 */
  conditionMarkers?: TimelineConditionMarker[]
  /** 拖时刻标记的回写（按 marker.id 路由到各自的落盘字段）。 */
  onPointMarkerChange?: (id: string, ms: number) => void
  /** 当前选中的时刻标记 id（与右侧表单双向联动：这里点亮，那边高亮对应配置块）。 */
  selectedPointMarkerId?: string | null
  /** 点中时刻标记时上抛（按下即选，不必等拖动结束）。 */
  onSelectPointMarker?: (id: string) => void
  /**
   * 结算**绑定界面**组：从属于 lifecycle 菱形，分布在菱形轨正上方。
   * 起始由宿主结算派生（不可单独编辑），因此这些条只有右手柄。
   */
  spawnGroups?: TimelineSpawnGroup[]
  /** 拖绑定界面右端的回写（id = `settlement-spawn:${settlementIndex}:${actionIndex}`）。 */
  onSpawnBarEndChange?: (id: string, endMs: number) => void
  /** 点中绑定界面时上抛（宿主结算的选中由 `onSelectPointMarker` 一并触发）。 */
  onSelectSpawnBar?: (id: string) => void
  /** 当前选中的绑定界面 id。 */
  selectedSpawnBarId?: string | null
  /** 提供时，选中的绑定界面上出现解除绑定控件。 */
  onDeleteSpawnBar?: (id: string) => void
}

/** 时刻标记的拖拽 sentinel 前缀（与 `__seek__` 同一手法：借指针管线，不占材料 key）。 */
const POINT_DRAG_PREFIX = '__point:'
/** 绑定界面「拖右端」的拖拽 sentinel 前缀；这类条没有起点拖动，所以只需要一个前缀。 */
const SPAWN_END_DRAG_PREFIX = '__spawnend:'
/** 绑定界面的最短可见跨度：一个吸附格，保证结束永不落到宿主结算时刻或它之前。 */
const MIN_SPAWN_SPAN_MS = 10
/** 绑定界面组虚线框相对组内条的留白，避免框线贴着条边。 */
const SPAWN_GROUP_PAD_X = 7
/**
 * 纵向留白只能取 1px：轨距 34、条高 32，相邻两行之间只有 2px 空隙，两组的框各分 1px 才刚好
 * 平铺不压线。要更多纵向留白就得给每组额外占一行，那是作者不愿付的代价。
 */
const SPAWN_GROUP_PAD_Y = 1

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
  mediaPlayhead,
  selectedMaterialKey,
  isTimedQteNode = false,
  editable = true,
  selectable = true,
  segments,
  widthMode = 'fit',
  emptyHint = '打开素材库，把控件加入当前节点时间轴',
  onSeek,
  onScrubStart,
  onScrubEnd,
  seekDragSensitivity = 1,
  onSelectMaterial,
  onPatchMaterial,
  onDeleteMaterial,
  onDropTemplate,
  mode,
  onModeChange,
  audioItems,
  onPatchAudio,
  pointMarkers,
  conditionMarkers,
  onPointMarkerChange,
  selectedPointMarkerId,
  onSelectPointMarker,
  spawnGroups,
  onSpawnBarEndChange,
  onSelectSpawnBar,
  selectedSpawnBarId,
  onDeleteSpawnBar,
}: MaterialTimelineProps) {
  injectStyleOnce('material-timeline', MATERIAL_TIMELINE_CSS)
  const activeMode: 'material' | 'audio' = mode ?? 'material'
  const audioList = audioItems ?? []
  // 当前活动条目列表（几何 + key 通用；只有它们的字段被 drag/render 用到）。
  const activeList: Array<{ key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number; fixedWidthPx?: number; locked?: boolean }> =
    activeMode === 'audio' ? audioList : materials
  const mediaPlayheadMaterial = mediaPlayhead
    ? materials.find((material) => material.key === mediaPlayhead.materialKey)
    : undefined
  const mediaPlayheadTimelineMs = mediaPlayheadMaterial && mediaPlayhead
    ? mediaPlayheadMaterial.startMs + Math.max(
      0,
      Math.min(mediaPlayheadMaterial.endMs - mediaPlayheadMaterial.startMs, mediaPlayhead.localMs),
    )
    : null
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const seekDragActiveRef = useRef(false)
  const normalizedSeekDragSensitivity = Number.isFinite(seekDragSensitivity)
    ? Math.max(0, seekDragSensitivity)
    : 1
  const [zoom, setZoom] = useState(1)
  const [viewportW, setViewportW] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropHint, setDropHint] = useState<{ ms: number; zIndex: number } | null>(null)

  // 无限轨：可见轨数由数据里最大 zIndex 派生，并永远多留一条空轨用于「拖到新轨=新增一轨」。
  const dataMaxLayer = activeList.reduce((mx, it) => Math.max(mx, it.zIndex), 0)
  // 结算独占一轨（排在材料轨之后）：它是"何时执行动作"，与界面窗口是不同维度。
  // 无确定时间的条件结算再独占下一轨；最后仍留一条空投放轨。
  const settlementMarkers = (pointMarkers ?? []).filter((m) => m.kind === 'settlement')
  const lifecycleMarkers = (pointMarkers ?? []).filter((m) => m.kind === 'lifecycle' || m.kind === 'derived')
  // 绑定界面组占据材料轨与菱形轨之间的若干行，因此菱形轨要整体下移让出空间。
  const spawnGroupList = activeMode === 'material' ? spawnGroups ?? [] : []
  const spawnRowCount = spawnGroupsMaxRow(spawnGroupList)
  const lifecycleTrack = dataMaxLayer + 1 + spawnRowCount
  const conditionTrack = lifecycleTrack + (lifecycleMarkers.length ? 1 : 0)
  const trackCount = Math.max(
    TIMELINE_MIN_TRACKS,
    dataMaxLayer + 2,
    lifecycleMarkers.length || spawnRowCount ? lifecycleTrack + 2 : 0,
    conditionMarkers?.length ? conditionTrack + 2 : 0,
  )
  // 流程预览锁定首段建立的 px/ms；后续片段等比例追加，视口通过横向滚动跟随。
  const firstSegmentMs = segments?.[0]
    ? Math.max(1, segments[0].endMs - segments[0].startMs)
    : maxMs
  const durationWidthScale = widthMode === 'append' ? maxMs / firstSegmentMs : 1
  const canvasPx = Math.max(1, (viewportW || 1) * zoom * durationWidthScale)
  const pxPerMs = canvasPx / maxMs
  const canvasHeight = TIMELINE_LAYER_TOP + trackCount * TIMELINE_LAYER_STEP + 8
  const viewportHeight = TIMELINE_LAYER_TOP
    + TIMELINE_MIN_TRACKS * TIMELINE_LAYER_STEP
    + 8
    + TIMELINE_SCROLLBAR_RESERVE_PX
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
          const nextCanvas = Math.max(1, (viewportW || 1) * next * durationWidthScale)
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
  }, [canvasPx, viewportW, durationWidthScale])

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
    item: { key: string; startMs: number; endMs: number; zIndex: number; markerMs?: number; fixedWidthPx?: number; locked?: boolean },
    dragMode: 'move' | 'start' | 'end' | 'marker',
  ): void {
    e.preventDefault()
    e.stopPropagation()
    if (item.locked) {
      if (onSeek) beginSeek(e)
      return
    }
    // 调时间不进选中态：拖左右手柄改的是「什么时候出现/消失」，不是「我要编辑这个界面」，
    // 不该顺带把它选中并在预览画布上点亮（与结算绑定界面的右手柄一致）。仍要暂停播放，
    // 否则播放头会在拖动中继续走。
    const timingOnly = dragMode === 'start' || dragMode === 'end'
    // 音频条仅显示 + 拖动，不进 material 选中/检视器流。
    if (activeMode === 'material' && selectable && !timingOnly) onSelectMaterial(item.key)
    if (timingOnly) onScrubStart?.()
    if (!editable && !selectable && onSeek) {
      beginSeek(e)
      return
    }
    // 让视口拿到焦点，Delete/Backspace 键删除才有落点（不滚动画面）。
    timelineViewportRef.current?.focus({ preventScroll: true })
    if (!editable) return
    if (item.fixedWidthPx != null && (dragMode === 'start' || dragMode === 'end')) return
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
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0 || !onSeek) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs * normalizedSeekDragSensitivity
      onSeek(clampMs(drag.startMs + deltaMs, 0, maxMs))
      return
    }
    if (drag.key.startsWith(POINT_DRAG_PREFIX)) {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
      const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
      const id = drag.key.slice(POINT_DRAG_PREFIX.length)
      onPointMarkerChange?.(id, clampMs(snapMs(drag.startMs + deltaMs, grid), 0, maxMs))
      return
    }
    if (drag.key.startsWith(SPAWN_END_DRAG_PREFIX)) {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
      const grid = resolveSnapGridMs({ shift: e.shiftKey, alt: e.altKey })
      const id = drag.key.slice(SPAWN_END_DRAG_PREFIX.length)
      // 起点归菱形所有：结束只能往后夹，永不越过宿主结算时刻。
      onSpawnBarEndChange?.(
        id,
        clampMs(snapMs(drag.endMs + deltaMs, grid), drag.startMs + MIN_SPAWN_SPAN_MS, maxMs),
      )
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const activeItem = activeList.find((m) => m.key === drag.key)
    if (!activeItem) return
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
      // 固定宽度条表达触发时刻，不表达占用跨度。即使旧数据的 endMs 落在视频末尾，
      // 也必须允许拖动起点；实际动画结束由组件时长决定并在写回层夹到视频范围内。
      const fixedWidth = activeItem.fixedWidthPx != null
      const start = clampMs(
        snapMs(drag.startMs + deltaMs, grid),
        0,
        fixedWidth ? maxMs : Math.max(0, maxMs - span),
      )
      dispatchPatch(drag.key, {
        startMs: start,
        endMs: fixedWidth ? Math.min(maxMs, start + span) : start + span,
        zIndex: nextLayer,
      })
    } else if (drag.mode === 'start') {
      dispatchPatch(drag.key, { startMs: snapMs(drag.startMs + deltaMs, grid), endMs: drag.endMs })
    } else {
      dispatchPatch(drag.key, { startMs: drag.startMs, endMs: snapMs(drag.endMs + deltaMs, grid) })
    }
  }

  function onPointerUp(): void {
    if (seekDragActiveRef.current) {
      seekDragActiveRef.current = false
      onScrubEnd?.()
    }
    setDrag(null)
  }

  function seekMsFromPointer(clientX: number): number | null {
    const canvas = timelineRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return null
    return clampMs(((clientX - rect.left) / rect.width) * maxMs, 0, maxMs)
  }

  // 按下先绝对定位；随后以较低灵敏度围绕该点微调，避免几像素就跨过大量视频时刻。
  function beginSeek(e: React.PointerEvent): void {
    if (!onSeek) return
    const anchorMs = seekMsFromPointer(e.clientX)
    if (anchorMs == null) return
    e.preventDefault()
    e.stopPropagation()
    onScrubStart?.() // 宿主据此暂停正在播放的视频
    seekDragActiveRef.current = true
    timelineRef.current?.setPointerCapture(e.pointerId)
    setDrag({ key: '__seek__', mode: 'move', pointerX: e.clientX, startMs: anchorMs, endMs: anchorMs, zIndex: 0 })
    onSeek(anchorMs)
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
    <div
      className={`mtl-root${editable ? '' : ' is-readonly'}`}
      style={{ '--gc-timeline-h': `${viewportHeight}px` } as CSSProperties}
    >
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
        <span className="gc-zoombar" style={{ display: 'none' }}>
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
          {segments?.map((segment) => (
            <div
              key={segment.id}
              className={`gc-flow-segment${segment.active ? ' is-active' : ''}`}
              style={{
                left: `${segment.startMs * pxPerMs}px`,
                width: `${Math.max(1, (segment.endMs - segment.startMs) * pxPerMs)}px`,
                height: `${canvasHeight}px`,
              }}
              title={`${segment.label} · ${fmtDur(segment.startMs)} - ${fmtDur(segment.endMs)}`}
              aria-hidden
            >
              <span>{segment.label}</span>
            </div>
          ))}
          <div
            className="gc-playhead"
            data-playhead-ms={Math.round(playheadMs)}
            style={{ left: `${playheadMs * pxPerMs}px` }}
            aria-hidden
          />
          {mediaPlayheadTimelineMs != null && mediaPlayheadMaterial ? (
            <div
              className="gc-media-playhead"
              data-media-playhead-ms={Math.round(mediaPlayhead?.localMs ?? 0)}
              style={{
                left: `${mediaPlayheadTimelineMs * pxPerMs}px`,
                top: `${layerTop(mediaPlayheadMaterial.zIndex)}px`,
                height: `${TIMELINE_LAYER_STEP - 2}px`,
              }}
              aria-hidden
            />
          ) : null}
          {settlementMarkers.map((mk) => {
            const dragKey = `${POINT_DRAG_PREFIX}${mk.id}`
            return (
              <div
                key={mk.id}
                className={`gc-point-mark is-settlement${drag?.key === dragKey ? ' is-dragging' : ''}`}
                style={{ left: `${mk.ms * pxPerMs}px` }}
                title={`${mk.label} · ${fmtDur(mk.ms)}（${editable ? '可拖' : '只读'}）`}
              >
                {/* 参考线只画到菱形：继续精确标出时刻，但不穿过下方时间轴行。 */}
                <span
                  className="gc-point-head"
                  style={{ left: `${pointHeadOffsetPx(mk.ms, maxMs)}px` }}
                  role="slider"
                  tabIndex={editable ? 0 : -1}
                  aria-label={mk.label}
                  aria-valuenow={mk.ms}
                  aria-valuemin={0}
                  aria-valuemax={maxMs}
                  onPointerDown={(e) => {
                    if (!editable || !onPointMarkerChange) return
                    e.preventDefault()
                    e.stopPropagation()
                    timelineRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ key: dragKey, mode: 'move', pointerX: e.clientX, startMs: mk.ms, endMs: mk.ms, zIndex: 0 })
                  }}
                />
              </div>
            )
          })}
          {lifecycleMarkers.length ? (
            <div className="gc-life-lane" style={{ top: `${layerTop(lifecycleTrack)}px`, width: `${canvasPx}px` }} aria-hidden>
              <span className="gc-life-lane-tag">结算</span>
            </div>
          ) : null}
          {lifecycleMarkers.map((mk) => {
            const dragKey = `${POINT_DRAG_PREFIX}${mk.id}`
            const derived = mk.kind === 'derived' || mk.draggable === false
            return (
              // 竖线 + 效果轨菱形是一体的：包裹层零宽、按 ms 定位，竖线只从顶部画到菱形，
              // 让时刻与上方覆盖物条对齐，同时不干扰菱形下方的时间轴行。
              <div
                key={mk.id}
                className={`gc-point-mark is-lifecycle${derived ? ' is-derived' : ''}${drag?.key === dragKey ? ' is-dragging' : ''}${selectedPointMarkerId === mk.id ? ' is-selected' : ''}`}
                style={{
                  left: `${mk.ms * pxPerMs}px`,
                  height: `${layerTop(lifecycleTrack) + 16}px`,
                }}
              >
                <span
                  className={`gc-life-head${derived ? ' is-derived' : ''}`}
                  style={{
                    left: `${pointHeadOffsetPx(mk.ms, maxMs)}px`,
                    top: `${layerTop(lifecycleTrack) + 16}px`,
                  }}
                  role="slider"
                  tabIndex={selectable || editable ? 0 : -1}
                  aria-label={mk.label}
                  aria-valuenow={mk.ms}
                  aria-valuemin={0}
                  aria-valuemax={maxMs}
                  title={`${mk.label} · ${fmtDur(mk.ms)}${derived ? '（由界面窗口决定）' : editable ? '（可拖）' : '（只读）'}`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    // 按下即选（与材料条一致）：只想让右侧高亮时不必真的拖动。
                    if (selectable) onSelectPointMarker?.(mk.id)
                    if (derived || !editable || !onPointMarkerChange) return
                    timelineRef.current?.setPointerCapture(e.pointerId)
                    setDrag({ key: dragKey, mode: 'move', pointerX: e.clientX, startMs: mk.ms, endMs: mk.ms, zIndex: 0 })
                  }}
                />
              </div>
            )
          })}
          {spawnGroupList.map((grp) => {
            const topRowTrack = spawnBarTrack(lifecycleTrack, grp.uBase, grp.bars.length - 1)
            const barWidth = (bar: { startMs: number; endMs: number }) =>
              Math.max(CLIP_MIN_PX, (bar.endMs - bar.startMs) * pxPerMs)
            // 条自带最小宽度，组框按实际渲染出的最宽一条量，才不会被短条截断。
            const widestBarPx = Math.max(...grp.bars.map(barWidth))
            // 条高 32 落在 34 的轨距里，故垂直跨度 = (n-1)×轨距 + 条高。
            const barsSpanPx = (grp.bars.length - 1) * TIMELINE_LAYER_STEP + 32
            return (
              <Fragment key={grp.markerId}>
                {/* 虚线组框：把同属一个结算的界面圈成一体，四边留白，不贴着条边。
                    选中宿主菱形时整组一起点亮，作者一眼看出这几行归哪个结算。 */}
                <div
                  className={`gc-spawn-group${selectedPointMarkerId === grp.markerId ? ' is-selected' : ''}`}
                  data-spawn-group={grp.markerId}
                  style={{
                    left: `${grp.startMs * pxPerMs - SPAWN_GROUP_PAD_X}px`,
                    width: `${widestBarPx + SPAWN_GROUP_PAD_X * 2}px`,
                    top: `${layerTop(topRowTrack) - SPAWN_GROUP_PAD_Y}px`,
                    height: `${barsSpanPx + SPAWN_GROUP_PAD_Y * 2}px`,
                  }}
                  aria-hidden
                >
                  <span className="gc-spawn-group-tag">绑定界面 · {grp.bars.length}</span>
                </div>
                {grp.bars.map((bar) => {
                  const dragKey = `${SPAWN_END_DRAG_PREFIX}${bar.id}`
                  const width = barWidth(bar)
                  const selected = selectedSpawnBarId === bar.id
                  return (
                    <div
                      key={bar.id}
                      // 复用材料条的视觉基座（gc-mclip）：圆角/高度/底色/左侧色条/选中描边与
                      // 挂载界面条一致，只用 is-spawn 区分配色，避免第二套条样式漂移。
                      className={`gc-mclip is-spawn gc-spawn-bar${bar.openEnded ? ' is-open-ended' : ''}${selected ? ' is-selected' : ''}${drag?.key === dragKey ? ' is-dragging' : ''}`}
                      data-spawn-bar={bar.id}
                      style={{
                        left: `${bar.startMs * pxPerMs}px`,
                        width: `${width}px`,
                        top: `${layerTop(spawnBarTrack(lifecycleTrack, grp.uBase, bar.rowInGroup))}px`,
                      }}
                      aria-label={`绑定界面 · ${bar.label}`}
                      title={`绑定界面 · ${bar.label} · 出现于结算 ${fmtDur(bar.startMs)}${bar.openEnded ? ' · 常驻到节点结束（拖右端改为按时长）' : ` - ${fmtDur(bar.endMs)}`}`}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!selectable) return
                        // 先点亮宿主结算，再定位到具体这条界面，右侧表单与预览画布同时对齐。
                        onSelectPointMarker?.(grp.markerId)
                        onSelectSpawnBar?.(bar.id)
                      }}
                    >
                      {width >= CLIP_LABEL_MIN_PX ? <span className="gc-mclip-label">{bar.label}</span> : null}
                      {editable && selected && onDeleteSpawnBar ? (
                        <button
                          type="button"
                          className="gc-mdelete"
                          aria-label="解除界面绑定"
                          title="解除绑定（界面配置从本结算移除）"
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSpawnBar(bar.id)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                      {editable ? (
                        <button
                          type="button"
                          className="gc-mhandle is-right"
                          aria-label="调整界面结束时间"
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            // 调时间不选中（同挂载条手柄），但要暂停：否则播放头会在拖动中继续走。
                            onScrubStart?.()
                            timelineRef.current?.setPointerCapture(e.pointerId)
                            setDrag({
                              key: dragKey,
                              mode: 'end',
                              pointerX: e.clientX,
                              startMs: bar.startMs,
                              endMs: bar.endMs,
                              zIndex: 0,
                            })
                          }}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
          {conditionMarkers?.length ? (
            <div
              className="gc-condition-lane"
              style={{ top: `${layerTop(conditionTrack)}px`, width: `${canvasPx}px` }}
            >
              <span className="gc-condition-lane-tag">条件结算</span>
              <div className="gc-condition-list">
                {conditionMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    className={`gc-condition-band${selectedPointMarkerId === marker.id ? ' is-selected' : ''}`}
                    title={marker.label}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (selectable) onSelectPointMarker?.(marker.id)
                    }}
                    tabIndex={selectable ? 0 : -1}
                    aria-disabled={!selectable}
                  >
                    <span aria-hidden>↻</span>
                    <span>{marker.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
                const fixedWidth = m.fixedWidthPx != null
                // 下限必须容得下「左手柄 + 中间可拖区 + 右手柄」，否则两个 8px 手柄在窄条上完全重叠，
                // 只有 DOM 靠后的右手柄能被抓到 → 起点永远调不了（CLIP_MIN_PX 见常量注释）。
                const width = fixedWidth
                  ? Math.max(CLIP_MIN_PX, m.fixedWidthPx ?? CLIP_MIN_PX)
                  : Math.max(CLIP_MIN_PX, (m.endMs - m.startMs) * pxPerMs)
                const selected = selectedMaterialKey === m.key
                return (
                  <Fragment key={m.key}>
                    <div
                      className={`gc-mclip ${materialClass(m.kind)}${selected ? ' is-selected' : ''}${m.overridden ? ' is-overridden' : ''}${fixedWidth ? ' is-fixed-width' : ''}${m.locked ? ' is-locked' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px`, top: `${layerTop(m.zIndex)}px` }}
                      onPointerDown={(e) => onPointerDown(e, m, 'move')}
                      aria-label={`${materialDisplayLabel(m)}${m.label ? ` · ${m.label}` : ''}`}
                      title={`${materialDisplayLabel(m)}${m.label ? ` · ${m.label}` : ''} · ${fmtDur(m.startMs)}${fixedWidth ? ' · 动画时长由组件控制' : ` - ${fmtDur(m.endMs)}`}${m.overridden ? ' · 已脱离方案跟随' : ''}`}
                    >
                      {editable && !fixedWidth && !m.locked ? (
                        <button className="gc-mhandle is-left" onPointerDown={(e) => onPointerDown(e, m, 'start')} aria-label="调整起点" />
                      ) : null}
                      {/* 窄条上不渲染文字：否则会盖住两侧手柄的点击区（文案仍在 title 里可悬停看）。 */}
                      {width >= CLIP_LABEL_MIN_PX ? (
                        <span className="gc-mclip-label">
                          {materialDisplayLabel(m)}{m.label ? ` · ${m.label}` : ''}
                        </span>
                      ) : null}
                      {editable && !m.locked && selected && onDeleteMaterial && canDeleteMaterial(m.kind) ? (
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
                      {editable && !fixedWidth && !m.locked ? (
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
                        onPointerDown={(e) => {
                          if (editable) onPointerDown(e, m, 'marker')
                          else if (selectable) onSelectMaterial(m.key)
                        }}
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
.mtl-root.is-readonly .gc-mtimeline-canvas.is-seekable,
.mtl-root.is-readonly .gc-mtimeline-ruler.is-seekable { cursor: ew-resize; }
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
.mtl-root .gc-flow-segment {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  border-right: 1px solid rgba(184,174,160,.3);
  background: rgba(255,255,255,.018);
  pointer-events: none;
  z-index: 0;
}
.mtl-root .gc-flow-segment:nth-of-type(even) { background: rgba(255,255,255,.032); }
.mtl-root .gc-flow-segment.is-active {
  background: rgba(240,136,64,.065);
  border-right-color: rgba(240,136,64,.45);
}
.mtl-root .gc-flow-segment > span {
  position: absolute;
  top: 23px;
  left: 5px;
  right: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(184,174,160,.72);
  font-size: 9px;
  line-height: 10px;
}
.mtl-root .gc-flow-segment.is-active > span { color: #f5bd75; }
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
.mtl-root .gc-media-playhead {
  position: absolute;
  width: 2px;
  transform: translateX(-1px);
  background: #78b7ff;
  box-shadow: 0 0 9px rgba(95,163,247,.9);
  z-index: 9;
  pointer-events: none;
}
.mtl-root .gc-media-playhead::before {
  content: "";
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: #78b7ff;
}
/* 节点级时刻标记：菱形上方的竖虚线 + 可拖菱形。与橙色播放头刻意区分——播放头是"现在播到哪"，
   这些是"这一刻会发生一件事"。路由结算=蓝紫，动作结算=青绿；两种菱形错开高度，
   同一 ms 上重合时也还能各自抓到。 */
.mtl-root .gc-point-mark {
  position: absolute;
  top: 0;
  height: 10px;
  width: 0;
  z-index: 7;
  pointer-events: none;
  border-left: 1px dashed currentColor;
}
.mtl-root .gc-point-mark.is-settlement { color: rgba(147,163,247,.85); }
/* 动作结算竖线比路由结算淡一档：一个节点可能有多条结算，避免时间轴过于杂乱。 */
.mtl-root .gc-point-mark.is-lifecycle { color: rgba(90,212,192,.5); }
.mtl-root .gc-point-head {
  position: absolute;
  left: 0;
  top: 4px;
  width: 11px;
  height: 11px;
  transform: translateX(-50%) rotate(45deg);
  background: currentColor;
  border: 1px solid #1b1713;
  cursor: ew-resize;
  pointer-events: auto;
}
.mtl-root.is-readonly .gc-point-head,
.mtl-root.is-readonly .gc-life-head,
.mtl-root.is-readonly .gc-mclip,
.mtl-root.is-readonly .gc-mmarker,
.mtl-root.is-readonly .gc-condition-band { cursor: default; }
.mtl-root .gc-condition-band[aria-disabled="true"] { pointer-events: none; }
.mtl-root .gc-point-head:hover,
.mtl-root .gc-point-mark.is-dragging .gc-point-head {
  filter: brightness(1.35);
  box-shadow: 0 0 12px currentColor;
}
.mtl-root .gc-point-mark.is-dragging { border-left-style: solid; }

/* 结算绑定界面：组框圈住同一结算下的全部界面，条本身只有右手柄（起点归菱形）。 */
.mtl-root .gc-spawn-group {
  position: absolute;
  border: 1px dashed rgba(90,212,192,.5);
  border-radius: 10px;
  background: rgba(90,212,192,.06);
  pointer-events: none;
  z-index: 1;
}
/* 宿主菱形被选中：整组连同标签一起提亮，与菱形的选中态同步。 */
.mtl-root .gc-spawn-group.is-selected {
  border-color: rgba(143,240,224,.95);
  background: rgba(90,212,192,.16);
  box-shadow: 0 0 12px rgba(90,212,192,.3);
}
.mtl-root .gc-spawn-group.is-selected .gc-spawn-group-tag { color: #e8fffb; }
/* 标签放在组框右外侧、纵向居中：框现在上下平铺，标签若压在框顶就会盖住上一组。
   右侧那片区域一定是空的——每行只有一条界面，行也从不共用。 */
.mtl-root .gc-spawn-group-tag {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--gc-panel2);
  color: rgba(143,240,224,.9);
  font-size: 10px;
  white-space: nowrap;
}
/* 绑定界面条：配色与挂载界面条同源（见 .is-mount 规则），只多一个层级压在组框之上。
   它属于「界面」这条视觉线；归属哪个结算由虚线组框和位置表达，不靠改色。 */
.mtl-root .gc-mclip.is-spawn {
  z-index: 2;
  cursor: pointer;
}
.mtl-root .gc-mclip.is-spawn.is-dragging { border-color: var(--gc-accent); }
/* 常驻界面没有确定的结束时刻：右端以虚线 + 渐隐开口表达「一直到节点结束」。 */
.mtl-root .gc-mclip.is-spawn.is-open-ended {
  border-right-style: dashed;
  mask-image: linear-gradient(to right, #000 0%, #000 72%, rgba(0,0,0,.25) 100%);
}
/* 选中态要露出条外的解除绑定按钮，遮罩会把它裁掉，所以选中时撤掉遮罩。 */
.mtl-root .gc-mclip.is-spawn.is-open-ended.is-selected { mask-image: none; }
.mtl-root.is-readonly .gc-mclip.is-spawn { cursor: default; }

/* 结算轨：独占材料轨之后的一行；定时/推导时刻显示菱形。 */
.mtl-root .gc-life-lane {
  position: absolute;
  left: 0;
  height: 32px;
  border: 1px dashed rgba(90,212,192,.28);
  border-radius: 8px;
  background: rgba(90,212,192,.05);
  pointer-events: none;
  z-index: 1;
}
.mtl-root .gc-life-lane-tag {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  color: rgba(90,212,192,.58);
  letter-spacing: .04em;
  white-space: nowrap;
  pointer-events: none;
}
.mtl-root .gc-life-head {
  position: absolute;
  left: 0;
  width: 13px;
  height: 13px;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #5ad4c0;
  border: 1px solid #123;
  box-shadow: 0 0 8px rgba(90,212,192,.55);
  cursor: ew-resize;
  pointer-events: auto;
  z-index: 6;
}
.mtl-root .gc-life-head:hover,
.mtl-root .gc-point-mark.is-dragging .gc-life-head,
.mtl-root .gc-point-mark.is-selected .gc-life-head {
  background: #8ff0e0;
  box-shadow: 0 0 14px rgba(90,212,192,.95);
}
/* 选中：菱形加白边，竖线仍保持虚线，只提高对比度与右侧高亮配置块对应。 */
.mtl-root .gc-point-mark.is-selected .gc-life-head { border-color: #f6f1e9; }
.mtl-root .gc-point-mark.is-selected { border-left-style: dashed; color: rgba(90,212,192,.9); }
.mtl-root .gc-point-mark.is-derived { color: rgba(90,212,192,.62); }
.mtl-root .gc-life-head.is-derived {
  background: rgba(18,34,32,.92);
  border: 2px solid currentColor;
  box-shadow: none;
  cursor: pointer;
}
.mtl-root .gc-point-mark.is-derived:hover .gc-life-head,
.mtl-root .gc-point-mark.is-derived.is-selected .gc-life-head {
  background: rgba(90,212,192,.18);
  border-color: #d8fff8;
  box-shadow: 0 0 10px rgba(90,212,192,.65);
}
.mtl-root .gc-condition-lane {
  position: absolute;
  left: 0;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  box-sizing: border-box;
  border: 1px dashed rgba(90,212,192,.25);
  border-radius: 8px;
  background: rgba(90,212,192,.035);
  z-index: 2;
}
.mtl-root .gc-condition-lane-tag {
  flex: none;
  font-size: 10px;
  color: rgba(90,212,192,.58);
  white-space: nowrap;
  pointer-events: none;
}
.mtl-root .gc-condition-list {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.mtl-root .gc-condition-band {
  min-width: 0;
  max-width: 240px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  overflow: hidden;
  border: 1px dashed rgba(90,212,192,.48);
  border-radius: 5px;
  background: rgba(90,212,192,.08);
  color: rgba(202,255,246,.78);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mtl-root .gc-condition-band span:last-child { overflow: hidden; text-overflow: ellipsis; }
.mtl-root .gc-condition-band:hover,
.mtl-root .gc-condition-band.is-selected {
  border-color: rgba(143,240,224,.95);
  background: rgba(90,212,192,.18);
  color: #e8fffb;
  box-shadow: 0 0 10px rgba(90,212,192,.28);
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
.mtl-root .gc-mclip.is-locked { cursor: ew-resize; }
.mtl-root .gc-mclip.is-locked:active { cursor: ew-resize; }
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
.mtl-root .gc-mclip.is-video {
  justify-content: flex-start;
  border-color: rgba(95,163,247,.62);
  color: #dcecff;
  background: rgba(38,70,108,.42);
}
.mtl-root .gc-mclip.is-video::before { background: #5fa3f7; }
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
/* 界面条配色（挂载界面 + 结算绑定界面共用一套：作者眼里它们都是「界面」）。 */
.mtl-root .gc-mclip.is-mount,
.mtl-root .gc-mclip.is-spawn { border-color: rgba(240,136,64,.6); color: #ffe6d2; background: rgba(240,136,64,.14); }
.mtl-root .gc-mclip.is-mount::before,
.mtl-root .gc-mclip.is-spawn::before { background: var(--gc-accent); }
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
