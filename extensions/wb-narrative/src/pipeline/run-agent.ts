/**
 * run-agent.ts — 单 agent 独立调用（Phase-1 M3）
 *
 * 不遍历全管线：按 io.requiredInputs 断言后单独执行。
 * 供 POST /api/narrative/agent/:id/run 与画布工程师/助手节点使用。
 */
import type { NarrativeContext } from "../types/index.js";
import { LLMClient } from "./llm-client.js";
import { executeAgent } from "./agent-exec.js";
import { getNarrativeAgentOrThrow } from "./agent-registry.js";
import "./step-registrations.js";
import "./blueprint/agent-def-registrations.js";

export interface RunAgentOptions {
  agentId: string;
  ctx: NarrativeContext;
  /** 覆盖/补齐 ctx 字段（写入后再断言 requiredInputs）。 */
  inputs?: Record<string, unknown>;
  llm?: LLMClient;
  onProgress?: (message: string) => void;
  /**
   * 逐 agent 进度（composite 的子步会各报一次）。
   * SSE 模式下服务端据此把子 DAG 波次转成 step 帧，让长任务在画布上可观测。
   */
  onAgentProgress?: (agentId: string, message: string) => void;
  /** 逐 agent 完成（composite 子步各报一次），带该 agent 的产出。 */
  onAgentComplete?: (agentId: string, output: unknown) => void;
}

export interface RunAgentResult {
  agentId: string;
  outputField: string;
  output: unknown;
  ctx: NarrativeContext;
}

/**
 * 前置校验：agent 存在 + requiredInputs 齐备。
 * SSE 模式必须先同步校验再返回 202，否则错误只能从流里出来（HTTP 状态码已发）。
 */
export function assertAgentRunnable(
  agentId: string,
  ctx: NarrativeContext,
  inputs?: Record<string, unknown>,
): NarrativeContext {
  const agent = getNarrativeAgentOrThrow(agentId);
  const merged = { ...ctx, ...(inputs ?? {}) } as NarrativeContext;
  assertRequiredInputs(agent.id, agent.io.requiredInputs, merged);
  return merged;
}

function assertRequiredInputs(agentId: string, required: string[], ctx: NarrativeContext): void {
  const missing = required.filter((k) => {
    const v = (ctx as Record<string, unknown>)[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `Agent '${agentId}' missing required inputs: ${missing.join(", ")}`,
    );
  }
}

/**
 * 独立执行单个 NarrativeAgent。
 * 执行路径分派统一由 executeAgent 承担（与 composite 子步同一条路径）。
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const agent = getNarrativeAgentOrThrow(opts.agentId);
  const ctx = { ...opts.ctx, ...(opts.inputs ?? {}) } as NarrativeContext;

  assertRequiredInputs(agent.id, agent.io.requiredInputs, ctx);

  const llm =
    opts.llm ??
    new LLMClient({
      /* env-driven defaults inside LLMClient */
    });

  const outcome = await executeAgent(agent.id, ctx, llm, {
    callbacks: {
      onProgress: (id, msg) => {
        opts.onProgress?.(msg);
        opts.onAgentProgress?.(id, msg);
      },
      onAgentComplete: (id, output) => opts.onAgentComplete?.(id, output),
    },
  });

  return {
    agentId: agent.id,
    outputField: outcome.outputField || agent.io.outputField,
    output: outcome.output,
    ctx,
  };
}
