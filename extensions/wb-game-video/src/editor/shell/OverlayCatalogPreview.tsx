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
  OverlayCanvasInteraction,
  type CanvasBox,
  type CanvasInteractionItem,
} from './OverlayCanvasInteraction'

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

/** 内容尚未完成 DOM 测量时的临时命中盒。 */
const DEFAULT_BOX_W = 0.25
const DEFAULT_BOX_H = 0.15
const SNAP_INSET_PX = 18

/** 归一 stage 矩形。 */
type NBox = { left: number; top: number; w: number; h: number }

/** 仅供界面 tab 使用的编辑器设计框，不属于发布 schema。 */
export const DEFAULT_OVERLAY_DESIGN_CANVAS: CanvasBox = {
  left: 0.1,
  top: 0.1,
  width: 0.8,
  height: 0.8,
}
const FULL_STAGE_CANVAS: CanvasBox = { left: 0, top: 0, width: 1, height: 1 }

export type OverlaySnapKind = 'vertical-center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface OverlayPlacement {
  left: number
  top: number
  snap: OverlaySnapKind | null
}

function clampAxis(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value))
}

/** 把组件内容盒完整钳在固定设计画布内，并在靠近中线/四角时吸附。 */
export function placeOverlayBox(
  canvas: CanvasBox,
  box: Pick<CanvasBox, 'width' | 'height'>,
  desired: { left: number; top: number },
  threshold: { x: number; y: number },
  inset: { x: number; y: number } = { x: 0, y: 0 },
): OverlayPlacement {
  const minLeft = canvas.left
  const minTop = canvas.top
  const maxLeft = canvas.left + canvas.width - box.width
  const maxTop = canvas.top + canvas.height - box.height
  let left = clampAxis(desired.left, minLeft, maxLeft)
  let top = clampAxis(desired.top, minTop, maxTop)

  const insetLeft = clampAxis(minLeft + inset.x, minLeft, maxLeft)
  const insetTop = clampAxis(minTop + inset.y, minTop, maxTop)
  const insetRight = clampAxis(maxLeft - inset.x, minLeft, maxLeft)
  const insetBottom = clampAxis(maxTop - inset.y, minTop, maxTop)
  const corners: Array<{ kind: Exclude<OverlaySnapKind, 'vertical-center'>; left: number; top: number }> = [
    { kind: 'top-left', left: insetLeft, top: insetTop },
    { kind: 'top-right', left: insetRight, top: insetTop },
    { kind: 'bottom-left', left: insetLeft, top: insetBottom },
    { kind: 'bottom-right', left: insetRight, top: insetBottom },
  ]
  const thresholdX = Math.max(threshold.x, Number.EPSILON)
  const thresholdY = Math.max(threshold.y, Number.EPSILON)
  const corner = corners
    .filter((candidate) => Math.abs(left - candidate.left) <= threshold.x && Math.abs(top - candidate.top) <= threshold.y)
    .sort((a, b) => (
      Math.hypot((left - a.left) / thresholdX, (top - a.top) / thresholdY)
      - Math.hypot((left - b.left) / thresholdX, (top - b.top) / thresholdY)
    ))[0]
  if (corner) return { left: corner.left, top: corner.top, snap: corner.kind }

  const centeredLeft = canvas.left + (canvas.width - box.width) / 2
  const centeredTop = canvas.top + (canvas.height - box.height) / 2
  if (Math.abs(left - centeredLeft) <= threshold.x && Math.abs(top - centeredTop) <= threshold.y) {
    left = centeredLeft
    top = centeredTop
    return { left, top, snap: 'vertical-center' }
  }
  return { left, top, snap: null }
}

