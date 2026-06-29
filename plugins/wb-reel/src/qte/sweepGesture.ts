/**
 * sweepGesture —— SWEEP 类型 QTE 的拖动识别纯函数
 *
 * SWEEP cue 需要玩家在 cue 中心按下后，朝 `cue.sweepDir` 的方向拖动一段距离，
 * 而不是像 TAP 一样单击就触发。把识别逻辑抽成纯函数，好处：
 *
 *   1. 可以在 vitest 里 mock pointer 序列测所有边界（距离阈值 / 方向容差 /
 *      反向拖等于 MISS / 还没到阈值时算"incomplete"），完全离 DOM
 *   2. QTEOverlay 只负责把 mousemove 的屏幕坐标喂进来，拿回 Verdict，
 *      避免 React 组件里写一堆 if/else
 *
 * 语义：
 *   - 按下时 `startSweep` 创建一个 SweepState，记录起点 + 方向
 *   - 每次 mousemove 调 `updateSweep`，返回当前 trail 端点 + 是否"已达阈值"
 *   - 松手时调 `resolveSweep`：
 *       * 达到阈值 & 方向正确 → 返回 'HIT'，调用方按 tap 的 delta 判分
 *       * 达到阈值 & 方向错误 → 返回 'WRONG_DIR'，按 MISS 处理
 *       * 未达到阈值              → 返回 'TOO_SHORT'，按 MISS 处理
 *
 * 阈值选择：
 *   - 默认 48px —— 鼠标轻松拖到的距离，不至于要拖半个屏幕
 *   - 方向容差 `dirToleranceDeg = 45°` —— 向上拖只要落在上半 90° 扇形即可算
 */

export type SweepDir = 'up' | 'down' | 'left' | 'right'

export interface SweepConfig {
  /** 必须到达的最小位移（px）；默认 48 */
  minDistancePx?: number
  /** 方向容差（度，单侧）；默认 45°（总角宽 90°） */
  dirToleranceDeg?: number
}

export interface SweepState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  dir: SweepDir
  cfg: Required<SweepConfig>
}

export interface SweepUpdate {
  /** 当前拖动距离（px，欧氏） */
  distance: number
  /** 当前是否已达到 minDistancePx */
  reachedThreshold: boolean
  /** 当前是否在 dir 的方向扇形内（未达阈值时也有效，供 UI 实时上色） */
  onAxis: boolean
  /** 归一化进度（0..1）：distance / minDistance，夹紧在 1 */
  progress: number
}

export type SweepResolution = 'HIT' | 'WRONG_DIR' | 'TOO_SHORT'

const DEFAULT_CFG: Required<SweepConfig> = {
  minDistancePx: 48,
  dirToleranceDeg: 45,
}

export function startSweep(
  startX: number,
  startY: number,
  dir: SweepDir,
  cfg: SweepConfig = {},
): SweepState {
  return {
    startX,
    startY,
    currentX: startX,
    currentY: startY,
    dir,
    cfg: { ...DEFAULT_CFG, ...cfg },
  }
}

/**
 * 喂新的 pointer 位置，返回派生的 SweepUpdate。
 * 不修改输入 state（纯函数）—— 调用方拿到新 state 和 update 一起 set。
 */
export function updateSweep(
  state: SweepState,
  x: number,
  y: number,
): { next: SweepState; update: SweepUpdate } {
  const dx = x - state.startX
  const dy = y - state.startY
  const distance = Math.hypot(dx, dy)
  const reachedThreshold = distance >= state.cfg.minDistancePx
  const onAxis =
    distance > 2 /* 避免抖动时 atan2 乱跳 */ ? isOnAxis(dx, dy, state.dir, state.cfg.dirToleranceDeg) : true
  const progress = Math.min(1, distance / state.cfg.minDistancePx)
  return {
    next: { ...state, currentX: x, currentY: y },
    update: { distance, reachedThreshold, onAxis, progress },
  }
}

/** 松手结算：只看当前距离 + 方向。 */
export function resolveSweep(state: SweepState): SweepResolution {
  const dx = state.currentX - state.startX
  const dy = state.currentY - state.startY
  const distance = Math.hypot(dx, dy)
  if (distance < state.cfg.minDistancePx) return 'TOO_SHORT'
  if (!isOnAxis(dx, dy, state.dir, state.cfg.dirToleranceDeg)) return 'WRONG_DIR'
  return 'HIT'
}

/**
 * 判断 (dx,dy) 向量是否在 `dir` 指向的扇形（单侧容差 tolDeg）内。
 *
 * 用 dot(v, axis) ≥ |v| * cos(tol) 判定，避免 atan2 + 环绕的麻烦。
 */
export function isOnAxis(
  dx: number,
  dy: number,
  dir: SweepDir,
  tolDeg: number,
): boolean {
  const mag = Math.hypot(dx, dy)
  if (mag === 0) return true
  // 注意：DOM 坐标 y 轴向下，所以 "up" = (0, -1)
  const axis = AXIS_VEC[dir]
  const cosA = (dx * axis[0] + dy * axis[1]) / mag
  const cosTol = Math.cos((tolDeg * Math.PI) / 180)
  return cosA >= cosTol
}

const AXIS_VEC: Record<SweepDir, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  down: [0, 1],
  up: [0, -1],
}
