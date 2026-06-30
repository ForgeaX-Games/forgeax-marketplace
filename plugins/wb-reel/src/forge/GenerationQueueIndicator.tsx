/**
 * GenerationQueueIndicator —— 剧情树顶部「剧集栏」右侧常驻的生成进度入口。
 *
 * 与 GenerationQueuePanel（素材库内的全宽内联条）的区别：
 *   · 这是一个**始终可见**的小药丸（即使队列为空也显示），让作者随时知道
 *     「生成进度在哪看」；点开是 fixed 定位的下拉，不受剧集栏 overflow 裁剪。
 *   · 统一展示 图片 / 视频 / 音频 三类任务（不管分镜关键帧还是出片，都在这）。
 *   · 下拉内：逐条进度（标签 + 阶段/报错 + 状态）+ 全局暂停/继续/取消/清理。
 *     已完成/失败的任务在「清理」前一直留着，充当「最近历史」。
 *
 * 只读队列状态 + 调度控制；不接触任何凭据（与 generationQueueStore 一致）。
 */
import { useEffect, useRef, useState } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'
import { useGenerationQueue, type GenJob, type GenJobStatus } from './generationQueueStore'
import { estimateProgress, useNowTick } from './queueProgress'
import { useShellStore } from '../shell/shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'
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

