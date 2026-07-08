import { pxToMs, resolveSnapGridMs, snapMs, type SnapModifiers } from './timelineMath'

/**
 * 时间轴拖拽 · 状态机的纯数据结构 + 状态推进函数
 *
 * 整条链路：
 *
 *   PointerEvent → updateDragState(prev, evt) → DragState
 *                                                  ↓
 *                                       消费方根据 deltaMs 派发 patch
 *                                       （dialogueDrag / cueDrag / branchDrag）
 *
 * 把鼠标事件 → DragState 拆出来的好处：
 *   1. 单测覆盖率高（无 DOM）
 *   2. 多种拖拽对象（dialogue / qte / branch）共享同一份"px → ms"算术
 *   3. 修饰键吸附粒度策略集中维护
 *
 * 注意：raw 值是「未吸附的真实位移」，主要用于 ① 时间码浮提显示 ②
 * snap=false 时的高精度场景；常规拖拽请直接读 `deltaMs`（已吸附）。
 */
export interface DragState {
  /** PointerDown 时光标的 clientX */
  startX: number
  /** 最近一次 PointerMove 的 clientX */
  currentX: number
  /** currentX - startX */
  deltaPx: number
  /** 应用 snap 后的毫秒位移（消费方主用） */
  deltaMs: number
  /** 未吸附的毫秒位移（精度展示用） */
  rawDeltaMs: number
  /** 当前修饰键状态（主要给 UI 显示"细 / 粗"用） */
  modifiers: SnapModifiers
}

export interface CreateDragStateArgs {
  startX: number
  totalMs: number
  trackWidthPx: number
}

export function createDragState(_args: CreateDragStateArgs): DragState {
  return {
    startX: _args.startX,
    currentX: _args.startX,
    deltaPx: 0,
    deltaMs: 0,
    rawDeltaMs: 0,
    modifiers: { shift: false, alt: false },
  }
}

export interface UpdateDragStateArgs {
  currentX: number
  totalMs: number
  trackWidthPx: number
  /** 不传等价于 { shift:false, alt:false } */
  modifiers?: SnapModifiers
  /** 默认 true。关掉 snap 时 deltaMs == rawDeltaMs */
  snap?: boolean
}

export function updateDragState(
  prev: DragState,
  args: UpdateDragStateArgs,
): DragState {
  const mods = args.modifiers ?? { shift: false, alt: false }
  const deltaPx = args.currentX - prev.startX
  const rawDeltaMs = pxToMs(deltaPx, args.totalMs, args.trackWidthPx)
  const useSnap = args.snap !== false
  const grid = useSnap ? resolveSnapGridMs(mods) : 0
  const deltaMs = useSnap ? snapMs(rawDeltaMs, grid) : rawDeltaMs
  return {
    startX: prev.startX,
    currentX: args.currentX,
    deltaPx,
    deltaMs,
    rawDeltaMs,
    modifiers: mods,
  }
}
