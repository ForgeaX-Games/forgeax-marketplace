import type { PerformanceCue, PerformanceSpec, Scenario } from '../scenario/types'
import { applyDamage, type EntitiesState } from './entities'

/** 到点且未触发过的 performance cues。 */
export function duePerformanceCues(
  spec: PerformanceSpec | undefined,
  elapsedMs: number,
  firedIds: ReadonlySet<string>,
): PerformanceCue[] {
  if (!spec?.cues?.length) return []
  return spec.cues.filter((c) => elapsedMs >= c.atMs && !firedIds.has(c.id))
}

function defaultBossId(scenario: Scenario): string | undefined {
  return Object.entries(scenario.entities ?? {}).find(([, e]) => e.kind === 'boss')?.[0]
}

function defaultPlayerId(scenario: Scenario): string | undefined {
  return Object.entries(scenario.entities ?? {}).find(([, e]) => e.kind === 'player')?.[0]
}

/** 应用一条 performance cue 的伤害；返回新 entities 与可选飘字。 */
export function applyPerformanceCue(
  cue: PerformanceCue,
  scenario: Scenario,
  entities: EntitiesState,
): { entities: EntitiesState; notice?: string } {
  let next = entities
  const parts: string[] = []
  for (const effect of cue.effects) {
    if (effect.kind !== 'entityStat' || effect.stat !== 'hp') continue
    const fallback = effect.value < 0 ? defaultBossId(scenario) : defaultPlayerId(scenario)
    const entityId = effect.entityId || fallback
    if (!entityId) continue
    next = applyDamage(next, entityId, -effect.value)
    const entityName = scenario.entities?.[entityId]?.name ?? entityId
    parts.push(`${entityName} ${effect.value >= 0 ? '+' : ''}${effect.value}`)
  }
  const notice = cue.label ?? (parts.length ? parts.join(' · ') : undefined)
  return { entities: next, notice }
}
