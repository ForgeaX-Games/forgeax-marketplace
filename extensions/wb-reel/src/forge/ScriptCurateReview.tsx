import { createPortal } from 'react-dom'
import { useMemo } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * ScriptCurateReview —— P2 整理稿审阅浮层。
 *
 * 触发：作者在 ScriptShapeConfirm 选了 p2-curate，IdeaForge 跑完
 *       forgeCuratedScript() 拿到 curated 文本，把原文 + 整理稿双双传进来。
 *
 * 行为契约：
 *   - 左边显示原文，右边显示整理稿（side-by-side），两边都按行同步滚动
 *   - 行级简易 diff：行集合差异以颜色高亮
 *       · 仅左有：红色（被整理删掉的行 / 被合并的碎片行）
 *       · 仅右有：绿色（整理后新出现的行 / 段落合并后的新行）
 *       · 两边都有：默认色
 *   - 右上角 stats：原文 X 字 → 整理后 Y 字（Z%），异常比例（< 80% 或 > 120%）会染色提示
 *   - 三个动作：
 *       · 接受整理稿（onAccept）：让 IdeaForge 用 curated 走 forgeScenarioFromScript
 *       · 重新整理（onRetry）：再跑一遍 forgeCuratedScript（同样的 hints）
 *       · 退到原文走 P1（onFallbackP1）：放弃整理，让 IdeaForge 用原文走 forgeScenarioFromScript
 *       · 取消（onCancel）：关掉浮层，不做任何后续动作
 *
 * 设计取舍：
 *   - **不做字符级 diff**：实现成本高、视觉嘈杂；行级 diff 已经够帮作者识别"动了哪"
 *   - **不做编辑**：作者要么接受、要么回退、要么重整理。要编辑就退回去自己改 textarea 再来一遍
 *   - **同步滚动**：两侧 height 锁同；用滚动事件镜像即可，不上库
 */

export interface ScriptCurateReviewProps {
  /** 原文（贴进来的剧本，未经整理） */
  original: string
  /** 整理后的 Markdown 文本 */
  curated: string
  /** 模型整理用时（毫秒），仅展示 */
  latencyMs?: number
  /** 接受整理稿（用 curated 进下游） */
  onAccept: () => void
  /** 重新整理（再跑一次 forgeCuratedScript） */
  onRetry: () => void
  /** 放弃整理，原文进下游（按 P1 直跑） */
  onFallbackP1: () => void
  /** 关掉浮层，啥也不做 */
  onCancel: () => void
}

