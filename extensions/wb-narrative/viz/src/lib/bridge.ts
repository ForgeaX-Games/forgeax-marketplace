/**
 * Narrative Viz ↔ host (workbench-ui) postMessage bridge protocol.
 *
 * Inbound (host → narrative-viz):
 *   narrative:load-run             — Load and display a specific run by ID
 *   narrative:reload               — Re-fetch current run status
 *   narrative:trigger-regenerate   — Host triggers regeneration of a step
 *   narrative:attach-run           — Attach UI to a run started externally (e.g. by 剧情师 Kotone
 *                                    via the narrative:start-pipeline tool). Sets runningRunId so
 *                                    the SSE stream drives the center preview live, and回填 INPUT/
 *                                    ROUTING 选择器 so the left toolbar reflects what the agent chose.
 *
 * Outbound (narrative-viz → host):
 *   narrative:ready                — Viz has loaded, ready to receive commands
 *   narrative:run-started          — A new pipeline run has been started
 *   narrative:run-completed        — Pipeline run finished successfully
 *   narrative:run-failed           — Pipeline run failed
 *   narrative:step-changed         — A pipeline step changed status
 *   narrative:progress             — Step progress with numeric details
 *   narrative:regenerate-requested — Viz requests regeneration of a step
 *   narrative:step-approved        — User approved a step's output
 *   narrative:step-rejected        — User rejected a step's output
 *   narrative:content-edited       — User saved edits to a step/node
 *   narrative:lifecycle-changed    — Step lifecycle state changed (editing/modified/stale)
 *   narrative:surface-snapshot     — Surface state snapshot for AI DUAL-MODALITY
 */

export type InboundEvent =
  | { type: "narrative:load-run"; payload: { runId: string } }
  | { type: "narrative:reload" }
  | { type: "narrative:trigger-regenerate"; payload: { stepId: string; instructions?: string } }
  | {
      type: "narrative:attach-run";
      payload: {
        runId: string;
        /** 后端 /start 返回的 sourceDir（输出目录名）。缺省时退化用 runId 作 entryKey。 */
        entryKey?: string;
        tier?: string;
        mode?: string;
        genreCode?: string | null;
        /** agent 解析出的用户需求原文（回填 INPUT 框）。 */
        userInput?: string;
        routeGroup?: "planning" | "narrative";
      };
    };

export type OutboundEvent =
  | { type: "narrative:ready" }
  | { type: "narrative:run-started"; payload: { runId: string; tier?: string; mode?: string } }
  | { type: "narrative:run-completed"; payload: { runId: string } }
  | { type: "narrative:run-failed"; payload: { runId: string; error: string } }
  | { type: "narrative:step-changed"; payload: { stepId: string; status: string; label?: string } }
  | { type: "narrative:progress"; payload: { stepId: string; label?: string; step: number; totalSteps: number; status: string } }
  | { type: "narrative:regenerate-requested"; payload: { stepId: string; instructions?: string } }
  | { type: "narrative:step-approved"; payload: { stepId: string } }
  | { type: "narrative:step-rejected"; payload: { stepId: string; reason?: string } }
  | { type: "narrative:content-edited"; payload: { stepId: string; nodeId?: string; hasUserInput: boolean } }
  | { type: "narrative:lifecycle-changed"; payload: { stepId: string; lifecycle: string; previousLifecycle?: string } }
  | { type: "narrative:surface-snapshot"; payload: { surface: string; snapshot: Record<string, unknown> } };

const isEmbedded = typeof window !== "undefined" && window.parent !== window;

export function sendToHost(event: OutboundEvent): void {
  if (isEmbedded) {
    window.parent.postMessage(event, "*");
  }
}

export function onHostMessage(handler: (event: InboundEvent) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (typeof e.data?.type === "string" && e.data.type.startsWith("narrative:")) {
      handler(e.data as InboundEvent);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function notifyReady(): void {
  sendToHost({ type: "narrative:ready" });
}
