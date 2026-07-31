/**
 * Overlay 目录预览 —— 界面 tab 用；无视频底、无时间轴，节点无关。
 * 通用渲染方案里的**每一个** child（HUD / 交互 / 表现），不写死具体皮肤。
 *
 * 两态（同一组件）：
 *  - **只读**：不传交互回调时 = 纯预览（规则/别处复用）。
 *  - **可交互**（界面 tab）：stage 作组件库拖拽落点；每个 child 叠一个「操作框」（layout 盒）。
 *    点击、重叠循环、拖动、方向键微调、边界钳制和层级调整全部复用
 *    OverlayCanvasInteraction；本组件只负责 child 的渲染测量与字段写回。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Entity, Layout, Overlay, Variable } from '../../runtime/schema/graph-schema'
import { bootEditorSkins } from '../init'
import { createCoreSkinRegistry } from '../../runtime/component-host/components'
import type { SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { injectStyleOnce } from '../../styles/injectStyle'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { isInteractive } from './editors'
import { OVERLAY_PRESET_MIME } from './ComponentLibrary'
import { overlayFitTargets } from './overlay-fit-targets'
import {
  clampCanvasDelta,
  OverlayCanvasInteraction,
  type CanvasBox,
  type CanvasInteractionItem,
} from './OverlayCanvasInteraction'

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

/** 内容尚未完成 DOM 测量时的临时命中盒。 */
const DEFAULT_BOX_W = 0.25
const DEFAULT_BOX_H = 0.15

/** 归一 stage 矩形。 */
type NBox = { left: number; top: number; w: number; h: number }

const OVERLAY_CANVAS_ITEM_ID = '__overlay-canvas__'

/** 仅供界面 tab 使用的编辑器设计框，不属于发布 schema。 */
export const DEFAULT_OVERLAY_DESIGN_CANVAS: CanvasBox = {
  left: 0.25,
  top: 0.25,
  width: 0.5,
  height: 0.5,
}
const FULL_STAGE_CANVAS: CanvasBox = { left: 0, top: 0, width: 1, height: 1 }

export interface OverlayContentBounds {
  ready: boolean
  box?: CanvasBox
}

export interface OverlayOverflowRegion extends CanvasBox {
  childId: string
}

/** 当前 overlay 全部 child 内容盒的最小 union；缺任一 child 测量结果时标记为未就绪。 */
export function unionOverlayContentBounds(
  childIds: readonly string[],
  boxes: Readonly<Record<string, NBox>>,
): OverlayContentBounds {
  if (childIds.length === 0) return { ready: true }
  const measured = childIds.map((id) => boxes[id]).filter((box): box is NBox => !!box)
  if (measured.length < childIds.length) return { ready: false }

  const left = clamp01(Math.min(...measured.map((box) => box.left)))
  const top = clamp01(Math.min(...measured.map((box) => box.top)))
  const right = clamp01(Math.max(...measured.map((box) => box.left + box.w)))
  const bottom = clamp01(Math.max(...measured.map((box) => box.top + box.h)))
  const round = (value: number): number => Math.round(value * 10_000) / 10_000
  return {
    ready: true,
    box: {
      left: round(left),
      top: round(top),
      width: round(Math.max(0, right - left)),
      height: round(Math.max(0, bottom - top)),
    },
  }
}

/** 设计画布只向外扩展以容纳内容，不因内容移动/缩小而自动收缩。 */
export function expandOverlayDesignCanvas(canvas: CanvasBox, content: CanvasBox | undefined): CanvasBox {
  if (!content) return { ...canvas }
  const left = Math.min(canvas.left, content.left)
  const top = Math.min(canvas.top, content.top)
  const right = Math.max(canvas.left + canvas.width, content.left + content.width)
  const bottom = Math.max(canvas.top + canvas.height, content.top + content.height)
  const round = (value: number): number => Math.round(value * 10_000) / 10_000
  return {
    left: round(left),
    top: round(top),
    width: round(right - left),
    height: round(bottom - top),
  }
}

