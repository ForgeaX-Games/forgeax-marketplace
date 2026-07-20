/**
 * 皮肤组件 registry 注册入口 —— 把从旧引擎迁移过来的皮肤组件按 component id 注册进渲染器 registry。
 *
 * 交互皮肤：battleParry / inkKou / inkYingMo / battleSkillBar
 * HUD 皮肤：battleHpBar
 * 各自是独立注册的顶层组件 id——`OverlayChild.component` 填这些 id 即按对应样式渲染；
 * 未指定 → 回退通用按钮 / 内置血条。加新皮肤只需在此注册一行。
 */
import { registerHudRenderer, registerInteractionSkin, registerOverlayRenderer, SkinRegistry } from '../rendererRegistry'
import { registerComponent, type ComponentDef, type ComponentRegistry } from '../../registry/component-registry'
import { BattleParryLayer, battleParryDefaults, battleParryPreset } from './BattleParryLayer'
import { InkKouLayer, inkKouDefaults, inkKouPreset } from './InkKouLayer'
import { InkYingMoLayer, inkYingMoDefaults, inkYingMoPreset } from './InkYingMoLayer'
import { BattleSkillLayer, battleSkillBarDefaults, battleSkillBarPreset } from './BattleSkillLayer'
import { BattleHpBar, battleHpBarComponent, battleHpBarPreset } from './BattleHpBar'
import { BossHitCheer, bossHitCheerComponent } from './BossHitCheer'
import { PanelA, PanelB, panelAComponent, panelBComponent } from './TurnPanels'

export {
  battleHpBarComponent,
  battleHpBarPreset,
  battleParryDefaults,
  battleParryPreset,
  battleSkillBarDefaults,
  battleSkillBarPreset,
  inkKouDefaults,
  inkKouPreset,
  inkYingMoDefaults,
  inkYingMoPreset,
}

/**
 * 组件包自带的注册契约（与渲染实现同文件导出）。
 * 通过 `installExtraComponents` 注入每局 ComponentRegistry；`registerCoreSkins` 注入默认表（编辑器/校验）。
 */
export const EXTRA_COMPONENTS: Array<[string, ComponentDef]> = [
  ['battleHpBar', battleHpBarComponent as unknown as ComponentDef],
  ['bossHitCheer', bossHitCheerComponent as unknown as ComponentDef],
  ['panelA', panelAComponent],
  ['panelB', panelBComponent],
]

/** 把组件包注入某个隔离 ComponentRegistry（多局 Session 用）。 */
export function installExtraComponents(reg: ComponentRegistry): void {
  for (const [id, c] of EXTRA_COMPONENTS) reg.registerComponent(id, c)
}

/**
 * 皮肤定位类型：
 *  - 'point'：位置由作者锚点（params.x/y 或 cue）决定（可拖，创作=皮肤=试玩三处一致）。
 *  - 'fixed'：整段自定位（如防反收圈），不跟预览手柄走。
 */
export type SkinPositioning = 'point' | 'fixed'

/**
 * 可选交互皮肤（供编辑器下拉/定位查询用，也是「这个组件是否有完整专属皮肤」的唯一登记点）。
 * `defaultAnchor` 仅 point 皮肤有意义（新建时的初始归一化位置）。`defaultEvents` = 该皮肤自己
 * tsx 里的固定出口目录——编辑器据此判定「这个组件的出口不让自由增删/改文案，永远用这份 defaults
 * 覆盖」（`graphMaterialOps.ts` 的 `applyStyleLockedEventParams`/`componentEventsLocked`），
 * 同时它也是「时间轴可渲染真实交互皮肤做预览」的白名单来源——两者共用同一份登记，不是两份手工
 * 维护的名单。新皮肤只需在这个数组里加一行（+ 下面 `installCoreSkins`/`registerCoreSkins` 注册渲染
 * 器），不必再去别的文件同步维护第二份组件 id 名单。
 * 各皮肤是独立注册的顶层组件 id，这里不再标它们该归到哪个编辑器下拉分组——那层分组现由
 * `listSchemeMountTabs`（`graphMaterialOps.ts`）接管。
 */
export const INTERACTION_SKINS: Array<{
  id: string
  label: string
  positioning: SkinPositioning
  defaultAnchor?: { x: number; y: number }
  defaultEvents: Array<{ id: string; label?: string; condition?: unknown }>
}> = [
  { id: 'battleParry', label: '防反 QTE（A/B 收圈）', positioning: 'fixed', defaultEvents: battleParryDefaults.events },
  { id: 'inkKou', label: '叩击 QTE（单点）', positioning: 'point', defaultAnchor: { x: 0.58, y: 0.39 }, defaultEvents: inkKouDefaults.events },
  { id: 'inkYingMo', label: '應/默 抉择', positioning: 'point', defaultAnchor: { x: 0.72, y: 0.78 }, defaultEvents: inkYingMoDefaults.events },
  { id: 'battleSkillBar', label: '战斗技能条', positioning: 'point', defaultAnchor: { x: 0.5, y: 0.88 }, defaultEvents: battleSkillBarDefaults.events },
]

/** 皮肤定位类型查询；未知/未选皮肤（默认按钮条）按 'fixed'（底部居中）处理。 */
export function skinPositioning(id: string | undefined): SkinPositioning {
  return INTERACTION_SKINS.find((s) => s.id === id)?.positioning ?? 'fixed'
}

/** point 皮肤的默认锚点（新建拍点初始位置）；无则 undefined（走通用兜底 0.5/0.55）。 */
export function skinDefaultAnchor(id: string | undefined): { x: number; y: number } | undefined {
  return INTERACTION_SKINS.find((s) => s.id === id)?.defaultAnchor
}

/** 可选 HUD 皮肤（供编辑器下拉）。 */
export const HUD_SKINS: Array<{ id: string; label: string }> = [{ id: 'battleHpBar', label: '水墨血条' }]

function installCoreSkins(reg: SkinRegistry): void {
  reg.registerInteractionSkin('battleParry', BattleParryLayer)
  reg.registerInteractionSkin('inkKou', InkKouLayer)
  reg.registerInteractionSkin('inkYingMo', InkYingMoLayer)
  reg.registerInteractionSkin('battleSkillBar', BattleSkillLayer)
  reg.registerHudRenderer('battleHpBar', BattleHpBar)
  reg.registerOverlayRenderer('bossHitCheer', BossHitCheer)
  reg.registerOverlayRenderer('panelA', PanelA)
  reg.registerOverlayRenderer('panelB', PanelB)
}

let _registered = false
/** 注册到默认表（编辑器幂等）：渲染器 + 组件包自带契约。 */
export function registerCoreSkins(): void {
  if (_registered) return
  _registered = true
  for (const [id, c] of EXTRA_COMPONENTS) registerComponent(id, c)
  registerInteractionSkin('battleParry', BattleParryLayer)
  registerInteractionSkin('inkKou', InkKouLayer)
  registerInteractionSkin('inkYingMo', InkYingMoLayer)
  registerInteractionSkin('battleSkillBar', BattleSkillLayer)
  registerHudRenderer('battleHpBar', BattleHpBar)
  registerOverlayRenderer('bossHitCheer', BossHitCheer)
  registerOverlayRenderer('panelA', PanelA)
  registerOverlayRenderer('panelB', PanelB)
}

/** 新建一份已装核心渲染器 + 战斗/水墨皮肤的隔离表（多局 Session 各持一份）。 */
export function createCoreSkinRegistry(): SkinRegistry {
  const reg = new SkinRegistry()
  reg.registerCoreRenderers()
  installCoreSkins(reg)
  return reg
}
