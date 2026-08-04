import { ChevronLeft } from "lucide-react";
import { ProjectLibraries } from "./ProjectLibraries";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useWorkbench } from "../workbench/WorkbenchProvider";
import { formatHistoryTime, STEP_LABEL_MAP } from "../../lib/routingCatalog";
import { localizeTagSummary } from "../../i18n/tagSummary";
import { useT, tStepLabel } from "../../i18n";

/**
 * 左栏：项目管理（PRD v1.4 §5.1 / 设计稿 01、08）。
 *
 * 两态——项目卡列表，双击进入后是该项目的资源管理 + 资产管理。
 * 输入与路由都搬到中栏了，这里只剩"哪些项目、项目里有什么"。
 */
export function ProjectPanel() {
  const t = useT();
  const wb = useWorkbench();
  const openedProjectKey = useNarrativeStore((s) => s.openedProjectKey);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const listExpandedKeys = useNarrativeStore((s) => s.listExpandedKeys);
  const entryPipelines = useNarrativeStore((s) => s.entryPipelines);
  const activePipelineId = useNarrativeStore((s) => s.activePipelineId);
  const toggleListExpanded = useNarrativeStore((s) => s.toggleListExpanded);
  const setActivePipelineId = useNarrativeStore((s) => s.setActivePipelineId);
  const deselectEntry = useNarrativeStore((s) => s.deselectEntry);
  const resetFormDraft = useNarrativeStore((s) => s.resetFormDraft);
  const openProject = useNarrativeStore((s) => s.openProject);
  const closeProject = useNarrativeStore((s) => s.closeProject);

  if (!wb) return null;
  const { displayHistory, historyLoading, loadingKey, selectEntry } = wb;

  if (openedProjectKey) {
    return (
      <div className="project-panel">
        <header className="project-panel__head">
          <button type="button" className="pi-back" onClick={closeProject}>
            <ChevronLeft size={13} aria-hidden />
            <span>{t("tms.project.back")}</span>
          </button>
          <span className="pi-key" title={openedProjectKey}>{openedProjectKey}</span>
        </header>
        <div className="project-panel__body">
          <ProjectLibraries entryKey={openedProjectKey} />
        </div>
      </div>
    );
  }

  return (
    <div className="project-panel">
      <header className="project-panel__head project-panel__head--count">
        <span className="project-panel__count">
          {historyLoading ? t("tms.project.loading") : t("tms.project.records", { n: displayHistory.length })}
        </span>
      </header>

      <div className="project-panel__body">
        {historyLoading ? (
          <div className="history-loading">{t("tms.history.loading")}</div>
        ) : displayHistory.length === 0 ? (
          <div className="history-empty">{t("tms.project.empty")}</div>
        ) : (
          <div className="history-list">
            {displayHistory.map((entry) => {
              const isActive = activeEntryKey === entry.key;
              const isCurrentlyRunning = entry.key === runningEntryKey || entry.status === "running";
              const busy = loadingKey === entry.key;
              const pipeCount = Math.max(entry.pipelineCount ?? 0, isActive ? entryPipelines.length : 0);
              const multi = pipeCount > 1;
              const listExpanded = listExpandedKeys.includes(entry.key);
              const entryPipes = isActive ? entryPipelines : [];

              return (
                <div key={entry.key} className="history-item-wrap">
                  <div
                    className={`history-item status-${entry.status ?? "unknown"} ${isActive ? "selected" : ""} ${isCurrentlyRunning ? "current-run" : ""}`}
                    style={{ cursor: busy ? "wait" : "pointer" }}
                    title={t("tms.project.openHint")}
                    onClick={() => {
                      if (busy) return;
                      if (isActive) {
                        deselectEntry();
                        resetFormDraft();
                        return;
                      }
                      void selectEntry(entry);
                    }}
                    onDoubleClick={() => {
                      // busy 常由前一次单击的 selectEntry 触发，此处不能因此吞掉双击
                      if (!isActive && !busy) void selectEntry(entry);
                      openProject(entry.key);
                    }}
                  >
                    <div className="hi-header">
                      <span className="hi-time">
                        {isCurrentlyRunning && !entry.startedAt ? t("tms.history.current") : formatHistoryTime(entry)}
                      </span>
                      <span className={`hi-badge hi-badge--${entry.status ?? "unknown"}`}>
                        {entry.status === "completed" ? t("tms.history.completed")
                          : entry.status === "running" ? t("tms.history.running")
                          : entry.status === "interrupted" ? t("tms.history.interrupted")
                          : entry.status === "failed" ? t("tms.history.failed")
                          : entry.status === "config" ? t("tms.history.config")
                          : entry.status ?? "?"}
                      </span>
                      {multi && (
                        <button
                          type="button"
                          className="hi-pipe-toggle"
                          title={t("tms.history.pipelinesToggle")}
                          onClick={(ev) => { ev.stopPropagation(); toggleListExpanded(entry.key); }}
                        >
                          {listExpanded ? "▾" : "▸"} {t("tms.history.pipelines", { n: pipeCount })}
                        </button>
                      )}
                    </div>
                    {entry.userInput && (() => {
                      const summary = localizeTagSummary(entry.userInput, t);
                      return (
                        <div className="hi-input-preview" title={summary}>
                          {summary.length > 120 ? `${summary.slice(0, 120)}…` : summary}
                        </div>
                      );
                    })()}
                    <div className="hi-meta">
                      {entry.routeGroup && (
                        <span className="hi-tag">
                          {entry.routeGroup === "planning" ? t("tms.routeGroup.planning") : t("tms.routeGroup.narrative")}
                        </span>
                      )}
                      {entry.mode && <span className="hi-tag">{entry.mode}</span>}
                      {entry.parentKey && (
                        <span className="hi-tag hi-tag--fork" title={entry.forkReason}>
                          {t("tms.history.fork")}
                        </span>
                      )}
                      {entry.fileCount != null && (
                        <span className="hi-files">{t("tms.history.files", { n: entry.fileCount })}</span>
                      )}
                    </div>
                    {entry.hasCheckpoint && entry.lastCompletedStep && (
                      <div className="hi-cp-info">
                        {t("tms.history.checkpoint", {
                          step: tStepLabel(entry.lastCompletedStep, STEP_LABEL_MAP.get(entry.lastCompletedStep) ?? entry.lastCompletedStep),
                        })}
                      </div>
                    )}
                    {busy && <div className="hi-loading-indicator">{t("tms.history.loading")}</div>}
                  </div>

                  {multi && listExpanded && isActive && entryPipes.length > 0 && (
                    <div className="history-pipelines" role="list">
                      {entryPipes.map((p, i) => (
                        <button
                          key={p.pipelineId}
                          type="button"
                          role="listitem"
                          className={`history-pipeline-row ${activePipelineId === p.pipelineId ? "is-active" : ""} ${p.complete ? "" : "is-incomplete"}`}
                          onClick={(ev) => { ev.stopPropagation(); setActivePipelineId(p.pipelineId); }}
                        >
                          <span className="hp-idx">{i + 1}</span>
                          <span className="hp-label">
                            {t("tms.history.pipelineLabel", { n: i + 1 })}
                            {!p.complete ? ` · ${t("tms.history.incomplete")}` : ""}
                          </span>
                          <span className="hp-meta">{p.agents?.length ?? 0} {t("tms.history.steps")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