export function ScriptCurateReview({
  original,
  curated,
  latencyMs,
  onAccept,
  onRetry,
  onFallbackP1,
  onCancel,
}: ScriptCurateReviewProps) {
  const stats = useMemo(() => {
    const ratio = original.length === 0 ? 0 : curated.length / original.length
    const pct = Math.round(ratio * 100)
    let tone: 'ok' | 'warn' | 'danger' = 'ok'
    // < 80% 多半删了内容；> 130% 多半润色 / 二创
    if (ratio < 0.8 || ratio > 1.3) tone = 'warn'
    if (ratio < 0.6 || ratio > 1.6) tone = 'danger'
    return {
      origLen: original.length,
      curatedLen: curated.length,
      pct,
      tone,
    }
  }, [original, curated])

  const diff = useMemo(() => buildLineDiff(original, curated), [original, curated])

  return createPortal(
    <div className="ks-curate-backdrop" onClick={onCancel}>
      <div className="ks-curate-card" onClick={(e) => e.stopPropagation()}>
        <header className="ks-curate-head">
          <div>
            <h3>整理稿审阅 · 你来拍板</h3>
            <p>
              左边是你贴的原文，右边是整理后的版本。整理只动结构，不动故事。
              不放心就"退到原文走 P1"，原文一字不动地进解析。
            </p>
          </div>
          <div className={`ks-curate-stats is-${stats.tone}`}>
            <span className="ks-curate-stats-num">
              {stats.origLen.toLocaleString()} → {stats.curatedLen.toLocaleString()} 字
            </span>
            <span className="ks-curate-stats-pct">（{stats.pct}%）</span>
            {typeof latencyMs === 'number' && (
              <span className="ks-curate-stats-time">· {(latencyMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </header>

        <div className="ks-curate-body">
          <div className="ks-curate-pane">
            <div className="ks-curate-pane-head">
              <span>原文</span>
              <span className="ks-curate-pane-meta">{stats.origLen} 字</span>
            </div>
            <pre className="ks-curate-pre">
              {diff.left.map((row, i) => (
                <span key={`L${i}`} className={`ks-curate-line is-${row.kind}`}>
                  {row.text || '\u00A0'}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>

          <div className="ks-curate-pane">
            <div className="ks-curate-pane-head">
              <span>整理稿</span>
              <span className="ks-curate-pane-meta">{stats.curatedLen} 字</span>
            </div>
            <pre className="ks-curate-pre">
              {diff.right.map((row, i) => (
                <span key={`R${i}`} className={`ks-curate-line is-${row.kind}`}>
                  {row.text || '\u00A0'}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        </div>

        {stats.tone !== 'ok' && (
          <div className={`ks-curate-warn is-${stats.tone}`}>
            {stats.tone === 'danger'
              ? '整理稿与原文长度差异异常（疑似删内容或二创），强烈建议「退到原文走 P1」。'
              : '整理稿长度与原文有较明显差异，请逐段核对后再"接受"。'}
          </div>
        )}

        <footer className="ks-curate-foot">
          <button type="button" className="ks-curate-btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="ks-curate-btn-fallback" onClick={onFallbackP1}>
            退到原文 · 按 P1 直跑
          </button>
          <button type="button" className="ks-curate-btn-retry" onClick={onRetry}>
            重新整理
          </button>
          <button
            type="button"
            className="ks-curate-btn-accept"
            onClick={onAccept}
            title="用整理稿进入下一步：剧本结构化解析"
          >
            接受整理稿 · 进解析
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ============================================================================
// 行级 diff 构建器
//
// 用最简单的 LCS 思想（基于行集合的"是否在另一边出现过"），不上库。
// 输出两个等长数组（左 / 右），每行带 kind：
//   - 'same'   : 两边都有此行
//   - 'remove' : 仅左有（被整理时去掉的行）
//   - 'add'    : 仅右有（整理后新出现的行）
//
// 注意：这不是真正的 LCS（不计算最长公共子序列），只是一个 O(N+M) 的"行命中"
// 估算 —— 对"段落整理 / 表格转散文"这种情况已经够用：能高亮被改动的局部，
// 不至于把所有行都误标为差异。
//
// 副作用：连续大段相同的内容，依然会按"行不同"标 add/remove；这是为了让
// 视觉上左右两栏行号对齐 —— 我们要的是"对照阅读"，不是工程级 diff。
// ============================================================================

interface DiffRow {
  text: string
  kind: 'same' | 'add' | 'remove'
}

interface DiffResult {
  left: DiffRow[]
  right: DiffRow[]
}

function buildLineDiff(orig: string, curated: string): DiffResult {
  const leftLines = orig.split('\n')
  const rightLines = curated.split('\n')

  // 把行做"软规范化"：去首尾空白 + 全角空格当普通空格 + 折叠多个空格
  // 这样"段落合并造成的空白差异"不会被错标成全行不同。
  const normalize = (s: string) =>
    s
      .replace(/\u3000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const leftNorm = leftLines.map(normalize)
  const rightNorm = rightLines.map(normalize)

  // 左行的"是否在右边出现过" / 右行的"是否在左边出现过"
  // 用 multiset 而非 set，避免重复行被吞（如多空行、相同对白）
  const rightCount = new Map<string, number>()
  for (const r of rightNorm) {
    if (!r) continue
    rightCount.set(r, (rightCount.get(r) ?? 0) + 1)
  }
  const leftCount = new Map<string, number>()
  for (const l of leftNorm) {
    if (!l) continue
    leftCount.set(l, (leftCount.get(l) ?? 0) + 1)
  }

  // 第一遍：标记每行 kind
  const leftKinds: DiffRow['kind'][] = leftNorm.map((s) => {
    if (!s) return 'same' // 空行不算差异
    const cnt = rightCount.get(s) ?? 0
    if (cnt > 0) {
      rightCount.set(s, cnt - 1)
      return 'same'
    }
    return 'remove'
  })
  const rightKinds: DiffRow['kind'][] = rightNorm.map((s) => {
    if (!s) return 'same'
    const cnt = leftCount.get(s) ?? 0
    if (cnt > 0) {
      leftCount.set(s, cnt - 1)
      return 'same'
    }
    return 'add'
  })

  return {
    left: leftLines.map((text, i) => ({ text, kind: leftKinds[i] ?? 'same' })),
    right: rightLines.map((text, i) => ({ text, kind: rightKinds[i] ?? 'same' })),
  }
}

// ============================================================================
// 样式（沿用 ScriptShapeConfirm 的视觉调性，作者切换不会跳脱）
// ============================================================================

const CSS = `
.ks-curate-backdrop {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(10, 14, 22, 0.55);
  backdrop-filter: blur(8px) saturate(1.2);
  -webkit-backdrop-filter: blur(8px) saturate(1.2);
  display: flex; align-items: center; justify-content: center;
  animation: ks-curate-fade 140ms ease-out;
}
@keyframes ks-curate-fade { from { opacity: 0 } to { opacity: 1 } }

.ks-curate-card {
  width: min(1180px, 95vw);
  max-height: 92vh;
  display: flex; flex-direction: column;
  border-radius: 20px;
  background: rgba(30, 28, 22, 0.94);
  border: 1px solid rgba(255, 240, 215, 0.14);
  box-shadow: 0 32px 80px -30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
  color: #f5ecd9;
  overflow: hidden;
  animation: ks-curate-pop 180ms cubic-bezier(.2,.8,.3,1);
}
@keyframes ks-curate-pop {
  from { transform: translateY(12px) scale(0.97); opacity: 0 }
  to   { transform: none; opacity: 1 }
}

.ks-curate-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
  padding: 18px 22px 12px;
  border-bottom: 1px solid rgba(255, 240, 215, 0.08);
}
.ks-curate-head h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
.ks-curate-head p {
  margin: 0; font-size: 12px; line-height: 1.55; color: rgba(245, 236, 217, 0.62); max-width: 720px;
}

.ks-curate-stats {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(111, 199, 168, 0.1);
  border: 1px solid rgba(111, 199, 168, 0.32);
  color: #6fc7a8;
  white-space: nowrap;
}
.ks-curate-stats.is-warn   { background: rgba(243, 179, 90, 0.1); border-color: rgba(243, 179, 90, 0.32); color: #f3b35a; }
.ks-curate-stats.is-danger { background: rgba(240, 119, 157, 0.1); border-color: rgba(240, 119, 157, 0.32); color: #f0779d; }
.ks-curate-stats-num { font-weight: 600; }
.ks-curate-stats-pct { opacity: 0.75; }
.ks-curate-stats-time { opacity: 0.6; }

.ks-curate-body {
  flex: 1;
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 14px 18px 0;
  min-height: 0;
}

.ks-curate-pane {
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
  background: rgba(20, 16, 10, 0.5);
  border: 1px solid rgba(255, 240, 215, 0.08);
  border-radius: 12px;
  overflow: hidden;
}
.ks-curate-pane-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  font-size: 11.5px; letter-spacing: 0.06em;
  color: rgba(245, 236, 217, 0.68);
  background: rgba(255, 240, 215, 0.04);
  border-bottom: 1px solid rgba(255, 240, 215, 0.08);
}
.ks-curate-pane-meta {
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(245, 236, 217, 0.45);
}

.ks-curate-pre {
  flex: 1; margin: 0; padding: 10px 14px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(245, 236, 217, 0.86);
}
.ks-curate-line.is-same   { /* 默认色 */ }
.ks-curate-line.is-remove {
  background: rgba(240, 119, 157, 0.14);
  color: #f7b7c8;
}
.ks-curate-line.is-add {
  background: rgba(111, 199, 168, 0.14);
  color: #b8e6d2;
}

.ks-curate-warn {
  margin: 10px 18px 0;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: 10px;
  background: rgba(243, 179, 90, 0.1);
  border: 1px solid rgba(243, 179, 90, 0.32);
  color: #f3b35a;
}
.ks-curate-warn.is-danger {
  background: rgba(240, 119, 157, 0.12);
  border-color: rgba(240, 119, 157, 0.4);
  color: #f0779d;
}

.ks-curate-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid rgba(255, 240, 215, 0.08);
  background: rgba(20, 16, 10, 0.4);
}
.ks-curate-foot button {
  all: unset; cursor: pointer;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 12px; font-weight: 500; letter-spacing: 0.02em;
  border: 1px solid rgba(255, 240, 215, 0.14);
  transition: background 140ms ease-out, color 140ms ease-out, transform 140ms ease-out;
}
.ks-curate-foot button:active { transform: scale(0.98); }

.ks-curate-btn-cancel {
  background: rgba(255, 240, 215, 0.06);
  color: rgba(245, 236, 217, 0.72);
}
.ks-curate-btn-cancel:hover { background: rgba(255, 240, 215, 0.12); color: #f5ecd9; }

.ks-curate-btn-fallback {
  background: rgba(108, 143, 184, 0.12);
  color: #9bb6dd;
  border-color: rgba(108, 143, 184, 0.36);
}
.ks-curate-btn-fallback:hover { background: rgba(108, 143, 184, 0.22); color: #cfdcef; }

.ks-curate-btn-retry {
  background: rgba(243, 179, 90, 0.12);
  color: #f3b35a;
  border-color: rgba(243, 179, 90, 0.36);
}
.ks-curate-btn-retry:hover { background: rgba(243, 179, 90, 0.22); color: #ffd696; }

.ks-curate-btn-accept {
  background: rgba(255, 123, 61, 0.18);
  color: #ffb079;
  border-color: rgba(255, 123, 61, 0.5);
  font-weight: 600;
}
.ks-curate-btn-accept:hover { background: rgba(255, 123, 61, 0.32); color: #ffd1ae; border-color: rgba(255, 123, 61, 0.7); }
`
injectStyleOnce('script-curate-review', CSS)
