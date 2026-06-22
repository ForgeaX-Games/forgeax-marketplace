import { useEffect, useRef, useCallback } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import type {
  PipelineProgress,
  RunStartResponse,
  RunResultResponse,
  NarrativeContext,
  TierId,
  ModeId,
  TierModeInfo,
} from "../types";

const API_BASE = "";

/** Fetch available tiers and modes from the API */
export async function fetchModes(): Promise<TierModeInfo[]> {
  const res = await fetch(`${API_BASE}/api/narrative/modes`);
  if (!res.ok) throw new Error(`Failed to fetch modes: ${res.status}`);
  return res.json();
}

/**
 * A1-4 / A2-1: 品类目录类型（与后端 GET /api/narrative/genres 对齐）。
 * 仅暴露 UI 需要的字段；needs 矩阵预留给后续灰显方案 B 使用。
 */
export interface GenreInfo {
  code: string;
  name: string;
  tier: TierId;
  narrative_ratio: string;
  narrative_type: string;
  pipeline_template: string;
  needs: Record<string, 0 | 1 | 2 | 3>;
  keywords: string[];
}

export interface GenreCategoryGroup {
  category: string;
  label: string;
  genres: GenreInfo[];
}

/** A1-4: 拉取按 15 大类分组的品类目录。 */
export async function fetchGenres(): Promise<GenreCategoryGroup[]> {
  const res = await fetch(`${API_BASE}/api/narrative/genres`);
  if (!res.ok) throw new Error(`Failed to fetch genres: ${res.status}`);
  const body = (await res.json()) as { categories: GenreCategoryGroup[] };
  return body.categories ?? [];
}

/** @deprecated A1: derived from (tier, mode, genre_code) instead. Kept as type alias for migration. */
export type RoutingMode = "auto" | "semi" | "manual";

/**
 * 上传剧本载荷。
 * - .txt：浏览器 file.text() → 直接走 content（utf8 字符串）
 * - .docx：浏览器 file.arrayBuffer() → base64 → 走 content_base64，由 backend mammoth 解析（M1.8）
 */
export interface UploadedScriptPayload {
  content?: string;
  content_base64?: string;
  encoding?: "utf8" | "base64-docx";
  file_name?: string;
  size?: number;
  mime?: string;
}

/** Start a new narrative generation run */
export async function startRun(
  userInput: string,
  opts: {
    tier?: TierId;
    mode?: ModeId;
    autoDetect?: boolean;
    model?: string;
    complexity?: number;
    routeGroup?: "planning" | "narrative";
    routingMode?: RoutingMode;
    genreCode?: string;
    uploadedScript?: UploadedScriptPayload;
  } = {},
): Promise<RunStartResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_input: userInput,
      tier: opts.tier,
      mode: opts.mode,
      auto_detect: opts.autoDetect,
      model: opts.model,
      complexity: opts.complexity,
      route_group: opts.routeGroup,
      routing_mode: opts.routingMode,
      genre_code: opts.genreCode,
      uploaded_script: opts.uploadedScript,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Start failed: ${res.status}`);
  }
  return res.json();
}

/** Fetch final result */
export async function fetchResult(runId: string): Promise<RunResultResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/result/${runId}`);
  if (!res.ok) throw new Error(`Failed to fetch result: ${res.status}`);
  return res.json();
}

/** Fetch current run status (for resume) */
export async function fetchStatus(runId: string) {
  const res = await fetch(`${API_BASE}/api/narrative/status/${runId}`);
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json();
}

export interface HistoryEntry {
  key: string;
  type: "dir" | "file";
  id: string | null;
  tier?: TierId;
  mode?: ModeId;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  fileCount?: number;
  hasCheckpoint: boolean;
  hasEdits?: boolean;
  lastCompletedStep: string | null;
  completedSteps: string[] | null;
  canResume: boolean;
  canLoad: boolean;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  parentKey?: string;
  forkReason?: string;
}

/** Cancel a running pipeline */
export async function cancelRun(runId: string): Promise<void> {
  await fetch(`${API_BASE}/api/narrative/cancel/${runId}`, { method: "POST" }).catch(() => {});
}

/** Fetch run history with checkpoint information */
export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch(`${API_BASE}/api/narrative/history`);
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

/** Load a historical run's full result */
export async function loadHistoryResult(key: string): Promise<RunResultResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/history/${encodeURIComponent(key)}/load`);
  if (!res.ok) throw new Error(`Failed to load history: ${res.status}`);
  return res.json();
}

/** Resume a run from a saved checkpoint */
export async function resumeRun(
  dir: string,
  opts: { model?: string } = {},
): Promise<RunStartResponse & { entryKey?: string }> {
  const res = await fetch(`${API_BASE}/api/narrative/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir, model: opts.model }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Resume failed: ${res.status}`);
  }
  return res.json();
}

export interface RegenerateResponse {
  id: string;
  status: string;
  message: string;
  sourceDir: string;
  newEntryKey?: string;
  fromStepId: string;
  staleSteps: string[];
  tier?: string;
  mode?: string;
  parentKey?: string;
}

export interface StaleStepsResponse {
  fromStepId: string;
  mode: string;
  staleSteps: string[];
  staleFields: string[];
}

/** Regenerate (fork) from a specific step with optional editDrafts */
export async function regenerateStep(
  sourceDir: string,
  fromStepId: string,
  opts: {
    userInstructions?: string;
    stopAfterStep?: string;
    patchedContext?: Record<string, unknown>;
    model?: string;
    skipSteps?: string[];
    nodeFilter?: Record<string, string[]>;
    editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
  } = {},
): Promise<RegenerateResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceDir,
      fromStepId,
      userInstructions: opts.userInstructions,
      stopAfterStep: opts.stopAfterStep,
      patchedContext: opts.patchedContext,
      model: opts.model,
      skipSteps: opts.skipSteps,
      nodeFilter: opts.nodeFilter,
      editDrafts: opts.editDrafts,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Regenerate failed: ${res.status}`);
  }
  return res.json();
}

