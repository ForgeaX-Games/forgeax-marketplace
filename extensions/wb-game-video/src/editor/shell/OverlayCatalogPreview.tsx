/**
 * Overlay 目录预览 —— 界面 tab 用；无视频底、无时间轴，节点无关。
 * 通用渲染方案里的**每一个** child（HUD / 交互 / 表现），不写死具体皮肤。
 *
 * 两态（同一组件）：
 *  - **只读**：不传交互回调时 = 纯预览（规则/别处复用）。
 *  - **可交互**（界面 tab）：stage 作组件库拖拽落点；每个 child 叠一个「操作框」（layout 盒）。
 *    **拖动改位置**（layout.left/top）、**方向键微调位置**（选中态 ←↑↓→，Shift 粗调）、
 *    **四角+四边改尺寸**（layout.width/height；边=整条边线可拖，角=对角双轴）
 *    ——对**所有** overlay 开放，
 *    不按组件类型门控（isSizable 只服务视频 tab）。均归一 0~1，写回 schema。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Entity, Layout, Overlay, OverlayChild, Variable } from '../../runtime/schema/graph-schema'
import { bootEditorSkins } from '../init'
import { createCoreSkinRegistry } from '../../runtime/component-host/components'
import type { SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { injectStyleOnce } from '../../styles/injectStyle'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { isInteractive, positionModeOf, type PositionMode } from './editors'
import { OVERLAY_PRESET_MIME } from './ComponentLibrary'

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const clampTo = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

/** 未显式配尺寸的组件，操作框默认展示大小（也是首次缩放的起点）。 */
const DEFAULT_BOX_W = 0.25
const DEFAULT_BOX_H = 0.15

/** 8 个缩放把手：4 角 + 4 边。h/v = 该把手拖动时影响的水平/垂直边（缺省=该轴不动）。 */
type HDir = 'w' | 'e'
type VDir = 'n' | 's'
const HANDLES: Array<{ k: string; h?: HDir; v?: VDir }> = [
  { k: 'nw', h: 'w', v: 'n' }, { k: 'n', v: 'n' }, { k: 'ne', h: 'e', v: 'n' },
  { k: 'w', h: 'w' }, { k: 'e', h: 'e' },
  { k: 'sw', h: 'w', v: 's' }, { k: 's', v: 's' }, { k: 'se', h: 'e', v: 's' },
]

/** 归一 stage 矩形。 */
type NBox = { left: number; top: number; w: number; h: number }

/** 方向键 → 位移方向（单位向量，y 向下为正）；选中组件时按此微调 left/top。 */
const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
}

/**
 * 尺寸缩放手柄开关：暂关。操作框现由实测内容 bbox 驱动、组件 w/h 不再用户可调
 * （运行时多数皮肤对 w/h 惰性）。手柄相关代码（HANDLES / beginResize / .ocp-edge / .ocp-resize CSS）
 * 全部保留——将来做「可编辑事件热区边框」时复用同一套。
 */
const SHOW_RESIZE_HANDLES = false

