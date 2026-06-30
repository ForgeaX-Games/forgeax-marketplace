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

/**
 * IP DNA 多模态摄入载荷（对齐后端 POST /api/narrative/ip-dna/start 的 files[]）。
 * - 文本：content（utf8 字符串）
 * - .docx：content_base64 + encoding="base64-docx"（后端 mammoth 解析）
 * - 二进制（图片/视频/音频/PDF/压缩包）：content_base64（不带 encoding，后端按 file_type 处理）
 */
export interface IpDnaFilePayload {
  file_name?: string;
  content?: string;
  content_base64?: string;
  encoding?: "utf8" | "base64-docx";
  file_type?: string;
  role?: string;
}

export interface IpDnaStartOptions {
  title?: string;
  tier?: TierId;
  generationMode?: ModeId;
  complexity?: number;
  /** 路由组（planning/narrative）：决定下游走策划全量还是叙事单品（§5.1 ROUTING 透传）。 */
  routeGroup?: string;
  /** 品类编码：scoped 生成喂 vn/rpg 管线的路由依据（§5.1/§L genreCode 透传）。 */
  genreCode?: string;
  /** 默认 true：跑完提取后继续跑生成管线（重需求端到端）。 */
  runGeneration?: boolean;
}

export interface IpDnaJobStartResponse {
  jobId: string;
  story_timestamp: string;
  status: string;
}

export interface IpDnaJobStatus {
  jobId: string;
  story_timestamp?: string;
  status: "pending" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled" | "degraded";
  current_stage?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: {
    story_timestamp?: string;
    run_id?: string;
    title?: string;
    media_type?: string;
    node_count?: number;
    /** ingest 阶段结果：层级树 + 默认裁剪/单元/维度 + 干扰过滤。 */
    hierarchy?: unknown[];
    volume?: unknown;
    decomposition?: unknown;
    noise_filtered?: string[];
    default_scope?: unknown;
    default_game_unit_plan?: unknown;
    default_dimensions?: unknown;
    awaiting?: string;
    /** D3 提取质量闸门（§14.2/§L）：层级连通 / 三件套齐全 / 核心要素 / 五大类算子覆盖。 */
    extraction_quality?: {
      passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail?: string }>;
      warnings: string[];
    };
    game_units?: Array<{ index: number; generated?: boolean; output_dir?: string }>;
  };
}

/**
 * 重需求摄入（蓝图 §5）：上传多模态/压缩包/多文件 → IP DNA → 改编 → 生成。
 * 异步模式：立即返回 jobId，前端轮询 fetchIpDnaJob。
 */
export async function startIpDnaRun(
  files: IpDnaFilePayload[],
  opts: IpDnaStartOptions = {},
): Promise<IpDnaJobStartResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      title: opts.title,
      tier: opts.tier,
      generation_mode: opts.generationMode,
      complexity: opts.complexity,
      route_group: opts.routeGroup,
      genre_code: opts.genreCode,
      run_generation: opts.runGeneration !== false,
      async: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `IP DNA start failed: ${res.status}`);
  }
  return res.json();
}

/** 轮询 IP DNA 异步任务进度（§11）。 */
export async function fetchIpDnaJob(jobId: string): Promise<IpDnaJobStatus> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/job/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch IP DNA job: ${res.status}`);
  return res.json();
}

/** 取消 IP DNA 异步任务（§5.1 取消生产；与主管线 cancelRun 对齐统一 job 状态）。 */
export async function ipDnaCancel(jobId: string): Promise<{ jobId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/job/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to cancel IP DNA job: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// IP 半自动阶段门 API 客户端（§5.1）：ingest → hierarchy →(decompose)→ confirm → extract/generate。
// 与平台 agent 工具 narrative:ip-dna-* 走同一组后端端点，行为等价（双通道）。
// ─────────────────────────────────────────────────────────────────

/** 层级节点摘要（前端展示/裁剪范围下拉用）。 */
export interface IpHierarchyNode {
  id: string;
  levelType: "complete" | "part" | "chapter" | "unit";
  index: number;
  title: string;
  parent: string | null;
  children?: string[];
  childRange?: string;
}

/** ingest / hierarchy 共用的层级树 + 默认裁剪/单元/维度摘要。 */
export interface IpHierarchyResult {
  story_timestamp: string;
  run_id: string;
  title: string;
  media_type: string;
  node_count: number;
  hierarchy: IpHierarchyNode[];
  volume?: { charCount: number; isShort: boolean; needsDecompose: boolean; suggestedChunks: number; thresholdBasis: string; oversizedUnitCount?: number };
  decomposition?: { iterations: number; splitUnits: number; residualOversize: boolean };
  noise_filtered?: string[];
  default_scope?: { full: boolean; selections?: unknown[] };
  default_game_unit_plan?: { mode: "single" | "series"; units: unknown[]; userSpecified?: boolean };
  default_dimensions?: unknown;
  confirmation?: Record<string, unknown>;
  awaiting?: string;
  jobId?: string;
  status?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((b as { error?: string }).error ?? `请求失败: ${res.status}`);
  }
  return res.json();
}

/** 阶段门①：摄入 + 标准化（async=true 返回 jobId，轮询 fetchIpDnaJob 取层级树摘要）。 */
export async function ipDnaIngest(
  files: IpDnaFilePayload[],
  opts: { title?: string; decompose?: boolean; model?: string; async?: boolean; storyTimestamp?: string } = {},
): Promise<IpHierarchyResult> {
  return postJson<IpHierarchyResult>(`${API_BASE}/api/narrative/ip-dna/ingest`, {
    files,
    title: opts.title,
    decompose: opts.decompose,
    model: opts.model,
    async: opts.async,
    story_timestamp: opts.storyTimestamp,
  });
}

/** 只读层级树 + 默认裁剪/单元/维度 + 体量（供确认裁剪范围引导）。 */
export async function fetchIpHierarchy(runId: string): Promise<IpHierarchyResult> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/hierarchy`);
  if (!res.ok) throw new Error(`Failed to fetch hierarchy: ${res.status}`);
  return res.json();
}

