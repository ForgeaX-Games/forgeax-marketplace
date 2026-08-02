/**
 * Manifest-driven input projection for RuntimeComponentHost.
 * Output is concrete values suitable to spread as leaf props.
 */
import type { ComponentManifest } from '../schema/node-config-schema'
import { resolveBoundHpBarValues } from './components/new/boundHpBar'
import { resolveTextDurationMs, resolveTextParameter } from './components/new/textParameter'
import { resolveNumericValue, resolveTextValue } from './components/numericValue'
import type { SkinCtx } from './rendererRegistry'

function isDynamicNumericInput(raw: unknown): boolean {
  if (typeof raw === 'string' && raw.trim()) return true
  if (raw && typeof raw === 'object' && typeof (raw as { expr?: unknown }).expr === 'string') return true
  return false
}

/**
 * Resolve authoring inputs against SkinCtx into concrete leaf props.
 * - numberExpr → number / string
 * - parameter（公式/数字）→ 展示用 string
 * - bind+attr + literal current/max → Host applies entity delta
 * - bind/attr dropped from the returned bag (editor sugar only)
 */
export function resolveComponentInputs(
  manifest: ComponentManifest | undefined,
  rawInputs: Record<string, unknown>,
  ctx: SkinCtx | undefined,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...rawInputs }
  const inputDefs = manifest?.inputs ?? []

  for (const input of inputDefs) {
    if (input.component !== 'numberExpr') continue
    if (input.key === 'parameter') continue

    const raw = rawInputs[input.key] !== undefined ? rawInputs[input.key] : input.default

    if (input.valueType === 'number') {
      const value = resolveNumericValue(raw, ctx)
      if (value !== undefined) resolved[input.key] = value
      continue
    }

    if (input.valueType === 'string') {
      const value = resolveTextValue(raw, ctx)
      if (value !== undefined) resolved[input.key] = value
      else if (typeof input.default === 'string') resolved[input.key] = input.default
    }
  }

  // Fill remaining defaults (keys / colors / duration / fixedText …).
  for (const input of inputDefs) {
    if (resolved[input.key] === undefined && input.default !== undefined) {
      resolved[input.key] = input.default
    }
  }

  const parameterDef = inputDefs.find((input) => input.key === 'parameter')
  if (parameterDef) {
    const fallback = typeof parameterDef.default === 'string' ? parameterDef.default : ''
    const raw = Object.prototype.hasOwnProperty.call(rawInputs, 'parameter')
      ? rawInputs.parameter
      : parameterDef.default
    const reference = parameterDef.component === 'numberExpr'
      && parameterDef.valueType === 'string'
      && raw
      && typeof raw === 'object'
      && typeof (raw as { ref?: unknown }).ref === 'string'
      ? resolveTextValue(raw, ctx)
      : undefined
    resolved.parameter = resolveTextParameter(reference ?? raw, ctx, fallback)
  }

  const durationDef = inputDefs.find((input) => input.key === 'durationMs')
  if (durationDef) {
    const fallback = typeof durationDef.default === 'number' ? durationDef.default : 1100
    resolved.durationMs = resolveTextDurationMs(resolved.durationMs, fallback)
  }

  const bind = typeof rawInputs.bind === 'string' && rawInputs.bind ? rawInputs.bind : ''
  const attr = typeof rawInputs.attr === 'string' && rawInputs.attr ? rawInputs.attr : ''
  const hasHpBinding = !!bind && !!attr && inputDefs.some((input) => input.key === 'current')
  if (hasHpBinding && !isDynamicNumericInput(rawInputs.current)) {
    const bound = resolveBoundHpBarValues(
      {
        ...resolved,
        bind,
        attr,
        current: typeof rawInputs.current === 'number' ? rawInputs.current : undefined,
        max: typeof rawInputs.max === 'number' ? rawInputs.max : resolved.max,
      },
      ctx,
      50,
      90,
    )
    resolved.current = bound.current
    resolved.max = bound.max
  }

  if (
    inputDefs.some((input) => input.key === 'qi')
    && resolved.qi === undefined
    && typeof ctx?.hud.vars.qi === 'number'
  ) {
    resolved.qi = ctx.hud.vars.qi
  }

  delete resolved.bind
  delete resolved.attr

  return resolved
}
