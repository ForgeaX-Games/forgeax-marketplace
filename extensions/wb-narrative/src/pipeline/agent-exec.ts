/**
 * agent-exec.ts — 单 agent 执行的唯一路径（Phase-2 M6）
 *
 * AgentDef registry 与 StepDescriptor registry 在此合流：
 *   - 注册了 AgentDef 且 useNewRunner → 走对应 AgentRunner
 *   - 否则回退 StepDescriptor.fn（legacy，自带 PromptComposer）
 *
 * run-agent.ts（单 agent HTTP 入口）与 CompositeRunner.runChild（nested 子 DAG）
 * 共用本函数，否则 composite 只能调度同样注册了 AgentDef 的子步，
 * 而 tpl-jrpg 的子步全是 legacy StepDescriptor。
 */
import type { NarrativeContext } from "../types/index.js";
import type { LLMClient } from "./llm-client.js";
import { getNarrativeAgentOrThrow } from "./agent-registry.js";
import { getAgentDef } from "./blueprint/agent-def-registry.js";
import type {
  AgentRunnerCallbacks,
  ResolvedPrompts,
  StepBlueprint,
} from "./blueprint/types.js";
import { STEP_REGISTRY } from "./step-registry.js";

export interface ExecuteAgentOptions {
  /** 步骤在所属序列中的顺序号，仅用于 Runner 内部日志。 */
  index?: number;
  /**
   * 新 Runner 路径下的提示词。composite 子步必须显式传入或留空，
   * 绝不能继承父步 resolvedPrompts（父 composite 的提示词与子步无关）。
   */
  resolvedPrompts?: ResolvedPrompts;
  callbacks?: AgentRunnerCallbacks;
  /** nested 展开链（含自身之前的所有祖先），用于环检测。 */
  ancestors?: readonly string[];
}

export interface ExecuteAgentOutcome {
  agentId: string;
  outputField: string;
  output: unknown;
  /** 实际走的执行路径，便于测试与可观测。 */
  via: "runner" | "legacy";
}

export function emptyResolvedPrompts(): ResolvedPrompts {
  return { systemPrompt: "", userPromptTemplate: "" };
}

/**
 * 执行单个 agent 并把产出写回 ctx[outputField]。
 * 不做 requiredInputs 断言（调用方按场景决定是否断言）。
 */
export async function executeAgent(
  agentId: string,
  ctx: NarrativeContext,
  llm: LLMClient,
  opts: ExecuteAgentOptions = {},
): Promise<ExecuteAgentOutcome> {
  const agent = getNarrativeAgentOrThrow(agentId);
  const ancestors = opts.ancestors ?? [];
  if (ancestors.includes(agentId)) {
    throw new Error(
      `Nested agent cycle detected: ${[...ancestors, agentId].join(" -> ")}`,
    );
  }

  const def = getAgentDef(agentId);
  if (def?.useNewRunner) {
    const { getRunnerForStructure } = await import("./blueprint/runners/index.js");
    const runner = getRunnerForStructure(def.structure.type);
    const config = def.structure.type === "single-turn" ? def.structure.config : undefined;
    const step: StepBlueprint = {
      stepId: def.id,
      index: opts.index ?? 0,
      agentDef: def,
      resolvedPrompts: opts.resolvedPrompts ?? emptyResolvedPrompts(),
      nestAncestors: [...ancestors, agentId],
      executionParams: {
        temperature: config?.temperature ?? 0.7,
        retryCount: config?.retryCount ?? 3,
        streaming: config?.streaming ?? false,
        responseFormat: config?.responseFormat ?? "json",
      },
    };
    opts.callbacks?.onProgress?.(def.id, `running ${def.name}`);
    const output = await runner.execute(step, ctx, llm, {
      ...opts.callbacks,
      // 子步进度沿用子步自己的 id，父 composite 不覆写。
      onProgress: opts.callbacks?.onProgress,
    });
    const outputField = def.io.outputField || agent.io.outputField;
    if (outputField && output !== undefined) {
      (ctx as Record<string, unknown>)[outputField] = output;
    }
    opts.callbacks?.onAgentComplete?.(agentId, output);
    return { agentId, outputField, output, via: "runner" };
  }

  const desc = STEP_REGISTRY.get(agentId);
  if (!desc?.fn) {
    throw new Error(
      `Agent '${agentId}' has no useNewRunner AgentDef and no legacy step function`,
    );
  }
  opts.callbacks?.onProgress?.(agentId, `running legacy ${desc.name}`);
  await desc.fn(ctx, llm);
  const outputField = agent.io.outputField;
  const output = (ctx as Record<string, unknown>)[outputField];
  opts.callbacks?.onAgentComplete?.(agentId, output);
  return { agentId, outputField, output, via: "legacy" };
}
