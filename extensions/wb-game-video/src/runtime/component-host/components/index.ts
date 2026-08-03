/**
 * 平台内建组件注册入口。
 *
 * 组件定义、展示名与渲染器的唯一清单是 `new/` 的 default export。
 * 旧组件源码不再从本入口导出或注册，已有旧 component id 运行时按未知组件处理。
 */
import {
  registerOverlayRenderer,
  SkinRegistry,
} from '../rendererRegistry'
import { ComponentRegistry, registerComponent, type ComponentDef } from '../../registry/component-registry'
import newComponents from './new'
import { BattleEnemyHpBarManifest } from './new/BattleEnemyHpBar'
import { BattleParryManifest } from './new/BattleParry'
import { BattlePlayerHpBarManifest } from './new/BattlePlayerHpBar'
import { BattleSkillManifest } from './new/BattleSkill'
import { DamageFloatTextManifest } from './new/DamageFloatText'
import { DialogueManifest } from './new/Dialogue'
import { GainFloatTextManifest } from './new/GainFloatText'
import { InkKouManifest } from './new/InkKou'
import { InkYingMoManifest } from './new/InkYingMo'
import { StatusNoticeManifest } from './new/StatusNotice'
import { TextOptionManifest } from './new/TextOption'

export {
  BattleEnemyHpBarManifest,
  BattleParryManifest,
  BattlePlayerHpBarManifest,
  BattleSkillManifest,
  DamageFloatTextManifest,
  DialogueManifest,
  GainFloatTextManifest,
  InkKouManifest,
  InkYingMoManifest,
  StatusNoticeManifest,
  TextOptionManifest,
}
export { default as newComponents } from './new'

/** 把全部新规格组件注入隔离注册表。 */
export function installNewComponents(reg: ComponentRegistry): void {
  for (const { manifest } of newComponents) reg.registerComponent(manifest.id, manifest as ComponentDef)
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
  { id: BattleParryManifest.id, label: BattleParryManifest.label ?? BattleParryManifest.id, positioning: 'fixed', defaultEvents: BattleParryManifest.events },
  { id: InkKouManifest.id, label: InkKouManifest.label ?? InkKouManifest.id, positioning: 'fixed', defaultEvents: InkKouManifest.events },
  { id: InkYingMoManifest.id, label: InkYingMoManifest.label ?? InkYingMoManifest.id, positioning: 'fixed', defaultEvents: InkYingMoManifest.events },
  { id: BattleSkillManifest.id, label: BattleSkillManifest.label ?? BattleSkillManifest.id, positioning: 'fixed', defaultEvents: BattleSkillManifest.events },
]

export function skinPositioning(id: string | undefined): SkinPositioning {
  return INTERACTION_SKINS.find((skin) => skin.id === id)?.positioning ?? 'fixed'
}

export function skinDefaultAnchor(id: string | undefined): { x: number; y: number } | undefined {
  return INTERACTION_SKINS.find((skin) => skin.id === id)?.defaultAnchor
}

/** 血条类新规格组件（供编辑器下拉）。 */
export const HP_BAR_COMPONENTS: Array<{ id: string; label: string }> = [
  { id: BattlePlayerHpBarManifest.id, label: BattlePlayerHpBarManifest.label ?? BattlePlayerHpBarManifest.id },
  { id: BattleEnemyHpBarManifest.id, label: BattleEnemyHpBarManifest.label ?? BattleEnemyHpBarManifest.id },
]

function installCoreSkins(reg: SkinRegistry): void {
  for (const { component, manifest } of newComponents) {
    reg.registerOverlayRenderer(manifest.id, component)
  }
}

let registered = false

/** 注册到默认组件与渲染表（编辑器幂等）。 */
export function registerCoreSkins(): void {
  if (registered) return
  registered = true
  for (const { component, manifest } of newComponents) {
    registerComponent(manifest.id, manifest as ComponentDef)
    registerOverlayRenderer(manifest.id, component)
  }
}

/** 新建一份只安装新规格渲染器的隔离表。 */
export function createCoreSkinRegistry(): SkinRegistry {
  const reg = new SkinRegistry()
  installCoreSkins(reg)
  return reg
}
