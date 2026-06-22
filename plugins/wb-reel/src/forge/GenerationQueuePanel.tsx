/**
 * GenerationQueuePanel —— 统一生成队列的可视化/控制面板。
 *
 * 折叠态：一行汇总（运行/排队/完成/失败）+ 全局暂停/继续/清理。
 * 展开态：逐 job 列表（标签 + 阶段 + 状态徽标 + 取消/重试）。
 *
 * 只读队列状态 + 调度控制；不接触任何凭据。
 */
import { useState } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'
import { useGenerationQueue, type GenJob, type GenJobStatus } from './generationQueueStore'
import { estimateProgress, useNowTick } from './queueProgress'
import { GenRequestDialog } from './GenRequestDialog'

const STATUS_LABEL: Record<GenJobStatus, string> = {
  queued: '排队',
  running: '生成中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}

const KIND_ICON: Record<GenJob['kind'], string> = {
  image: '🖼',
  video: '🎬',
  audio: '🎙',
}

export function GenerationQueuePanel() {
  const jobs = useGenerationQueue((s) => s.jobs)
  const order = useGenerationQueue((s) => s.order)
  const paused = useGenerationQueue((s) => s.paused)
  const pause = useGenerationQueue((s) => s.pause)
  const resume = useGenerationQueue((s) => s.resume)
  const cancel = useGenerationQueue((s) => s.cancel)
  const cancelAll = useGenerationQueue((s) => s.cancelAll)
  const retry = useGenerationQueue((s) => s.retry)
  const clearFinished = useGenerationQueue((s) => s.clearFinished)

  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inspectId, setInspectId] = useState<string | null>(null)

  async function copyError(id: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板不可用（非 https / 权限）→ 退回选中兜底
      const sel = window.getSelection()
      const node = document.getElementById(`ks-q-err-${id}`)
      if (sel && node) {
        const range = document.createRange()
        range.selectNodeContents(node)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
  }

  const list = order.map((id) => jobs[id]).filter((j): j is GenJob => !!j)
  const running = list.filter((j) => j.status === 'running').length
  const queued = list.filter((j) => j.status === 'queued').length
  const done = list.filter((j) => j.status === 'done').length
  const failed = list.filter((j) => j.status === 'failed').length
  const active = running + queued
  const now = useNowTick(open && running > 0)

  if (list.length === 0) return null

  return (
    <div className={`ks-q ${open ? 'is-open' : ''}`}>
      <div className="ks-q-bar">
        <button type="button" className="ks-q-toggle" onClick={() => setOpen((v) => !v)}>
          <span className={`ks-q-dot ${active > 0 ? 'is-live' : ''}`} />
          生成队列
          <span className="ks-q-counts">
            {running > 0 && <em className="is-run">⟳ {running}</em>}
            {queued > 0 && <em>· 排队 {queued}</em>}
            {done > 0 && <em className="is-done">· ✓ {done}</em>}
            {failed > 0 && <em className="is-fail">· ✕ {failed}</em>}
          </span>
          <span className="ks-q-caret">{open ? '▾' : '▸'}</span>
        </button>
        <div className="ks-q-ctrls">
          {active > 0 ? (
            paused ? (
              <button type="button" className="ks-q-btn" onClick={() => resume()}>▶ 继续</button>
            ) : (
              <button type="button" className="ks-q-btn" onClick={() => pause()}>⏸ 暂停</button>
            )
          ) : null}
          {active > 0 ? (
            <button type="button" className="ks-q-btn is-danger" onClick={() => cancelAll()}>
              取消全部
            </button>
          ) : null}
          {done + failed > 0 ? (
            <button type="button" className="ks-q-btn" onClick={() => clearFinished()}>
              清理已完成
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="ks-q-list">
          {list.map((job) => {
            const pct = job.status === 'running' ? estimateProgress(job, now) : null
            return (
              <div key={job.id} className={`ks-q-item is-${job.status}`}>
                <div className={`ks-q-row is-${job.status}`}>
                  <span className="ks-q-kind">{KIND_ICON[job.kind]}</span>
                  <span className="ks-q-label" title={job.label}>
                    {job.label}
                  </span>
                  {job.status === 'running' ? (
                    <span className="ks-q-pct" title={job.stage ?? 'in_progress'}>
                      {pct ?? 0}%
                    </span>
                  ) : (
                    <span className={`ks-q-badge is-${job.status}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  )}
                  {job.request || job.error ? (
                    <button
                      type="button"
                      className="ks-q-x is-info"
                      onClick={() => setInspectId(job.id)}
                      title="查看发给模型的请求：提示词 / 上传的参考图 / 参数"
                    >
                      🔍
                    </button>
                  ) : null}
                  {job.status === 'queued' || job.status === 'running' ? (
                    <button type="button" className="ks-q-x" onClick={() => cancel(job.id)} title="取消">
                      ✕
                    </button>
                  ) : job.status === 'failed' || job.status === 'cancelled' ? (
                    <button type="button" className="ks-q-x is-retry" onClick={() => retry(job.id)} title="重试">
                      ↻
                    </button>
                  ) : (
                    <span className="ks-q-x is-ok">✓</span>
                  )}
                </div>
                {job.status === 'running' ? (
                  <div className="ks-q-track" title={job.stage ?? 'in_progress'}>
                    <div className="ks-q-fill" style={{ width: `${pct ?? 0}%` }} />
                  </div>
                ) : null}
                {job.status === 'failed' && job.error ? (
                  <div className="ks-q-errwrap">
                    <p id={`ks-q-err-${job.id}`} className="ks-q-err">
                      {job.error}
                    </p>
                    <button
                      type="button"
                      className="ks-q-copy"
                      onClick={() => void copyError(job.id, job.error ?? '')}
                      title="复制完整错误"
                    >
                      {copiedId === job.id ? '已复制' : '复制'}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {inspectId && jobs[inspectId] ? (
        <GenRequestDialog job={jobs[inspectId]!} onClose={() => setInspectId(null)} />
      ) : null}
    </div>
  )
}

const css = `
.ks-q {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-elev);
}
.ks-q-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px;
}
.ks-q-toggle {
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11.5px; font-weight: 600; color: var(--ks-text-soft);
}
.ks-q-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ks-text-faint);
}
.ks-q-dot.is-live { background: var(--ks-amber, #d4ff48); animation: ksqpulse 1.2s ease-in-out infinite; }
@keyframes ksqpulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.ks-q-counts { display: inline-flex; gap: 4px; font-style: normal; }
.ks-q-counts em { font-style: normal; font-size: 11px; color: var(--ks-text-faint); }
.ks-q-counts em.is-run { color: var(--ks-amber, #d4ff48); }
.ks-q-counts em.is-done { color: #4dd2c2; }
.ks-q-counts em.is-fail { color: var(--ks-rose, #ff6b6b); }
.ks-q-caret { color: var(--ks-text-faint); font-size: 10px; }
.ks-q-ctrls { margin-left: auto; display: flex; gap: 6px; }
.ks-q-btn {
  all: unset; cursor: pointer;
  font-family: var(--ks-font-ui); font-size: 10.5px;
  padding: 3px 10px; border-radius: 999px;
  border: 1px solid var(--ks-border-soft); color: var(--ks-text-soft);
}
.ks-q-btn:hover { border-color: var(--ks-amber); color: var(--ks-amber); }
.ks-q-btn.is-danger:hover { border-color: var(--ks-rose, #ff6b6b); color: var(--ks-rose, #ff6b6b); }

.ks-q-list {
  max-height: 320px; overflow-y: auto;
  padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 3px;
  scrollbar-width: thin;
}
.ks-q-item {
  display: flex; flex-direction: column;
  border-radius: 6px;
  background: var(--ks-panel-solid);
  border: 1px solid transparent;
}
.ks-q-item.is-running { border-color: var(--ks-amber-soft, rgba(212,255,72,0.25)); }
.ks-q-item.is-failed { border-color: rgba(255,107,107,0.3); }
.ks-q-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px;
  border: 1px solid transparent;
}
.ks-q-kind { flex: 0 0 auto; font-size: 12px; }
.ks-q-label {
  flex: 1 1 auto; min-width: 0;
  font-size: 11.5px; color: var(--ks-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-q-pct {
  flex: 0 0 auto; min-width: 34px; text-align: right;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px; font-weight: 600;
  color: var(--ks-amber, #d4ff48);
  font-variant-numeric: tabular-nums;
}
.ks-q-badge {
  flex: 0 0 auto;
  font-size: 10.5px; color: var(--ks-text-faint);
}
.ks-q-badge.is-failed { color: var(--ks-rose, #ff6b6b); }
.ks-q-badge.is-done { color: #4dd2c2; }
.ks-q-track {
  height: 4px; margin: 0 8px 6px 28px;
  border-radius: 999px; overflow: hidden;
  background: rgba(255,255,255,0.08);
}
.ks-q-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--ks-amber, #d4ff48) 55%, transparent),
    var(--ks-amber, #d4ff48));
  transition: width .6s ease;
  animation: ksqshimmer 1.6s ease-in-out infinite;
}
@keyframes ksqshimmer { 0%,100% { opacity: .75; } 50% { opacity: 1; } }
.ks-q-x {
  all: unset; cursor: pointer; flex: 0 0 auto;
  width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center;
  font-size: 11px; color: var(--ks-text-faint); border-radius: 4px;
}
.ks-q-x:hover { color: var(--ks-rose, #ff6b6b); background: rgba(255,107,107,0.1); }
.ks-q-x.is-retry:hover { color: var(--ks-amber, #d4ff48); background: rgba(212,255,72,0.1); }
.ks-q-x.is-info:hover { color: var(--ks-amber, #d4ff48); background: rgba(212,255,72,0.1); }
.ks-q-x.is-ok { cursor: default; color: #4dd2c2; }

/* 失败错误：完整换行 + 可选中复制（修复"看不全、选不中"） */
.ks-q-errwrap {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 0 8px 6px 28px;
}
.ks-q-err {
  flex: 1 1 auto; min-width: 0; margin: 0;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px; line-height: 1.5;
  color: var(--ks-rose, #ff6b6b);
  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text; cursor: text;
}
.ks-q-copy {
  all: unset; cursor: pointer; flex: 0 0 auto;
  font-family: var(--ks-font-ui); font-size: 10px;
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--ks-border-soft); color: var(--ks-text-soft);
  white-space: nowrap;
}
.ks-q-copy:hover { border-color: var(--ks-amber, #d4ff48); color: var(--ks-amber, #d4ff48); }
`
injectStyleOnce('generation-queue', css)
