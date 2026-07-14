/**
 * blockoutTypes —— 3D 相机调度类型的本地汇出口 + 常量。
 *
 * 核心类型（Blockout / BlockoutObject / BlockoutCamera / Transform / Vec3 / 枚举）
 * 定义在 `scenario/types.ts`（与 Scene/Scenario 同处，单向依赖）。本模块只做 re-export
 * 方便 blockout/ 目录内 import，并放置纯常量。
 */
export type {
  Vec3,
  Transform,
  BlockoutObjectKind,
  BlockoutObject,
  CameraMove,
  BlockoutCamera,
  Blockout,
} from '../../scenario/types'

/** 默认空间尺度（米）—— 地面网格半边长，仅 UI/渲染用。 */
export const BLOCKOUT_GROUND_HALF = 6

export const DEFAULT_VEC3_ZERO = { x: 0, y: 0, z: 0 } as const
export const DEFAULT_VEC3_ONE = { x: 1, y: 1, z: 1 } as const
