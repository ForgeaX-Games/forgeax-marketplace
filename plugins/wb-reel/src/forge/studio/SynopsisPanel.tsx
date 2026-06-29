import { useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { CopyButton } from '../../ui/CopyButton'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * SynopsisPanel —— 作品梗概（小说家工作板 · 第 1 段）。
 *
 * 数据源：`Scenario.synopsis`（顶层字段，作者层面纲领）。
 *
 * 角色定位：
 *   - 这是"作品的一句话魂魄" —— 给玩家看的封面文案 / 给后续 LLM 当上下文锚点
 *   - 与 scenes 解耦：作者改梗概不会自动重写 scenes，但可以在 chat 里
 *     `/expand` 命令触发"按新梗概重新拉大纲 / 重新展开剧本"
 *
 * 展示取舍（2026-06 作者反馈："内容太生硬，要艺术化、水平居中、文字效果、氛围"）：
 *   - 默认是**电影感只读展示**：氛围光晕 + 暗角、居中、衬线大字、文字渐变微光、
 *     逐行淡入上浮，把梗概当成"片头字幕 / 海报文案"而非编辑框。
 *   - 点「编辑」或双击切回 textarea 编辑；空梗概直接进编辑态引导撰写。
 *   - 视觉对齐主站深色 + 琥珀（--ks-amber）基调。
 */
export function SynopsisPanel() {
  const synopsis = useScenarioStore((s) => s.scenario.synopsis ?? '')
  const setSynopsis = useScenarioStore((s) => s.setSynopsis)
  const [editing, setEditing] = useState(false)

  const lines = synopsis
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const hasContent = lines.length > 0

  // 编辑态（或还没有梗概时）—— 保留原 textarea 工作流
  if (editing || !hasContent) {
    return (
      <div className="ks-fs-panel ks-fs-synopsis">
        <div className="ks-fs-panel-head">
          <span className="ks-mono ks-faint">梗概 · SYNOPSIS</span>
          <div className="ks-fs-panel-head-right">
            <span className="ks-fs-panel-count ks-mono ks-faint">{synopsis.length} 字</span>
            <CopyButton value={synopsis} />
            {hasContent && (
              <button
                type="button"
                className="ks-syn-done ks-mono"
                onClick={() => setEditing(false)}
              >
                完成 ✓
              </button>
            )}
          </div>
        </div>
        <textarea
          className="ks-fs-textarea ks-fs-synopsis-area"
          value={synopsis}
          autoFocus={hasContent}
          placeholder={
            '一句话魂魄 ——\n\n例：\n— 雨夜的旧居门前，男人面对锁着的门，门里似乎不只有她。\n— 末日地铁站，三秒决定救谁，每一次选择都掀翻一个人的人生。'
          }
          onChange={(e) => setSynopsis(e.target.value)}
          onBlur={() => hasContent && setEditing(false)}
          rows={8}
        />
        <div className="ks-fs-panel-hint ks-mono ks-faint">
          ▸ 改完后想重拉大纲？右侧 chat 输入 <code>/expand</code> 让 AI 按新梗概重写
        </div>
      </div>
    )
  }

  // 展示态 —— 电影感艺术化呈现
  return (
    <div
      className="ks-syn-stage"
      onDoubleClick={() => setEditing(true)}
      title="双击编辑"
    >
      <div className="ks-syn-ambient" aria-hidden />
      <div className="ks-syn-vignette" aria-hidden />

      <div className="ks-syn-content">
        <div className="ks-syn-kicker">
          <span className="ks-syn-rule" />
          SYNOPSIS · 梗概
          <span className="ks-syn-rule" />
        </div>

        <div className="ks-syn-quote" aria-hidden>
          &ldquo;
        </div>

        <div className="ks-syn-text">
          {lines.map((line, i) => (
            <p
              key={i}
              className="ks-syn-line"
              style={{ animationDelay: `${0.12 + i * 0.13}s` }}
            >
              {line}
            </p>
          ))}
        </div>

        <div className="ks-syn-meta">
          <span className="ks-mono ks-syn-count">{synopsis.length} 字</span>
          <button
            type="button"
            className="ks-syn-edit ks-mono"
            onClick={() => setEditing(true)}
          >
            ✎ 编辑
          </button>
          <CopyButton value={synopsis} />
        </div>
      </div>
    </div>
  )
}

const css = `
.ks-fs-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.ks-fs-panel-head {
  display: flex; justify-content: space-between; align-items: center;
}
.ks-fs-panel-head .ks-mono {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--ks-text-dim);
}
.ks-fs-panel-head-right {
  display: flex; align-items: center; gap: 10px;
}
.ks-fs-panel-count {
  font-size: 10px;
  letter-spacing: 0.12em;
}
.ks-syn-done {
  border: 1px solid var(--ks-amber);
  background: rgba(255, 123, 61, 0.12);
  color: var(--ks-amber);
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--ks-dur-fast), filter var(--ks-dur-fast);
}
.ks-syn-done:hover { filter: brightness(1.2); }
.ks-fs-textarea {
  flex: 1;
  min-height: 140px;
  width: 100%;
  font-family: var(--ks-font-cn);
  font-size: 13.5px;
  line-height: 1.85;
  padding: 14px 16px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  resize: none;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast);
}
.ks-fs-textarea:focus {
  outline: none;
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 3px rgba(255, 123, 61, 0.12);
}
.ks-fs-synopsis-area {
  min-height: 200px;
}
.ks-fs-panel-hint {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ks-text-faint);
}
.ks-fs-panel-hint code {
  font-family: var(--ks-font-mono);
  background: rgba(255, 123, 61, 0.1);
  color: var(--ks-amber);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ============ 电影感梗概展示 ============ */
.ks-syn-stage {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-radius: var(--ks-radius-lg, 14px);
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(255, 170, 80, 0.10) 0%, rgba(255, 170, 80, 0) 55%),
    linear-gradient(180deg, #14110d 0%, #0c0b0a 60%, #08080a 100%);
  cursor: text;
}
/* 缓慢呼吸的中心光晕 */
.ks-syn-ambient {
  position: absolute;
  left: 50%;
  top: 30%;
  width: 80%;
  height: 60%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: radial-gradient(closest-side, rgba(255, 190, 110, 0.16), rgba(255, 190, 110, 0) 70%);
  filter: blur(8px);
  animation: ks-syn-breathe 7s ease-in-out infinite;
}
/* 四周暗角，聚焦视线 */
.ks-syn-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 120px 40px rgba(0, 0, 0, 0.55);
  border-radius: inherit;
}
.ks-syn-content {
  position: relative;
  z-index: 1;
  margin: auto;
  max-width: 62ch;
  padding: 48px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 18px;
}
.ks-syn-kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--ks-amber, #d4f04a);
  opacity: 0.9;
  animation: ks-syn-fade-up 0.6s ease both;
}
.ks-syn-rule {
  width: 36px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ks-amber, #d4f04a));
}
.ks-syn-rule:last-child {
  background: linear-gradient(90deg, var(--ks-amber, #d4f04a), transparent);
}
.ks-syn-quote {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 72px;
  line-height: 0.4;
  height: 36px;
  color: rgba(255, 190, 110, 0.32);
  animation: ks-syn-fade-up 0.7s ease both;
  animation-delay: 0.05s;
}
.ks-syn-text {
  display: flex;
  flex-direction: column;
  gap: 14px;
  filter: drop-shadow(0 2px 22px rgba(255, 175, 90, 0.18));
}
.ks-syn-line {
  margin: 0;
  font-family: 'Noto Serif SC', 'Songti SC', 'STSong', 'Source Han Serif SC', serif;
  font-size: clamp(18px, 2.1vw, 27px);
  line-height: 1.95;
  letter-spacing: 0.04em;
  font-weight: 500;
  background: linear-gradient(180deg, #fffaf2 0%, #ffe7c2 55%, #ffc987 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ks-syn-fade-up 0.8s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.ks-syn-meta {
  margin-top: 22px;
  display: flex;
  align-items: center;
  gap: 14px;
  opacity: 0;
  animation: ks-syn-fade-up 0.6s ease both;
  animation-delay: 0.5s;
}
.ks-syn-count {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ks-text-faint, rgba(255,255,255,0.4));
}
.ks-syn-edit {
  border: 1px solid rgba(255, 190, 110, 0.4);
  background: rgba(255, 170, 80, 0.08);
  color: var(--ks-amber, #d4f04a);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--ks-dur-fast, 160ms), border-color var(--ks-dur-fast, 160ms);
}
.ks-syn-edit:hover {
  background: rgba(255, 170, 80, 0.18);
  border-color: var(--ks-amber, #d4f04a);
}

@keyframes ks-syn-fade-up {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ks-syn-breathe {
  0%, 100% { opacity: 0.7; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
}
@media (prefers-reduced-motion: reduce) {
  .ks-syn-kicker,
  .ks-syn-quote,
  .ks-syn-line,
  .ks-syn-meta { animation: none; opacity: 1; transform: none; }
  .ks-syn-ambient { animation: none; }
}
`
injectStyleOnce('forge-studio-panel', css)
