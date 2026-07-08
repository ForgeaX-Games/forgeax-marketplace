/**
 * 玩法优先判定 —— 集中「这个 Scenario 是不是玩法优先视频游戏」的判断，
 * 让 Player.tsx 等处只插一行 guard，不散落 ?? 兜底语义。
 *
 * 判定 = gameplay 模块是否启用(moduleFlags 默认:有 entities 即默认开)。
 * 普通影游(无 entities / 显式关掉) → false，Player 行为与现状完全一致。
 */

import { isModuleEnabled } from '../scenario/moduleFlags'
import type { Scenario, Scene } from '../scenario/types'
import { resolveInnerMode } from './gameplayState'

/** 这个剧本是否玩法优先(决定挂不挂 HUD)。 */
export function isGameplay(scenario: Scenario | null | undefined): boolean {
  if (!scenario) return false
  return isModuleEnabled(scenario, 'gameplay')
}

/** 当前场景是否 Boss 战(两级状态机内层 = battle)。 */
export function isBattleScene(scene: Scene | null | undefined): boolean {
  return resolveInnerMode(scene) === 'battle'
}

/** 当前场景是否处于「节奏/限时」交互(QTE 或限时 QTE)。 */
export function isQteScene(scene: Scene | null | undefined): boolean {
  return resolveInnerMode(scene) === 'qte'
}

/** 当前场景是否选择节点。 */
export function isChoiceScene(scene: Scene | null | undefined): boolean {
  return resolveInnerMode(scene) === 'choice'
}
