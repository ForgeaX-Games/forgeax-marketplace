/**
 * 皮肤组件 registry 注册入口 —— 把从旧引擎迁移过来的皮肤组件按 component id 注册进渲染器 registry。
 *
 * 交互皮肤：battleParry / inkKou / inkYingMo / battleSkillBar
 * HUD 皮肤：battleHpBar
 * 配置里（元素 params.component / ui.hud[i].component）填这些 id，试玩即按对应旧样式渲染；
 * 未指定 → 回退通用按钮 / 内置血条。加新皮肤只需在此注册一行。
 */
import { registerInteractionSkin, registerHudRenderer } from '../rendererRegistry'
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

let _registered = false
export function registerCoreSkins(): void {
  if (_registered) return
  _registered = true
  registerInteractionSkin('battleParry', BattleParryLayer)
  registerInteractionSkin('inkKou', InkKouLayer)
  registerInteractionSkin('inkYingMo', InkYingMoLayer)
  registerInteractionSkin('battleSkillBar', BattleSkillLayer)
  registerHudRenderer('battleHpBar', BattleHpBar)
}
