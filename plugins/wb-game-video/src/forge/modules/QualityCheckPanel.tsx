import { useMemo } from 'react'
import { lintScenario, type LintIssue } from '../../scenario/lintScenario'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useShellStore } from '../../shell/shellStore'
import { injectStyleOnce } from '../../styles/injectStyle'

const SEV_LABEL: Record<LintIssue['severity'], string> = {
  error: '错误',
  warn: '警告',
  info: '提示',
}

export function QualityCheckPanel() {
  const scenario = useScenarioStore((s) => s.scenario)
  const selectScene = useScenarioStore((s) => s.selectScene)
  const setForgeView = useShellStore((s) => s.setForgeView)
  const setActiveTab = useShellStore((s) => s.setActiveTab)
  const focusSceneInStage = useShellStore((s) => s.focusSceneInStage)

  const report = useMemo(() => lintScenario(scenario), [scenario])

  function jumpTo(issue: LintIssue): void {
    if (!issue.sceneId) return
    setActiveTab('forge')
    setForgeView('tree')
    selectScene(issue.sceneId)
    focusSceneInStage(issue.sceneId)
  }

  return (
    <div className="ks-qc">
      <header className="ks-qc-head">
        <div>
          <div className="ks-qc-title ks-mono">QUALITY · 质检</div>
          <div className="ks-qc-sub ks-cn">
            机械校验 Scenario 结构 — 分支可达、玩法引用、QTE 窗口、媒体绑定。不阻断保存。
          </div>
        </div>
        <div className="ks-qc-stats" aria-label="质检统计">
          <span className={`ks-qc-stat ks-qc-stat--err${report.errorCount ? ' has' : ''}`}>
            {report.errorCount} 错误
          </span>
          <span className={`ks-qc-stat ks-qc-stat--warn${report.warnCount ? ' has' : ''}`}>
            {report.warnCount} 警告
          </span>
        </div>
      </header>

      {report.ok && report.warnCount === 0 ? (
        <div className="ks-qc-ok">
          <span className="ks-qc-ok-icon" aria-hidden>✓</span>
          <div>
            <div className="ks-qc-ok-title">未发现结构问题</div>
            <div className="ks-qc-ok-hint">可切到「试玩」视图验证玩法手感与成片效果。</div>
          </div>
        </div>
      ) : (
        <ul className="ks-qc-list">
          {report.issues.map((issue, idx) => (
            <li key={`${issue.code}-${issue.sceneId ?? 'global'}-${idx}`}>
              <button
                type="button"
                className={`ks-qc-item ks-qc-item--${issue.severity}`}
                onClick={() => jumpTo(issue)}
                disabled={!issue.sceneId}
                title={issue.sceneId ? '点击定位到剧情树节点' : undefined}
              >
                <span className={`ks-qc-badge ks-qc-badge--${issue.severity}`}>
                  {SEV_LABEL[issue.severity]}
                </span>
                <span className="ks-qc-msg ks-cn">{issue.message}</span>
                {issue.sceneId ? (
                  <span className="ks-qc-scene ks-mono">{issue.sceneId}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const QC_CSS = `
.ks-qc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.ks-qc-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--color-border-default);
}
.ks-qc-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.ks-qc-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
  max-width: 520px;
}
.ks-qc-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--ks-font-ui, inherit);
}
.ks-qc-stat { color: var(--color-text-faint); }
.ks-qc-stat--err.has { color: #e85d6a; }
.ks-qc-stat--warn.has { color: #d4a017; }
.ks-qc-ok {
  margin: 24px 18px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px;
  border-radius: var(--radius-md, 10px);
  border: 1px solid color-mix(in srgb, #3dba6c 35%, transparent);
  background: color-mix(in srgb, #3dba6c 8%, var(--color-background-elevated));
}
.ks-qc-ok-icon {
  font-size: 22px;
  color: #3dba6c;
  line-height: 1;
}
.ks-qc-ok-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.ks-qc-ok-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.ks-qc-list {
  list-style: none;
  margin: 0;
  padding: 8px 10px 16px;
  overflow: auto;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ks-qc-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm, 8px);
  border: 1px solid var(--color-border-default);
  background: var(--color-background-elevated);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: border-color .12s, background .12s;
}
.ks-qc-item:disabled { cursor: default; opacity: 0.85; }
.ks-qc-item:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 6%, var(--color-background-elevated));
}
.ks-qc-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 999px;
}
.ks-qc-badge--error {
  color: #e85d6a;
  background: color-mix(in srgb, #e85d6a 14%, transparent);
}
.ks-qc-badge--warn {
  color: #d4a017;
  background: color-mix(in srgb, #d4a017 14%, transparent);
}
.ks-qc-badge--info {
  color: var(--color-text-secondary);
  background: var(--color-interaction-hover);
}
.ks-qc-msg {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-text-primary);
}
.ks-qc-scene {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-text-faint);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
`
injectStyleOnce('ks-quality-check', QC_CSS)
