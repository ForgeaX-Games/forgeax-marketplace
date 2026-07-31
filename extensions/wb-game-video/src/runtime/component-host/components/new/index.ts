import type { ComponentDef } from '../../../registry/component-registry'
import type { OverlayComponent } from '../../rendererRegistry'
import { BattleEnemyHpBar, battleEnemyHpBarComponent } from './BattleEnemyHpBar'
import { BattleParryLayer, battleParryComponent } from './BattleParry'
import { BattlePlayerHpBar, battlePlayerHpBarComponent } from './BattlePlayerHpBar'
import { BattleSkillLayer, battleSkillBarComponent } from './BattleSkill'
import { DamageFloatTextOverlay, damageFloatTextComponent } from './DamageFloatText'
import { DialogueOverlay, dialogueComponent } from './Dialogue'
import { GainFloatTextOverlay, gainFloatTextComponent } from './GainFloatText'
import { InkKouLayer, inkKouComponent } from './InkKou'
import { InkYingMoLayer, inkYingMoComponent } from './InkYingMo'

export {
  BattleEnemyHpBar,
  battleEnemyHpBarComponent,
  BattleParryLayer,
  battleParryComponent,
  BattlePlayerHpBar,
  battlePlayerHpBarComponent,
  BattleSkillLayer,
  battleSkillBarComponent,
  DamageFloatTextOverlay,
  damageFloatTextComponent,
  DialogueOverlay,
  dialogueComponent,
  GainFloatTextOverlay,
  gainFloatTextComponent,
  InkKouLayer,
  inkKouComponent,
  InkYingMoLayer,
  inkYingMoComponent,
}

/** 新规格组件的唯一注册与展示清单。 */
export const NEW_COMPONENTS: ReadonlyArray<{
  id: string
  definition: ComponentDef
  renderer: OverlayComponent
}> = [
  { id: 'dialogue', definition: dialogueComponent, renderer: DialogueOverlay },
  { id: 'inkKou', definition: inkKouComponent, renderer: InkKouLayer },
  { id: 'inkYingMo', definition: inkYingMoComponent, renderer: InkYingMoLayer },
  { id: 'battleParry', definition: battleParryComponent, renderer: BattleParryLayer },
  { id: 'battleSkillBar', definition: battleSkillBarComponent, renderer: BattleSkillLayer },
  { id: 'damageFloatText', definition: damageFloatTextComponent, renderer: DamageFloatTextOverlay },
  { id: 'gainFloatText', definition: gainFloatTextComponent, renderer: GainFloatTextOverlay },
  { id: 'battlePlayerHpBar', definition: battlePlayerHpBarComponent, renderer: BattlePlayerHpBar },
  { id: 'battleEnemyHpBar', definition: battleEnemyHpBarComponent, renderer: BattleEnemyHpBar },
]
