import { useEffect } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  MILESTONES,
  bootNarrativeProgress,
  useNarrativeProgressStore,
} from './narrativeProgressStore'

/**
 * NarrativeProgressBanner —— 影游 × 叙事「分阶段协作」的实时进度条。
 *
 * Reia 借用叙事工坊管线分阶段产出（梗概 → 三幕大纲 → 剧情树 → 剧本）。这条横幅让
 * 作者「过程可见」：4 个里程碑的进度点 + 当前正在生成的步骤提示 + 断点等待状态。
 * 里程碑数据落盘后，scenario 由磁盘轮询自动 reload，下方面板随之增量渲染。
 *
 * 没有活动叙事 run 时整条隐藏（不打扰纯本地/快通自编流程）。
 */
export function NarrativeProgressBanner() {
  const active = useNarrativeProgressStore((s) => s.active)
  const status = useNarrativeProgressStore((s) => s.status)
  const reached = useNarrativeProgressStore((s) => s.reachedMilestones)
  const activeMilestone = useNarrativeProgressStore((s) => s.activeMilestone)
  const message = useNarrativeProgressStore((s) => s.currentStepMessage)
  const paused = useNarrativeProgressStore((s) => s.pausedAtMilestone)

  if (!active && status === 'idle') return null

  const statusLabel =
    status === 'running'
      ? '叙事工坊生成中'
      : paused || status === 'paused'
        ? '已到里程碑断点 · 等你确认'
        : status === 'completed'
          ? '叙事产出已就绪'
          : status === 'failed'
            ? '叙事生成出错'
            : '叙事协作'

  return (
    <div className={`ks-narr-prog ks-narr-prog-${status}`}>
      <div className="ks-narr-prog-head">
        <span className="ks-narr-prog-dot" />
        <span className="ks-narr-prog-status">{statusLabel}</span>
        {message && status === 'running' ? (
          <span className="ks-narr-prog-msg ks-faint">{message}</span>
        ) : null}
      </div>
      <div className="ks-narr-prog-track">
        {MILESTONES.map((m, i) => {
          const done = reached.includes(m.id)
          const isActive = m.id === activeMilestone && status === 'running'
          const cls = done
            ? 'is-done'
            : isActive
              ? 'is-active'
              : 'is-pending'
          return (
            <div key={m.id} className="ks-narr-prog-step-wrap">
              {i > 0 ? (
                <span
                  className={`ks-narr-prog-line ${reached.includes(MILESTONES[i - 1]!.id) ? 'is-done' : ''}`}
                />
              ) : null}
              <div className={`ks-narr-prog-step ${cls}`}>
                <span className="ks-narr-prog-step-mark">
                  {done ? '✓' : isActive ? '…' : i + 1}
                </span>
                <span className="ks-narr-prog-step-label">{m.label}</span>
              </div>
            </div>
          )
        })}
      </div>
      {paused || status === 'paused' ? (
        <div className="ks-narr-prog-hint ks-faint">
          ▸ 这一段已生成，左侧各面板已增量更新。要改就在右侧对话里告诉 Reia，或让她继续下一段。
        </div>
      ) : null}
    </div>
  )
}

/** Hook: boot the narrative-progress poller for as long as the host is mounted. */
export function useNarrativeProgressBoot() {
  useEffect(() => {
    const dispose = bootNarrativeProgress()
    return () => dispose()
  }, [])
}

const css = `
.ks-narr-prog {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  margin: 10px 12px 0;
  border: 1px solid var(--ks-border, var(--color-border-default));
  border-radius: var(--ks-radius-lg, 10px);
  background: var(--ks-panel-solid, var(--color-background-elevated));
}
.ks-narr-prog-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px;
}
.ks-narr-prog-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--ks-amber, #ff7b3d);
}
.ks-narr-prog-running .ks-narr-prog-dot { animation: ks-narr-pulse 1.1s ease-in-out infinite; }
.ks-narr-prog-paused .ks-narr-prog-dot { background: #d8a200; }
.ks-narr-prog-completed .ks-narr-prog-dot { background: #3fae6a; }
.ks-narr-prog-failed .ks-narr-prog-dot { background: #d8584f; }
@keyframes ks-narr-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.ks-narr-prog-status { font-weight: 600; }
.ks-narr-prog-msg {
  font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 60%;
}
.ks-narr-prog-track {
  display: flex; align-items: center;
}
.ks-narr-prog-step-wrap { display: flex; align-items: center; flex: 1; }
.ks-narr-prog-step-wrap:first-child { flex: 0 0 auto; }
.ks-narr-prog-line {
  height: 2px; flex: 1; min-width: 14px;
  background: var(--ks-border, #3a3a3a);
}
.ks-narr-prog-line.is-done { background: #3fae6a; }
.ks-narr-prog-step {
  display: flex; align-items: center; gap: 5px;
}
.ks-narr-prog-step-mark {
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
  border: 1px solid var(--ks-border, #3a3a3a);
  color: var(--ks-text-dim, #999);
}
.ks-narr-prog-step.is-done .ks-narr-prog-step-mark {
  background: #3fae6a; border-color: #3fae6a; color: #fff;
}
.ks-narr-prog-step.is-active .ks-narr-prog-step-mark {
  border-color: var(--ks-amber, #ff7b3d); color: var(--ks-amber, #ff7b3d);
}
.ks-narr-prog-step-label {
  font-size: 11px; color: var(--ks-text-dim, #aaa);
}
.ks-narr-prog-step.is-done .ks-narr-prog-step-label,
.ks-narr-prog-step.is-active .ks-narr-prog-step-label {
  color: var(--ks-text, #eee);
}
.ks-narr-prog-hint {
  font-size: 10.5px; letter-spacing: 0.04em;
}
`
injectStyleOnce('narrative-progress-banner', css)