export function GenerationQueueIndicator() {
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
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** 当前打开「请求详情」弹窗的 job id（提示词 / 上传的参考图 / 参数 / 报错就地可看）。 */
  const [inspectId, setInspectId] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  /**
   * 跳到素材库里该任务对应的节点卡片（而不是弹一个遮盖卡片的请求详情模态）。
   *   - selectScene → 素材库(AssetsTab)跟随 selectedSceneId 渲染该节点 AssetBoard；
   *   - setForgeView('assets') → 中间内容区切到素材库（两者都经 crossPaneSync 镜像到 center）；
   *   - setSelectedShotId → 同 pane 内定位到该镜卡片（跨 pane 不同步，属临时游标）。
   * 侧边栏是独立 iframe，这里改的是路由态，真正展示发生在 center 内容区。
   */
  function jumpToAsset(job: GenJob): void {
    const shell = useShellStore.getState()
    if (job.sceneId) {
      useScenarioStore.getState().selectScene(job.sceneId)
      shell.setStageScene(job.sceneId)
      if (job.shotId) shell.setSelectedShotId(job.shotId)
      // 统一走 openAssetFocus：切到素材库 + 写聚焦意图(tick++)，让 AssetBoard 把该镜
      // 「完整信息卡」展开并滚动到中区（与时间轴右键「在素材库查看」同一条路径）。
      shell.openAssetFocus({
        sceneId: job.sceneId,
        trayKind: job.shotId ? 'shot' : 'video',
        shotId: job.shotId ?? null,
      })
    } else {
      shell.setForgeView('assets')
    }
    setOpen(false)
  }

  async function copyError(id: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const sel = window.getSelection()
      const node = document.getElementById(`ks-qi-err-${id}`)
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

  // 下拉用 fixed 定位（剧集栏 overflow-x:auto 会裁剪 absolute 子元素），开合时按
  // 按钮的视口坐标重新计算锚点；监听滚动/缩放时关闭以免错位。
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
    place()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onClose = () => setOpen(false)
    // 滚动关闭：但忽略「在浮层内部滚动」——否则用户滚动错误列表看长报错时浮层会被关掉。
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const list = order.map((id) => jobs[id]).filter((j): j is GenJob => !!j)
  const running = list.filter((j) => j.status === 'running').length
  const queued = list.filter((j) => j.status === 'queued').length
  const done = list.filter((j) => j.status === 'done').length
  const failed = list.filter((j) => j.status === 'failed').length
  const active = running + queued
  // 仅在展开 + 有任务在跑时计时，驱动进度条平滑前进。
  const now = useNowTick(open && running > 0)

  return (
    <div className="ks-qi">
      <button
        ref={btnRef}
        type="button"
        className={`ks-qi-pill${active > 0 ? ' is-live' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="生成进度队列（图片 / 视频 / 音频）"
      >
        <span className={`ks-qi-dot${active > 0 ? ' is-live' : ''}`} />
        <span className="ks-qi-txt">生成</span>
        {active > 0 ? (
          <span className="ks-qi-counts">
            {running > 0 && <em className="is-run">⟳{running}</em>}
            {queued > 0 && <em>·{queued}</em>}
          </span>
        ) : failed > 0 ? (
          <span className="ks-qi-counts">
            <em className="is-fail">✕{failed}</em>
          </span>
        ) : done > 0 ? (
          <span className="ks-qi-counts">
            <em className="is-done">✓{done}</em>
          </span>
        ) : null}
        <span className="ks-qi-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && anchor && (
        <div
          ref={popRef}
          className="ks-qi-pop"
          style={{ top: anchor.top, right: anchor.right }}
        >
          <div className="ks-qi-head">
            <span className="ks-qi-head-title">
              生成队列
              {list.length > 0 && (
                <em className="ks-qi-head-sum">
                  {running > 0 && ` ⟳${running}`}
                  {queued > 0 && ` 排队${queued}`}
                  {done > 0 && ` ✓${done}`}
                  {failed > 0 && ` ✕${failed}`}
                </em>
              )}
            </span>
            <div className="ks-qi-ctrls">
              {active > 0 &&
                (paused ? (
                  <button type="button" className="ks-qi-btn" onClick={() => resume()}>
                    ▶ 继续
                  </button>
                ) : (
                  <button type="button" className="ks-qi-btn" onClick={() => pause()}>
                    ⏸ 暂停
                  </button>
                ))}
              {active > 0 && (
                <button type="button" className="ks-qi-btn is-danger" onClick={() => cancelAll()}>
                  取消全部
                </button>
              )}
              {done + failed > 0 && (
                <button type="button" className="ks-qi-btn" onClick={() => clearFinished()}>
                  清理
                </button>
              )}
            </div>
          </div>

          {list.length === 0 ? (
            <div className="ks-qi-empty">
              暂无生成任务
              <span>分镜 / 关键帧 / 视频 / 音频生成时，进度会实时显示在这里。</span>
            </div>
          ) : (
            <div className="ks-qi-list">
              {list
                .slice()
                .reverse()
                .map((job) => {
                  const pct =
                    job.status === 'running' ? estimateProgress(job, now) : null
                  return (
                    <div key={job.id} className={`ks-qi-item is-${job.status}`}>
                      <div className={`ks-qi-row is-${job.status}`}>
                        <span className="ks-qi-kind">{KIND_ICON[job.kind]}</span>
                        <span className="ks-qi-label" title={job.label}>
                          {job.label}
                        </span>
                        {job.status === 'running' ? (
                          <span className="ks-qi-pct" title={job.stage ?? 'in_progress'}>
                            {pct ?? 0}%
                          </span>
                        ) : (
                          <span className={`ks-qi-badge is-${job.status}`}>
                            {STATUS_LABEL[job.status]}
                          </span>
                        )}
                        {/* 已完成且有节点：「查看」直接跳到素材库该卡片（在卡上看完整
                            信息 + 用 ⓘ 看参考锚点），不再停在队列二级弹窗。失败/排队/无
                            产物时仍弹请求详情，方便就地排查报错。 */}
                        {job.status === 'done' && job.sceneId ? (
                          <button
                            type="button"
                            className="ks-qi-x is-info"
                            onClick={() => jumpToAsset(job)}
                            title="在素材库打开这张卡片（看完整信息 / 用 ⓘ 看用到的角色·场景·道具锚点）"
                          >
                            🔍
                          </button>
                        ) : job.request || job.error ? (
                          <button
                            type="button"
                            className="ks-qi-x is-info"
                            onClick={() => {
                              setInspectId(job.id)
                              setOpen(false)
                            }}
                            title="查看发给模型的请求：提示词 / 上传的参考图 / 参数 / 报错"
                          >
                            🔍
                          </button>
                        ) : null}
                        {job.sceneId ? (
                          <button
                            type="button"
                            className="ks-qi-x is-info"
                            onClick={() => jumpToAsset(job)}
                            title="去素材库定位这张卡片（在节点画板里继续编辑/重生）"
                          >
                            ↗
                          </button>
                        ) : null}
                        {job.status === 'queued' || job.status === 'running' ? (
                          <button
                            type="button"
                            className="ks-qi-x"
                            onClick={() => cancel(job.id)}
                            title="取消"
                          >
                            ✕
                          </button>
                        ) : job.status === 'failed' || job.status === 'cancelled' ? (
                          <button
                            type="button"
                            className="ks-qi-x is-retry"
                            onClick={() => retry(job.id)}
                            title="重试"
                          >
                            ↻
                          </button>
                        ) : (
                          <span className="ks-qi-x is-ok">✓</span>
                        )}
                      </div>
                      {job.status === 'running' ? (
                        <div className="ks-qi-track" title={job.stage ?? 'in_progress'}>
                          <div className="ks-qi-fill" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                      ) : null}
                      {job.status === 'failed' && job.error ? (
                        <div className="ks-qi-errwrap">
                          <p id={`ks-qi-err-${job.id}`} className="ks-qi-err">
                            {job.error}
                          </p>
                          <button
                            type="button"
                            className="ks-qi-copy"
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
          )}
        </div>
      )}

      {inspectId && jobs[inspectId] ? (
        <GenRequestDialog job={jobs[inspectId]!} onClose={() => setInspectId(null)} />
      ) : null}
    </div>
  )
}

const css = `
.ks-qi { flex-shrink: 0; margin-left: auto; position: relative; }

.ks-qi-pill {
  all: unset;
  box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px;
  font-size: 10.5px; font-weight: 600;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--color-border-default, #404040);
  cursor: pointer; white-space: nowrap;
  transition: color .12s ease, border-color .12s ease, background .12s ease;
}
.ks-qi-pill:hover,
.ks-qi-pill.is-open {
  color: var(--color-text-primary, #fff);
  border-color: var(--color-border-strong, #737373);
  background: var(--color-interaction-hover, rgba(255,255,255,0.06));
}
.ks-qi-pill.is-live {
  color: var(--color-brand-primary, #d4ff48);
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 45%, transparent);
}

.ks-qi-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-tertiary, rgba(255,255,255,0.3)); }
.ks-qi-dot.is-live { background: var(--color-brand-primary, #d4ff48); animation: ksqipulse 1.2s ease-in-out infinite; }
@keyframes ksqipulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

.ks-qi-txt { font-family: var(--ks-font-cn, inherit); }
.ks-qi-counts { display: inline-flex; gap: 3px; }
.ks-qi-counts em { font-style: normal; font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,0.4)); }
.ks-qi-counts em.is-run { color: var(--color-brand-primary, #d4ff48); }
.ks-qi-counts em.is-done { color: #4dd2c2; }
.ks-qi-counts em.is-fail { color: #ff6b6b; }
.ks-qi-caret { font-size: 8px; color: var(--color-text-tertiary, rgba(255,255,255,0.35)); }

.ks-qi-pop {
  position: fixed;
  width: 320px; max-width: calc(100vw - 16px);
  z-index: 9999;
  background: var(--color-background-elevated, #1f1f1f);
  border: 1px solid var(--color-border-strong, #555);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5);
  overflow: hidden;
}
.ks-qi-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 11px;
  border-bottom: 1px solid var(--color-border-default, #404040);
}
.ks-qi-head-title {
  font-family: var(--ks-font-cn, inherit);
  font-size: 11.5px; font-weight: 700; color: var(--color-text-primary, #fff);
}
.ks-qi-head-sum { font-style: normal; font-weight: 500; font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,0.4)); margin-left: 6px; }
.ks-qi-ctrls { margin-left: auto; display: flex; gap: 5px; }
.ks-qi-btn {
  all: unset; cursor: pointer;
  font-size: 10px; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--color-border-default, #404040);
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
}
.ks-qi-btn:hover { border-color: var(--color-brand-primary, #d4ff48); color: var(--color-brand-primary, #d4ff48); }
.ks-qi-btn.is-danger:hover { border-color: #ff6b6b; color: #ff6b6b; }

.ks-qi-empty {
  display: flex; flex-direction: column; gap: 5px;
  padding: 18px 14px; text-align: center;
  font-family: var(--ks-font-cn, inherit);
  font-size: 11.5px; color: var(--color-text-secondary, rgba(255,255,255,0.55));
}
.ks-qi-empty span { font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,0.35)); line-height: 1.5; }

.ks-qi-list {
  max-height: 360px; overflow-y: auto;
  padding: 6px; display: flex; flex-direction: column; gap: 3px;
  scrollbar-width: thin;
}
.ks-qi-item {
  display: flex; flex-direction: column;
  border-radius: 6px;
  background: var(--color-background-base, #161616);
  border: 1px solid transparent;
}
.ks-qi-item.is-running { border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 28%, transparent); }
.ks-qi-item.is-failed { border-color: rgba(255,107,107,0.3); }
.ks-qi-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  border: 1px solid transparent;
}
.ks-qi-kind { flex: 0 0 auto; font-size: 12px; }
.ks-qi-label {
  flex: 1 1 auto; min-width: 0;
  font-size: 11px; color: var(--color-text-primary, #fff);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 运行中：固定宽度的百分比（永远可见，不被长标题挤掉） */
.ks-qi-pct {
  flex: 0 0 auto; min-width: 34px; text-align: right;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10.5px; font-weight: 600;
  color: var(--color-brand-primary, #d4ff48);
  font-variant-numeric: tabular-nums;
}
/* 非运行态：短状态徽标 */
.ks-qi-badge {
  flex: 0 0 auto;
  font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,0.4));
}
.ks-qi-badge.is-failed { color: #ff6b6b; }
.ks-qi-badge.is-done { color: #4dd2c2; }
.ks-qi-badge.is-queued { color: var(--color-text-tertiary, rgba(255,255,255,0.4)); }
/* 进度条 */
.ks-qi-track {
  height: 4px; margin: 0 8px 6px 28px;
  border-radius: 999px; overflow: hidden;
  background: rgba(255,255,255,0.08);
}
.ks-qi-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--color-brand-primary, #d4ff48) 55%, transparent),
    var(--color-brand-primary, #d4ff48));
  transition: width .6s ease;
  animation: ksqishimmer 1.6s ease-in-out infinite;
}
@keyframes ksqishimmer { 0%,100% { opacity: .75; } 50% { opacity: 1; } }
.ks-qi-x {
  all: unset; cursor: pointer; flex: 0 0 auto;
  width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center;
  font-size: 11px; color: var(--color-text-tertiary, rgba(255,255,255,0.4)); border-radius: 4px;
}
.ks-qi-x:hover { color: #ff6b6b; background: rgba(255,107,107,0.1); }
.ks-qi-x.is-retry:hover { color: var(--color-brand-primary, #d4ff48); background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 12%, transparent); }
.ks-qi-x.is-info:hover { color: var(--color-brand-primary, #d4ff48); background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 12%, transparent); }
.ks-qi-x.is-ok { cursor: default; color: #4dd2c2; }

/* 失败错误：完整换行 + 可选中复制（修复"看不全、选不中"） */
.ks-qi-errwrap {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 0 8px 7px 28px;
}
.ks-qi-err {
  flex: 1 1 auto; min-width: 0; margin: 0;
  font-family: var(--ks-font-mono, monospace);
  font-size: 10px; line-height: 1.5;
  color: #ff6b6b;
  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text; cursor: text;
}
.ks-qi-copy {
  all: unset; cursor: pointer; flex: 0 0 auto;
  font-size: 9.5px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--color-border-default, #404040);
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  white-space: nowrap;
}
.ks-qi-copy:hover { border-color: var(--color-brand-primary, #d4ff48); color: var(--color-brand-primary, #d4ff48); }
`
injectStyleOnce('generation-queue-indicator', css)
