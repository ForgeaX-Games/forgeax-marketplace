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
};

export default tools;
