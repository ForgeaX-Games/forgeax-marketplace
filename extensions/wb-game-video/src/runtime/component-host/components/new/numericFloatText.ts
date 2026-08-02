import type { NumOrExpr } from '../../../schema/graph-schema'
import type { SkinCtx } from '../../rendererRegistry'
import { resolveNumericValue } from '../numericValue'

export { resolveNumericValue as resolveNumericFloatValue } from '../numericValue'

export interface NumericFloatTextInputs {
  value?: NumOrExpr | string
  /** 兼容旧版字符串参数；新编辑器只写 value。 */
  text?: string
  /** 整段飘字动画的总时长，单位 ms。 */
  durationMs?: number
}

type NumericFloatSign = 'signed' | 'negative'

function signed(value: number, sign: NumericFloatSign): string {
  const normalized = Object.is(value, -0) ? 0 : value
  if (sign === 'negative') return `-${Math.abs(normalized)}`
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

export function resolveNumericFloatText(
  inputs: NumericFloatTextInputs,
  ctx: SkinCtx | undefined,
  fallback: string,
  sign: NumericFloatSign = 'signed',
): string {
  const value = resolveNumericValue(inputs.value, ctx)
  if (value != null) return signed(value, sign)
  return typeof inputs.text === 'string' && inputs.text ? inputs.text : fallback
}

/** 非法时长不应让 CSS 动画失效；缺省保持各飘字皮肤原来的 1.1 秒节奏。 */
export function resolveNumericFloatDurationMs(value: unknown, fallback = 1100): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
