/**
 * 统一的符号化运算符按钮组（+ − × ÷ =…）。Effect 层的「运算」字段与 ValueExprEditor
 * 选取公式模式下每一项的「运算」字段共用同一份视觉/交互实现，各自传入自己的 option 列表。
 */
import type { CSSProperties } from 'react'
import type { EffectDisplayOp } from './valueExprPick'

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
 * Effect 层"运算"符号按钮。这里处理稳定的编辑器运算态；落盘到 add/mul/set 的编码由
 * EffectRow 统一完成，不让按钮点击直接篡改操作数。
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

export function EffectOpButtons({
  op,
  onChange,
}: {
  op: EffectDisplayOp
  onChange: (next: EffectDisplayOp) => void
}): JSX.Element {
  return (
    <OpSymbolButtons
      ariaLabel="运算"
      options={EFFECT_OP_SYMBOLS.map((o) => ({
        key: o.key,
        symbol: o.symbol,
        title: o.title,
        active: o.key === op,
      }))}
      onPick={(key) => onChange(key as EffectDisplayOp)}
    />
  )
}
