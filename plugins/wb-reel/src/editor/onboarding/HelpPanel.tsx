/**
 * HelpPanel —— 时间轴快捷键 / 功能速查面板。
 *
 * 工具栏「?」按钮（onboardingStore.setHelpOpen(true)）随时打开；列快捷键 + 各轨/各
 * 功能速查 + 一个「重看新手引导」入口（重开分步 tour）。
 */

import { injectStyleOnce } from '../../styles/injectStyle'
import { useOnboardingStore } from './onboardingStore'

interface Row {
  keys: string
  desc: string
}

const SHORTCUTS: Row[] = [
  { keys: '⌘/Ctrl + Z', desc: '撤销（误删可找回，内存栈最多 50 步）' },
  { keys: '⌘/Ctrl + Shift + Z · Ctrl+Y', desc: '重做' },
  { keys: 'Delete · Backspace', desc: '删除选中片段（多选则整批删）' },
  { keys: '⌘/Ctrl + C / V / D', desc: '复制 / 粘贴到播放头 / 原地再制' },
  { keys: 'Shift + 点击', desc: '多选片段（可整批删除 / 微调）' },
  { keys: 'M', desc: '在播放头处打一个标记点' },
  { keys: 'Esc', desc: '取消当前选择 / 多选' },
  { keys: '拖两端 / 拖中间', desc: '裁剪片段时长 / 移动片段位置' },
  { keys: 'Ctrl/⌘ + 滚轮', desc: '时间轴缩放（也可拖工具栏缩放滑块）' },
]

const FEATURES: Row[] = [
  { keys: '轨道头 👁', desc: '显示 / 隐藏该轨（不影响数据，仅预览与画面叠层）' },
  { keys: '轨道头 🔒', desc: '锁定该轨：片段不可拖动，点击只透传播放头' },
  { keys: '「轨道」按钮', desc: '统一管理所有轨的显隐' },
  { keys: '右侧后期面板', desc: '转场 / 特效 / 贴纸 / 滤镜 / 调节 / 首尾动画 / 变速 / 我的' },
  { keys: '变速 / 定格', desc: '选中镜头 → 后期面板「变速」：定格(0)/0.5×/1×/2× 等' },
  { keys: '工具栏「更多 ⋯」', desc: '复制/粘贴/再制 · 镜头/音频左对齐 · 左右微调 · 清空' },
  { keys: '标尺双击 / M', desc: '打标记点（可命名、可吸附、不进成片）' },
  { keys: '音频淡入淡出', desc: '选中音频片段 → 设音量 / 淡入 / 淡出' },
]

export function HelpPanel() {
  injectStyleOnce('ks-help-panel', css)
  const helpOpen = useOnboardingStore((s) => s.helpOpen)
  const setHelpOpen = useOnboardingStore((s) => s.setHelpOpen)
  const openTour = useOnboardingStore((s) => s.openTour)
  if (!helpOpen) return null
  const close = (): void => setHelpOpen(false)
  return (
    <div className="ks-help-scrim" onClick={close} role="presentation">
      <aside className="ks-help-panel" role="dialog" aria-label="时间轴帮助" onClick={(e) => e.stopPropagation()}>
        <header className="ks-help-head">
          <span className="ks-help-title">时间轴速查</span>
          <button type="button" className="ks-help-close" onClick={close} aria-label="关闭" title="关闭 (点击空白处也可)">
            ✕
          </button>
        </header>
        <div className="ks-help-body">
          <section className="ks-help-sec">
            <h4 className="ks-help-sec-title">快捷键</h4>
            <table className="ks-help-table">
              <tbody>
                {SHORTCUTS.map((r) => (
                  <tr key={r.keys}>
                    <td className="ks-help-keys ks-mono">{r.keys}</td>
                    <td className="ks-help-desc">{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="ks-help-sec">
            <h4 className="ks-help-sec-title">功能速查</h4>
            <table className="ks-help-table">
              <tbody>
                {FEATURES.map((r) => (
                  <tr key={r.keys}>
                    <td className="ks-help-keys">{r.keys}</td>
                    <td className="ks-help-desc">{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="ks-help-foot">
          <button
            type="button"
            className="ks-help-replay"
            onClick={() => {
              setHelpOpen(false)
              openTour()
            }}
          >
            ↺ 重看新手引导
          </button>
        </footer>
      </aside>
    </div>
  )
}

const css = `
.ks-help-scrim {
  position: absolute; inset: 0; z-index: 61;
  display: flex; align-items: stretch; justify-content: flex-end;
  background: rgba(0,0,0,0.4);
}
.ks-help-panel {
  width: min(420px, 92%);
  height: 100%;
  display: flex; flex-direction: column;
  background: var(--ks-panel-elev);
  border-left: 1px solid var(--ks-border);
  box-shadow: -12px 0 40px rgba(0,0,0,0.45);
  color: var(--ks-text);
}
.ks-help-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--ks-border-soft);
}
.ks-help-title { font-size: 14px; font-weight: 700; }
.ks-help-close {
  all: unset; cursor: pointer; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--ks-radius-sm); color: var(--ks-text-dim);
}
.ks-help-close:hover { color: var(--ks-text); background: var(--ks-panel-solid); }
.ks-help-body { flex: 1 1 auto; overflow-y: auto; padding: 12px 16px; }
.ks-help-sec { margin-bottom: 18px; }
.ks-help-sec-title {
  margin: 0 0 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ks-text-faint);
}
.ks-help-table { width: 100%; border-collapse: collapse; }
.ks-help-table td { padding: 5px 0; vertical-align: top; font-size: 12px; line-height: 1.5; }
.ks-help-keys {
  width: 44%; padding-right: 10px !important; color: var(--ks-amber);
  white-space: nowrap; word-break: keep-all;
}
.ks-help-desc { color: var(--ks-text-soft); }
.ks-help-foot { padding: 12px 16px; border-top: 1px solid var(--ks-border-soft); }
.ks-help-replay {
  all: unset; cursor: pointer; display: block; width: 100%; text-align: center;
  padding: 8px 0; border-radius: var(--ks-radius-sm); font-size: 12px;
  color: var(--ks-text-soft); border: 1px solid var(--ks-border-soft); background: var(--ks-panel-solid);
}
.ks-help-replay:hover { color: var(--ks-text); border-color: var(--ks-border-strong); }
`
