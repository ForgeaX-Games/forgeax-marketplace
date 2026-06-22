/**
 * PipelineStatusBar — center preview top strip (EditorCenterWorkspace).
 */
import { useMemo } from "react";
import { Check, Loader2, X, Pencil, Circle } from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { StepState } from "../../store/narrativeStore";
import { PIPELINE_STEPS } from "../../types";
import { resolveStepDisplay } from "../../utils/stepDisplay";
import type { EntryStatus, DraftState, StepDisplayState } from "../../utils/stepDisplay";

type StepStatus = "pending" | "running" | "completed" | "failed";

const STEP_LABEL_MAP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

function ChipGlyph({ display }: { display: StepDisplayState }) {
  const size = 10;
  const stroke = 2;
  switch (display) {
    case "completed":
    case "draft_ready":
      return <Check size={size} strokeWidth={stroke} aria-hidden />;
    case "running":
      return <Loader2 size={size} strokeWidth={stroke} className="cw-spin" aria-hidden />;
    case "failed":
      return <X size={size} strokeWidth={stroke} aria-hidden />;
    case "editing":
      return <Pencil size={size} strokeWidth={stroke} aria-hidden />;
    case "pending":
    case "incomplete":
    default:
      return <Circle size={size} strokeWidth={stroke} aria-hidden />;
  }
}

export function PipelineStatusBar() {
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const activeConfig = useNarrativeStore((s) => s.activeConfig);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const pipelineOrder = useNarrativeStore((s) => s.pipelineOrder);
  const previewOrder = useNarrativeStore((s) => s.previewOrder);
  const previewIsAuto = useNarrativeStore((s) => s.previewIsAuto);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);

  const isRunning = !!runningRunId;
  const isViewingRunning =
    (activeEntryKey === runningEntryKey && isRunning) || activeEntryStatus === "running";

  const liveSteps = activeEntryKey && activeEntryKey === runningEntryKey ? runningProgress : activeSteps;

  const effectivePipelineOrder = isViewingRunning
    ? pipelineOrder
    : activeEntryKey && activeConfig?.pipelineOrder && activeConfig.pipelineOrder.length > 0
      ? activeConfig.pipelineOrder
      : [];

  const liveMap = useMemo(() => new Map(liveSteps.map((s) => [s.id, s])), [liveSteps]);
  const labelOf = (id: string, live: StepState | undefined) =>
    STEP_LABEL_MAP.get(id) ?? live?.label ?? id;

  const displaySteps = useMemo(() => {
    const buildFromOrder = (order: string[]) => {
      const used = new Set<string>();
      const ordered = order.map((id) => {
        used.add(id);
        const live = liveMap.get(id);
        return { id, label: labelOf(id, live), status: (live?.status ?? "pending") as StepStatus };
      });
      const extra = liveSteps
        .filter((s) => !used.has(s.id))
        .map((s) => ({ id: s.id, label: labelOf(s.id, s), status: s.status as StepStatus }));
      return [...ordered, ...extra];
    };
    if (effectivePipelineOrder.length > 0) return buildFromOrder(effectivePipelineOrder);
    if (previewOrder && previewOrder.length > 0) return buildFromOrder(previewOrder);
    if (liveSteps.length > 0)
      return liveSteps.map((s) => ({ id: s.id, label: labelOf(s.id, s), status: s.status as StepStatus }));
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePipelineOrder, previewOrder, liveMap, liveSteps]);

  const done = displaySteps.filter((s) => s.status === "completed").length;
  const total = displaySteps.length;
  const showAutoHint = previewIsAuto && !activeEntryKey && done === 0;

  return (
    <div className="cw-pipeline-wrap pipeline-bar-wrap">
      <div className="cw-pipeline-header">
        <span className="cw-eyebrow">Pipeline</span>
        <span className="cw-pipeline-title">
          管线状态{total > 0 ? ` (${done}/${total})` : ""}
        </span>
        <span className="cw-pipeline-note">预览界面 — 创世之书就此展开</span>
      </div>

      {total === 0 ? (
        <div className="cw-pipeline-empty pipeline-bar-empty">
          在左侧选择叙事类型后，这里展示完整管线链路
        </div>
      ) : (
        <div className="cw-pipeline-track pipeline-bar-track">
          {showAutoHint && (
            <span className="pipeline-bar-auto" title="自动模式预览的是 T1 标准管线，实际步骤由 LLM 按品类判定">
              自动 · 预览 T1 管线
            </span>
          )}
          {displaySteps.map((s, i) => (
            <div className="pipeline-chip-cell" key={s.id}>
              <StepChip step={s} entryStatus={activeEntryStatus} draft={editDrafts[s.id]} />
              {i < displaySteps.length - 1 && <span className="pipeline-chip-arrow" aria-hidden>›</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepChip({
  step,
  entryStatus,
  draft,
}: {
  step: { id: string; label: string; status: StepStatus };
  entryStatus: EntryStatus;
  draft?: DraftState;
}) {
  const focusedId = useNarrativeStore((s) => s.focusedStepId);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const isActive = focusedId === step.id;

  const display = resolveStepDisplay(step.status, entryStatus, draft);

  return (
    <button
      type="button"
      className={`pipeline-chip status-${display} ${isActive ? "active" : ""}`}
      onClick={() => setFocus(isActive ? null : step.id)}
      title={`${step.label} · 点击在下方预览该步产物`}
    >
      <span className="pipeline-chip-icon">
        <ChipGlyph display={display} />
      </span>
      <span className="pipeline-chip-label">{step.label}</span>
    </button>
  );
}
