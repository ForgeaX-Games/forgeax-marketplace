/**
 * 皮肤组件 registry 注册入口 —— 把从旧引擎迁移过来的皮肤组件按 component id 注册进渲染器 registry。
 *
 * 交互皮肤：battleParry / inkKou / inkYingMo / battleSkillBar
 * HUD 皮肤：battleHpBar
 * 配置里（元素 params.component / overlay HUD child `component`）填这些 id，试玩即按对应旧样式渲染；
 * 未指定 → 回退通用按钮 / 内置血条。加新皮肤只需在此注册一行。
 */
import { registerHudRenderer, registerInteractionSkin, SkinRegistry } from '../rendererRegistry'
import { BattleParryLayer } from './BattleParryLayer'
import { InkKouLayer } from './InkKouLayer'
import { InkYingMoLayer } from './InkYingMoLayer'
import { BattleSkillLayer } from './BattleSkillLayer'
import { BattleHpBar } from './BattleHpBar'

/** 可选交互皮肤（供编辑器下拉）。 */
export const INTERACTION_SKINS: Array<{ id: string; label: string }> = [
  { id: 'battleParry', label: '防反 QTE（A/B 收圈）' },
  { id: 'inkKou', label: '叩击 QTE（单点）' },
  { id: 'inkYingMo', label: '應/默 抉择' },
  { id: 'battleSkillBar', label: '战斗技能条' },
]
/** 可选 HUD 皮肤（供编辑器下拉）。 */
export const HUD_SKINS: Array<{ id: string; label: string }> = [{ id: 'battleHpBar', label: '水墨血条' }]

function installCoreSkins(reg: SkinRegistry): void {
  reg.registerInteractionSkin('battleParry', BattleParryLayer)
  reg.registerInteractionSkin('inkKou', InkKouLayer)
  reg.registerInteractionSkin('inkYingMo', InkYingMoLayer)
  reg.registerInteractionSkin('battleSkillBar', BattleSkillLayer)
  reg.registerHudRenderer('battleHpBar', BattleHpBar)
}

let _registered = false
/** 注册到默认表（编辑器幂等）。 */
export function registerCoreSkins(): void {
  if (_registered) return
  _registered = true
  registerInteractionSkin('battleParry', BattleParryLayer)
  registerInteractionSkin('inkKou', InkKouLayer)
  registerInteractionSkin('inkYingMo', InkYingMoLayer)
  registerInteractionSkin('battleSkillBar', BattleSkillLayer)
  registerHudRenderer('battleHpBar', BattleHpBar)
}

/** 新建一份已装核心渲染器 + 战斗/水墨皮肤的隔离表（多局 Session 各持一份）。 */
export function createCoreSkinRegistry(): SkinRegistry {
  const reg = new SkinRegistry()
  reg.registerCoreRenderers()
  installCoreSkins(reg)
  return reg
}
