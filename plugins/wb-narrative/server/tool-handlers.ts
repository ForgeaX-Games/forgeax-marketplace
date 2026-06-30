/**
 * wb-narrative `entry.backend` for ToolRegistry.
 *
 * Each handler bridges to the narrative-studio Express API running on
 * localhost:${NARRATIVE_PORT}. The Express server (src/api/server.ts) owns
 * the pipeline lifecycle; this file is a thin RPC adapter so the ForgeaX
 * ToolRegistry can dispatch `narrative:*` tool calls from AI / chat / CLI.
 *
 * Pattern mirrors wb-character/server/tool-handlers.ts:
 *   ToolRegistry → tools["narrative:start-pipeline"](args, ctx)
 *                → HTTP fetch to :8900
 *                → return structured result
 *
 * Sandbox contract: handlers MUST use ctx.env for secrets / port config
 * and ctx.cwd for project root. Never read process.env directly.
 */

interface ToolCtx {
  caller: { kind: string; id?: string };
  toolId: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

function getApiBase(ctx: ToolCtx): string {
  const port = ctx.env?.NARRATIVE_PORT ?? "8900";
  return `http://localhost:${port}/api/narrative`;
}

async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), {
      code: res.status === 409 ? "conflict" : "api_error",
      httpStatus: res.status,
    });
  }
  return body;
}

// ---------------------------------------------------------------------------

interface StartPipelineArgs {
  userInput: string;
  tier?: string;
  mode?: string;
  genreCode?: string;
  complexity?: number;
  routeGroup?: "planning" | "narrative";
  routingMode?: "auto" | "semi" | "manual";
  model?: string;
}

interface GetRunStatusArgs {
  runId: string;
  includeResult?: boolean;
}

interface ListRunsArgs {
  limit?: number;
}

interface ExportResultArgs {
  runId: string;
  slug?: string;
  targetDir?: string;
}

interface CancelRunArgs {
  runId: string;
}

interface RegenerateStepArgs {
  sourceDir: string;
  fromStepId: string;
  userInstructions?: string;
  stopAfterStep?: string;
  model?: string;
  skipSteps?: string[];
  nodeFilter?: Record<string, string[]>;
  editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
}

interface RunIdArg {
  runId: string;
}

interface ReadFileArgs {
  runId: string;
  filePath: string;
}

interface DirArg {
  dir: string;
}

interface LoadHistoryArgs {
  key: string;
}

interface ResumePipelineArgs {
  dir: string;
  model?: string;
}

interface StaleStepsArgs {
  sourceDir: string;
  fromStepId: string;
}

interface AnalyzeImpactArgs {
  sourceDir: string;
  modifications: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
  }>;
}

interface SetReviewArgs {
  dir: string;
  stepId: string;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
  regenerateRunId?: string;
}

/** 嵌套裁剪选择（§4.4 第①步对话产物）。 */
interface ScopeSelectionArg {
  nodeId: string;
  childRange?: [number, number];
  children?: ScopeSelectionArg[];
}

interface IpDnaStartArgs {
  files: Array<{
    fileName: string;
    content?: string;
    contentBase64?: string;
    encoding?: "utf8" | "base64-docx";
    fileType?: string;
    role?: string;
  }>;
  title?: string;
  mode?: "single" | "series";
  /** §4.4 第①步：裁剪范围（嵌套选择）；缺省=全量。 */
  scopeSelections?: ScopeSelectionArg[];
  /** §4.4 第②步：用户精确选填的游戏单元规划；缺省=默认切分。 */
  gameUnitPlan?: unknown;
  /** §4.4 第③步：改编维度（叙事层级数 + 模板字段）；缺省=全维度模板。 */
  adaptationDimensions?: unknown;
  /** §5.1 自定义补充：作者改编意图自由文本；缺省=忠实转化。 */
  adaptationNotes?: string;
  targetUnits?: number;
  complexity?: number;
  runGeneration?: boolean;
  maxGameUnits?: number;
  pipelineFamily?: "rpg" | "vn";
  tier?: string;
  generationMode?: string;
  /** ROUTING 透传（§5.1/§L）：路由组 + 品类编码，决定下游 vn/rpg 生成管线。 */
  routeGroup?: "planning" | "narrative";
  genreCode?: string;
  model?: string;
}

interface IpDnaAnalyzeImpactArgs {
  runId: string;
  changedKeys: string[];
}

/** 阶段门 ① 摄入 + 标准化（停在确认裁剪范围前）。 */
interface IpDnaIngestArgs {
  files: Array<{
    fileName: string;
    content?: string;
    contentBase64?: string;
    encoding?: "utf8" | "base64-docx";
    fileType?: string;
    role?: string;
  }>;
  title?: string;
  decompose?: boolean;
  model?: string;
  /** 异步：true 立即返回 jobId，轮询 ip-dna-get-job 取层级树摘要。 */
  async?: boolean;
  storyTimestamp?: string;
}

