/**
 * fx-components —— 滤镜 / 特效两个 presentation 组件（独立于 core-components，避免与运行时负责人
 * 的 core-components 改动冲突）。
 *
 * 两者都是「一段时间 + 叠层顺序 + 一组参数」，复用 OverlayChild 的 window/layout(zIndex)/inputs，
 * **不新增任何 schema 字段**。预设与视觉解析在 `../fx/video-fx`（SSOT）：
 *   · filter：调色滤镜（黑白/怀旧/暖冷调/鲜艳/梦幻…）
 *   · fx：画面特效（闪白/染色/暗角/震屏/变焦冲击）
 *
 * 无 render()：与 dialogue/transition 一致，走引擎泛型 renderOverlay，Player 侧由运行时
 * 负责人接对应渲染（P2）；编辑器预览已用 video-fx 直接画出。
 */
import type { ComponentDef } from './component-registry'
import { registerComponent } from './component-registry'
import { FILTER_OPTIONS, FX_OPTIONS } from '../fx/video-fx'

export interface FilterParams {
  /** 预设 id（见 FILTER_PRESETS）。 */
  filter?: string
  /** 强度 0~1。 */
  intensity?: number
}
export const filterComponent: ComponentDef<FilterParams> = {
  role: 'presentation',
  label: '滤镜',
  inputs: [
    { key: 'filter', label: '滤镜', valueType: 'string', default: 'warm', options: FILTER_OPTIONS },
    { key: 'intensity', label: '强度', valueType: 'number', default: 1 },
  ],
}

export interface FxParams {
  /** 特效 id（flash/tint/vignette/shake/zoom）。 */
  fx?: string
  /** 强度 0~1。 */
  intensity?: number
  /** 颜色（flash/tint 用）。 */
  color?: string
}
export const fxComponent: ComponentDef<FxParams> = {
  role: 'presentation',
  label: '特效',
  inputs: [
    { key: 'fx', label: '特效', valueType: 'string', default: 'flash', options: FX_OPTIONS },
    { key: 'intensity', label: '强度', valueType: 'number', default: 1 },
    { key: 'color', label: '颜色', valueType: 'string', component: 'color' },
  ],
}

export const FX_COMPONENTS: Array<[string, ComponentDef]> = [
  ['filter', filterComponent as unknown as ComponentDef],
  ['fx', fxComponent as unknown as ComponentDef],
]

/** 注册滤镜/特效组件（幂等）。registry 为全局单例：编辑器侧调用后，校验与运行时 getComponent 均可见。 */
export function registerFxComponents(): void {
  for (const [id, c] of FX_COMPONENTS) registerComponent(id, c)
}
