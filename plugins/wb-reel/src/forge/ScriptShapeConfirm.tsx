import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../styles/injectStyle'
import type { ChosenPath } from './forgeDraftStore'
import type { ScriptShapeKind, ScriptShapeReport } from './detectScriptShape'

/**
 * ScriptShapeConfirm —— 入口判别器的"作者知情确认"浮层。
 *
 * 触发：作者在 IdeaForge「贴剧本」tab 点"解析剧本树"。
 *
 * 行为契约：
 *   - 在 IdeaForge 里调用 detectScriptShape() 拿到 report
 *   - 如果 report.kind === 'structured-script' 且 confidence ≥ 0.8，
 *     **不弹**，直接走 P1（原有 forgeScenarioFromScript 路径）
 *   - 其他情况一律弹本组件，让作者：
 *       1) 看到我们检测到的特征（命中的标题/对白/表格数）
 *       2) 看到为什么这么判（reasons 文字）
 *       3) 选择一条路径（P1 / P2 / P3 / 改去 idea）
 *
 * 设计取舍：
 *   - 永远提供"按 P1 直跑"逃生口 —— 即使我们判 prose-novel，作者觉得"算了你直跑试试"也行
 *   - 永远提供"取消" —— 关掉浮层不做任何事
 *   - "改去 idea 模式"作为一个显式选项，因为对于太短/纯小说体作者经常该走 idea
 *
 * 不做的事：
 *   - 不在这里调 LLM —— 仅做 UI 决策传递，实际锻造由 IdeaForge.forge() 拿到 chosenPath 后分派
 *   - 不持久化决策 —— 决策已经在 forgeDraftStore.chosenPath 里，本组件只读不写
 */

export interface ScriptShapeConfirmProps {
  report: ScriptShapeReport
  /**
   * 作者点选项后回调，传入选中路径或 null（表示取消）。
   * 由父组件落到 forgeDraftStore.setChosenPath / clearShapeChoice。
   */
  onChoose: (path: ChosenPath | null) => void
}