/** 返回每个 child 落在设计画布外、但仍位于 16:9 舞台内的可见区域。 */
export function overlayOverflowRegions(
  canvas: CanvasBox,
  boxes: Readonly<Record<string, NBox>>,
): OverlayOverflowRegion[] {
  const canvasRight = canvas.left + canvas.width
  const canvasBottom = canvas.top + canvas.height
  const regions: OverlayOverflowRegion[] = []
  const round = (value: number): number => Math.round(value * 10_000) / 10_000
  const add = (childId: string, left: number, top: number, right: number, bottom: number): void => {
    const clippedLeft = clamp01(left)
    const clippedTop = clamp01(top)
    const clippedRight = clamp01(right)
    const clippedBottom = clamp01(bottom)
    if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return
    regions.push({
      childId,
      left: round(clippedLeft),
      top: round(clippedTop),
      width: round(clippedRight - clippedLeft),
      height: round(clippedBottom - clippedTop),
    })
  }
  for (const [childId, box] of Object.entries(boxes)) {
    const right = box.left + box.w
    const bottom = box.top + box.h
    if (box.top < canvas.top) add(childId, box.left, box.top, right, Math.min(bottom, canvas.top))
    if (bottom > canvasBottom) add(childId, box.left, Math.max(box.top, canvasBottom), right, bottom)
    const middleTop = Math.max(box.top, canvas.top)
    const middleBottom = Math.min(bottom, canvasBottom)
    if (middleBottom > middleTop) {
      if (box.left < canvas.left) add(childId, box.left, middleTop, Math.min(right, canvas.left), middleBottom)
      if (right > canvasRight) add(childId, Math.max(box.left, canvasRight), middleTop, right, middleBottom)
    }
  }
  return regions
}

function percentValue(value: number): string {
  return String(Math.round(value * 1000) / 10)
}

function OverlayBoundsReadout({ box }: { box: CanvasBox }): JSX.Element {
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
        覆盖物画布尺寸
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {([
          ['width', '宽%'],
          ['height', '高%'],
        ] as const).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, fontSize: 10, opacity: 0.85 }}>
            <span>{label}</span>
            <input
              type="number"
              value={percentValue(box[key])}
              aria-label={`覆盖物画布 ${label}`}
              readOnly
              style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 11 }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

const PREVIEW_CSS = `
.ocp-root { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ocp-stage {
  position: relative;
  container-type: size;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(165deg, #1a1510 0%, #0a0908 55%, #12100e 100%);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 0 40px rgba(0,0,0,.45);
}
.ocp-stage.is-dropping { border-color: var(--gc-accent, #c8955a); box-shadow: inset 0 0 40px rgba(200,149,90,.25); }
.ocp-stage::after {
  content: '界面预览';
  position: absolute; left: 8px; top: 6px;
  font-size: 10px; letter-spacing: .06em; opacity: .45; pointer-events: none; z-index: 999;
}
.ocp-stage [data-canvas-item="${OVERLAY_CANVAS_ITEM_ID}"] {
  border: 1px dashed rgba(190,196,204,.72);
  border-radius: 2px;
  background:
    repeating-linear-gradient(
      135deg,
      rgba(190,196,204,.08) 0,
      rgba(190,196,204,.08) 6px,
      rgba(190,196,204,.03) 6px,
      rgba(190,196,204,.03) 12px
    );
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
}
.ocp-stage [data-canvas-item="${OVERLAY_CANVAS_ITEM_ID}"].is-selected {
  border-style: dashed;
  border-color: rgba(220,225,232,.92);
  box-shadow: 0 0 0 1px rgba(200,206,214,.18), inset 0 0 0 1px rgba(255,255,255,.04);
}
.ocp-overflow-region {
  position: absolute;
  z-index: 49;
  box-sizing: border-box;
  pointer-events: none;
  border: 1px dashed rgba(255,82,82,.96);
  background: rgba(255,82,82,.025);
}
.ocp-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; opacity: .45; pointer-events: none;
}
.ocp-scrub { display: flex; align-items: center; gap: 8px; font-size: 10px; opacity: .7; }
.ocp-scrub input { flex: 1; }
.ocp-hit-tag {
  position: absolute; left: 0; top: -15px; white-space: nowrap;
  font-size: 9px; line-height: 1; padding: 2px 4px; border-radius: 3px;
  background: rgba(0,0,0,.6); color: #f6f1e9; pointer-events: none;
}
/* 按钮真实事件热区可视化：青色虚线，冲突时标红。纯展示，不挡点。 */
.ocp-hot { position: absolute; pointer-events: none; border: 1px dashed rgba(90,200,220,.75); border-radius: 3px; background: rgba(90,200,220,.10); }
.ocp-hot.is-warn { border-color: #ff6b6b; background: rgba(255,107,107,.16); }
.ocp-warn-tag {
  position: absolute; left: 0; top: -15px; white-space: nowrap;
  font-size: 9px; line-height: 1; padding: 2px 4px; border-radius: 3px;
  background: #7a2020; color: #ffd9d9; pointer-events: none;
}
/* 选中态：框内侧右下角只显示位置；宽高由方案整体 bounds 统一展示。 */
.ocp-dim {
  position: absolute; right: 2px; bottom: 2px; white-space: nowrap;
  font-size: 9px; line-height: 1; padding: 2px 5px; border-radius: 3px;
  background: var(--gc-accent, #c8955a); color: #1a1510; pointer-events: none;
  font-variant-numeric: tabular-nums; font-weight: 600;
}
`

