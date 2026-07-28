/**
 * 统一的符号化运算符按钮组（+ − × ÷ =…）。Effect 层的「运算」字段与 ValueExprEditor
 * 选取公式模式下每一项的「运算」字段共用同一份视觉/交互实现，各自传入自己的 option 列表。
 */
import type { CSSProperties } from 'react'
import type { NumericEffectOp, NumOrExpr } from '../../runtime/schema/graph-schema'
import { negateNumOrExpr, reciprocalNumOrExpr } from './valueExprPick'

const row: CSSProperties = { display: 'flex', gap: 2 }
const btn: CSSProperties = { minWidth: 26, padding: '2px 6px', fontFamily: 'monospace', fontSize: 13 }

export interface OpSymbolOption {
  key: string
  symbol: string
  title?: string
  /** 是否是当前持久化状态（勾选态）；缺省 = 一次性动作按钮，不高亮。 */
  active?: boolean
  disabled?: boolean
}

export function OpSymbolButtons({
  options,
  onPick,
  ariaLabel,
}: {
  options: OpSymbolOption[]
  onPick: (key: string) => void
  ariaLabel?: string
}): JSX.Element {
  return (
    <div style={row} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.title ?? o.symbol}
          disabled={o.disabled}
          className={o.active ? 'gc-mini-action is-on' : 'gc-mini-action'}
          style={btn}
          onClick={() => onPick(o.key)}
        >
          {o.symbol}
        </button>
      ))}
    </div>
  )
}

/**
 * Effect 层"运算"符号按钮——落盘的 NumericEffectOp 仍只有 add/mul/set；− 和 ÷ 是编辑器侧的
 * 一次性动作（取反 value 后落 add / 取倒数后落 mul），不新增 schema 字面量，详见 valueExprPick.ts。
 * 嵌进「值」编辑器内部（`ValueInput`/`ValueExprEditor` 的 `effectOp` 入口）与 Effect 编辑器
 * 复用同一份实现——不放在 editors.tsx／ValueExprEditor.tsx 任一方，避免两者互相 import 成环。
 */
const EFFECT_OP_SYMBOLS: { key: string; symbol: string; title: string }[] = [
  { key: 'add', symbol: '+', title: '增加' },
  { key: 'sub', symbol: '−', title: '减少（取反后按"增加"落盘）' },
  { key: 'mul', symbol: '×', title: '乘以' },
  { key: 'div', symbol: '÷', title: '除以（取倒数后按"乘以"落盘）' },
  { key: 'set', symbol: '=', title: '设为' },
]

/**
 * 从落盘 {op, value} 反推「用户当前选的显示运算符」——因为 −/÷ 落盘成 add/mul，直接按 op 高亮会
 * 让 + / × 误亮、−/÷ 永不亮。规则对齐本组件按钮的产物（negate→ -(…)/负数、reciprocal→ 1/(…)）：
 *  set → '='；mul 且 value 形如 1/(…) → 'div' 否则 'mul'；add 且 value 形如 -(…)/负数 → 'sub' 否则 'add'。
 */
function displayOpKey(op: NumericEffectOp, value: NumOrExpr | undefined): string {
  if (op === 'set') return 'set'
  if (op === 'mul') {
    if (typeof value === 'object' && value && /^1\/\(/.test(value.expr)) return 'div'
    return 'mul'
  }
  // add
  if (typeof value === 'number') return value < 0 ? 'sub' : 'add'
  if (typeof value === 'object' && value && /^-\(/.test(value.expr)) return 'sub'
  return 'add'
}

export function EffectOpButtons({
  op,
  value,
  onChange,
}: {
  op: NumericEffectOp
  value: NumOrExpr | undefined
  onChange: (next: { op: NumericEffectOp; value?: NumOrExpr }) => void
}): JSX.Element {
  const shownKey = displayOpKey(op, value)
  return (
    <OpSymbolButtons
      ariaLabel="运算"
      options={EFFECT_OP_SYMBOLS.map((o) => ({
        key: o.key,
        symbol: o.symbol,
        title: o.title,
        active: o.key === shownKey,
      }))}
      onPick={(key) => {
        if (key === 'sub') onChange({ op: 'add', value: negateNumOrExpr(value ?? 0) })
        else if (key === 'div') onChange({ op: 'mul', value: reciprocalNumOrExpr(value ?? 1) })
        else onChange({ op: key as NumericEffectOp })
      }}
    />
  )
}
