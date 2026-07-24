/**
 * 组件包 registry 入口 —— 组件包 = ComponentDef + Renderer（同文件），经本入口注册。
 *
 * 默认表现/交互：floatText / dialogue / transition / choice / skill / qte / hotspot / filter / fx
 * 专属皮肤：battleParry / inkKou / inkYingMo / battleSkillBar
 * overlay：battleHpBar / bossHitCheer / panelA / panelB
 *
 * 加新组件 = 同文件导出契约+渲染，并在 EXTRA_COMPONENTS + installCoreSkins 各挂一行。
 */
import {
  registerOverlayRenderer,
  SkinRegistry,
} from '../rendererRegistry'
import { ComponentRegistry, registerComponent, type ComponentDef } from '../../registry/component-registry'
import {
  BattleParryLayer,
  battleParryComponent,
  battleParryDefaults,
  battleParryPreset,
} from './BattleParryLayer'
import { InkKouLayer, inkKouComponent, inkKouDefaults, inkKouPreset } from './InkKouLayer'
import {
  InkYingMoLayer,
  inkYingMoComponent,
  inkYingMoDefaults,
  inkYingMoPreset,
} from './InkYingMoLayer'
import {
  BattleSkillLayer,
  battleSkillBarComponent,
  battleSkillBarDefaults,
  battleSkillBarPreset,
} from './BattleSkillLayer'
import { BattleHpBar, battleHpBarComponent, battleHpBarPreset } from './BattleHpBar'
import { BossHitCheer, bossHitCheerComponent } from './BossHitCheer'
import { PanelA, PanelB, panelAComponent, panelBComponent } from './TurnPanels'
import { FloatTextOverlay, floatTextComponent } from './FloatText'
import { DialogueOverlay, dialogueComponent } from './Dialogue'
import { TransitionOverlay, transitionComponent } from './Transition'
import { ChoiceButtons, choiceComponent, skillComponent } from './Choice'
import { QteButtons, qteComponent } from './Qte'
import { HotspotButtons, hotspotComponent } from './Hotspot'
import { FilterOverlay, filterComponent } from './Filter'
import { FxOverlay, fxComponent } from './FxEffect'

export {
  battleHpBarComponent,
  battleHpBarPreset,
  battleParryComponent,
  battleParryDefaults,
  battleParryPreset,
  battleSkillBarComponent,
  battleSkillBarDefaults,
  battleSkillBarPreset,
  inkKouComponent,
  inkKouDefaults,
  inkKouPreset,
  inkYingMoComponent,
  inkYingMoDefaults,
  inkYingMoPreset,
  floatTextComponent,
  dialogueComponent,
  transitionComponent,
  choiceComponent,
  skillComponent,
  qteComponent,
  hotspotComponent,
  filterComponent,
  fxComponent,
}
export { CHOICE_INPUTS, validateChoiceEvents } from './Choice'
export type { ChoiceOption, ChoiceParams, ChoicePresentation } from './Choice'
export type { FloatTextParams } from './FloatText'
export type { DialogueParams } from './Dialogue'
export type { TransitionParams } from './Transition'
export type { HotspotSpot, HotspotParams } from './Hotspot'
export { QTE_DEFAULT_EVENTS, QTE_INPUTS } from './Qte'
export type { QteCue, QteCueShape, QteParams } from './Qte'

/**
 * 全部可挂载组件契约（与渲染同文件导出）。
 * `installExtraComponents` → 每局 ComponentRegistry；`registerCoreSkins` → 默认表。
 */
export const EXTRA_COMPONENTS: Array<[string, ComponentDef]> = [
  ['floatText', floatTextComponent as unknown as ComponentDef],
  ['dialogue', dialogueComponent as unknown as ComponentDef],
  ['transition', transitionComponent as unknown as ComponentDef],
  ['choice', choiceComponent as unknown as ComponentDef],
  ['skill', skillComponent as unknown as ComponentDef],
  ['qte', qteComponent as unknown as ComponentDef],
  ['hotspot', hotspotComponent as unknown as ComponentDef],
  ['filter', filterComponent as unknown as ComponentDef],
  ['fx', fxComponent as unknown as ComponentDef],
  ['inkKou', inkKouComponent as unknown as ComponentDef],
  ['battleParry', battleParryComponent as unknown as ComponentDef],
  ['inkYingMo', inkYingMoComponent as unknown as ComponentDef],
  ['battleSkillBar', battleSkillBarComponent as unknown as ComponentDef],
  ['battleHpBar', battleHpBarComponent as unknown as ComponentDef],
  ['bossHitCheer', bossHitCheerComponent as unknown as ComponentDef],
  ['panelA', panelAComponent],
  ['panelB', panelBComponent],
]

