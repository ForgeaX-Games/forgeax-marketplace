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

/**
 * 动态 C 序号（§5.1 / 蓝图 §3.5 动态分步）：中间管线里出现的 IP 预处理节点（id 以 `ip_` 开头）
 * 按其在当前管线序列中的实际出现顺序赋号 C0..Cn——而非写死 C0–C4。
 * 这样拆解(ip_decompose)/改编规划(ip_adapt_plan) 等可选分支被纳入时，后续序号自动顺延。
 * 仅中间管线加 C 前缀（左侧步骤用纯数字，按产品决策）。
 */
function withDynamicIpPrefix<T extends { id: string; label: string }>(steps: T[]): T[] {
  let c = 0;
  return steps.map((s) => {
    if (!s.id.startsWith("ip_")) return s;
    const label = `C${c} ${s.label.replace(/^C\d+(?:\.\d+)?\s*/, "")}`;
    c += 1;
    return { ...s, label };
  });
}

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
  const ipPreviewRunId = useNarrativeStore((s) => s.ipPreviewRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const pipelineOrder = useNarrativeStore((s) => s.pipelineOrder);
  const previewOrder = useNarrativeStore((s) => s.previewOrder);
  const previewIsAuto = useNarrativeStore((s) => s.previewIsAuto);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);

  const isRunning = !!runningRunId;
  // IP 半自动预览（ipPreviewRunId）与正式 SSE run 共用"运行中视图"——与 useOrderedSteps 对齐（§D3）。
  const isIpPreview = !!ipPreviewRunId;
  const hasIpProgress = runningProgress.some((s) => s.id.startsWith("ip_"));
  const isViewingRunning =
    (activeEntryKey != null &&
      activeEntryKey === runningEntryKey &&
      (isRunning || isIpPreview || runningProgress.length > 0)) ||
    activeEntryStatus === "running";

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
    // 整条铺开（含未达 pending）：正式 run / 历史视图——可预见下游待跑步骤。
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
    // 逐步生长（仅已 push 的步骤，与预览同源）：IP 半自动预处理随每步确认增量出现（§D1）。
    const buildGrown = (order: string[]) => {
      const used = new Set<string>();
      const ordered: Array<{ id: string; label: string; status: StepStatus }> = [];
      for (const id of order) {
        const live = liveMap.get(id);
        if (!live) continue; // 未 push → 不渲染（不铺 pending）
        used.add(id);
        ordered.push({ id, label: labelOf(id, live), status: live.status as StepStatus });
      }
      const extra = liveSteps
        .filter((s) => !used.has(s.id))
        .map((s) => ({ id: s.id, label: labelOf(s.id, s), status: s.status as StepStatus }));
      return [...ordered, ...extra];
    };
    let built: Array<{ id: string; label: string; status: StepStatus }>;
    const useGrown = isIpPreview || (hasIpProgress && isViewingRunning);
    if (useGrown) built = buildGrown(effectivePipelineOrder.length > 0 ? effectivePipelineOrder : liveSteps.map((s) => s.id));
    else if (effectivePipelineOrder.length > 0) built = buildFromOrder(effectivePipelineOrder);
    else if (previewOrder && previewOrder.length > 0) built = buildFromOrder(previewOrder);
    else if (liveSteps.length > 0)
      built = liveSteps.map((s) => ({ id: s.id, label: labelOf(s.id, s), status: s.status as StepStatus }));
    else built = [];
    return withDynamicIpPrefix(built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIpPreview, hasIpProgress, isViewingRunning, effectivePipelineOrder, previewOrder, liveMap, liveSteps]);

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