function mockHudCtx(entities: Record<string, Entity> | undefined, variables: Record<string, Variable> | undefined): SkinCtx {
  const ents: SkinCtx['hud']['entities'] = {}
  const pack = (attrs: Record<string, number>, attrMeta?: Record<string, { max?: number; initial?: number }>) => {
    const attrMax: Record<string, number> = {}
    for (const [k, v] of Object.entries(attrs)) attrMax[k] = attrMeta?.[k]?.max ?? v
    return { hp: attrs.hp ?? 0, maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0, attrs: { ...attrs }, attrMax }
  }
  for (const [id, e] of Object.entries(entities ?? {})) {
    const hp = e.attrs?.hp ?? e.attrMeta?.hp?.initial ?? 100
    const attrs = { ...(e.attrs ?? {}), hp }
    ents[id] = pack(attrs, e.attrMeta)
  }
  // 保底给两个常见战斗实体样例血量，好让血条皮肤在无实体数据时也有内容。
  if (!ents['ent-player']) ents['ent-player'] = pack({ hp: 72 }, { hp: { max: 100 } })
  if (!ents['ent-boss']) ents['ent-boss'] = pack({ hp: 58 }, { hp: { max: 100 } })
  const vars: Record<string, number> = { qi: 3 }
  for (const [id, v] of Object.entries(variables ?? {})) vars[id] = v.initial ?? 0
  return { hud: { entities: ents, vars, flags: {}, score: 1200 } }
}

export interface OverlayCatalogPreviewProps {
  overlay: Overlay
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 传任一交互回调即进入「可交互」态；全缺省 = 只读预览（向后兼容）。 */
  selectedChildId?: string
  onSelectChild?: (childId: string) => void
  /** 组件库 chip 拖到画布落地：presetId（可选带初始 place）；返回新 child id，供拖入吸附定位。 */
  onAddChild?: (
    presetId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ) => string | undefined | void
  /** 画布上拖动：写回 child.layout 的位置字段（归一 0~1），不改组件宽高。 */
  onPatchChildLayout?: (childId: string, patch: Partial<Layout>) => void
  /** 编辑器本地设计画布；不写入 Overlay，也不进入运行时。 */
  designCanvas?: CanvasBox
  /** moveDelta 存在时表示整体移动，调用方需同步平移 children。 */
  onDesignCanvasChange?: (box: CanvasBox, moveDelta?: { x: number; y: number }) => void
  /** 交互热区重叠冲突集变化时回调（DOM 实测得出）——供上层做参数列表标红 / banner。 */
  onWarnChange?: (ids: Set<string>) => void
}

