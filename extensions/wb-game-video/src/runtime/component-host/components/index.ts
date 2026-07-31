/**
 * 平台内建组件注册入口。
 *
 * 组件定义、展示名与渲染器的唯一清单是 `new/NEW_COMPONENTS`。
 * 旧组件源码不再从本入口导出或注册，已有旧 component id 运行时按未知组件处理。
 */
import {
  registerOverlayRenderer,
  SkinRegistry,
} from '../rendererRegistry'
import { ComponentRegistry, registerComponent } from '../../registry/component-registry'
import {
  NEW_COMPONENTS,
  battleEnemyHpBarComponent,
  battleParryComponent,
  battlePlayerHpBarComponent,
  battleSkillBarComponent,
  damageFloatTextComponent,
  dialogueComponent,
  gainFloatTextComponent,
  inkKouComponent,
  inkYingMoComponent,
} from './new'

export {
  NEW_COMPONENTS,
  battleEnemyHpBarComponent,
  battleParryComponent,
  battlePlayerHpBarComponent,
  battleSkillBarComponent,
  damageFloatTextComponent,
  dialogueComponent,
  gainFloatTextComponent,
  inkKouComponent,
  inkYingMoComponent,
}

/** 把全部新规格组件注入隔离注册表。 */
export function installNewComponents(reg: ComponentRegistry): void {
  for (const { id, definition } of NEW_COMPONENTS) reg.registerComponent(id, definition)
}

/** GraphSession 默认使用的完整组件契约表。 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  const reg = new ComponentRegistry()
  installNewComponents(reg)
  return reg
}

export type SkinPositioning = 'point' | 'fixed'

/** 有固定交互表现与出口集合的组件。 */
export const INTERACTION_SKINS: Array<{
  id: string
  label: string
  positioning: SkinPositioning
  defaultAnchor?: { x: number; y: number }
  defaultEvents: Array<{ id: string; label?: string; condition?: unknown }>
}> = [
  { id: 'battleParry', label: battleParryComponent.label ?? 'battleParry', positioning: 'fixed', defaultEvents: battleParryComponent.events ?? [] },
  { id: 'inkKou', label: inkKouComponent.label ?? 'inkKou', positioning: 'fixed', defaultEvents: inkKouComponent.events ?? [] },
  { id: 'inkYingMo', label: inkYingMoComponent.label ?? 'inkYingMo', positioning: 'fixed', defaultEvents: inkYingMoComponent.events ?? [] },
  { id: 'battleSkillBar', label: battleSkillBarComponent.label ?? 'battleSkillBar', positioning: 'fixed', defaultEvents: battleSkillBarComponent.events ?? [] },
]

export function skinPositioning(id: string | undefined): SkinPositioning {
  return INTERACTION_SKINS.find((skin) => skin.id === id)?.positioning ?? 'fixed'
}

export function skinDefaultAnchor(id: string | undefined): { x: number; y: number } | undefined {
  return INTERACTION_SKINS.find((skin) => skin.id === id)?.defaultAnchor
}

/** 血条类新规格组件（供编辑器下拉）。 */
export const HP_BAR_COMPONENTS: Array<{ id: string; label: string }> = [
  { id: 'battlePlayerHpBar', label: battlePlayerHpBarComponent.label ?? 'battlePlayerHpBar' },
  { id: 'battleEnemyHpBar', label: battleEnemyHpBarComponent.label ?? 'battleEnemyHpBar' },
]

function installCoreSkins(reg: SkinRegistry): void {
  for (const { id, renderer } of NEW_COMPONENTS) reg.registerOverlayRenderer(id, renderer)
}

let registered = false

/** 注册到默认组件与渲染表（编辑器幂等）。 */
export function registerCoreSkins(): void {
  if (registered) return
  registered = true
  for (const { id, definition, renderer } of NEW_COMPONENTS) {
    registerComponent(id, definition)
    registerOverlayRenderer(id, renderer)
  }
}

/** 新建一份只安装新规格渲染器的隔离表。 */
export function createCoreSkinRegistry(): SkinRegistry {
  const reg = new SkinRegistry()
  installCoreSkins(reg)
  return reg
}
