import { useCallback, useEffect, useRef } from 'react'
import { rafThrottle } from '../../lib/rafThrottle'
import {
  createDragState,
  updateDragState,
  type DragState,
} from './timelineDrag'

/**
 * 时间轴拖拽 React Hook · 把 timelineDrag 纯函数 + DOM Pointer 事件 + rAF 节流缝合到一起。
 *
 * 设计要点：
 *   - 一个 hook 实例可以被多个 handle 复用 —— 通过 `beginDrag(evt, opts)` 入口起一次拖拽。
 *   - 真正的状态走 useRef + 闭包；不走 React state，避免 60Hz 移动触发重渲。
 *   - PointerCapture 在事件 target 上 → 离开元素也能继续接收 move/up。
 *   - ESC 取消（onCancel），并阻止 onEnd 提交。
 *   - 监听器一律挂在 document，方便跨 iframe / 弹窗。
 *
 * 调用示例：
 *
 *   const trackRef = useRef<HTMLDivElement>(null)
 *   const drag = useTimelineDrag({
 *     getTrackEl: () => trackRef.current,
 *     getTotalMs: () => scene.durationMs,
 *   })
 *
 *   <div onPointerDown={(e) => drag.beginDrag(e, {
 *     onMove: (s) => setPreview(start + s.deltaMs),
 *     onEnd: (s) => commit(start + s.deltaMs),
 *   })} />
 */

export interface UseTimelineDragArgs {
  /** 返回当前轨道根元素（getBoundingClientRect 用） */
  getTrackEl: () => HTMLElement | null
  /** 返回当前 scene.durationMs（动态读取，避免闭包过时） */
  getTotalMs: () => number
}

export interface BeginDragOpts<C = void> {
  /**
   * pointer down 时回调，可返回一个上下文对象（比如 dialogue 起始时间），
   * 后续 onMove / onEnd 会原样回传。
   */
  onStart?: (e: PointerEvent) => C
  /** 拖动时回调（rAF 节流，最多 60Hz） */
  onMove: (state: DragState, ctx: C) => void
  /** 抬起时回调（取消时不会触发） */
  onEnd?: (state: DragState, ctx: C) => void
  /** ESC 取消时回调（适合还原预览） */
  onCancel?: (ctx: C) => void
  /**
   * 是否启用网格吸附（默认 true）。
   * 关掉以后 deltaMs == rawDeltaMs，但修饰键仍会写到 state.modifiers 里。
   */
  snap?: boolean
}

export interface TimelineDragApi {
  beginDrag: <C = void>(
    e: React.PointerEvent | PointerEvent,
    opts: BeginDragOpts<C>,
  ) => void
  /**
   * 主动取消正在进行的拖拽（如果有）。
   *
   * 用例：dialogue 双击进入行内编辑态时，第一次 pointerdown 启动的 drag 还
   * 挂在 document 上（pointercapture + pointermove/pointerup listener），
   * 它的副作用（onMove → setPreview / onEnd → setPreview(null)）会跟编辑器
   * 抢渲染、抢焦点。进入编辑态前调一次 cancelActive 把它干掉最稳。
   *
   * 没有 active drag 时是 no-op。
   */
  cancelActive: () => void
}

/** 一次拖拽的活动数据（闭包绑定，不进 React state） */
interface ActiveDrag<C> {
  pointerId: number
  trackEl: HTMLElement
  state: DragState
  context: C
  opts: BeginDragOpts<C>
  /** rAF 节流后的 onMove */
  schedule: (e: PointerEvent) => void
  /** 用于 cancel 时清掉队列 */
  scheduleCancel: () => void
}

export function useTimelineDrag(args: UseTimelineDragArgs): TimelineDragApi {
  const argsRef = useRef(args)
  argsRef.current = args
  const activeRef = useRef<ActiveDrag<unknown> | null>(null)

  const teardown = useCallback((opts: { cancelled: boolean }) => {
    const a = activeRef.current
    if (!a) return
    a.scheduleCancel()
    document.removeEventListener('pointermove', a.schedule)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('keydown', onKey)
    try {
      a.trackEl.releasePointerCapture(a.pointerId)
    } catch {
      /* element 可能已离开 DOM */
    }
    if (opts.cancelled) {
      a.opts.onCancel?.(a.context)
    } else {
      a.opts.onEnd?.(a.state, a.context)
    }
    activeRef.current = null
    // 防止上一次未结束的"pendings"漏到下一次拖动
  }, [])

  const onUp = useCallback(() => {
    teardown({ cancelled: false })
  }, [teardown])

  const onCancel = useCallback(() => {
    teardown({ cancelled: true })
  }, [teardown])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') teardown({ cancelled: true })
    },
    [teardown],
  )

  // 卸载时强制清掉游离监听
  useEffect(() => {
    return () => {
      if (activeRef.current) teardown({ cancelled: true })
    }
  }, [teardown])

  const beginDrag = useCallback(
    function <C>(e: React.PointerEvent | PointerEvent, opts: BeginDragOpts<C>): void {
      // 已经有拖拽进行中 → 忽略，避免双指竞态
      if (activeRef.current) return
      const trackEl = argsRef.current.getTrackEl()
      if (!trackEl) return

      const native = (e as React.PointerEvent).nativeEvent ?? (e as PointerEvent)

      // 仅响应主键 / 触摸 / 笔
      if (native.button !== 0 && native.pointerType === 'mouse') return

      const totalMs = argsRef.current.getTotalMs()
      const rect = trackEl.getBoundingClientRect()
      let trackWidthPx = rect.width

      const ctx = (opts.onStart ? opts.onStart(native) : undefined) as C

      let state = createDragState({ startX: native.clientX, totalMs, trackWidthPx })

      const onMoveRaw = (ev: PointerEvent) => {
        // 拖到一半窗口缩放？读最新宽度
        const r = trackEl.getBoundingClientRect()
        trackWidthPx = r.width
        state = updateDragState(state, {
          currentX: ev.clientX,
          totalMs: argsRef.current.getTotalMs(),
          trackWidthPx,
          modifiers: { shift: ev.shiftKey, alt: ev.altKey },
          snap: opts.snap !== false,
        })
        active.state = state
        opts.onMove(state, ctx)
      }
      const throttled = rafThrottle(onMoveRaw)

      const active: ActiveDrag<C> = {
        pointerId: native.pointerId,
        trackEl,
        state,
        context: ctx,
        opts,
        schedule: throttled,
        scheduleCancel: () => throttled.cancel(),
      }
      // 用一个泛型容器存进 ref（运行时 unknown）
      activeRef.current = active as unknown as ActiveDrag<unknown>

      try {
        trackEl.setPointerCapture(native.pointerId)
      } catch {
        /* 不支持的 polyfill 环境就直接跳过 */
      }
      document.addEventListener('pointermove', throttled)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onCancel)
      document.addEventListener('keydown', onKey)

      // 阻断浏览器默认拖拽（图片/链接拖动会污染 pointer 流）
      if (typeof (e as React.PointerEvent).preventDefault === 'function') {
        ;(e as React.PointerEvent).preventDefault()
      }
    },
    [onUp, onCancel, onKey],
  )

  const cancelActive = useCallback(() => {
    if (activeRef.current) teardown({ cancelled: true })
  }, [teardown])

  return { beginDrag, cancelActive }
}
