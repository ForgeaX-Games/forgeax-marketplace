import type { JSX } from 'react'
import aiParameterFillIcon from './assets/ai-parameter-fill.png'

export function AiParameterFillButton({ className }: { className?: string }): JSX.Element {
  return (
    <button
      type="button"
      className={className}
      disabled
      aria-label="AI 补全参数"
      title="AI 补全暂不可用"
      style={{
        flex: 'none',
        display: 'block',
        width: 18,
        height: 18,
        padding: 0,
        border: 0,
        borderRadius: 0,
        background: 'transparent',
        cursor: 'not-allowed',
        opacity: 1,
      }}
    >
      <img
        src={aiParameterFillIcon}
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
        style={{ display: 'block' }}
      />
    </button>
  )
}
