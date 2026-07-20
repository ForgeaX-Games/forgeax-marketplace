import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * AssetLightbox —— 素材库「生成候选」全屏放大预览 + 常驻图像编辑器。
 *
 * 设计基线：严格走 forgeax design token（lime brand / 中性 elevation / radius 阶梯）。
 *
 * 布局（v2 · 悬浮）：
 *   · 近全屏大图（无侧栏占位，图尽量大）
 *   · 顶部悬浮工具栏：图像默认即可编辑，无需二次点击
 *   · 底部悬浮操作栏：保存 / 采用 / →视频 / 下载 / 删除
 *   · 左上信息条（标题 / 翻页 / 元信息），右上关闭
 *
 * 编辑工具（仅图像）：
 *   · 画笔：取色 + 笔型(实线/高亮) + 粗细
 *   · 打码：马赛克笔刷，拖动像素化
 *   · 箭头：拖动画直线，终点自动生成箭头
 *   · 数字：点击盖圆形数字贴纸，自动 1→2→3… 递增；可整体统一缩放（矢量层，保存时合成）
 *   · 变换：水平/垂直翻转、左右旋转 90°
 *   · 撤销 / 复位
 *   · 保存至原图（就地覆盖）/ 另存为新候选
 */

export interface LightboxItem {
  id: string
  mediaId?: string
  url: string
  kind: 'image' | 'video' | 'audio'
  prompt?: string
  model?: string
  createdAt?: number
  bytes?: number
  filename?: string
  adopted?: boolean
}

