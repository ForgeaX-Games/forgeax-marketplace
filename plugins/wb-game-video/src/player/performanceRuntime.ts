import type { FloatText, Settlement } from '../scenario/gameplayTypes'
import type { OverlayClip, Scenario } from '../scenario/types'
import { applyDamage, type EntitiesState } from './entities'
import { applyEffects, applyItemEffects, type ItemState, type VarState } from './conditionEval'

/**
 * overlaySettlement —— 「飘字」结算运行时（v13 起取代 performance.cues 的
 * duePerformanceCues / applyPerformanceCue）。主试玩 Player 走这里的
 * applyOverlaySettlement 应用**全 effect 类型**（与 BlueprintPlayer 的引擎侧
 * applyRuntimeEffects 拉齐）；可见飘字由 OverlayLayer 自身渲染，不再 spawn transient。
 */

/** 到点（startMs）且未触发过的、带 settlement 的 overlay。 */
export function dueOverlaySettlements(
  overlays: OverlayClip[] | undefined,
  elapsedMs: number,
  firedIds: ReadonlySet<string>,
): OverlayClip[] {
  if (!overlays?.length) return []
  return overlays.filter((o) => o.settlement != null && elapsedMs >= o.startMs && !firedIds.has(o.id))
}

function defaultBossId(scenario: Scenario): string | undefined {
  return Object.entries(scenario.entities ?? {}).find(([, e]) => e.kind === 'boss')?.[0]
}

function defaultPlayerId(scenario: Scenario): string | undefined {
  return Object.entries(scenario.entities ?? {}).find(([, e]) => e.kind === 'player')?.[0]
}

/** Player 三态存储（var/flag · item · entity hp）。 */
export interface SettlementStores {
  vars: VarState
  items: ItemState
  entities: EntitiesState
}

/**
 * 通用结算执行 —— 应用全 effect 类型到 Player 的三个状态存储：
 *   · var / flag  → applyEffects
 *   · item        → applyItemEffects
 *   · entityStat  → applyDamage（hp；entityId 缺省按 value 正负回退到 boss/player）
 * 返回新存储 + 可选独立飘字（一般为空，可见 overlay 自渲染）。
 */
export function applyOverlaySettlement(
  settlement: Settlement,
  scenario: Scenario,
  stores: SettlementStores,
): { stores: SettlementStores; float?: FloatText } {
  const effects = settlement.effects ?? []
  const vars = applyEffects(effects, stores.vars, scenario)
  const items = applyItemEffects(effects, stores.items)
  let entities = stores.entities
  for (const effect of effects) {
    if (effect.kind !== 'entityStat' || effect.stat !== 'hp') continue
    const fallback = effect.value < 0 ? defaultBossId(scenario) : defaultPlayerId(scenario)
    const entityId = effect.entityId || fallback
    if (!entityId) continue
    entities = applyDamage(entities, entityId, -effect.value)
  }
  return { stores: { vars, items, entities }, float: settlement.float }
}
