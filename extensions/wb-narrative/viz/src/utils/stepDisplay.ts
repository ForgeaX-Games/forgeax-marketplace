/**
 * Unified step display state derivation.
 * All UI surfaces (sidebar PipelineStatus, TextViewPanel, graph mode)
 * share this pure function + icon mapping.
 */

export type StepDisplayState =
  | "completed"
  | "running"
  | "pending"
  | "incomplete"
  | "failed"
  | "editing"
  | "draft_ready";

export type EntryStatus = "completed" | "interrupted" | "running" | null;

export interface DraftState {
  editing?: boolean;
  saved?: boolean;
}

export function resolveStepDisplay(
  stepStatus: "completed" | "pending" | "running" | "failed",
  entryStatus: EntryStatus,
  draft: DraftState | undefined,
): StepDisplayState {
  if (draft?.editing) return "editing";
  if (draft?.saved) return "draft_ready";
  if (stepStatus === "completed") return "completed";
  if (stepStatus === "running") return "running";
  if (stepStatus === "failed") return "failed";
  if (entryStatus === "running") return "pending";
  if (entryStatus === "interrupted") return "incomplete";
  return "pending";
}

export function getStepIcon(display: StepDisplayState): string {
  switch (display) {
    case "completed":   return "✓";
    case "running":     return "⟳";
    case "pending":     return "○";
    case "incomplete":  return "◌";
    case "failed":      return "✕";
    case "editing":     return "✎";
    case "draft_ready": return "✎";
  }
}

export function getStepDisplayClass(display: StepDisplayState): string {
  return `status-${display}`;
}