const PREVIEW_CSS = `
.ocp-root { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ocp-stage {
  position: relative;
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
.ocp-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; opacity: .45; pointer-events: none;
}
.ocp-scrub { display: flex; align-items: center; gap: 8px; font-size: 10px; opacity: .7; }
.ocp-scrub input { flex: 1; }
/* ── 可交互操作层：操作框只描边不挡点（pointer-events:none），选中/拖动/循环全走 stage ── */
.ocp-stage.is-interactive { cursor: default; }
.ocp-stage.is-grab { cursor: grab; }
.ocp-stage.is-grabbing, .ocp-stage.is-grabbing * { cursor: grabbing !important; }
.ocp-hit {
  position: absolute; box-sizing: border-box;
  border: 1px dashed rgba(255,255,255,.28); border-radius: 4px;
  pointer-events: none; touch-action: none;
}
.ocp-hit.is-selected { border: 1px solid var(--gc-accent, #c8955a); box-shadow: 0 0 0 1px rgba(200,149,90,.4); }
.ocp-hit.is-warn { border: 1px solid #ff6b6b; box-shadow: 0 0 0 1px rgba(255,107,107,.5); }
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
.ocp-menu {
  position: fixed; z-index: 100000; min-width: 96px; padding: 3px;
  background: var(--gc-panel, #211c16); border: 1px solid var(--gc-line, rgba(255,255,255,.14));
  border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.5); font-size: 12px;
}
.ocp-menu button {
  display: block; width: 100%; text-align: left; padding: 5px 8px; border: 0; border-radius: 4px;
  background: none; color: var(--gc-txt, #f6f1e9); cursor: pointer;
}
.ocp-menu button:hover { background: var(--gc-item-hover, rgba(255,255,255,.08)); }
/* 四角把手：小方块，拖动双轴缩放。 */
.ocp-resize {
  position: absolute; width: 12px; height: 12px; z-index: 2;
  border-radius: 2px; background: var(--gc-accent, #c8955a);
  border: 1px solid #fff; touch-action: none; pointer-events: auto;
}
.ocp-resize.nw { left: -5px; top: -5px; cursor: nwse-resize; }
.ocp-resize.ne { right: -5px; top: -5px; cursor: nesw-resize; }
.ocp-resize.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.ocp-resize.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
/* 四边把手：覆盖整条边线的高亮长条（两端让出角把手），沿边任意处可拖；hover 加粗发光。 */
.ocp-edge {
  position: absolute; z-index: 1; touch-action: none; pointer-events: auto;
  background: rgba(200,149,90,.35); border-radius: 3px;
  transition: background .1s ease, box-shadow .1s ease;
}
.ocp-edge:hover { background: rgba(200,149,90,.85); box-shadow: 0 0 7px rgba(200,149,90,.75); }
.ocp-edge.n, .ocp-edge.s { left: 9px; right: 9px; height: 5px; cursor: ns-resize; }
.ocp-edge.w, .ocp-edge.e { top: 9px; bottom: 9px; width: 5px; cursor: ew-resize; }
.ocp-edge.n { top: -3px; }
.ocp-edge.s { bottom: -3px; }
.ocp-edge.w { left: -3px; }
.ocp-edge.e { right: -3px; }
/* 选中态：框**内侧**右下角显示 x,y · w×h 像素读数。 */
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
  /** 组件库 chip 拖到画布落地：presetId + 归一落点。 */
  onAddChild?: (presetId: string, layout: Partial<Layout>) => void
  /** 画布上拖动/缩放：写回 child.layout（归一 0~1）。 */
  onPatchChildLayout?: (childId: string, patch: Partial<Layout>) => void
  /** 画布上拖动锚点定位型组件：写回 child.inputs（如 x/y，是该组件的位置控件）。 */
  onPatchChildInputs?: (childId: string, inputs: Record<string, unknown>) => void
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
  onPatchChildInputs,
  onWarnChange,
}: OverlayCatalogPreviewProps): JSX.Element {
  injectStyleOnce('overlay-catalog-preview', PREVIEW_CSS)
  bootEditorSkins()
  const reg = useMemo(() => createCoreSkinRegistry(), [])
  const ctx = useMemo(() => mockHudCtx(entities, variables), [entities, variables])
  const [timeMs, setTimeMs] = useState(400)
  const [dropping, setDropping] = useState(false)
  /** 右键层级菜单（置顶/置底）。 */
  const [menu, setMenu] = useState<{ x: number; y: number; childId: string } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** 每个 child 操作框的 DOM——stage 按其屏幕 rect 做几何命中判定（不依赖 z 序/事件目标）。 */
  const childRefs = useRef<Record<string, HTMLElement | null>>({})
  /** 每个 child 预览渲染层的 DOM——实测可点热区做重叠告警。 */
  const previewRefs = useRef<Record<string, HTMLElement | null>>({})
  /** 拖动进行中——悬停 cursor 逻辑在拖动时让位给「抓紧」。 */
  const draggingRef = useRef(false)
  /** 交互热区重叠冲突集（DOM 实测）。 */
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())
  const warnSigRef = useRef('')
  /** 各按钮真实事件热区（归一 stage 坐标）——画布叠加可视化。 */
  const [hotAreas, setHotAreas] = useState<Array<NBox & { warn: boolean }>>([])
  const hotSigRef = useRef('')
  /** stage 当前像素尺寸——选中态显示 x,y · w×h 像素读数用。 */
  const [stagePx, setStagePx] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  /** 每个 child 真实渲染内容的最小包围盒（归一 stage 坐标，DOM 实测）——操作框贴合内容用。 */
  const [contentBoxes, setContentBoxes] = useState<Record<string, NBox>>({})
  const contentSigRef = useRef('')

  const interactive = !!(onAddChild || onPatchChildLayout || onPatchChildInputs)

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
        for (const el of wrap.querySelectorAll<HTMLElement>('*')) {
          const rc = el.getBoundingClientRect()
          if (!rc.width || !rc.height) continue
          // 排除铺满整屏的透明/背景层（previewRefs / STAGE_FILL wrapper / 全屏皮肤底）——只并入真实内容框。
          if (rc.width >= W * 0.98 && rc.height >= H * 0.98) continue
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
      if (sig !== contentSigRef.current) {
        contentSigRef.current = sig
        setContentBoxes(next)
      }
    }
    measure()
    // load 不冒泡 → 捕获阶段监听；rAF 合并连发的图片 load。
    const onLoad = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    stage.addEventListener('load', onLoad, true)
    return () => { cancelAnimationFrame(raf); stage.removeEventListener('load', onLoad, true) }
  }, [overlay.children, timeMs, interactive, stagePx.w, stagePx.h])

  /** stage 当前像素尺寸（拖拽时 px 位移 → 归一）。 */
  const stageSize = (): { w: number; h: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    return { w: r?.width ?? 0, h: r?.height ?? 0 }
  }
  /** 事件点 → 归一舞台坐标。 */
  const normPoint = (clientX: number, clientY: number): { left: number; top: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return { left: 0, top: 0 }
    return { left: clamp01((clientX - r.left) / r.width), top: clamp01((clientY - r.top) / r.height) }
  }

  /** 读组件当前归一位置（拖拽/微调增量基准）——写它自己的位置字段（inputs.x/y 或 layout.left/top）。
   *  inputs 模式未设值时用实测内容中心 seed，首拖不跳。 */
  const readPosBase = (child: OverlayChild): { mode: PositionMode; x: number; y: number } => {
    const mode = positionModeOf(child.component)
    if (mode.kind === 'inputs') {
      const cb = contentBoxes[child.id]
      return {
        mode,
        x: num(child.inputs?.[mode.xKey], cb ? cb.left + cb.w / 2 : 0.5),
        y: num(child.inputs?.[mode.yKey], cb ? cb.top + cb.h / 2 : 0.5),
      }
    }
    return { mode, x: num(child.layout?.left, 0), y: num(child.layout?.top, 0) }
  }
  /** 写回组件自己的位置字段（inputs.x/y 是它暴露的位置控件；否则 layout.left/top）。 */
  const writePos = (childId: string, mode: PositionMode, x: number, y: number): void => {
    if (mode.kind === 'inputs') onPatchChildInputs?.(childId, { [mode.xKey]: x, [mode.yKey]: y })
    else onPatchChildLayout?.(childId, { left: x, top: y })
  }
  /** 不许组件溢出画布：按内容 bbox 把「拟施加的位移增量」钳到内容仍落在 [0,1] 内，返回允许的增量。 */
  const clampMoveDelta = (cb: NBox | undefined, dx: number, dy: number): { dx: number; dy: number } => {
    if (!cb) return { dx, dy }
    return {
      dx: clampTo(cb.left + dx, 0, 1 - cb.w) - cb.left,
      dy: clampTo(cb.top + dy, 0, 1 - cb.h) - cb.top,
    }
  }

  // 选中组件后方向键微调位置：步长按像素换算成归一，Shift=粗调（10px）否则 1px。写回组件自己的位置字段
  // （inputs.x/y 或 layout.left/top）；位移经 clampMoveDelta 钳到内容不溢出画布。输入框/.gc-list 内让位。
  useEffect(() => {
    if (!interactive || !selectedChildId) return
    const onKey = (e: KeyboardEvent): void => {
      const d = ARROW_DELTA[e.key]
      if (!d) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (t?.closest?.('.gc-list')) return
      const child = overlay.children.find((c) => c.id === selectedChildId)
      if (!child) return
      const { w, h } = stageSize()
      if (!w || !h) return
      e.preventDefault()
      const px = e.shiftKey ? 10 : 1
      const base = readPosBase(child)
      const mv = clampMoveDelta(contentBoxes[child.id], (d[0] * px) / w, (d[1] * px) / h)
      writePos(child.id, base.mode, base.x + mv.dx, base.y + mv.dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactive, onPatchChildLayout, onPatchChildInputs, selectedChildId, overlay.children])

  /** 事件点是否落在某 child 操作框内（用其真实屏幕 rect）。 */
  const rectContains = (childId: string, x: number, y: number): boolean => {
    const r = childRefs.current[childId]?.getBoundingClientRect()
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  /** 命中栈：点上所有 child，顶层在前（按 zIndex 再按数组序，与运行时/预览层叠一致）。 */
  const hitStack = (x: number, y: number) =>
    overlay.children
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => rectContains(c.id, x, y))
      .sort((a, b) => num(a.c.layout?.zIndex, 0) - num(b.c.layout?.zIndex, 0) || a.i - b.i)
      .map(({ c }) => c)
      .reverse()

  /** 层级重排：置顶 = 最大 zIndex+1，置底 = 最小 zIndex-1。 */
  const reorder = (childId: string, to: 'front' | 'back') => {
    if (!onPatchChildLayout) return
    const zs = overlay.children.map((c) => num(c.layout?.zIndex, 0))
    const z = to === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1
    onPatchChildLayout(childId, { zIndex: z })
  }

  /** 悬停在某组件操作框上 → 抓手（grab）；空处 → 默认。拖动中不干预（让位给 grabbing）。 */
  const onStageHoverMove = (e: ReactPointerEvent) => {
    if (!interactive || draggingRef.current) return
    const stage = stageRef.current
    if (!stage) return
    const over = overlay.children.some((c) => rectContains(c.id, e.clientX, e.clientY))
    stage.classList.toggle('is-grab', over)
  }

  /** 右键命中最上层组件 → 弹层级菜单（置顶/置底）。 */
  const onStageContextMenu = (e: ReactMouseEvent) => {
    if (!interactive || !onPatchChildLayout) return
    const stack = hitStack(e.clientX, e.clientY)
    if (!stack.length) { setMenu(null); return }
    e.preventDefault()
    const top = stack[0]!
    onSelectChild?.(top.id)
    setMenu({ x: e.clientX, y: e.clientY, childId: top.id })
  }

  /**
   * stage 按下：几何命中栈（顶层在前）。操作框 pointer-events:none，故 stage 总能收到按下。
   * 模型 = 点击选中 / 拖动移动：拖动移动**当前选中**（在栈内）否则栈顶，改 left/top；
   * 纯点击（无位移）在重叠处**循环**到下一层，供逐层选中。
   */
  const onStagePointerDown = (e: ReactPointerEvent) => {
    if (!interactive) return
    if (menu) setMenu(null) // 任意按下先收起右键菜单
    if ((e.target as HTMLElement).classList.contains('ocp-resize')) return // 交给缩放手柄自身
    const stack = hitStack(e.clientX, e.clientY)
    if (stack.length === 0) {
      onSelectChild?.('')
      return
    }
    const selIdx = stack.findIndex((c) => c.id === selectedChildId)
    const target = selIdx >= 0 ? stack[selIdx] : stack[0]
    if (!target) return
    onSelectChild?.(target.id)
    // 拖动写回组件自己的位置字段（inputs.x/y 或 layout.left/top）；位移按起始内容 bbox 钳制不溢出画布。
    const base = readPosBase(target)
    const startCb = contentBoxes[target.id]
    const { w, h } = stageSize()
    if (!w || !h) return
    const startX = e.clientX
    const startY = e.clientY
    const startL = base.x
    const startT = base.y
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* 无活动指针(合成事件/边缘态):捕获可选,监听照常绑 */ }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 2 && Math.abs(ev.clientY - startY) < 2) return
      if (!moved) {
        moved = true
        draggingRef.current = true
        el.classList.remove('is-grab')
        el.classList.add('is-grabbing') // 拖动中 → 抓紧
      }
      const mv = clampMoveDelta(startCb, (ev.clientX - startX) / w, (ev.clientY - startY) / h)
      writePos(target.id, base.mode, startL + mv.dx, startT + mv.dy)
    }
    const up = () => {
      try { el.releasePointerCapture(e.pointerId) } catch { /* already released */ }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      draggingRef.current = false
      el.classList.remove('is-grabbing')
      // 纯点击（未拖动）+ 已选中项在栈内 + 有重叠 → 循环到下一层，逐层选中。
      if (!moved && selIdx >= 0 && stack.length > 1) {
        const next = stack[(selIdx + 1) % stack.length]
        if (next) onSelectChild?.(next.id)
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  /** 缩放：拖角(双轴)或拖边(单轴)。h='w'/'e' 动左/右边、v='n'/'s' 动上/下边；对角/对边固定。 */
  const beginResize = (e: ReactPointerEvent, childId: string, layout: Layout | undefined, h?: HDir, v?: VDir) => {
    if (!onPatchChildLayout) return
    e.stopPropagation()
    e.preventDefault()
    onSelectChild?.(childId)
    const { w, h: stageH } = stageSize()
    if (!w || !stageH) return
    const startX = e.clientX
    const startY = e.clientY
    const startL = num(layout?.left, 0)
    const startT = num(layout?.top, 0)
    const startW = num(layout?.width, DEFAULT_BOX_W)
    const startH = num(layout?.height, DEFAULT_BOX_H)
    const right = startL + startW
    const bottom = startT + startH
    const MIN = 0.02
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) } catch { /* 无活动指针(合成事件/边缘态):捕获可选,监听照常绑 */ }
    const move = (ev: PointerEvent) => {
      const dnx = (ev.clientX - startX) / w
      const dny = (ev.clientY - startY) / stageH
      let L = startL, T = startT, W = startW, H = startH
      if (h === 'w') { L = Math.min(Math.max(0, startL + dnx), right - MIN); W = right - L }
      else if (h === 'e') { W = Math.max(MIN, Math.min(startW + dnx, 1 - startL)) }
      if (v === 'n') { T = Math.min(Math.max(0, startT + dny), bottom - MIN); H = bottom - T }
      else if (v === 's') { H = Math.max(MIN, Math.min(startH + dny, 1 - startT)) }
      onPatchChildLayout(childId, { left: L, top: T, width: W, height: H })
    }
    const up = () => {
      try { el.releasePointerCapture(e.pointerId) } catch { /* already released */ }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    if (!onAddChild) return
    const presetId = e.dataTransfer.getData(OVERLAY_PRESET_MIME)
    if (!presetId) return
    e.preventDefault()
    onAddChild(presetId, normPoint(e.clientX, e.clientY))
  }

  return (
    <div className="ocp-root">
      <div
        ref={stageRef}
        className={`ocp-stage${interactive ? ' is-interactive' : ''}${dropping ? ' is-dropping' : ''}`}
        onPointerDown={interactive ? onStagePointerDown : undefined}
        onPointerMove={interactive ? onStageHoverMove : undefined}
        onContextMenu={interactive ? onStageContextMenu : undefined}
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
        {overlay.children.length === 0 ? (
          <div className="ocp-empty">{interactive ? '从右侧组件库拖组件到这里' : '此方案暂无组件'}</div>
        ) : (
          overlay.children.map((child) => (
            <div
              key={child.id}
              ref={(el) => { previewRefs.current[child.id] = el }}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {renderOverlayChildPreview(child, reg, ctx, timeMs)}
            </div>
          ))
        )}
        {interactive &&
          hotAreas.map((a, i) => (
            <div
              key={`hot-${i}`}
              className={`ocp-hot${a.warn ? ' is-warn' : ''}`}
              style={{ left: `${a.left * 100}%`, top: `${a.top * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
            />
          ))}
        {interactive &&
          overlay.children.map((child) => {
            const L = child.layout
            const cb = contentBoxes[child.id]
            // 操作框贴合实测内容(位置+尺寸跟随内容渲染处);未测出时(首帧)回退 layout/默认框,避免闪空。
            const pl = cb ? cb.left : num(L?.left, 0)
            const pt = cb ? cb.top : num(L?.top, 0)
            const boxW = cb ? cb.w : typeof L?.width === 'number' ? L.width : DEFAULT_BOX_W
            const boxH = cb ? cb.h : typeof L?.height === 'number' ? L.height : DEFAULT_BOX_H
            const selected = child.id === selectedChildId
            const warn = warnIds.has(child.id)
            return (
              <div
                key={child.id}
                ref={(el) => { childRefs.current[child.id] = el }}
                className={`ocp-hit${selected ? ' is-selected' : ''}${warn ? ' is-warn' : ''}`}
                style={{ left: `${pl * 100}%`, top: `${pt * 100}%`, width: `${boxW * 100}%`, height: `${boxH * 100}%` }}
              >
                <span className="ocp-hit-tag">{child.component}</span>
                {warn && <span className="ocp-warn-tag" title="与另一交互组件热区重叠，运行时点击会互相遮挡">⚠ 重叠</span>}
                {selected && (
                  <>
                    <span className="ocp-dim">
                      {Math.round(pl * stagePx.w)},{Math.round(pt * stagePx.h)} · {Math.round(boxW * stagePx.w)}×{Math.round(boxH * stagePx.h)}
                    </span>
                    {/* 尺寸手柄暂隐藏：操作框现由实测内容驱动、w/h 不再用户可调（见 SHOW_RESIZE_HANDLES）。 */}
                    {SHOW_RESIZE_HANDLES &&
                      HANDLES.map((hd) => {
                        // 角（同时改水平+垂直）= 小方块；边（单轴）= 整条高亮边条。
                        const corner = hd.h != null && hd.v != null
                        return (
                          <span
                            key={hd.k}
                            className={`${corner ? 'ocp-resize' : 'ocp-edge'} ${hd.k}`}
                            onPointerDown={(e) => beginResize(e, child.id, L, hd.h, hd.v)}
                            title="拖动改尺寸"
                          />
                        )
                      })}
                  </>
                )}
              </div>
            )
          })}
      </div>
      {menu && (
        <div className="ocp-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onPointerDown={(e) => { e.stopPropagation(); reorder(menu.childId, 'front'); setMenu(null) }}>⬆ 置顶</button>
          <button type="button" onPointerDown={(e) => { e.stopPropagation(); reorder(menu.childId, 'back'); setMenu(null) }}>⬇ 置底</button>
        </div>
      )}
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
