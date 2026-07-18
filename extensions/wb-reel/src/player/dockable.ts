import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 可贴边的浮动 UI —— 玩家模式 FAB / 工具按钮专用。
 *
 * 真实 bug 现场：原 FAB 用 `position: fixed; top: 18px; right: 18px;` 死位置，
 * 跟顶栏右侧的"导出剧本"撞了。修法 = 让 FAB 可拖拽 + 自动贴最近边停靠。
 *
 * 设计要点：
 *   1) "贴边停靠"模式 = DockPosition { edge, ratio }
 *      - edge = 屏幕的哪一条边（top/right/bottom/left）
 *      - ratio = 沿那条边的 0-1 位置（0=最上/左，1=最下/右）
 *      → 优点：窗口 resize 后自动按比例保持视觉位置
 *   2) 拖拽时用 transform 偏移；松手时算最近边并落到比例
 *   3) localStorage persist（key 由调用方给）
 *
 * 这里**不**做 React hook 之外的副作用：
 *   - 计算（pure）→ computeDockPosition / clampToViewport / cssFromDock
 *   - 存取（IO）  → serializeDock / deserializeDock + loadDock / saveDock
 *   - hook（聚合）→ useDockable
 */

export type DockEdge = 'top' | 'right' | 'bottom' | 'left'

export interface DockPosition {
  edge: DockEdge
  /** 沿 edge 的 0-1 比例 */
  ratio: number
}

export interface Viewport {
  width: number
  height: number
}

interface Size {
  w: number
  h: number
}

const DEFAULT_DOCK: DockPosition = { edge: 'right', ratio: 0.5 }

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数（可单测）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 给定 FAB 当前左上角坐标 + 尺寸 + 视口，决定它应该贴哪条边。
 * 决策方式：FAB 中心到四条边的距离取最小。
 */
export function computeDockPosition(
  topLeft: { x: number; y: number },
  size: Size,
  vp: { width: number; height: number },
): DockPosition {
  const cx = topLeft.x + size.w / 2
  const cy = topLeft.y + size.h / 2
  const dTop = cy
  const dBottom = vp.height - cy
  const dLeft = cx
  const dRight = vp.width - cx

  let edge: DockEdge = 'right'
  let min = dRight
  if (dTop < min) {
    edge = 'top'
    min = dTop
  }
  if (dBottom < min) {
    edge = 'bottom'
    min = dBottom
  }
  if (dLeft < min) {
    edge = 'left'
    min = dLeft
  }

  // ratio：沿目标边的位置归一化
  let ratio = 0
  if (edge === 'left' || edge === 'right') {
    const range = vp.height - size.h
    ratio = range > 0 ? topLeft.y / range : 0
  } else {
    const range = vp.width - size.w
    ratio = range > 0 ? topLeft.x / range : 0
  }
  ratio = Math.max(0, Math.min(1, ratio))
  return { edge, ratio }
}

/** 把任意 (x, y) 钳到视口内，FAB 不会跑到屏外。 */
export function clampToViewport(
  topLeft: { x: number; y: number },
  size: Size,
  vp: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(vp.width - size.w, topLeft.x)),
    y: Math.max(0, Math.min(vp.height - size.h, topLeft.y)),
  }
}

