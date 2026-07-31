import type { SkinCtx } from '../../rendererRegistry'

export interface BoundHpBarValues {
  bind: string
  attr: string
  current: number
  max: number
}

/**
 * Keep an explicitly authored display baseline while following runtime entity deltas.
 * Without an authored baseline, render the bound entity value directly.
 */
export function resolveBoundHpBarValues(
  inputs: Record<string, unknown>,
  ctx: SkinCtx | undefined,
  fallbackBind: string,
  fallbackCurrent: number,
  fallbackMax: number,
): BoundHpBarValues {
  const bind = typeof inputs.bind === 'string' && inputs.bind ? inputs.bind : fallbackBind
  const attr = typeof inputs.attr === 'string' && inputs.attr ? inputs.attr : 'hp'
  const authoredCurrent = typeof inputs.current === 'number' ? inputs.current : undefined
  const authoredMax = typeof inputs.max === 'number' ? inputs.max : undefined
  const entity = ctx?.hud.entities[bind]

  if (!entity) {
    return {
      bind,
      attr,
      current: authoredCurrent ?? fallbackCurrent,
      max: authoredMax ?? fallbackMax,
    }
  }

  const live = entity.attrs[attr] ?? (attr === 'hp' ? entity.hp : 0)
  const entityMax = entity.attrMax[attr] ?? (attr === 'hp' ? entity.maxHp : live)
  const initial = entity.initialAttrs?.[attr] ?? entityMax
  return {
    bind,
    attr,
    current: authoredCurrent == null ? live : authoredCurrent + (live - initial),
    max: authoredMax ?? entityMax,
  }
}
