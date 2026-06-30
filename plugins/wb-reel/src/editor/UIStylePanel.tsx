import { useScenarioStore } from '../scenario/scenarioStore'
import { CopyButton } from '../ui/CopyButton'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 全局 UI 风格 —— 跨场景的视觉一致性总开关。
 *
 * 影响：
 *   - 每次场景生图时，会被自动前置为 prompt 的"整体视觉风格"段落
 *   - 渲染游戏内 UI 元素（按钮、字幕条、QTE icon）的草稿时也用它
 */
export function UIStylePanel() {
  const uiStyle = useScenarioStore((s) => s.scenario.uiStyle)
  const setUIStyle = useScenarioStore((s) => s.setUIStyle)
  const value = uiStyle?.prompt ?? ''

  return (
    <div className="ks-uis">
      <div className="ks-uis-head">
        <span className="ks-mono ks-faint">全局视觉风格 · 影响所有生图</span>
        <CopyButton value={value} />
      </div>
      <textarea
        rows={4}
        value={value}
        placeholder={
          '例：深夜电影质感的 UI —— 黑曜石玻璃 + 极薄琥珀金描边 + 衬线中文 + 微弱胶片噪点'
        }
        onChange={(e) => setUIStyle({ prompt: e.target.value })}
      />
    </div>
  )
}

const uisCss = `
.ks-uis { display: flex; flex-direction: column; gap: 8px; }
.ks-uis-head {
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-uis textarea {
  width: 100%;
  font-family: var(--ks-font-cn);
  font-size: 13px;
  line-height: 1.75;
  padding: 14px 16px;
  border-radius: var(--ks-radius-md);
}
`
injectStyleOnce('ui-style-panel', uisCss)