type SaveMode = 'replace' | 'new'
type Tool = 'brush' | 'mosaic' | 'arrow' | 'number'
interface Sticker {
  id: string
  x: number
  y: number
  color: string
}

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtTime(ts?: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function readableText(hex: string): string {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(f.slice(0, 2), 16)
  const g = parseInt(f.slice(2, 4), 16)
  const b = parseInt(f.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#fff'
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#111111' : '#ffffff'
}

const MAX_EDIT_DIM = 2048
const STICKER_BASE_R = 18
const FONT_STACK = '"PingFang SC", "Noto Sans SC", system-ui, sans-serif'
const SWATCHES = [
  '#ff5a5a',
  '#ffb056',
  '#ffd24a',
  '#4ade80',
  '#5b9eff',
  '#cc9bfa',
  '#d4ff48',
  '#ffffff',
  '#000000',
]

export function AssetLightbox(props: {
  title: string
  items: LightboxItem[]
  index: number
  onClose: () => void
  onNavigate: (i: number) => void
  onToggleAdopt?: (item: LightboxItem) => void
  onSpawnVideo?: (mediaId: string) => void
  onDelete?: (item: LightboxItem) => void
  onSaveEdited?: (item: LightboxItem, dataUrl: string, mode: SaveMode) => Promise<void> | void
  /** 保存按钮文案覆盖（通用化）：定妆照场景用「替换原图 / 设为新变体」，默认沿用素材库文案。 */
  saveReplaceLabel?: string
  saveNewLabel?: string
}): React.ReactElement | null {
  const saveReplaceLabel = props.saveReplaceLabel ?? '保存至原图'
  const saveNewLabel = props.saveNewLabel ?? '另存为新候选'
  const { title, items, index, onClose, onNavigate } = props
  const item = items[index]
  const editable = !!item && item.kind === 'image' && !!props.onSaveEdited

  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#ff5a5a')
  const [brushSize, setBrushSize] = useState(14)
  const [brushType, setBrushType] = useState<'solid' | 'marker'>('solid')
  const [stickerScale, setStickerScale] = useState(1)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [saving, setSaving] = useState<SaveMode | null>(null)
  const [undoDepth, setUndoDepth] = useState(0)
  const [sizeTick, setSizeTick] = useState(0)

  const editRef = useRef<HTMLCanvasElement | null>(null)
  const stkRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const arrowBaseRef = useRef<HTMLCanvasElement | null>(null)
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null)
  const undoStackRef = useRef<HTMLCanvasElement[]>([])
  const actionsRef = useRef<Array<'raster' | 'sticker'>>([])

  // ref 镜像：pointer / 导出回调读最新参数
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  const sizeRef = useRef(brushSize)
  const typeRef = useRef(brushType)
  const stickersRef = useRef(stickers)
  const scaleRef = useRef(stickerScale)
  toolRef.current = tool
  colorRef.current = color
  sizeRef.current = brushSize
  typeRef.current = brushType
  stickersRef.current = stickers
  scaleRef.current = stickerScale

  const goPrev = useCallback(() => {
    if (items.length <= 1) return
    onNavigate((index - 1 + items.length) % items.length)
  }, [index, items.length, onNavigate])
  const goNext = useCallback(() => {
    if (items.length <= 1) return
    onNavigate((index + 1) % items.length)
  }, [index, items.length, onNavigate])

  const dirty = undoDepth > 0

  const guardedClose = useCallback(() => {
    if (dirty && !window.confirm('放弃未保存的编辑并关闭？')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') guardedClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guardedClose])

  // ── 画布 ───────────────────────────────────────────────────────────────
  const drawAllStickers = useCallback((ctx: CanvasRenderingContext2D) => {
    const r = STICKER_BASE_R * scaleRef.current
    const list = stickersRef.current
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = r * 0.35
      ctx.shadowOffsetY = r * 0.08
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fillStyle = s.color
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = Math.max(2, r * 0.14)
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.fillStyle = readableText(s.color)
      ctx.font = `700 ${r * 1.25}px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), s.x, s.y + r * 0.06)
      ctx.restore()
    }
  }, [])

  const loadImage = useCallback(() => {
    const canvas = editRef.current
    if (!canvas || !item) return
    const img = new Image()
    img.onload = () => {
      let w = img.naturalWidth || img.width
      let h = img.naturalHeight || img.height
      const scale = Math.min(1, MAX_EDIT_DIM / Math.max(w, h))
      w = Math.round(w * scale)
      h = Math.round(h * scale)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      setSizeTick((t) => t + 1)
    }
    img.src = item.url
  }, [item])

  // 切候选：清空编辑态
  useEffect(() => {
    undoStackRef.current = []
    actionsRef.current = []
    arrowBaseRef.current = null
    setUndoDepth(0)
    setStickers([])
  }, [item?.id])

  // 载入图像
  useEffect(() => {
    if (editable) loadImage()
  }, [editable, loadImage])

  // 数字贴纸矢量层重绘
  useEffect(() => {
    const stk = stkRef.current
    const edit = editRef.current
    if (!stk || !edit) return
    if (stk.width !== edit.width || stk.height !== edit.height) {
      stk.width = edit.width
      stk.height = edit.height
    }
    const ctx = stk.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, stk.width, stk.height)
    drawAllStickers(ctx)
  }, [stickers, stickerScale, sizeTick, drawAllStickers])

  const snapshot = useCallback((): HTMLCanvasElement | null => {
    const canvas = editRef.current
    if (!canvas) return null
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    c.getContext('2d')?.drawImage(canvas, 0, 0)
    return c
  }, [])

  const pushRasterUndo = useCallback((): HTMLCanvasElement | null => {
    const snap = snapshot()
    if (!snap) return null
    undoStackRef.current.push(snap)
    actionsRef.current.push('raster')
    if (undoStackRef.current.length > 20) {
      undoStackRef.current.shift()
      const i = actionsRef.current.indexOf('raster')
      if (i >= 0) actionsRef.current.splice(i, 1)
    }
    setUndoDepth(actionsRef.current.length)
    return snap
  }, [snapshot])

  const undo = useCallback(() => {
    const a = actionsRef.current.pop()
    if (!a) return
    if (a === 'sticker') {
      setStickers((s) => s.slice(0, -1))
    } else {
      const prev = undoStackRef.current.pop()
      const canvas = editRef.current
      if (prev && canvas) {
        canvas.width = prev.width
        canvas.height = prev.height
        canvas.getContext('2d')?.drawImage(prev, 0, 0)
        setSizeTick((t) => t + 1)
      }
    }
    setUndoDepth(actionsRef.current.length)
  }, [])

  const resetEdit = useCallback(() => {
    undoStackRef.current = []
    actionsRef.current = []
    setUndoDepth(0)
    setStickers([])
    loadImage()
  }, [loadImage])

  // edit + 贴纸 合成成一张
  const exportToCanvas = useCallback((): HTMLCanvasElement | null => {
    const edit = editRef.current
    if (!edit) return null
    const c = document.createElement('canvas')
    c.width = edit.width
    c.height = edit.height
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(edit, 0, 0)
    drawAllStickers(ctx)
    return c
  }, [drawAllStickers])

  const toXY = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = editRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const pixelate = (ctx: CanvasRenderingContext2D, cx: number, cy: number): void => {
    const canvas = ctx.canvas
    const rad = sizeRef.current * 1.6
    const block = Math.max(5, Math.round(sizeRef.current / 1.1))
    let x = Math.round(cx - rad)
    let y = Math.round(cy - rad)
    let w = Math.round(rad * 2)
    let h = Math.round(rad * 2)
    if (x < 0) { w += x; x = 0 }
    if (y < 0) { h += y; y = 0 }
    if (x + w > canvas.width) w = canvas.width - x
    if (y + h > canvas.height) h = canvas.height - y
    if (w <= 1 || h <= 1) return
    const sw = Math.max(1, Math.round(w / block))
    const sh = Math.max(1, Math.round(h / block))
    const tmp = document.createElement('canvas')
    tmp.width = sw
    tmp.height = sh
    const tctx = tmp.getContext('2d')
    if (!tctx) return
    tctx.imageSmoothingEnabled = false
    tctx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
    ctx.imageSmoothingEnabled = true
  }

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void => {
    const wdt = sizeRef.current
    const col = colorRef.current
    ctx.save()
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineWidth = wdt
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const head = Math.max(wdt * 2.6, 14)
    const ang = Math.atan2(y1 - y0, x1 - x0)
    // 线身缩短一点，给箭头留位
    const bx = x1 - head * 0.6 * Math.cos(ang)
    const by = y1 - head * 0.6 * Math.sin(ang)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 7), y1 - head * Math.sin(ang - Math.PI / 7))
    ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 7), y1 - head * Math.sin(ang + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  const strokeTo = (x: number, y: number): void => {
    const ctx = editRef.current?.getContext('2d')
    if (!ctx) return
    const last = lastRef.current
    if (toolRef.current === 'mosaic') {
      if (last) {
        const dist = Math.hypot(x - last.x, y - last.y)
        const steps = Math.max(1, Math.floor(dist / (sizeRef.current * 0.8)))
        for (let i = 1; i <= steps; i++) {
          pixelate(ctx, last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps)
        }
      } else {
        pixelate(ctx, x, y)
      }
      lastRef.current = { x, y }
      return
    }
    ctx.save()
    ctx.globalAlpha = typeRef.current === 'marker' ? 0.35 : 1
    ctx.strokeStyle = colorRef.current
    ctx.fillStyle = colorRef.current
    ctx.lineWidth = sizeRef.current
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (last) {
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, sizeRef.current / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    lastRef.current = { x, y }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!editable) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const { x, y } = toXY(e)
    const t = toolRef.current
    if (t === 'number') {
      const s: Sticker = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x, y, color: colorRef.current }
      actionsRef.current.push('sticker')
      setStickers((prev) => [...prev, s])
      setUndoDepth(actionsRef.current.length)
      return
    }
    pushRasterUndo()
    drawingRef.current = true
    lastRef.current = null
    if (t === 'arrow') {
      arrowBaseRef.current = snapshot()
      arrowStartRef.current = { x, y }
    } else {
      strokeTo(x, y)
    }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!editable || !drawingRef.current) return
    const { x, y } = toXY(e)
    if (toolRef.current === 'arrow') {
      const base = arrowBaseRef.current
      const start = arrowStartRef.current
      const ctx = editRef.current?.getContext('2d')
      if (!base || !start || !ctx) return
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.drawImage(base, 0, 0)
      drawArrow(ctx, start.x, start.y, x, y)
      return
    }
    strokeTo(x, y)
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (drawingRef.current && toolRef.current === 'arrow') {
      const start = arrowStartRef.current
      const { x, y } = toXY(e)
      // 太短视作误触 → 撤销这次
      if (start && Math.hypot(x - start.x, y - start.y) < 6) undo()
    }
    drawingRef.current = false
    lastRef.current = null
    arrowBaseRef.current = null
    arrowStartRef.current = null
  }

  const transform = (kind: 'flipH' | 'flipV' | 'rotL' | 'rotR'): void => {
    const edit = editRef.current
    if (!edit) return
    // 把当前(含数字贴纸)合成为源，并作为撤销基线；之后清空矢量贴纸
    const src = exportToCanvas()
    if (!src) return
    undoStackRef.current.push(src)
    actionsRef.current.push('raster')
    if (undoStackRef.current.length > 20) {
      undoStackRef.current.shift()
      const i = actionsRef.current.indexOf('raster')
      if (i >= 0) actionsRef.current.splice(i, 1)
    }
    setUndoDepth(actionsRef.current.length)
    setStickers([])
    const ctx = edit.getContext('2d')
    if (!ctx) return
    if (kind === 'flipH' || kind === 'flipV') {
      ctx.clearRect(0, 0, edit.width, edit.height)
      ctx.save()
      if (kind === 'flipH') {
        ctx.translate(edit.width, 0)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(0, edit.height)
        ctx.scale(1, -1)
      }
      ctx.drawImage(src, 0, 0)
      ctx.restore()
    } else {
      edit.width = src.height
      edit.height = src.width
      ctx.save()
      if (kind === 'rotR') {
        ctx.translate(edit.width, 0)
        ctx.rotate(Math.PI / 2)
      } else {
        ctx.translate(0, edit.height)
        ctx.rotate(-Math.PI / 2)
      }
      ctx.drawImage(src, 0, 0)
      ctx.restore()
    }
    setSizeTick((t) => t + 1)
  }

  const doSave = async (mode: SaveMode): Promise<void> => {
    const out = exportToCanvas()
    if (!out || !item || !props.onSaveEdited) return
    setSaving(mode)
    try {
      const dataUrl = out.toDataURL('image/png')
      await props.onSaveEdited(item, dataUrl, mode)
      if (mode === 'replace') {
        // 覆盖成功：画布以新图为准，清空编辑态
        const img = new Image()
        img.onload = () => {
          const canvas = editRef.current
          if (!canvas) return
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d')?.drawImage(img, 0, 0)
          setSizeTick((t) => t + 1)
        }
        img.src = dataUrl
        undoStackRef.current = []
        actionsRef.current = []
        setUndoDepth(0)
        setStickers([])
      }
    } catch {
      /* 错误由调用方 store 记录 */
    } finally {
      setSaving(null)
    }
  }

  const handleDelete = (): void => {
    if (!props.onDelete || !item) return
    if (window.confirm('删除这条候选？删除后不可恢复（若已采用，将一并从本场景移除）。')) {
      props.onDelete(item)
    }
  }

  if (!item) return null
  const busy = saving !== null
  const showColor = tool === 'brush' || tool === 'arrow' || tool === 'number'
  const showWidth = tool === 'brush' || tool === 'mosaic' || tool === 'arrow'

  return createPortal(
    <div className="ks-lbx-backdrop" onClick={guardedClose} role="dialog" aria-modal="true">
      <div className="ks-lbx" onClick={(e) => e.stopPropagation()}>
        {/* 左上信息 */}
        <div className="ks-lbx-topbar">
          <div className="ks-lbx-topline">
            {items.length > 1 ? (
              <button type="button" className="ks-lbx-pg" title="上一张" onClick={goPrev}>
                ‹
              </button>
            ) : null}
            <span className="ks-lbx-title">{title}</span>
            {items.length > 1 ? (
              <>
                <span className="ks-lbx-counter">
                  {index + 1}/{items.length}
                </span>
                <button type="button" className="ks-lbx-pg" title="下一张" onClick={goNext}>
                  ›
                </button>
              </>
            ) : null}
          </div>
          <div className="ks-lbx-metaline">
            {item.model ? <span>{item.model}</span> : null}
            <span>{fmtBytes(item.bytes)}</span>
            <span>{fmtTime(item.createdAt)}</span>
            {item.adopted ? <span className="ks-lbx-tag-on">已采用</span> : null}
          </div>
        </div>

        <button type="button" className="ks-lbx-close" title="关闭 (Esc)" onClick={guardedClose}>
          ✕
        </button>

        {/* 顶部悬浮工具栏（图像常驻） */}
        {editable ? (
          <div className="ks-lbx-toolbar" onClick={(e) => e.stopPropagation()}>
            <div className="ks-lbx-seg" role="tablist">
              {(
                [
                  ['brush', '✏ 画笔'],
                  ['mosaic', '▦ 打码'],
                  ['arrow', '↗ 箭头'],
                  ['number', '① 数字'],
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`ks-lbx-seg-tab ${tool === t ? 'is-on' : ''}`}
                  onClick={() => setTool(t)}
                >
                  {label}
                </button>
              ))}
            </div>

            {showColor ? (
              <div className="ks-lbx-tgroup">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`ks-lbx-swatch ${color.toLowerCase() === c.toLowerCase() ? 'is-on' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
                <input
                  type="color"
                  className="ks-lbx-color"
                  value={color}
                  title="自定义颜色"
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            ) : null}

            {tool === 'brush' ? (
              <div className="ks-lbx-seg ks-lbx-seg-sm">
                <button
                  type="button"
                  className={`ks-lbx-seg-tab ${brushType === 'solid' ? 'is-on' : ''}`}
                  onClick={() => setBrushType('solid')}
                >
                  实线
                </button>
                <button
                  type="button"
                  className={`ks-lbx-seg-tab ${brushType === 'marker' ? 'is-on' : ''}`}
                  onClick={() => setBrushType('marker')}
                >
                  高亮
                </button>
              </div>
            ) : null}

            {showWidth ? (
              <label className="ks-lbx-tgroup ks-lbx-slider" title="粗细">
                <span>粗细</span>
                <input
                  type="range"
                  min={2}
                  max={80}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
                <b>{brushSize}</b>
              </label>
            ) : null}

            {tool === 'number' ? (
              <label className="ks-lbx-tgroup ks-lbx-slider" title="数字贴纸统一缩放">
                <span>数字大小</span>
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.1}
                  value={stickerScale}
                  onChange={(e) => setStickerScale(Number(e.target.value))}
                />
                <b>{stickerScale.toFixed(1)}×</b>
              </label>
            ) : null}

            <div className="ks-lbx-tgroup">
              <button type="button" className="ks-lbx-tbtn" title="水平翻转" onClick={() => transform('flipH')}>
                ⇄
              </button>
              <button type="button" className="ks-lbx-tbtn" title="垂直翻转" onClick={() => transform('flipV')}>
                ⇅
              </button>
              <button type="button" className="ks-lbx-tbtn" title="左转 90°" onClick={() => transform('rotL')}>
                ↺
              </button>
              <button type="button" className="ks-lbx-tbtn" title="右转 90°" onClick={() => transform('rotR')}>
                ↻
              </button>
            </div>

            <div className="ks-lbx-tgroup">
              <button
                type="button"
                className="ks-lbx-tbtn"
                title="撤销"
                disabled={undoDepth === 0}
                onClick={undo}
              >
                ↶
              </button>
              <button
                type="button"
                className="ks-lbx-tbtn"
                title="复位到原图"
                disabled={!dirty}
                onClick={resetEdit}
              >
                ⟲
              </button>
            </div>
          </div>
        ) : null}

        {/* 主舞台 */}
        <div className="ks-lbx-stage">
          {editable ? (
            <div className="ks-lbx-canvas-wrap">
              <canvas
                ref={editRef}
                className={`ks-lbx-canvas ks-lbx-canvas-${tool}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
              <canvas ref={stkRef} className="ks-lbx-stickers" />
            </div>
          ) : item.kind === 'video' ? (
            <video src={item.url} controls autoPlay loop playsInline className="ks-lbx-mediael" />
          ) : item.kind === 'audio' ? (
            <div className="ks-lbx-audio">
              <div className="ks-lbx-audio-icon">🎙</div>
              <audio src={item.url} controls autoPlay />
            </div>
          ) : (
            <img src={item.url} alt={item.prompt ?? ''} draggable={false} className="ks-lbx-mediael" />
          )}
        </div>

        {/* 底部悬浮操作栏 */}
        <div className="ks-lbx-actionbar" onClick={(e) => e.stopPropagation()}>
          {editable ? (
            <>
              <button
                type="button"
                className="ks-lbx-abtn is-primary"
                disabled={busy || !dirty}
                onClick={() => doSave('replace')}
              >
                {saving === 'replace' ? '保存中…' : saveReplaceLabel}
              </button>
              <button
                type="button"
                className="ks-lbx-abtn"
                disabled={busy || !dirty}
                onClick={() => doSave('new')}
              >
                {saving === 'new' ? '保存中…' : saveNewLabel}
              </button>
              <span className="ks-lbx-sep" />
            </>
          ) : null}
          {props.onToggleAdopt && item.kind !== 'audio' ? (
            <button
              type="button"
              className={`ks-lbx-abtn ${item.adopted ? 'is-on' : ''}`}
              onClick={() => props.onToggleAdopt?.(item)}
            >
              {item.adopted ? '✓ 已采用' : '采用'}
            </button>
          ) : null}
          {props.onSpawnVideo && item.kind === 'image' && item.mediaId ? (
            <button
              type="button"
              className="ks-lbx-abtn"
              onClick={() => item.mediaId && props.onSpawnVideo?.(item.mediaId)}
            >
              → 生成视频
            </button>
          ) : null}
          <a className="ks-lbx-abtn" href={item.url} download={item.filename ?? ''}>
            ⤓ 下载
          </a>
          {props.onDelete ? (
            <button type="button" className="ks-lbx-abtn is-danger" onClick={handleDelete}>
              🗑 删除
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const css = `
.ks-lbx-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-top, 9999);
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ks-font-cn, var(--font-sans));
}
.ks-lbx {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: var(--color-background-canvas, #0d0d0d);
  overflow: hidden;
}
.ks-lbx-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 78px 24px 74px;
  background:
    repeating-conic-gradient(#161616 0% 25%, #101010 0% 50%) 50% / 24px 24px;
}
.ks-lbx-canvas-wrap {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: calc(100vh - 152px);
  box-shadow: var(--ks-shadow-lift);
}
.ks-lbx-canvas,
.ks-lbx-mediael {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 152px);
  width: auto;
  height: auto;
  border-radius: var(--radius-sm, 4px);
}
.ks-lbx-canvas { touch-action: none; }
.ks-lbx-canvas-brush  { cursor: crosshair; }
.ks-lbx-canvas-mosaic { cursor: cell; }
.ks-lbx-canvas-arrow  { cursor: crosshair; }
.ks-lbx-canvas-number { cursor: copy; }
.ks-lbx-stickers { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.ks-lbx-audio { display: flex; flex-direction: column; align-items: center; gap: 14px; color: var(--color-text-primary); }
.ks-lbx-audio-icon { font-size: 56px; opacity: 0.7; }

/* 左上信息 */
.ks-lbx-topbar { position: absolute; top: 14px; left: 16px; z-index: 3; display: flex; flex-direction: column; gap: 3px; }
.ks-lbx-topline { display: flex; align-items: center; gap: 8px; }
.ks-lbx-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.ks-lbx-counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); }
.ks-lbx-pg {
  width: 22px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center;
  font-size: 16px; border-radius: var(--radius-sm, 4px);
  border: 1px solid var(--color-border-default); background: var(--color-background-floating); color: var(--color-text-primary);
}
.ks-lbx-pg:hover { border-color: var(--color-border-strong); }
.ks-lbx-metaline { display: flex; gap: 10px; font-size: 11px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.ks-lbx-tag-on { color: var(--color-status-success); }

.ks-lbx-close {
  position: absolute; top: 12px; right: 14px; z-index: 4;
  width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-pill, 9999px);
  border: 1px solid var(--color-border-default); background: var(--color-background-floating); color: var(--color-text-secondary);
  font-size: 14px;
}
.ks-lbx-close:hover { color: var(--color-text-primary); border-color: var(--color-border-strong); }

/* 悬浮工具栏 */
.ks-lbx-toolbar {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 3;
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: center;
  max-width: calc(100vw - 360px);
  padding: 7px 10px;
  background: color-mix(in srgb, var(--color-background-elevated, #242424) 88%, transparent);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--ks-shadow-lift);
  backdrop-filter: blur(8px);
}
.ks-lbx-seg { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-pill, 9999px); background: var(--color-background-base); }
.ks-lbx-seg-tab { padding: 5px 11px; border: none; border-radius: var(--radius-pill, 9999px); font-size: 12px; font-weight: 600; color: var(--color-text-secondary); background: transparent; white-space: nowrap; }
.ks-lbx-seg-tab:hover { color: var(--color-text-primary); background: transparent; }
.ks-lbx-seg-tab.is-on { background: var(--color-brand-primary, #d4ff48); color: var(--color-text-on-bright-primary, #000); }
.ks-lbx-seg-sm .ks-lbx-seg-tab { font-size: 11px; padding: 4px 9px; }
.ks-lbx-tgroup { display: flex; align-items: center; gap: 5px; }
.ks-lbx-swatch { width: 18px; height: 18px; padding: 0; border-radius: var(--radius-sm, 4px); border: 1px solid var(--color-divider-strong); cursor: pointer; }
.ks-lbx-swatch.is-on { box-shadow: 0 0 0 2px var(--color-brand-primary, #d4ff48); border-color: var(--color-brand-primary, #d4ff48); }
.ks-lbx-color { width: 22px; height: 22px; padding: 0; border: 1px solid var(--color-border-default); border-radius: var(--radius-sm, 4px); background: transparent; cursor: pointer; }
.ks-lbx-slider { font-size: 11px; color: var(--color-text-tertiary); }
.ks-lbx-slider input[type=range] { width: 92px; accent-color: var(--color-brand-primary, #d4ff48); }
.ks-lbx-slider b { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); min-width: 26px; }
.ks-lbx-tbtn {
  width: 30px; height: 28px; padding: 0; font-size: 14px;
  border: 1px solid var(--color-border-default); border-radius: var(--radius-sm, 6px);
  background: var(--color-background-floating); color: var(--color-text-primary);
}
.ks-lbx-tbtn:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-interaction-hover); }
.ks-lbx-tbtn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 悬浮操作栏 */
.ks-lbx-actionbar {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 3;
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: center;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-background-elevated, #242424) 88%, transparent);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--ks-shadow-lift);
  backdrop-filter: blur(8px);
}
.ks-lbx-sep { width: 1px; height: 20px; background: var(--color-divider-strong); margin: 0 2px; }
.ks-lbx-abtn {
  font-size: 12.5px; padding: 8px 14px; border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-default, #404040); background: var(--color-background-floating, #333);
  color: var(--color-text-primary); text-decoration: none; white-space: nowrap;
}
.ks-lbx-abtn:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-interaction-hover); }
.ks-lbx-abtn:disabled { opacity: 0.42; cursor: not-allowed; }
.ks-lbx-abtn.is-primary { background: var(--color-brand-primary, #d4ff48); border-color: var(--color-brand-primary, #d4ff48); color: var(--color-text-on-bright-primary, #000); font-weight: 600; }
.ks-lbx-abtn.is-primary:hover:not(:disabled) { background: var(--color-brand-primary-hover, #c5f038); border-color: var(--color-brand-primary-hover, #c5f038); }
.ks-lbx-abtn.is-on { background: var(--color-accent-green-soft); border-color: var(--color-status-success); color: var(--color-status-success); }
.ks-lbx-abtn.is-danger { border-color: var(--color-accent-error-soft); color: var(--color-status-error); }
.ks-lbx-abtn.is-danger:hover:not(:disabled) { background: var(--color-interaction-error); border-color: var(--color-status-error); }

@media (max-width: 720px) {
  .ks-lbx-toolbar { max-width: calc(100vw - 24px); }
}
`

injectStyleOnce('asset-lightbox', css)
