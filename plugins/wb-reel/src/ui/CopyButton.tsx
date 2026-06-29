import { useState } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 复制提示词按钮 —— 给"我想拿到外部网站生成"的工作流用。
 *
 * 极薄、低对比；点击后 1.4 秒变绿色 ✓ + "已复制"。
 */
export function CopyButton({
  value,
  label = '复制',
  className = '',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [done, setDone] = useState(false)

  async function copy(e: React.MouseEvent): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      window.setTimeout(() => setDone(false), 1400)
    } catch (err) {
      console.warn('[CopyButton] failed:', err)
    }
  }

  return (
    <button
      type="button"
      className={`ks-copy ${done ? 'is-done' : ''} ${className}`}
      onClick={copy}
      disabled={!value}
      title="复制到剪贴板"
    >
      {done ? '✓ 已复制' : label}
    </button>
  )
}

const copyCss = `
.ks-copy {
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 4px 12px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-pill);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-copy:hover:not(:disabled) {
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
  background: rgba(108, 143, 184, 0.08);
  box-shadow: none;
}
.ks-copy.is-done {
  border-color: rgba(111, 199, 168, 0.5);
  color: var(--ks-mint);
  background: rgba(111, 199, 168, 0.1);
}
`
injectStyleOnce('copy-button', copyCss)