/** 阶段门 ③ 确认裁剪范围（§4.4 第①步）。 */
interface IpDnaConfirmScopeArgs {
  runId: string;
  scopeSelections?: ScopeSelectionArg[];
  scopeFull?: boolean;
  /** §5.1 自定义补充：作者改编意图自由文本；缺省=忠实转化。 */
  adaptationNotes?: string;
}

/** 阶段门 确认游戏单元 + 改编维度（§4.4 第②③步）。 */
interface IpDnaConfirmUnitsArgs {
  runId: string;
  gameUnitPlan?: unknown;
  adaptationDimensions?: unknown;
  mode?: "single" | "series";
  targetUnits?: number;
}

/** 阶段门 提取/生成（extract=仅 IP DNA；generate=提取+下游生成自动串跑）。 */
interface IpDnaExtractGenerateArgs {
  runId: string;
  pipelineFamily?: "rpg" | "vn";
  tier?: string;
  generationMode?: string;
  complexity?: number;
  maxGameUnits?: number;
  equipOperators?: boolean;
  model?: string;
  async?: boolean;
}

interface JobIdArg {
  jobId: string;
}

/** read-file may return text/plain; cap payload so AI callers don't blow context. */
const READ_FILE_MAX_CHARS = 24000;

// ---------------------------------------------------------------------------

