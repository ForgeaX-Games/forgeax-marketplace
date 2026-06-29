import { useCinemaHold } from './cinemaGate'
import { injectStyleOnce } from '../styles/injectStyle'

interface Props {
  /** 玩家累计 QTE 总分（用作"战绩"展示） */
  score: number
  /** 失败的触发点标签（用作上下文提示） */
  failedLabel: string
  onReplay: () => void
  onBackEditor: () => void
}

/**
 * SettlementOverlay —— 触发点失败结算屏
 *
 * 当玩家在子弹时间触发点未能命中、且作者既没指定 `slowMo.failSceneId`、
 * 也没在 scene.branches 里挂 `qte_fail` 分支时，引擎兜底弹这个屏。
 *
 * 视觉语言（与 EndingScreen 区分）：
 *   - 主色冷红 + 黑闪 → 暗示"事故 / 失败"
 *   - 大字标题 MISSED、副标题指出失败的触发点
 *   - 两个按钮：再来一次 / 返回编辑器
 */
export function SettlementOverlay({ score, failedLabel, onReplay, onBackEditor }: Props) {
  // 结算屏挂着时玩家需要做决定（再来一次 / 返回），阻止电影模式
  useCinemaHold(true)
  return (
    <div className="ks-settle">
      <div className="ks-settle-panel">
        <div className="ks-settle-stamp ks-mono">SIGNAL · LOST</div>
        <div className="ks-settle-title ks-cn">MISSED.</div>
        <div className="ks-settle-sub ks-cn">
          错过触发点 <span className="ks-settle-cue ks-mono">{failedLabel}</span>
        </div>
        <div className="ks-settle-meta ks-mono">
          <span>分数</span>
          <span className="ks-settle-score">{score}</span>
        </div>
        <div className="ks-settle-actions">
          <button type="button" onClick={onReplay} className="ks-settle-btn-primary">
            ↻ 再来一次
          </button>
          <button type="button" onClick={onBackEditor}>
            返回编辑器
          </button>
        </div>
      </div>
    </div>
  )
}

const settleCss = `
.ks-settle {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(251, 113, 133, 0.18), transparent 60%),
    rgba(2, 4, 10, 0.86);
  backdrop-filter: blur(22px);
  z-index: 70;
  animation: ks-settle-fade-in 380ms ease-out;
}
@keyframes ks-settle-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ks-settle-panel {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  padding: 56px 80px;
  border: 1px solid rgba(251, 113, 133, 0.45);
  border-radius: 4px;
  background: rgba(8, 6, 12, 0.7);
  box-shadow:
    0 0 0 1px rgba(251, 113, 133, 0.18),
    inset 0 0 80px rgba(251, 113, 133, 0.08),
    0 30px 80px rgba(0, 0, 0, 0.7);
  animation: ks-settle-pop 480ms cubic-bezier(0.2, 1.2, 0.4, 1);
}
@keyframes ks-settle-pop {
  from { transform: translateY(14px) scale(0.98); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
.ks-settle-stamp {
  font-size: 10px;
  letter-spacing: 0.42em;
  color: var(--ks-rose);
  text-shadow: 0 0 12px rgba(251, 113, 133, 0.55);
}
.ks-settle-title {
  font-size: 76px;
  font-weight: 600;
  letter-spacing: 0.32em;
  color: var(--ks-rose);
  text-shadow: 0 0 28px rgba(251, 113, 133, 0.35);
}
.ks-settle-sub {
  font-size: 14px;
  color: var(--ks-text-soft);
  letter-spacing: 0.04em;
}
.ks-settle-cue {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid rgba(251, 113, 133, 0.4);
  color: var(--ks-rose);
  border-radius: 2px;
  font-size: 12px;
  letter-spacing: 0.18em;
}
.ks-settle-meta {
  display: flex; align-items: baseline; gap: 14px;
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.32em;
  color: var(--ks-text-dim);
}
.ks-settle-score {
  font-size: 28px;
  letter-spacing: 0.12em;
  color: var(--ks-amber-glow);
  text-shadow: 0 0 16px rgba(232, 162, 58, 0.4);
}
.ks-settle-actions {
  display: flex; gap: 12px; margin-top: 12px;
}
.ks-settle-actions button {
  font-family: var(--ks-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.24em;
  padding: 10px 22px;
}
.ks-settle-actions .ks-settle-btn-primary {
  border-color: var(--ks-rose);
  color: var(--ks-rose);
}
.ks-settle-actions .ks-settle-btn-primary:hover {
  background: rgba(251, 113, 133, 0.08);
  box-shadow: 0 0 24px rgba(251, 113, 133, 0.18);
}
`
injectStyleOnce('settlement-overlay', settleCss)
