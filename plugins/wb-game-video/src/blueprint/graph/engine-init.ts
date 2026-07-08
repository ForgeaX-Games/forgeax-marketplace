/**
 * 从 GameScenario 建初始运行态 MutableState。
 *
 * - variables：kind='number' → vars(+varMeta 上下限)；kind='flag' → flags(0/1)。
 * - entities：attrs 直接拷贝作为初始/当前值；attrMeta 透传（clamp/ratio/复位约束）。
 *   若某 attr 只在 attrMeta 里给了 initial 而 attrs 没有，则用 initial 补上初值。
 *   **无 hp 特权**：hp 只是 attrs 里名为 hp 的一项（约定）。
 * - rng：createRng(scenario.rng.seed ?? 0)，可复现。
 */
import type { GameScenario } from './graph-schema'
import { createRng } from './rng'
import type { MutableEntity, MutableState } from './apply-effects'

export function initState(scenario: GameScenario): MutableState {
  const vars: Record<string, number> = {}
  const varMeta: Record<string, { min?: number; max?: number }> = {}
  const flags: Record<string, number> = {}

  for (const [id, raw] of Object.entries(scenario.variables ?? {})) {
    const initial = raw.initial ?? 0
    if (raw.kind === 'flag') {
      flags[id] = initial ? 1 : 0
    } else {
      vars[id] = initial
      if (raw.min !== undefined || raw.max !== undefined) varMeta[id] = { min: raw.min, max: raw.max }
    }
  }

  const entities: Record<string, MutableEntity> = {}
  for (const [id, raw] of Object.entries(scenario.entities ?? {})) {
    const attrs: Record<string, number> = { ...(raw.attrs ?? {}) }
    if (raw.attrMeta) {
      for (const [k, m] of Object.entries(raw.attrMeta)) {
        if (attrs[k] === undefined && m.initial !== undefined) attrs[k] = m.initial
      }
    }
    entities[id] = { attrs, attrMeta: raw.attrMeta }
  }

  return {
    vars,
    varMeta,
    entities,
    flags,
    score: 0,
    items: {},
    rng: createRng(scenario.rng?.seed ?? 0),
    appliedOnce: new Set<string>(),
  }
}