export function ScriptShapeConfirm({ report, onChoose }: ScriptShapeConfirmProps) {
  return createPortal(
    <div className="ks-shape-backdrop" onClick={() => onChoose(null)}>
      <div className="ks-shape-card" onClick={(e) => e.stopPropagation()}>
        <header className="ks-shape-head">
          <h3>检测到的剧本形态 · 请确认下一步走哪条路径</h3>
          <p>这一步不会改你的字。我们先给你看检测到了什么，由你拍板进哪条管线。</p>
        </header>

        <div className="ks-shape-body">
          {/* ── 检测特征卡片 ── */}
          <section className="ks-shape-detect">
            <div className="ks-shape-kind">
              <KindBadge kind={report.kind} />
              <span className="ks-shape-confi" title={`confidence ${report.confidence}`}>
                {Math.round(report.confidence * 100)}% 把握
              </span>
            </div>
            <ul className="ks-shape-reasons">
              {report.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <SignalChips report={report} />
          </section>

          {/* ── 路径选项（按推荐度排序，每档都给"会做什么"和"风险"） ── */}
          <section className="ks-shape-paths">
            {visibleOptions(report.kind).map((opt) => (
              <button
                key={opt.path}
                type="button"
                className={`ks-shape-opt ${opt.recommended ? 'is-rec' : ''}`}
                onClick={() => onChoose(opt.path)}
              >
                <div className="ks-shape-opt-head">
                  <span className="ks-shape-opt-title">{opt.title}</span>
                  {opt.recommended && <span className="ks-shape-opt-tag">推荐</span>}
                </div>
                <div className="ks-shape-opt-desc">{opt.desc}</div>
                <div className="ks-shape-opt-meta">
                  <span className="ks-shape-opt-llm">{opt.llmCost}</span>
                  <span className="ks-shape-opt-risk">{opt.risk}</span>
                </div>
              </button>
            ))}
          </section>
        </div>

        <footer className="ks-shape-foot">
          <button
            type="button"
            className="ks-shape-cancel"
            onClick={() => onChoose(null)}
            title="关掉，不做任何事"
          >
            取消
          </button>
          <span className="ks-shape-foot-tip">
            选哪条都不会立即改你的字 —— 只是告诉我们走哪条管线。
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ============================================================================
// 子组件 · 类型徽章 / 信号 chips
// ============================================================================

function KindBadge({ kind }: { kind: ScriptShapeKind }) {
  const meta = KIND_META[kind]
  return (
    <span className={`ks-shape-badge ${meta.cls}`}>
      <span className="ks-shape-badge-dot">●</span>
      {meta.label}
    </span>
  )
}

const KIND_META: Record<ScriptShapeKind, { label: string; cls: string }> = {
  'structured-script': { label: '结构化剧本', cls: 'is-ok' },
  'mixed-with-tables': { label: '含表格的剧本', cls: 'is-warn' },
  'prose-novel': { label: '叙事小说体', cls: 'is-warn' },
  'too-short': { label: '文本过短', cls: 'is-danger' },
  unknown: { label: '结构特征不明', cls: 'is-mid' },
}

function SignalChips({ report }: { report: ScriptShapeReport }) {
  const s = report.signals
  // 全部用同一种 chip 展现，灰底白字，让 UI 不喧宾夺主
  const chips: { label: string; value: string | number; show: boolean }[] = [
    { label: '总字数', value: s.length, show: true },
    { label: '段落数', value: s.paragraphCount, show: s.paragraphCount > 0 },
    { label: '场景/章节标题', value: s.headingCount, show: s.headingCount > 0 },
    { label: '对白', value: s.dialogueCount, show: s.dialogueCount > 0 },
    { label: 'Markdown 表格行', value: s.mdTableRows, show: s.mdTableRows > 0 },
    { label: 'HTML 表格', value: s.htmlTableCount, show: s.htmlTableCount > 0 },
    {
      label: '段落均长',
      value: `${s.avgParagraphChars} 字`,
      show: s.paragraphCount > 0,
    },
  ]
  return (
    <div className="ks-shape-chips">
      {chips
        .filter((c) => c.show)
        .map((c) => (
          <span key={c.label} className="ks-shape-chip">
            <span className="ks-shape-chip-k">{c.label}</span>
            <span className="ks-shape-chip-v">{c.value}</span>
          </span>
        ))}
    </div>
  )
}

// ============================================================================
// 路径选项 · 按检测类别决定哪些显示 / 哪个推荐
//
// 每个选项都说明三件事：
//   - 会做什么（desc）
//   - LLM 成本（llmCost：直观告诉作者这条要烧多少 token / 大约多久）
//   - 风险（risk：告诉作者这条会不会改字、会不会二创）
//
// 不展示完全不适用的选项（比如 too-short 不展示 P2/P3）以免分心。
// ============================================================================

interface PathOption {
  path: ChosenPath
  title: string
  desc: string
  llmCost: string
  risk: string
  recommended: boolean
}

const ALL_OPTIONS: Record<ChosenPath, Omit<PathOption, 'recommended'>> = {
  'p1-direct': {
    path: 'p1-direct',
    title: '直通 · 按结构化剧本解析',
    desc: '把剧本原样喂给翻译器（temperature 0.3、绝对忠于原文）。台词一字不改、章节一一对应。',
    llmCost: '1 次 LLM · 约 30-90 秒',
    risk: '不改你的字',
  },
  'p2-curate': {
    path: 'p2-curate',
    title: '整理 · 把表格/列表展平为叙事段落',
    desc: '先用一轮 LLM 把表格行、清单数据改写成叙事描写，整理稿你审一遍再进结构化解析。重组不创作。',
    llmCost: '2 次 LLM · 约 1-2 分钟',
    risk: '不加情节、不改台词，仅改格式',
  },
  'p3-expand': {
    path: 'p3-expand',
    title: '扩写 · 小说体 → 剧本（含 beats 审阅）',
    desc: '先把小说切成 beats（带原文 quote 可审计），你逐项审/编/合并/拆分后，每个 beat 才扩写成场景剧本，最后进结构化解析。',
    llmCost: '若干次 LLM · 约 3-6 分钟',
    risk: '会基于原文创作（增血肉），但每一步都让你审',
  },
  'p4-image': {
    path: 'p4-image',
    title: '图生种子（在脚本模式不可用）',
    desc: '"一张图 → 故事种子" 路径已在第三 tab「◉ 一张图」单独落地。脚本模式里看到的这条选项仅为类型完整性保留，不会出现在任何输入形态的推荐列表里。',
    llmCost: '—',
    risk: '—',
  },
  'goto-idea': {
    path: 'goto-idea',
    title: '改去 idea 模式',
    desc: '你这段输入更像"想法/灵感"。改用 idea 模式，让我们一句话扩写整个故事。',
    llmCost: '取决于 idea 模式',
    risk: '会创作（这是 idea 模式的本意）',
  },
}

function visibleOptions(kind: ScriptShapeKind): PathOption[] {
  switch (kind) {
    case 'structured-script':
      // 理论上这种不会弹层；但万一作者强弹（confidence < 0.8）—— 仍以 P1 为推荐
      return [
        { ...ALL_OPTIONS['p1-direct'], recommended: true },
        { ...ALL_OPTIONS['p2-curate'], recommended: false },
      ]
    case 'mixed-with-tables':
      return [
        { ...ALL_OPTIONS['p2-curate'], recommended: true },
        { ...ALL_OPTIONS['p1-direct'], recommended: false },
      ]
    case 'prose-novel':
      return [
        { ...ALL_OPTIONS['p3-expand'], recommended: true },
        { ...ALL_OPTIONS['p1-direct'], recommended: false },
        { ...ALL_OPTIONS['goto-idea'], recommended: false },
      ]
    case 'too-short':
      return [
        { ...ALL_OPTIONS['goto-idea'], recommended: true },
        { ...ALL_OPTIONS['p1-direct'], recommended: false },
      ]
    case 'unknown':
    default:
      return [
        { ...ALL_OPTIONS['p1-direct'], recommended: false },
        { ...ALL_OPTIONS['p2-curate'], recommended: false },
        { ...ALL_OPTIONS['p3-expand'], recommended: false },
        { ...ALL_OPTIONS['goto-idea'], recommended: false },
      ]
  }
}

// ============================================================================
// 样式（与 ReconnectOrphansDialog 同源风格，作者切换两个 dialog 不会跳脱）
// ============================================================================

const CSS = `
.ks-shape-backdrop {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(10, 14, 22, 0.55);
  backdrop-filter: blur(8px) saturate(1.2);
  -webkit-backdrop-filter: blur(8px) saturate(1.2);
  display: flex; align-items: center; justify-content: center;
  animation: ks-shape-fade 140ms ease-out;
}
@keyframes ks-shape-fade { from { opacity: 0 } to { opacity: 1 } }

.ks-shape-card {
  width: min(720px, 92vw);
  max-height: 86vh;
  display: flex; flex-direction: column;
  border-radius: 20px;
  background: rgba(30, 28, 22, 0.94);
  border: 1px solid rgba(255, 240, 215, 0.14);
  box-shadow: 0 32px 80px -30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
  color: #f5ecd9;
  overflow: hidden;
  animation: ks-shape-pop 180ms cubic-bezier(.2,.8,.3,1);
}
@keyframes ks-shape-pop {
  from { transform: translateY(12px) scale(0.97); opacity: 0 }
  to   { transform: none; opacity: 1 }
}

.ks-shape-head { padding: 18px 22px 12px; border-bottom: 1px solid rgba(255, 240, 215, 0.08); }
.ks-shape-head h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
.ks-shape-head p {
  margin: 0; font-size: 12px; line-height: 1.55; color: rgba(245, 236, 217, 0.62);
}

.ks-shape-body { flex: 1; overflow-y: auto; padding: 14px 18px 18px; }

/* ── 检测特征区 ── */
.ks-shape-detect {
  background: rgba(255, 240, 215, 0.04);
  border: 1px solid rgba(255, 240, 215, 0.08);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.ks-shape-kind {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 8px;
}
.ks-shape-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
  border: 1px solid rgba(255,255,255,0.1);
}
.ks-shape-badge-dot { font-size: 8px; line-height: 1; }
.ks-shape-badge.is-ok      { color: #6fc7a8; background: rgba(111, 199, 168, 0.1); border-color: rgba(111, 199, 168, 0.32); }
.ks-shape-badge.is-warn    { color: #f3b35a; background: rgba(243, 179, 90, 0.1); border-color: rgba(243, 179, 90, 0.32); }
.ks-shape-badge.is-mid     { color: #6c8fb8; background: rgba(108, 143, 184, 0.1); border-color: rgba(108, 143, 184, 0.32); }
.ks-shape-badge.is-danger  { color: #f0779d; background: rgba(240, 119, 157, 0.1); border-color: rgba(240, 119, 157, 0.32); }
.ks-shape-confi {
  font-size: 11px;
  color: rgba(245, 236, 217, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ks-shape-reasons {
  margin: 0 0 10px; padding-left: 18px;
  font-size: 12.5px; line-height: 1.7; color: rgba(245, 236, 217, 0.86);
}
.ks-shape-reasons li { padding: 1px 0; }

.ks-shape-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 240, 215, 0.08);
}
.ks-shape-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255, 240, 215, 0.06);
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ks-shape-chip-k { color: rgba(245, 236, 217, 0.55); }
.ks-shape-chip-v { color: #f5ecd9; font-weight: 600; }

/* ── 路径选项区 ── */
.ks-shape-paths {
  display: flex; flex-direction: column; gap: 8px;
}
.ks-shape-opt {
  all: unset;
  cursor: pointer;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 240, 215, 0.04);
  border: 1px solid rgba(255, 240, 215, 0.08);
  transition: background 140ms ease-out, border-color 140ms ease-out, transform 140ms ease-out;
}
.ks-shape-opt:hover {
  background: rgba(255, 240, 215, 0.08);
  border-color: rgba(255, 240, 215, 0.18);
}
.ks-shape-opt:active { transform: scale(0.99); }
.ks-shape-opt.is-rec {
  border-color: rgba(255, 123, 61, 0.45);
  background: rgba(255, 123, 61, 0.06);
}
.ks-shape-opt.is-rec:hover {
  border-color: rgba(255, 123, 61, 0.65);
  background: rgba(255, 123, 61, 0.12);
}
.ks-shape-opt-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 4px;
}
.ks-shape-opt-title {
  font-size: 13.5px; font-weight: 600; letter-spacing: 0.02em;
  color: #f5ecd9;
}
.ks-shape-opt-tag {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 123, 61, 0.18);
  color: #ffb079;
  border: 1px solid rgba(255, 123, 61, 0.4);
}
.ks-shape-opt-desc {
  font-size: 12px; line-height: 1.65;
  color: rgba(245, 236, 217, 0.78);
  margin-bottom: 6px;
}
.ks-shape-opt-meta {
  display: flex; gap: 14px;
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(245, 236, 217, 0.5);
}
.ks-shape-opt-risk { color: rgba(243, 179, 90, 0.85); }

/* ── 底部 ── */
.ks-shape-foot {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px;
  border-top: 1px solid rgba(255, 240, 215, 0.08);
  background: rgba(20, 16, 10, 0.4);
}
.ks-shape-cancel {
  all: unset; cursor: pointer;
  padding: 7px 16px;
  border-radius: 999px;
  font-size: 12px; font-weight: 500; letter-spacing: 0.02em;
  background: rgba(255, 240, 215, 0.06);
  color: rgba(245, 236, 217, 0.78);
  border: 1px solid rgba(255, 240, 215, 0.14);
  transition: background 140ms ease-out, color 140ms ease-out;
}
.ks-shape-cancel:hover { background: rgba(255, 240, 215, 0.12); color: #f5ecd9; }
.ks-shape-foot-tip {
  font-size: 11px;
  color: rgba(245, 236, 217, 0.45);
}
`
injectStyleOnce('script-shape-confirm', CSS)
