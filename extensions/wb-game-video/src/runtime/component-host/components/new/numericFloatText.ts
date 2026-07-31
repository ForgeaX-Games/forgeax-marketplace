import type { NumOrExpr } from '../../../schema/graph-schema'
import type { SkinCtx } from '../../rendererRegistry'
import { resolveNumericValue } from '../numericValue'

export { resolveNumericValue as resolveNumericFloatValue } from '../numericValue'

export interface NumericFloatTextInputs {
  value?: NumOrExpr | string
  /** 兼容旧版字符串参数；新编辑器只写 value。 */
  text?: string
}

function signed(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

export function resolveNumericFloatText(
  inputs: NumericFloatTextInputs,
  ctx: SkinCtx | undefined,
  fallback: string,
): string {
  const value = resolveNumericValue(inputs.value, ctx)
  if (value != null) return signed(value)
  return typeof inputs.text === 'string' && inputs.text ? inputs.text : fallback
}
