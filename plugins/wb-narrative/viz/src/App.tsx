import { useEffect, useRef, useCallback, useMemo } from "react";
import { AlignLeft, Network, Download, ArrowLeftRight, Trash2 } from "lucide-react";
import { useT } from "./i18n";
import { NarrativeCanvas } from "./components/NarrativeCanvas";
import { TextViewPanel } from "./components/panels/TextViewPanel";
import { StepDetailPanel } from "./components/panels/StepDetailPanel";
import { RegeneratePanel } from "./components/panels/RegeneratePanel";
import { TierModeSelector } from "./components/controls/TierModeSelector";
import { PipelineStatusBar } from "./components/panels/PipelineStatusBar";
import { useNarrativeStore, useNarrativePhase } from "./store/narrativeStore";
import type { TierId, ModeId } from "./types";
import { useAutoAttach } from "./hooks/useAutoAttach";
import { notifyReady, sendToHost, onHostMessage } from "./lib/bridge";
import "reactflow/dist/style.css";

export type { ViewMode } from "./store/narrativeStore";

type PaneMode = "left" | "center" | "full";

function getPaneMode(): PaneMode {
  const p = new URLSearchParams(window.location.search).get("pane");
  if (p === "left" || p === "center") return p;
  return "full";
}

export function App() {
  const t = useT();
  const pane = useMemo(getPaneMode, []);
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const setViewMode = useNarrativeStore((s) => s.setViewMode);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const ipPreviewRunId = useNarrativeStore((s) => s.ipPreviewRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const tier = useNarrativeStore((s) => s.tier);
  const mode = useNarrativeStore((s) => s.mode);
  const prevStatus = useRef(activeEntryStatus);
  const prevStepsRef = useRef<string>("");

  const isRunning = !!runningRunId;
  const isIpPreview = !!ipPreviewRunId;
  const isViewingRunning =
    activeEntryKey != null &&
    activeEntryKey === runningEntryKey &&
    (isRunning || isIpPreview || runningProgress.length > 0);
  // §状态机重构：header/状态灯由单一 phase 派生。generating（SSE run 或 IP DNA 下游 job）→ running；
  // done → completed；其余（含 IP 半自动预处理 input/routed）→ activeEntryStatus（预处理期恒为 STANDBY，
  // 不再因 useAutoAttach 误设 runningRunId 而闪成 GENERATING）。
  const phase = useNarrativePhase();
  const displayStatus = phase === "generating" ? "running" : phase === "done" ? "completed" : activeEntryStatus;

  // 自动挂载 agent（Kotone）在后台起的 run：让中间预览直播 + 左栏选择器回填，无需 host 转发。
  useAutoAttach();

  useEffect(() => {
    notifyReady();
    return onHostMessage((event) => {
      if (event.type === "narrative:reload") {
        const state = useNarrativeStore.getState();
        if (state.runningRunId) {
          window.location.reload();
        }
      } else if (event.type === "narrative:attach-run") {
        // Kotone（或其它 agent）通过 narrative:start-pipeline 工具起的 run —— host 把 runId 转发过来，
        // 这里挂载到该 run：设 runningRunId（→ SSE 自动连上直播中间预览）+ 回填左栏选择器。
        const p = event.payload;
        const st = useNarrativeStore.getState();
        if (st.runningRunId === p.runId) return; // 已挂载，幂等
        const tierVal = (p.tier ?? undefined) as TierId | undefined;
        const modeVal = (p.mode ?? undefined) as ModeId | undefined;
        st.startNewRun(p.runId, p.entryKey ?? p.runId, tierVal, modeVal);
        st.setActiveConfig({
          userInput: p.userInput,
          routeGroup: p.routeGroup,
          tier: tierVal ?? null,
          mode: modeVal ?? null,
          genreCode: p.genreCode ?? null,
          hydrateToken: Date.now(),
        });
      }
    });
  }, []);

  useEffect(() => {
    if (prevStatus.current === displayStatus) return;
    prevStatus.current = displayStatus;

    if (displayStatus === "running" && runningRunId) {
      sendToHost({
        type: "narrative:run-started",
        payload: { runId: runningRunId, tier: tier ?? undefined, mode: mode ?? undefined },
      });
    } else if (displayStatus === "completed" && activeEntryKey) {
      sendToHost({
        type: "narrative:run-completed",
        payload: { runId: activeEntryKey },
      });
    }
  }, [displayStatus, runningRunId, activeEntryKey, tier, mode]);

  useEffect(() => {
    const snapshot = activeSteps.map((s) => `${s.id}:${s.status}`).join(",");
    if (snapshot === prevStepsRef.current) return;

    const prevMap = new Map(
      prevStepsRef.current.split(",").filter(Boolean).map((entry) => {
        const [id, st] = entry.split(":");
        return [id, st] as [string, string];
      }),
    );

    for (const s of activeSteps) {
      const prevSt = prevMap.get(s.id);
      if (prevSt !== s.status) {
        sendToHost({
          type: "narrative:step-changed",
          payload: { stepId: s.id, status: s.status },
        });
      }
    }

    prevStepsRef.current = snapshot;
  }, [activeSteps]);

  const statusLabel = displayStatus === "running" ? "GENERATING" : displayStatus === "completed" ? "DONE" : displayStatus === "interrupted" ? "INTERRUPTED" : "STANDBY";

  const handleExport = useCallback(() => {
    const state = useNarrativeStore.getState();
    const blob = new Blob([JSON.stringify(state.activeResult, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `narrative-${state.activeEntryKey?.slice(0, 16) ?? "draft"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const hasEntry = !!activeEntryKey;

  const showSidebar = pane === "left" || pane === "full";
  const showCenter = pane === "center" || pane === "full";

  return (
    <div className="app-root">
      {pane === "full" && (
        <header className="app-header">
          <div className="header-left">
            <span className="header-title">{t("app.title")}</span>
            <span className="header-sub">{t("app.subtitle")}</span>
          </div>
          <div className="header-right">
            <span className={`header-status ${displayStatus === "running" ? "running" : ""}`}>
              {statusLabel}
            </span>
          </div>
        </header>
      )}

      <main className="app-main">
        {showSidebar && (
          <aside className="app-sidebar tool-left-panel" aria-label={t("app.sidebarAria")}>
            <header className="workbench-pane-header">
              <span className="workbench-pane-title">{t("app.title")}</span>
              <span className={`workbench-pane-pill ${displayStatus === "running" ? "running" : ""}`}>
                {statusLabel}
              </span>
            </header>
            <div className="tool-left-panel__body">
              <TierModeSelector />
            </div>
          </aside>
        )}

        {showCenter && (
          <div className="app-right-panel editor-center-workspace">
            <header className="workbench-pane-header cw-preview-header">
              <span className="workbench-pane-title">叙事预览</span>
              <span className={`workbench-pane-pill ${displayStatus === "running" ? "running" : ""}`}>
                {statusLabel}
              </span>
            </header>
            <PipelineStatusBar />
            <div className="cw-toolbar">
              <div className="cw-toolbar-row">
                <div className="fx-segmented" role="tablist" aria-label={t("app.previewModeAria")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "text"}
                    className={`fx-segmented-btn ${viewMode === "text" ? "is-selected" : ""}`}
                    onClick={() => setViewMode("text")}
                  >
                    <AlignLeft size={14} aria-hidden />
                    {t("app.view.text")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "graph"}
                    className={`fx-segmented-btn ${viewMode === "graph" ? "is-selected" : ""}`}
                    onClick={() => setViewMode("graph")}
                  >
                    <Network size={14} aria-hidden />
                    {t("app.view.graph")}
                  </button>
                </div>
              </div>

              {hasEntry && (
                <div className="cw-toolbar-row">
                  <span className="cw-hint">
                    {displayStatus === "completed" ? t("app.status.completed") : displayStatus === "running" ? t("app.status.running") : displayStatus === "interrupted" ? t("app.status.interruptedShort") : ""}
                    {displayStatus ? " · " : ""}
                    {new Date().toLocaleDateString()} · {t("app.stepsCount", { n: activeSteps.filter((s) => s.status === "completed").length })}
                  </span>
                  <div className="cw-action-btns">
                    <button type="button" className="fx-btn" onClick={handleExport}>
                      <Download size={13} aria-hidden />
                      {t("app.export")}
                    </button>
                    <button
                      type="button"
                      className="fx-btn"
                      onClick={() => setViewMode(viewMode === "text" ? "graph" : "text")}
                    >
                      <ArrowLeftRight size={13} aria-hidden />
                      {t("app.switchView")}
                    </button>
                    <button
                      type="button"
                      className="fx-btn fx-btn--danger"
                      onClick={() => {
                        if (confirm(t("app.clearConfirm"))) useNarrativeStore.getState().reset();
                      }}
                    >
                      <Trash2 size={13} aria-hidden />
                      {t("app.clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="editor-center-body app-content">
              <RegeneratePanel />
              {viewMode === "text" ? (
                <TextViewPanel />
              ) : (
                <div className="graph-layout">
                  <div className="graph-canvas-area">
                    <NarrativeCanvas />
                  </div>
                  <StepDetailPanel />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