export const tools = {
  "narrative:start-pipeline": async (args: StartPipelineArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/start`, {
      method: "POST",
      body: JSON.stringify({
        user_input: args.userInput,
        tier: args.tier,
        mode: args.mode,
        genre_code: args.genreCode,
        complexity: args.complexity,
        route_group: args.routeGroup,
        routing_mode: args.routingMode,
        model: args.model,
      }),
    });
  },

  "narrative:get-run-status": async (args: GetRunStatusArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const status = await apiFetch(`${base}/status/${args.runId}`);
    if (
      args.includeResult &&
      (status as { status: string }).status === "completed"
    ) {
      const result = await apiFetch(`${base}/result/${args.runId}`);
      return { ...(status as object), result };
    }
    return status;
  },

  "narrative:list-runs": async (_args: ListRunsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/history`);
  },

  "narrative:export-result": async (args: ExportResultArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const targetDir =
      args.targetDir ??
      `${ctx.cwd ?? "."}/.forgeax/games/${args.slug ?? "_default"}/narrative`;
    return await apiFetch(`${base}/export/${args.runId}`, {
      method: "POST",
      body: JSON.stringify({ target_dir: targetDir }),
    });
  },

  "narrative:cancel-run": async (args: CancelRunArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/cancel/${args.runId}`, {
      method: "POST",
    });
  },

  "narrative:regenerate-step": async (
    args: RegenerateStepArgs,
    ctx: ToolCtx,
  ) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        fromStepId: args.fromStepId,
        userInstructions: args.userInstructions,
        stopAfterStep: args.stopAfterStep,
        model: args.model,
        skipSteps: args.skipSteps,
        nodeFilter: args.nodeFilter,
        editDrafts: args.editDrafts,
      }),
    });
  },

  // ── A. 能力发现 ──────────────────────────────────────────────────────────

  "narrative:list-genres": async (_args: Record<string, never>, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/genres`);
  },

  "narrative:list-modes": async (_args: Record<string, never>, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/modes`);
  },

  // ── B. 读产出 ────────────────────────────────────────────────────────────

  "narrative:list-files": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/files/${encodeURIComponent(args.runId)}`);
  },

  "narrative:read-file": async (args: ReadFileArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const segs = String(args.filePath)
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = `${base}/file/${encodeURIComponent(args.runId)}/${segs}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(msg), { code: "api_error", httpStatus: res.status });
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      const data = await res.json();
      const text = JSON.stringify(data, null, 2);
      if (text.length > READ_FILE_MAX_CHARS) {
        return {
          runId: args.runId,
          filePath: args.filePath,
          truncated: true,
          content: `${text.slice(0, READ_FILE_MAX_CHARS)}\n…(truncated)`,
        };
      }
      return { runId: args.runId, filePath: args.filePath, truncated: false, content: data };
    }
    const text = await res.text();
    const truncated = text.length > READ_FILE_MAX_CHARS;
    return {
      runId: args.runId,
      filePath: args.filePath,
      truncated,
      content: truncated ? `${text.slice(0, READ_FILE_MAX_CHARS)}\n…(truncated)` : text,
    };
  },

  "narrative:get-story-tree": async (args: DirArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/story-tree/${encodeURIComponent(args.dir)}`);
  },

  "narrative:get-pipeline-nodes": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/pipeline-nodes/${encodeURIComponent(args.runId)}`);
  },

  // ── C. 历史 / 断点续跑 ────────────────────────────────────────────────────

  "narrative:load-history": async (args: LoadHistoryArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/history/${encodeURIComponent(args.key)}/load`);
  },

  "narrative:resume-pipeline": async (args: ResumePipelineArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/resume`, {
      method: "POST",
      body: JSON.stringify({ dir: args.dir, model: args.model }),
    });
  },

  // ── D. 编辑评估 ──────────────────────────────────────────────────────────

  "narrative:get-stale-steps": async (args: StaleStepsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const qs = new URLSearchParams({
      sourceDir: args.sourceDir,
      fromStepId: args.fromStepId,
    }).toString();
    return await apiFetch(`${base}/stale-steps?${qs}`);
  },

  "narrative:analyze-impact": async (args: AnalyzeImpactArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/analyze-impact`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        modifications: args.modifications,
      }),
    });
  },

  // ── E. 评审 ──────────────────────────────────────────────────────────────

  "narrative:get-review": async (args: DirArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/review/${encodeURIComponent(args.dir)}`);
  },

  "narrative:set-review": async (args: SetReviewArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/review/${encodeURIComponent(args.dir)}`, {
      method: "POST",
      body: JSON.stringify({
        stepId: args.stepId,
        status: args.status,
        feedback: args.feedback,
        regenerateRunId: args.regenerateRunId,
      }),
    });
  },

  // ── F. IP DNA 叙事操作系统（蓝图 §5/§10/§15）─────────────────────────────

  "narrative:ip-dna-start": async (args: IpDnaStartArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/start`, {
      method: "POST",
      body: JSON.stringify({
        files: (args.files ?? []).map((f) => ({
          file_name: f.fileName,
          content: f.content,
          content_base64: f.contentBase64,
          encoding: f.encoding,
          file_type: f.fileType,
          role: f.role,
        })),
        title: args.title,
        mode: args.mode,
        scope_selections: args.scopeSelections,
        game_unit_plan: args.gameUnitPlan,
        adaptation_dimensions: args.adaptationDimensions,
        adaptation_notes: args.adaptationNotes,
        target_units: args.targetUnits,
        complexity: args.complexity,
        run_generation: args.runGeneration,
        max_game_units: args.maxGameUnits,
        pipeline_family: args.pipelineFamily,
        tier: args.tier,
        generation_mode: args.generationMode,
        route_group: args.routeGroup,
        genre_code: args.genreCode,
        model: args.model,
      }),
    });
  },

  "narrative:get-ip-dna": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}`);
  },

  // ── F.2 IP 半自动阶段门（§5.1）：ingest → hierarchy → (decompose) → confirm → extract/generate ──

  "narrative:ip-dna-ingest": async (args: IpDnaIngestArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/ingest`, {
      method: "POST",
      body: JSON.stringify({
        files: (args.files ?? []).map((f) => ({
          file_name: f.fileName,
          content: f.content,
          content_base64: f.contentBase64,
          encoding: f.encoding,
          file_type: f.fileType,
          role: f.role,
        })),
        title: args.title,
        decompose: args.decompose,
        model: args.model,
        async: args.async,
        story_timestamp: args.storyTimestamp,
      }),
    });
  },

  "narrative:ip-dna-get-hierarchy": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/hierarchy`);
  },

  "narrative:ip-dna-decompose": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/decompose`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  "narrative:ip-dna-confirm-scope": async (args: IpDnaConfirmScopeArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/confirm-scope`, {
      method: "POST",
      body: JSON.stringify({ scope_selections: args.scopeSelections, scope_full: args.scopeFull, adaptation_notes: args.adaptationNotes }),
    });
  },

  "narrative:ip-dna-confirm-units": async (args: IpDnaConfirmUnitsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/confirm-units`, {
      method: "POST",
      body: JSON.stringify({
        game_unit_plan: args.gameUnitPlan,
        adaptation_dimensions: args.adaptationDimensions,
        mode: args.mode,
        target_units: args.targetUnits,
      }),
    });
  },

  "narrative:ip-dna-extract": async (args: IpDnaExtractGenerateArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/extract`, {
      method: "POST",
      body: JSON.stringify({
        pipeline_family: args.pipelineFamily,
        tier: args.tier,
        generation_mode: args.generationMode,
        complexity: args.complexity,
        max_game_units: args.maxGameUnits,
        equip_operators: args.equipOperators,
        model: args.model,
        async: args.async,
      }),
    });
  },

  "narrative:ip-dna-generate": async (args: IpDnaExtractGenerateArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/generate`, {
      method: "POST",
      body: JSON.stringify({
        pipeline_family: args.pipelineFamily,
        tier: args.tier,
        generation_mode: args.generationMode,
        complexity: args.complexity,
        max_game_units: args.maxGameUnits,
        equip_operators: args.equipOperators,
        model: args.model,
        async: args.async,
      }),
    });
  },

  "narrative:ip-dna-get-job": async (args: JobIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/job/${encodeURIComponent(args.jobId)}`);
  },

  // 取消生产（§5.1）：与前端 UI「取消生成」按钮能力对等（agent 也能取消 IP DNA 异步任务）。
  "narrative:ip-dna-cancel": async (args: JobIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/job/${encodeURIComponent(args.jobId)}/cancel`, {
      method: "POST",
    });
  },

  "narrative:ip-dna-analyze-impact": async (args: IpDnaAnalyzeImpactArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/analyze-impact`, {
      method: "POST",
      body: JSON.stringify({ runId: args.runId, changedKeys: args.changedKeys }),
    });
  },
};

export default tools;