/** 只读：按 runId 读取已落盘 IP DNA 层级树摘要（§6/§10，历史回放还原输入模块用）。 */
export interface IpDnaHierarchySummary {
  story_id: string;
  title: string;
  media_type: string;
  node_count: number;
  hierarchy: IpHierarchyNode[];
}
export async function fetchIpDnaHierarchy(runId: string): Promise<IpDnaHierarchySummary | null> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch IP DNA hierarchy: ${res.status}`);
  return res.json();
}

/** 拆解（§5 步骤6-10）：超线时按标记/单元闭环拆解→再标准化→重写骨架层级树。 */
export async function ipDnaDecompose(runId: string): Promise<{ run_id: string; decomposed: boolean; chunk_count: number; closure: unknown; node_count: number; hierarchy: IpHierarchyNode[] }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/decompose`, {});
}

/** ① 确认裁剪范围（§4.4 第①步）。 */
export async function ipDnaConfirmScope(
  runId: string,
  body: { scopeSelections?: unknown[]; scopeFull?: boolean; adaptationNotes?: string } = {},
): Promise<{ run_id: string; confirmation: Record<string, unknown>; awaiting: string }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/confirm-scope`, {
    scope_selections: body.scopeSelections,
    scope_full: body.scopeFull,
    adaptation_notes: body.adaptationNotes,
  });
}

/** ② 确认游戏单元 + 改编维度（§4.4 第②③步）。 */
export async function ipDnaConfirmUnits(
  runId: string,
  body: { gameUnitPlan?: unknown; adaptationDimensions?: unknown; mode?: "single" | "series"; targetUnits?: number } = {},
): Promise<{ run_id: string; confirmation: Record<string, unknown>; awaiting: string }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/confirm-units`, {
    game_unit_plan: body.gameUnitPlan,
    adaptation_dimensions: body.adaptationDimensions,
    mode: body.mode,
    target_units: body.targetUnits,
  });
}

/** ③ 生成 scoped IP DNA（仅提取，run_generation=false）。async=true 走 job。 */
export async function ipDnaExtract(
  runId: string,
  opts: { pipelineFamily?: "rpg" | "vn"; tier?: TierId; generationMode?: ModeId; complexity?: number; maxGameUnits?: number; equipOperators?: boolean; model?: string; async?: boolean } = {},
): Promise<IpDnaJobStartResponse | IpDnaJobStatus["result"]> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/extract`, {
    pipeline_family: opts.pipelineFamily,
    tier: opts.tier,
    generation_mode: opts.generationMode,
    complexity: opts.complexity,
    max_game_units: opts.maxGameUnits,
    equip_operators: opts.equipOperators,
    model: opts.model,
    async: opts.async,
  });
}

/** 开始生成（§5 步骤4→5）：提取 + 下游生成自动串跑。async=true 走 job。 */
export async function ipDnaGenerate(
  runId: string,
  opts: { pipelineFamily?: "rpg" | "vn"; tier?: TierId; generationMode?: ModeId; complexity?: number; maxGameUnits?: number; equipOperators?: boolean; model?: string; async?: boolean } = {},
): Promise<IpDnaJobStartResponse | IpDnaJobStatus["result"]> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/generate`, {
    pipeline_family: opts.pipelineFamily,
    tier: opts.tier,
    generation_mode: opts.generationMode,
    complexity: opts.complexity,
    max_game_units: opts.maxGameUnits,
    equip_operators: opts.equipOperators,
    model: opts.model,
    async: opts.async,
  });
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