export interface DockCss {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/**
 * DockPosition + 视口 → CSS 偏移。
 * - 左/右停靠：用 right/left 固定边距，top 沿垂直比例
 * - 上/下停靠：用 top/bottom 固定边距，left 沿水平比例
 *
 * margin = FAB 离边的最小距离（默认 12px）
 */
export function cssFromDock(
  dock: DockPosition,
  size: Size,
  vp: { width: number; height: number },
  margin = 12,
): DockCss {
  if (dock.edge === 'right') {
    const range = vp.height - size.h - margin * 2
    return {
      right: margin,
      top: Math.round(dock.ratio * Math.max(0, range) + margin),
    }
  }
  if (dock.edge === 'left') {
    const range = vp.height - size.h - margin * 2
    return {
      left: margin,
      top: Math.round(dock.ratio * Math.max(0, range) + margin),
    }
  }
  if (dock.edge === 'top') {
    const range = vp.width - size.w - margin * 2
    return {
      top: margin,
      left: Math.round(dock.ratio * Math.max(0, range) + margin),
    }
  }
  // bottom
  const range = vp.width - size.w - margin * 2
  return {
    bottom: margin,
    left: Math.round(dock.ratio * Math.max(0, range) + margin),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 序列化 / 持久化
// ─────────────────────────────────────────────────────────────────────────────

export function serializeDock(dock: DockPosition): string {
  return JSON.stringify(dock)
}

export function deserializeDock(raw: string | null | undefined): DockPosition {
  if (!raw) return { ...DEFAULT_DOCK }
  try {
    const parsed = JSON.parse(raw) as Partial<DockPosition>
    const edge = parsed.edge
    if (
      edge !== 'top' &&
      edge !== 'right' &&
      edge !== 'bottom' &&
      edge !== 'left'
    ) {
      return { ...DEFAULT_DOCK }
    }
    let ratio = typeof parsed.ratio === 'number' ? parsed.ratio : 0.5
    if (!Number.isFinite(ratio)) ratio = 0.5
    ratio = Math.max(0, Math.min(1, ratio))
    return { edge, ratio }
  } catch {
    return { ...DEFAULT_DOCK }
  }
}

function loadDock(key: string): DockPosition {
  if (typeof window === 'undefined') return { ...DEFAULT_DOCK }
  try {
    return deserializeDock(window.localStorage.getItem(key))
  } catch {
    return { ...DEFAULT_DOCK }
  }
}

function saveDock(key: string, dock: DockPosition): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, serializeDock(dock))
  } catch {
    // 配额错忽略 —— FAB 位置不是关键数据
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseDockableArgs {
  /** localStorage key；不传不持久化 */
  storageKey?: string
  /** 初始 dock；持久化没值时用这个 */
  initial?: DockPosition
  /** 元素尺寸（px）—— 拖拽数学需要它 */
  size: Size
  /** 距边最小留白 px */
  margin?: number
}

export interface UseDockableReturn {
  /** 应直接展开到组件 root 的 style（含 position: fixed） */
  style: React.CSSProperties
  /** 绑定到 mouseDown 上启动拖拽 */
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  /** 拖动结束后是否 _刚刚_ 移动过；用来阻止 click 误触发 */
  wasDragging: () => boolean
  /** 当前 dock（只读） */
  dock: DockPosition
  /** 强制重置到默认右中 */
  reset: () => void
}

const DRAG_THRESHOLD_PX = 4

export function useDockable(args: UseDockableArgs): UseDockableReturn {
  const margin = args.margin ?? 12
  const [dock, setDock] = useState<DockPosition>(() => {
    if (args.storageKey) return loadDock(args.storageKey)
    return args.initial ?? { ...DEFAULT_DOCK }
  })
  const [vp, setVp] = useState<Viewport>(() =>
    typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1280, height: 720 },
  )
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const dragSnapshotRef = useRef<{
    startX: number
    startY: number
    startTopLeft: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const wasDraggingRef = useRef(false)

  // 视口变化重新刷
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onResize() {
      setVp({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const computeBaseTopLeft = useCallback((): { x: number; y: number } => {
    const css = cssFromDock(dock, args.size, vp, margin)
    let x: number
    let y: number
    if (typeof css.left === 'number') x = css.left
    else x = vp.width - args.size.w - (css.right ?? 0)
    if (typeof css.top === 'number') y = css.top
    else y = vp.height - args.size.h - (css.bottom ?? 0)
    return { x, y }
  }, [dock, vp, args.size, margin])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // 只响应主键
      if (e.button !== 0) return
      const startTopLeft = computeBaseTopLeft()
      dragSnapshotRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTopLeft,
        moved: false,
      }
      // 不立即设 drag 状态，等真的有移动才进入拖拽（避免单击被吃掉）
      const onMove = (ev: PointerEvent): void => {
        const snap = dragSnapshotRef.current
        if (!snap) return
        const dx = ev.clientX - snap.startX
        const dy = ev.clientY - snap.startY
        if (!snap.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        snap.moved = true
        wasDraggingRef.current = true
        const next = clampToViewport(
          { x: snap.startTopLeft.x + dx, y: snap.startTopLeft.y + dy },
          args.size,
          vp,
        )
        setDrag(next)
      }
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const snap = dragSnapshotRef.current
        dragSnapshotRef.current = null
        if (!snap || !snap.moved) {
          setDrag(null)
          return
        }
        const finalTopLeft = clampToViewport(
          {
            x: snap.startTopLeft.x + (ev.clientX - snap.startX),
            y: snap.startTopLeft.y + (ev.clientY - snap.startY),
          },
          args.size,
          vp,
        )
        const newDock = computeDockPosition(finalTopLeft, args.size, vp)
        setDock(newDock)
        setDrag(null)
        if (args.storageKey) saveDock(args.storageKey, newDock)
        // wasDraggingRef 在下一帧后清掉 —— 让 click 监听有时间识别
        setTimeout(() => {
          wasDraggingRef.current = false
        }, 0)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      e.preventDefault()
    },
    [args.size, vp, args.storageKey, computeBaseTopLeft],
  )

  const wasDragging = useCallback(() => wasDraggingRef.current, [])

  const reset = useCallback(() => {
    setDock({ ...DEFAULT_DOCK })
    if (args.storageKey) saveDock(args.storageKey, { ...DEFAULT_DOCK })
  }, [args.storageKey])

  // 计算最终 style：拖拽中用 left/top 跟手；停止时用 cssFromDock
  const style: React.CSSProperties = { position: 'fixed' }
  if (drag) {
    style.left = drag.x
    style.top = drag.y
    style.right = 'auto'
    style.bottom = 'auto'
  } else {
    const css = cssFromDock(dock, args.size, vp, margin)
    if (css.top != null) style.top = css.top
    if (css.right != null) style.right = css.right
    if (css.bottom != null) style.bottom = css.bottom
    if (css.left != null) style.left = css.left
  }

  return {
    style,
    onPointerDown,
    wasDragging,
    dock,
    reset,
  }
}
