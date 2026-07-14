/**
 * fx-kinds —— 滤镜 / 特效两个 presentation kind（独立于 core-kinds，避免与运行时负责人
 * 的 core-kinds 改动冲突）。
 *
 * 两者都是「一段时间 + 一图层 + 一组参数」，复用 TimelineElement 的 window/layer/params，
 * **不新增任何 schema 字段**。预设与视觉解析在 `../fx/video-fx`（SSOT）：
 *   · filter：调色滤镜（黑白/怀旧/暖冷调/鲜艳/梦幻…）
 *   · fx：画面特效（闪白/染色/暗角/震屏/变焦冲击）
 *
 * 无 render()：与 dialogue/transition 一致，走引擎泛型 renderOverlay，Player 侧由运行时
 * 负责人接对应渲染（P2）；编辑器预览已用 video-fx 直接画出。
 */
import type { KindPlugin } from './kind-registry'
import { registerKind } from './kind-registry'
import { FILTER_OPTIONS, FX_OPTIONS } from '../fx/video-fx'

export interface FilterParams {
  /** 预设 id（见 FILTER_PRESETS）。 */
  filter?: string
  /** 强度 0~1。 */
  intensity?: number
}
export const filterKind: KindPlugin<FilterParams> = {
  kind: 'filter',
  role: 'presentation',
  label: '滤镜',
  defaults: () => ({ filter: 'warm', intensity: 1 }),
  form: [
    { t: 'select', key: 'filter', label: '滤镜', options: FILTER_OPTIONS },
    { t: 'number', key: 'intensity', label: '强度', step: 0.05 },
  ],
  validate: () => [],
  outputs: () => [],
}

export interface FxParams {
  /** 特效 id（flash/tint/vignette/shake/zoom）。 */
  fx?: string
  /** 强度 0~1。 */
  intensity?: number
  /** 颜色（flash/tint 用）。 */
  color?: string
}
export const fxKind: KindPlugin<FxParams> = {
  kind: 'fx',
  role: 'presentation',
  label: '特效',
  defaults: () => ({ fx: 'flash', intensity: 1 }),
  form: [
    { t: 'select', key: 'fx', label: '特效', options: FX_OPTIONS },
    { t: 'number', key: 'intensity', label: '强度', step: 0.05 },
    { t: 'color', key: 'color', label: '颜色', placeholder: '#ffffff' },
  ],
  validate: () => [],
  outputs: () => [],
}

export const FX_KINDS: KindPlugin[] = [filterKind as unknown as KindPlugin, fxKind as unknown as KindPlugin]

/** 注册滤镜/特效 kind（幂等）。registry 为全局单例：编辑器侧调用后，校验与运行时 getKind 均可见。 */
export function registerFxKinds(): void {
  for (const k of FX_KINDS) registerKind(k)
}