export function OverlayCatalogPreview({
  overlay,
  entities,
  variables,
  selectedChildId,
  onSelectChild,
  onAddChild,
  onPatchChildLayout,
  designCanvas = DEFAULT_OVERLAY_DESIGN_CANVAS,
  onDesignCanvasChange,
  onWarnChange,
}: OverlayCatalogPreviewProps): JSX.Element {
  injectStyleOnce('overlay-catalog-preview', PREVIEW_CSS)
  bootEditorSkins()
  const reg = useMemo(() => createCoreSkinRegistry(), [])
  const ctx = useMemo(() => mockHudCtx(entities, variables), [entities, variables])
  const [timeMs, setTimeMs] = useState(400)
  const [dropping, setDropping] = useState(false)
  const [overlayCanvasSelected, setOverlayCanvasSelected] = useState(false)
  const previousSelectedChildRef = useRef(selectedChildId)
  const stageRef = useRef<HTMLDivElement>(null)
  /** 每个 child 预览渲染层的 DOM——实测可点热区做重叠告警。 */
  const previewRefs = useRef<Record<string, HTMLElement | null>>({})
  /** 交互热区重叠冲突集（DOM 实测）。 */
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())
  const warnSigRef = useRef('')
  /** 各按钮真实事件热区（归一 stage 坐标）——画布叠加可视化。 */
  const [hotAreas, setHotAreas] = useState<Array<NBox & { warn: boolean }>>([])
  const hotSigRef = useRef('')
  /** stage 当前像素尺寸——选中态显示 x,y · w×h 像素读数用。 */
  const [stagePx, setStagePx] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  /** 每个 child 真实渲染内容的最小包围盒（归一 stage 坐标，DOM 实测）——操作框贴合内容用。 */
  const [contentBoxState, setContentBoxState] = useState<{
    overlayId: string
    boxes: Record<string, NBox>
  }>(() => ({ overlayId: overlay.id, boxes: {} }))
  const contentBoxes = contentBoxState.overlayId === overlay.id ? contentBoxState.boxes : {}
  const contentSigRef = useRef('')
  const pendingAutoExpandRef = useRef(false)
  /** 组件库拖入后待「吸附到落点」的 child：等它渲染 + 实测出内容盒，再把内容中心平移到鼠标点。 */
  const pendingSnapRef = useRef<{ childId: string; left: number; top: number } | null>(null)

  const interactive = !!(onAddChild || onPatchChildLayout || onDesignCanvasChange)
  const overlayCanvasRect = designCanvas
  const contentClipRect = interactive ? overlayCanvasRect : FULL_STAGE_CANVAS
  const clipStyle = useMemo<CSSProperties>(() => ({
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    clipPath: `inset(${contentClipRect.top * 100}% ${Math.max(0, 1 - contentClipRect.left - contentClipRect.width) * 100}% ${Math.max(0, 1 - contentClipRect.top - contentClipRect.height) * 100}% ${contentClipRect.left * 100}%)`,
  }), [contentClipRect.height, contentClipRect.left, contentClipRect.top, contentClipRect.width])

  // 跟踪 stage 像素尺寸（缩放/换比例时更新），供选中框显示真实像素读数。
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const update = () => { const r = stage.getBoundingClientRect(); setStagePx({ w: r.width, h: r.height }) }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  // 重叠告警 + 事件热区可视化：量每个**可交互** child 的逐个按钮热区，两两相交则告警。
  useLayoutEffect(() => {
    if (!interactive) return
    const stage = stageRef.current
    if (!stage) return
    const sr = stage.getBoundingClientRect()
    const W = sr.width
    const H = sr.height
    if (!W || !H) return
    type Box = { l: number; t: number; r: number; b: number }
    const affById: Record<string, Box[]> = {}
    for (const child of overlay.children) {
      if (!isInteractive(child.component)) continue
      const wrap = previewRefs.current[child.id]
      if (!wrap) continue
      const cand = Array.from(wrap.querySelectorAll<HTMLElement>('*')).filter((el) => {
        const cs = getComputedStyle(el)
        return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || cs.cursor === 'pointer' || cs.cursor === 'not-allowed'
      })
      const outer = cand.filter((el) => !cand.some((o) => o !== el && o.contains(el)))
      const rects = outer
        .map((el) => el.getBoundingClientRect())
        .filter((rc) => rc.width && rc.height)
        .map((rc) => ({ l: rc.left, t: rc.top, r: rc.right, b: rc.bottom }))
      if (rects.length) affById[child.id] = rects
    }
    const intersects = (a: Box, bx: Box) => a.l < bx.r && bx.l < a.r && a.t < bx.b && bx.t < a.b
    const ids = Object.keys(affById)
    const hit = new Set<string>()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = affById[ids[i]!]!
        const B = affById[ids[j]!]!
        if (A.some((a) => B.some((bx) => intersects(a, bx)))) { hit.add(ids[i]!); hit.add(ids[j]!) }
      }
    }
    const sig = [...hit].sort().join(',')
    if (sig !== warnSigRef.current) {
      warnSigRef.current = sig
      setWarnIds(hit)
      onWarnChange?.(hit)
    }
    const areas = ids.flatMap((id) =>
      affById[id]!.map((bx) => ({ left: (bx.l - sr.left) / W, top: (bx.t - sr.top) / H, w: (bx.r - bx.l) / W, h: (bx.b - bx.t) / H, warn: hit.has(id) })),
    )
    const hotSig = areas.map((a) => `${a.left.toFixed(3)},${a.top.toFixed(3)},${a.w.toFixed(3)},${a.h.toFixed(3)},${a.warn ? 1 : 0}`).join('|')
    if (hotSig !== hotSigRef.current) {
      hotSigRef.current = hotSig
      setHotAreas(areas)
    }
  }, [overlay.children, timeMs, interactive, onWarnChange])

  // 每个 child 的最小内容包围盒（DOM 实测，归一 stage 坐标）——操作框据此贴合真实内容，而非满屏 / 默认框。
  // 量 wrap 内**叶子元素**（真实内容）**并入交互热区元素**（button/role=button/cursor:pointer），
  // 取非零尺寸的 union，保证框完整覆盖内容 + 可点热区；无可测则回退整层（= 满屏，对真·满屏皮肤正确）。
  // 复用热区那段的 stage 归一 + 签名 diff 范式。图片等异步内容用捕获阶段 load 监听 + rAF 重量。
  useLayoutEffect(() => {
    if (!interactive) return
    const stage = stageRef.current
    if (!stage) return
    let raf = 0
    const measure = (): void => {
      const sr = stage.getBoundingClientRect()
      const W = sr.width
      const H = sr.height
      if (!W || !H) return
      const next: Record<string, NBox> = {}
      for (const child of overlay.children) {
        const wrap = previewRefs.current[child.id]
        if (!wrap) continue
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
        for (const el of overlayFitTargets(wrap)) {
          const rc = el.getBoundingClientRect()
          if (!rc.width || !rc.height) continue
          if (rc.left < l) l = rc.left
          if (rc.top < t) t = rc.top
          if (rc.right > r) r = rc.right
          if (rc.bottom > b) b = rc.bottom
        }
        if (!(r > l && b > t)) {
          const rc = wrap.getBoundingClientRect() // 无可测内容（真·全屏皮肤）→ 回退整层
          l = rc.left; t = rc.top; r = rc.right; b = rc.bottom
        }
        next[child.id] = { left: (l - sr.left) / W, top: (t - sr.top) / H, w: (r - l) / W, h: (b - t) / H }
      }
      const sig = Object.entries(next)
        .map(([id, x]) => `${id}:${x.left.toFixed(3)},${x.top.toFixed(3)},${x.w.toFixed(3)},${x.h.toFixed(3)}`)
        .join('|')
      const scopedSig = `${overlay.id}|${sig}`
      if (scopedSig !== contentSigRef.current) {
        contentSigRef.current = scopedSig
        setContentBoxState({ overlayId: overlay.id, boxes: next })
      }
    }
    measure()
    // load 不冒泡 → 捕获阶段监听；rAF 合并连发的图片 load。
    const onLoad = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    stage.addEventListener('load', onLoad, true)
    return () => { cancelAnimationFrame(raf); stage.removeEventListener('load', onLoad, true) }
  }, [overlay.children, timeMs, interactive, stagePx.w, stagePx.h])

  const overlayBounds = useMemo(
    () => unionOverlayContentBounds(overlay.children.map((child) => child.id), contentBoxes),
    [contentBoxes, overlay.children],
  )
  const overflowRegions = useMemo(
    () => overlayOverflowRegions(overlayCanvasRect, contentBoxes),
    [contentBoxes, overlayCanvasRect],
  )

  // 仅组件拖入/移动允许把设计画布向外扩展；手动缩放、参数变化和内容动画不会触发回弹。
  useEffect(() => {
    if (!pendingAutoExpandRef.current || !overlayBounds.ready || !onDesignCanvasChange) return
    pendingAutoExpandRef.current = false
    const next = expandOverlayDesignCanvas(overlayCanvasRect, overlayBounds.box)
    if (
      next.left === overlayCanvasRect.left
      && next.top === overlayCanvasRect.top
      && next.width === overlayCanvasRect.width
      && next.height === overlayCanvasRect.height
    ) return
    onDesignCanvasChange(next)
  }, [onDesignCanvasChange, overlayBounds, overlayCanvasRect])

  useEffect(() => {
    setOverlayCanvasSelected(false)
  }, [overlay.id])

  useEffect(() => {
    if (previousSelectedChildRef.current !== selectedChildId) setOverlayCanvasSelected(false)
    previousSelectedChildRef.current = selectedChildId
  }, [selectedChildId])

  /** 事件点 → 归一舞台坐标。 */
  const normPoint = (clientX: number, clientY: number): { left: number; top: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return { left: 0, top: 0 }
    return { left: clamp01((clientX - r.left) / r.width), top: clamp01((clientY - r.top) / r.height) }
  }

  /** 操作框始终贴真实可见内容；组件自身 width/height 不再作为界面 tab 的编辑盒。 */
  const interactionBox = (child: Overlay['children'][number]): CanvasBox => {
    const content = contentBoxes[child.id]
    return {
      left: content?.left ?? num(child.layout?.left, 0),
      top: content?.top ?? num(child.layout?.top, 0),
      width: content?.w ?? DEFAULT_BOX_W,
      height: content?.h ?? DEFAULT_BOX_H,
    }
  }

  /** 只移动 child：按内容盒位移增量修改 left/top，保留原 width/height。 */
  const moveChild = (childId: string, from: CanvasBox, nextLeft: number, nextTop: number): void => {
    const child = overlay.children.find((candidate) => candidate.id === childId)
    if (!child) return
    pendingAutoExpandRef.current = true
    onPatchChildLayout?.(childId, {
      left: num(child.layout?.left, 0) + nextLeft - from.left,
      top: num(child.layout?.top, 0) + nextTop - from.top,
      right: undefined,
      bottom: undefined,
    })
  }
  /** 层级重排：置顶 = 最大 zIndex+1，置底 = 最小 zIndex-1。 */
  const reorder = (childId: string, to: 'front' | 'back') => {
    if (!onPatchChildLayout) return
    const zs = overlay.children.map((c) => num(c.layout?.zIndex, 0))
    const z = to === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1
    onPatchChildLayout(childId, { zIndex: z })
  }

  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    if (!onAddChild) return
    const presetId = e.dataTransfer.getData(OVERLAY_PRESET_MIME)
    if (!presetId) return
    e.preventDefault()
    // 严格跟随鼠标：不猜落点字段（cue.x/y、CSS 边角锚定、满屏盒各不相同），先按预设默认加组件，
    // 待其渲染 + 实测出内容盒后，把可见内容框的中心平移到落点。
    const p = normPoint(e.clientX, e.clientY)
    const id = onAddChild(presetId)
    if (typeof id === 'string') pendingSnapRef.current = { childId: id, left: p.left, top: p.top }
  }

  // 拖入吸附：新 child 渲染并实测出内容盒后，只平移到落点，不改变组件宽高。
  useEffect(() => {
    const pend = pendingSnapRef.current
    if (!pend) return
    const child = overlay.children.find((c) => c.id === pend.childId)
    const cb = contentBoxes[pend.childId]
    if (!child || !cb) return // 尚未渲染/实测完 → 等下一次 contentBoxes 更新
    pendingSnapRef.current = null
    // 内容中心当前落在 (cb.left+w/2, cb.top+h/2)；要它落到 (pend.left, pend.top) → 施加对应位移。
    const wantDx = pend.left - (cb.left + cb.w / 2)
    const wantDy = pend.top - (cb.top + cb.h / 2)
    const delta = clampCanvasDelta(
      { left: cb.left, top: cb.top, width: cb.w, height: cb.h },
      wantDx,
      wantDy,
    )
    moveChild(
      child.id,
      { left: cb.left, top: cb.top, width: cb.w, height: cb.h },
      cb.left + delta.x,
      cb.top + delta.y,
    )
  }, [contentBoxes, overlay.children])

  const interactionItems = useMemo<CanvasInteractionItem[]>(() => {
    const children: CanvasInteractionItem[] = overlay.children.map((child) => {
      const box = interactionBox(child)
      return {
        id: child.id,
        label: child.component,
        position: { x: box.left, y: box.top },
        frame: { kind: 'box' as const, ...box },
        zIndex: num(child.layout?.zIndex, 0),
        movable: true,
        resizable: false,
        warn: warnIds.has(child.id),
      }
    })
    return [
      {
        id: OVERLAY_CANVAS_ITEM_ID,
        label: '覆盖物画布',
        position: { x: overlayCanvasRect.left, y: overlayCanvasRect.top },
        frame: { kind: 'box' as const, ...overlayCanvasRect },
        zIndex: -50,
        movable: true,
        resizable: true,
        yieldToHigherItems: true,
      },
      ...children,
    ]
  }, [contentBoxes, overlay.children, overlayCanvasRect.height, overlayCanvasRect.left, overlayCanvasRect.top, overlayCanvasRect.width, warnIds])

  return (
    <div className="ocp-root">
      <div
        ref={stageRef}
        className={`ocp-stage${interactive ? ' is-interactive' : ''}${dropping ? ' is-dropping' : ''}`}
        onDragOver={
          onAddChild
            ? (e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (!dropping) setDropping(true)
              }
            : undefined
        }
        onDragLeave={onAddChild ? () => setDropping(false) : undefined}
        onDrop={onAddChild ? onDrop : undefined}
      >
        <div data-overlay-content-clip style={clipStyle}>
          {overlay.children.length === 0 ? (
            <div className="ocp-empty">{interactive ? '从右侧组件库拖组件到这里' : '此方案暂无组件'}</div>
          ) : (
            overlay.children.map((child) => (
              <div
                key={child.id}
                ref={(el) => { previewRefs.current[child.id] = el }}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {renderOverlayChildPreview(
                  child,
                  reg,
                  ctx,
                  timeMs,
                )}
              </div>
            ))
          )}
          {interactive && hotAreas.map((a, i) => (
            <div
              key={`hot-${i}`}
              className={`ocp-hot${a.warn ? ' is-warn' : ''}`}
              style={{ left: `${a.left * 100}%`, top: `${a.top * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
            />
          ))}
        </div>
        {interactive && overflowRegions.map((region, index) => (
          <div
            key={`${region.childId}:${index}`}
            className="ocp-overflow-region"
            data-overflow-child={region.childId}
            aria-hidden
            style={{
              left: `${region.left * 100}%`,
              top: `${region.top * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        ))}
        {interactive &&
          <OverlayCanvasInteraction
            stageRef={stageRef}
            items={interactionItems}
            selectedId={overlayCanvasSelected ? OVERLAY_CANVAS_ITEM_ID : (selectedChildId || null)}
            onSelect={(id) => {
              if (id === OVERLAY_CANVAS_ITEM_ID) {
                setOverlayCanvasSelected(true)
                return
              }
              setOverlayCanvasSelected(false)
              onSelectChild?.(id ?? '')
            }}
            onMove={(id, position) => {
              if (id === OVERLAY_CANVAS_ITEM_ID) {
                onDesignCanvasChange?.({
                  left: position.x,
                  top: position.y,
                  width: overlayCanvasRect.width,
                  height: overlayCanvasRect.height,
                }, {
                  x: position.x - overlayCanvasRect.left,
                  y: position.y - overlayCanvasRect.top,
                })
                return
              }
              const item = interactionItems.find((candidate) => candidate.id === id)
              if (!item || item.frame.kind !== 'box') return
              moveChild(id, item.frame, position.x, position.y)
            }}
            onResize={onDesignCanvasChange
              ? (id, box) => {
                  if (id !== OVERLAY_CANVAS_ITEM_ID) return
                  onDesignCanvasChange(box)
                }
              : undefined}
            onReorder={onPatchChildLayout
              ? (id, direction) => {
                  if (id !== OVERLAY_CANVAS_ITEM_ID) reorder(id, direction)
                }
              : undefined}
            ariaLabel="界面方案画布"
            spaceDragId={OVERLAY_CANVAS_ITEM_ID}
            renderFrame={(item, state) => (
              item.id === OVERLAY_CANVAS_ITEM_ID ? null :
              <>
                <span className="ocp-hit-tag">{item.label}</span>
                {item.warn ? (
                  <span className="ocp-warn-tag" title="与另一交互组件热区重叠，运行时点击会互相遮挡">
                    重叠
                  </span>
                ) : null}
                {state.selected ? (
                  <span className="ocp-dim">
                    {Math.round(state.box.left * stagePx.w)},{Math.round(state.box.top * stagePx.h)}
                  </span>
                ) : null}
              </>
            )}
          />}
      </div>
      {interactive ? <OverlayBoundsReadout box={overlayCanvasRect} /> : null}
      {/* 预览时刻拖条：仅只读预览态显示（规则 tab 等）；界面 tab 可交互态不显，画布固定 t=400ms 渲染。 */}
      {!interactive && (
        <label className="ocp-scrub">
          <span>预览时刻</span>
          <input type="range" min={0} max={3000} step={50} value={timeMs} onChange={(e) => setTimeMs(Number(e.target.value))} />
          <span>{(timeMs / 1000).toFixed(2)}s</span>
        </label>
      )}
    </div>
  )
}