/** 已识别吸附类型后，用组件的真实尺寸求最终落点。 */
export function positionForOverlaySnap(
  canvas: CanvasBox,
  box: Pick<CanvasBox, 'width' | 'height'>,
  snap: OverlaySnapKind,
  inset: { x: number; y: number } = { x: 0, y: 0 },
): { left: number; top: number } {
  const left = canvas.left + inset.x
  const top = canvas.top + inset.y
  const right = canvas.left + canvas.width - box.width - inset.x
  const bottom = canvas.top + canvas.height - box.height - inset.y
  if (snap === 'top-left') return { left, top }
  if (snap === 'top-right') return { left: right, top }
  if (snap === 'bottom-left') return { left, top: bottom }
  if (snap === 'bottom-right') return { left: right, top: bottom }
  return {
    left: canvas.left + (canvas.width - box.width) / 2,
    top: canvas.top + (canvas.height - box.height) / 2,
  }
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

function OverlaySnapGuides({
  kind,
  canvas,
  inset,
}: {
  kind: OverlaySnapKind
  canvas: CanvasBox
  inset: { x: number; y: number }
}): JSX.Element {
  const right = canvas.left + canvas.width
  const bottom = canvas.top + canvas.height
  const x = kind === 'top-right' || kind === 'bottom-right'
    ? right - inset.x
    : kind === 'vertical-center'
      ? canvas.left + canvas.width / 2
      : canvas.left + inset.x
  const y = kind === 'bottom-left' || kind === 'bottom-right'
    ? bottom - inset.y
    : kind === 'vertical-center'
      ? canvas.top + canvas.height / 2
      : canvas.top + inset.y
  return (
    <div
      className="ocp-snap-guides"
      data-snap-guide={kind}
      aria-hidden
    >
      <span
        className="ocp-snap-guide is-vertical"
        style={{ left: `${x * 100}%`, top: `${canvas.top * 100}%`, height: `${canvas.height * 100}%` }}
      />
      <span
        className="ocp-snap-guide is-horizontal"
        style={{ left: `${canvas.left * 100}%`, top: `${y * 100}%`, width: `${canvas.width * 100}%` }}
      />
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
.ocp-design-canvas {
  position:absolute; z-index:48; box-sizing:border-box; pointer-events:none;
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
.ocp-snap-guides { position:absolute; inset:0; z-index:60; pointer-events:none; }
.ocp-snap-guide {
  position:absolute; display:block; box-sizing:border-box; opacity:.62;
}
.ocp-snap-guide.is-vertical { width:0; border-left:1px dashed rgba(112,190,184,.72); }
.ocp-snap-guide.is-horizontal { height:0; border-top:1px dashed rgba(112,190,184,.72); }
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
  const pack = (
    attrs: Record<string, number>,
    attrMeta?: Record<string, { max?: number; initial?: number }>,
    name?: string,
  ) => {
    const attrMax: Record<string, number> = {}
    for (const [k, v] of Object.entries(attrs)) attrMax[k] = attrMeta?.[k]?.max ?? v
    return { name, hp: attrs.hp ?? 0, maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0, attrs: { ...attrs }, attrMax }
  }
  for (const [id, e] of Object.entries(entities ?? {})) {
    const hp = e.attrs?.hp ?? e.attrMeta?.hp?.initial ?? 100
    const attrs = { ...(e.attrs ?? {}), hp }
    ents[id] = pack(attrs, e.attrMeta, e.name?.trim() || id)
  }
  // 保底给两个常见战斗实体样例血量，好让血条皮肤在无实体数据时也有内容。
  if (!ents['ent-player']) ents['ent-player'] = pack({ hp: 72 }, { hp: { max: 100 } }, 'ent-player')
  if (!ents['ent-boss']) ents['ent-boss'] = pack({ hp: 58 }, { hp: { max: 100 } }, 'ent-boss')
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
  onWarnChange,
}: OverlayCatalogPreviewProps): JSX.Element {
  injectStyleOnce('overlay-catalog-preview', PREVIEW_CSS)
  bootEditorSkins()
  const reg = useMemo(() => createCoreSkinRegistry(), [])
  const ctx = useMemo(() => mockHudCtx(entities, variables), [entities, variables])
  const [timeMs, setTimeMs] = useState(400)
  const [dropping, setDropping] = useState(false)
  const [snapGuide, setSnapGuide] = useState<OverlaySnapKind | null>(null)
  const interactionActiveRef = useRef(false)
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
  /** 组件库拖入后待「吸附到落点」的 child：等它渲染 + 实测出内容盒，再把内容中心平移到鼠标点。 */
  const pendingSnapRef = useRef<{ childId: string; left: number; top: number; snap: OverlaySnapKind | null } | null>(null)

  useEffect(() => {
    setDropping(false)
    setSnapGuide(null)
    pendingSnapRef.current = null
  }, [overlay.id])

  const interactive = !!(onAddChild || onPatchChildLayout)
  const overlayCanvasRect = DEFAULT_OVERLAY_DESIGN_CANVAS
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

  /** 事件点 → 归一舞台坐标。 */
  const normPoint = (clientX: number, clientY: number): { left: number; top: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return { left: 0, top: 0 }
    return { left: clamp01((clientX - r.left) / r.width), top: clamp01((clientY - r.top) / r.height) }
  }

  const snapThreshold = (): { x: number; y: number } => ({
    x: stagePx.w > 0 ? 12 / stagePx.w : 0.02,
    y: stagePx.h > 0 ? 12 / stagePx.h : 0.035,
  })

  const snapInset = (): { x: number; y: number } => ({
    x: stagePx.w > 0 ? SNAP_INSET_PX / stagePx.w : 0.025,
    y: stagePx.h > 0 ? SNAP_INSET_PX / stagePx.h : 0.045,
  })

  /** 组件库拖拽尚无真实尺寸，用指针自身探测靠近的中线/角点。 */
  const snapAtPointer = (point: { left: number; top: number }): OverlaySnapKind | null =>
    placeOverlayBox(
      overlayCanvasRect,
      { width: 0, height: 0 },
      point,
      snapThreshold(),
      snapInset(),
    ).snap

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
    const snap = snapAtPointer(p)
    const id = onAddChild(presetId)
    if (typeof id === 'string') pendingSnapRef.current = { childId: id, left: p.left, top: p.top, snap }
    else setSnapGuide(null)
  }

  // 拖入吸附：新 child 渲染并实测出内容盒后，只平移到落点，不改变组件宽高。
  useEffect(() => {
    const pend = pendingSnapRef.current
    if (!pend) return
    const child = overlay.children.find((c) => c.id === pend.childId)
    const cb = contentBoxes[pend.childId]
    if (!child || !cb) return // 尚未渲染/实测完 → 等下一次 contentBoxes 更新
    pendingSnapRef.current = null
    const desired = pend.snap
      ? positionForOverlaySnap(
          overlayCanvasRect,
          { width: cb.w, height: cb.h },
          pend.snap,
          snapInset(),
        )
      : {
          left: pend.left - cb.w / 2,
          top: pend.top - cb.h / 2,
        }
    const placed = placeOverlayBox(
      overlayCanvasRect,
      { width: cb.w, height: cb.h },
      desired,
      { x: 0, y: 0 },
      snapInset(),
    )
    moveChild(
      child.id,
      { left: cb.left, top: cb.top, width: cb.w, height: cb.h },
      placed.left,
      placed.top,
    )
    setSnapGuide(null)
  }, [contentBoxes, overlay.children])

  const interactionItems = useMemo<CanvasInteractionItem[]>(() => {
    return overlay.children.map((child) => {
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
  }, [contentBoxes, overlay.children, warnIds])

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
                setSnapGuide(snapAtPointer(normPoint(e.clientX, e.clientY)))
              }
            : undefined
        }
        onDragLeave={onAddChild
          ? (e) => {
              const next = e.relatedTarget as Node | null
              if (next && e.currentTarget.contains(next)) return
              setDropping(false)
              setSnapGuide(null)
            }
          : undefined}
        onDrop={onAddChild ? onDrop : undefined}
      >
        <div
          className="ocp-design-canvas"
          data-overlay-design-canvas
          style={{
            left: `${overlayCanvasRect.left * 100}%`,
            top: `${overlayCanvasRect.top * 100}%`,
            width: `${overlayCanvasRect.width * 100}%`,
            height: `${overlayCanvasRect.height * 100}%`,
          }}
          aria-hidden
        />
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
        {snapGuide ? <OverlaySnapGuides kind={snapGuide} canvas={overlayCanvasRect} inset={snapInset()} /> : null}
        {interactive &&
          <OverlayCanvasInteraction
            stageRef={stageRef}
            items={interactionItems}
            selectedId={selectedChildId || null}
            onSelect={(id) => {
              onSelectChild?.(id ?? '')
            }}
            onMove={(id, position) => {
              const item = interactionItems.find((candidate) => candidate.id === id)
              if (!item || item.frame.kind !== 'box') return
              const placed = placeOverlayBox(
                overlayCanvasRect,
                { width: item.frame.width, height: item.frame.height },
                { left: position.x, top: position.y },
                interactionActiveRef.current ? snapThreshold() : { x: 0, y: 0 },
                snapInset(),
              )
              setSnapGuide(interactionActiveRef.current ? placed.snap : null)
              moveChild(id, item.frame, placed.left, placed.top)
            }}
            onInteractionChange={(active) => {
              interactionActiveRef.current = active
              if (!active) setSnapGuide(null)
            }}
            onReorder={onPatchChildLayout
              ? (id, direction) => reorder(id, direction)
              : undefined}
            ariaLabel="界面方案画布"
            renderFrame={(item, state) => (
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
