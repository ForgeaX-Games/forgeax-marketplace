import { useState, forwardRef } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * TextareaWithCopy —— 内嵌复制按钮的 textarea（v3.9.7 新组件）。
 *
 * 动机（作者原话）：
 *   "你这两个每个都有个复制按钮，放这里我根本不知道他复制的是什么，
 *    你放在文本窗口内不好吗？"
 *
 * 旧的 <CopyButton> 是外挂在 FieldHead 右侧，视觉上跟下方 textarea 脱节。
 * 这个组件把复制按钮**叠**在 textarea 右上角，语义清晰：按钮直接盖在
 * 文本框上，就是复制这个文本框的内容。
 *
 * 设计：
 *   - 小图标按钮（📋 → ✓），不占文本区内容宽度（右上角绝对定位）
 *   - 右内边距 padding-right: 44px，避免文本贴近按钮
 *   - textarea value 空时按钮置灰
 *   - 其它 textarea props 直接透传
 */
export interface TextareaWithCopyProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  copyHint?: string
}

export const TextareaWithCopy = forwardRef<
  HTMLTextAreaElement,
  TextareaWithCopyProps
>(function TextareaWithCopy({ value, copyHint, className = '', ...rest }, ref) {
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
      console.warn('[TextareaWithCopy] clipboard write failed:', err)
    }
  }

  return (
    <div className={`ks-ta-wrap ${className}`}>
      <textarea ref={ref} value={value} className="ks-ta-area" {...rest} />
      <button
        type="button"
        className={`ks-ta-copy ${done ? 'is-done' : ''}`}
        onClick={copy}
        disabled={!value}
        title={copyHint || '复制该段提示词到剪贴板'}
        aria-label={copyHint || '复制'}
      >
        {done ? (
          <span className="ks-ta-copy-done">✓</span>
        ) : (
          <span className="ks-ta-copy-icon" aria-hidden>
            {/* 极简复制图标 —— 两个错开的方块 */}
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M3 11V3a1 1 0 0 1 1-1h8" />
            </svg>
          </span>
        )}
      </button>
    </div>
  )
})

const css = `
.ks-ta-wrap {
  position: relative;
  display: block;
}
.ks-ta-wrap > .ks-ta-area {
  width: 100%;
  padding-right: 44px; /* 给右上角复制按钮留位 */
}
.ks-ta-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--ks-radius-sm);
  border: 1px solid transparent;
  background: rgba(20, 16, 12, 0.55);
  color: var(--ks-text-dim);
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
  backdrop-filter: blur(4px);
}
.ks-ta-copy:hover:not(:disabled) {
  color: var(--ks-cyan);
  border-color: rgba(108, 143, 184, 0.35);
  background: rgba(108, 143, 184, 0.15);
}
.ks-ta-copy:disabled {
  opacity: 0.35;
  cursor: default;
}
.ks-ta-copy.is-done {
  color: var(--ks-mint);
  border-color: rgba(111, 199, 168, 0.5);
  background: rgba(111, 199, 168, 0.12);
}
.ks-ta-copy-done {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}
`
injectStyleOnce('textarea-with-copy', css)