/** 把组件包注入某个隔离 ComponentRegistry（多局 Session 用）。 */
export function installExtraComponents(reg: ComponentRegistry): void {
  for (const [id, c] of EXTRA_COMPONENTS) reg.registerComponent(id, c)
}

/** 完整组件契约隔离表（GraphSession 默认用）。 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  const reg = new ComponentRegistry()
  installExtraComponents(reg)
  return reg
}

/**
 * 皮肤定位类型：
 *  - 'point'：位置由作者锚点（params.x/y 或 cue）决定（可拖，创作=皮肤=试玩三处一致）。
 *  - 'fixed'：整段自定位（如防反收圈），不跟预览手柄走。
 */
export type SkinPositioning = 'point' | 'fixed'

/**
 * 可选交互皮肤（供编辑器下拉/定位查询用，也是「这个组件是否有完整专属皮肤」的唯一登记点）。
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
  { id: 'inkYingMo', label: '應/默 抉择', positioning: 'point', defaultAnchor: { x: 0.5, y: 0.88 }, defaultEvents: inkYingMoDefaults.events },
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

/** 血条类 overlay 组件（供编辑器下拉）。 */
export const HP_BAR_COMPONENTS: Array<{ id: string; label: string }> = [
  { id: 'battleHpBar', label: '水墨血条' },
]

function installCoreSkins(reg: SkinRegistry): void {
  reg.registerOverlayRenderer('choice', ChoiceButtons)
  reg.registerOverlayRenderer('skill', ChoiceButtons)
  reg.registerOverlayRenderer('qte', QteButtons)
  reg.registerOverlayRenderer('hotspot', HotspotButtons)
  reg.registerOverlayRenderer('floatText', FloatTextOverlay)
  reg.registerOverlayRenderer('transition', TransitionOverlay)
  reg.registerOverlayRenderer('dialogue', DialogueOverlay)
  reg.registerOverlayRenderer('filter', FilterOverlay)
  reg.registerOverlayRenderer('fx', FxOverlay)
  reg.registerOverlayRenderer('battleParry', BattleParryLayer)
  reg.registerOverlayRenderer('inkKou', InkKouLayer)
  reg.registerOverlayRenderer('inkYingMo', InkYingMoLayer)
  reg.registerOverlayRenderer('battleSkillBar', BattleSkillLayer)
  reg.registerOverlayRenderer('battleHpBar', BattleHpBar)
  reg.registerOverlayRenderer('bossHitCheer', BossHitCheer)
  reg.registerOverlayRenderer('panelA', PanelA)
  reg.registerOverlayRenderer('panelB', PanelB)
}

let _registered = false
/** 注册到默认表（编辑器幂等）：渲染器 + 组件包契约。 */
export function registerCoreSkins(): void {
  if (_registered) return
  _registered = true
  for (const [id, c] of EXTRA_COMPONENTS) registerComponent(id, c)
  registerOverlayRenderer('choice', ChoiceButtons)
  registerOverlayRenderer('skill', ChoiceButtons)
  registerOverlayRenderer('qte', QteButtons)
  registerOverlayRenderer('hotspot', HotspotButtons)
  registerOverlayRenderer('floatText', FloatTextOverlay)
  registerOverlayRenderer('transition', TransitionOverlay)
  registerOverlayRenderer('dialogue', DialogueOverlay)
  registerOverlayRenderer('filter', FilterOverlay)
  registerOverlayRenderer('fx', FxOverlay)
  registerOverlayRenderer('battleParry', BattleParryLayer)
  registerOverlayRenderer('inkKou', InkKouLayer)
  registerOverlayRenderer('inkYingMo', InkYingMoLayer)
  registerOverlayRenderer('battleSkillBar', BattleSkillLayer)
  registerOverlayRenderer('battleHpBar', BattleHpBar)
  registerOverlayRenderer('bossHitCheer', BossHitCheer)
  registerOverlayRenderer('panelA', PanelA)
  registerOverlayRenderer('panelB', PanelB)
}

/** 新建一份已装全部默认渲染器的隔离表（多局 Session 各持一份）。 */
export function createCoreSkinRegistry(): SkinRegistry {
  const reg = new SkinRegistry()
  installCoreSkins(reg)
  return reg
}

/** 可用组件清单（id + 展示名）——供界面 tab 组件库渲染所有可拖组件。 */
export const availableComponents: Array<{ id: string; label: string }> = EXTRA_COMPONENTS.map(
  ([id, def]) => ({ id, label: def.label ?? id }),
)