export interface ImpactAnalysisResponse {
  affectedSteps: string[];
  canSkip: string[];
  reasoning: string;
  mode?: string;
  pipelineOrder?: string[];
  fallback?: boolean;
  nodeImpacts?: Array<{ stepId: string; nodeIds: string[] }> | null;
}

/** Analyze impact of user edits via LLM diff analysis */
export async function analyzeImpact(
  sourceDir: string,
  modifications: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
  }>,
): Promise<ImpactAnalysisResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/analyze-impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceDir, modifications }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Impact analysis failed: ${res.status}`);
  }
  return res.json();
}

/** Fetch saved edits for a run directory */
export async function fetchEdits(dir: string): Promise<{
  edits: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
    originalContent?: unknown;
    savedAt: string;
  }>;
  updatedAt: string;
}> {
  const res = await fetch(`${API_BASE}/api/narrative/edits/${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(`Failed to fetch edits: ${res.status}`);
  return res.json();
}

/** Preview which steps would become stale if a step is re-run */
export async function fetchStaleSteps(
  sourceDir: string,
  fromStepId: string,
): Promise<StaleStepsResponse> {
  const params = new URLSearchParams({ sourceDir, fromStepId });
  const res = await fetch(`${API_BASE}/api/narrative/stale-steps?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch stale steps: ${res.status}`);
  return res.json();
}

/**
 * Hook: connects to SSE stream for the active run and updates the store.
 * Auto-fetches result on completion.
 */
export function useNarrativeStream() {
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const pushProgress = useNarrativeStore((s) => s.pushProgress);
  const appendStreamChunk = useNarrativeStore((s) => s.appendStreamChunk);
  const completeRun = useNarrativeStore((s) => s.completeRun);
  const failRun = useNarrativeStore((s) => s.failRun);
  const esRef = useRef<EventSource | null>(null);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!runningRunId) {
      cleanup();
      return;
    }

    const es = new EventSource(`${API_BASE}/api/narrative/stream/${runningRunId}`);
    esRef.current = es;

    es.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "done") {
          cleanup();
          if (data.status === "completed") {
            try {
              const result = await fetchResult(runningRunId);
              if (result.result) {
                const newKey = (result as unknown as Record<string, unknown>).sourceDir as string | undefined;
                completeRun(result.result, newKey ?? undefined);
              } else {
                failRun("Result unavailable");
              }
            } catch {
              failRun("Failed to fetch result");
            }
          } else {
            failRun(data.error ?? "Pipeline failed");
          }

          useNarrativeStore.getState().snapshot();
          return;
        }

        if (data.type === "streaming" && data.stepId && (data.chunk || data.accumulated)) {
          let sid = data.stepId as string;
          if (sid === "script_scene_generation") {
            const msg = (data.accumulated ?? data.chunk ?? "") as string;
            sid = msg.includes("场景") ? "scene_generation" : "script_generation";
          }
          appendStreamChunk(sid, (data.accumulated ?? data.chunk) as string);
          return;
        }

        // D4: pipeline_steps_announce — forwarded as a regular progress frame.
        if (data.type === "pipeline_steps_announce" && Array.isArray(data.steps)) {
          pushProgress(data as PipelineProgress);
          return;
        }

        const progress = data as PipelineProgress;
        pushProgress(progress);
      } catch {
        // skip malformed events
      }
    };

    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    const scheduleReconnect = () => {
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts - 1), 15000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!useNarrativeStore.getState().runningRunId) return;
          const newEs = new EventSource(`${API_BASE}/api/narrative/stream/${runningRunId}`);
          esRef.current = newEs;
          newEs.onmessage = es.onmessage;
          newEs.onerror = es.onerror;
        }, delay);
      } else {
        failRun("Lost connection after multiple retries");
      }
    };

    es.onerror = () => {
      cleanup();
      const store = useNarrativeStore.getState();
      if (!store.runningRunId) return;

      fetchStatus(runningRunId).then(async (st) => {
        if (st.status === "completed") {
          try {
            const result = await fetchResult(runningRunId);
            if (result.result) {
              const newKey = (result as unknown as Record<string, unknown>).sourceDir as string | undefined;
              completeRun(result.result, newKey ?? undefined);
            } else {
              failRun("Result unavailable");
            }
          } catch {
            failRun("Failed to fetch result on reconnect");
          }
        } else if (st.status === "failed") {
          failRun(st.error ?? "Unknown error");
        } else {
          scheduleReconnect();
        }
      }).catch(async () => {
        try {
          const history = await fetchHistory();
          const match = history.find((h) => h.id === runningRunId && h.canLoad);
          if (match) {
            const data = await loadHistoryResult(match.key);
            if (data.result) {
              completeRun(data.result, match.key);
              useNarrativeStore.getState().snapshot();
              return;
            }
          }
        } catch { /* history lookup failed */ }
        scheduleReconnect();
      });
    };

    return cleanup;
  }, [runningRunId, pushProgress, appendStreamChunk, completeRun, failRun, cleanup]);
}
