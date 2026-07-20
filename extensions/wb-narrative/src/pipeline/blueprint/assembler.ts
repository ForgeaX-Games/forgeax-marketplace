/**
 * blueprint/assembler.ts — Blueprint 组装器
 *
 * 在配置时（pipeline 启动前）一次性完成管线蓝图的组装：
 *   1. 确定步骤序列（复用现有 Planner 选步逻辑）
 *   2. 对每个步骤解析 AgentDef
 *   3. 加载并注入 Skill 到 system prompt
 *   4. 构建不可变 PipelineBlueprint
 *
 * 向后兼容：
 *   尚未注册 AgentDef 的步骤，从 STEP_REGISTRY 的 StepDescriptor 自动桥接。
 *   已注册 AgentDef 的步骤，优先使用 AgentDef 路径。
 */
import type {
  PipelineBlueprint,
  StepBlueprint,
  AgentDef,
  ResolvedPrompts,
} from "./types.js";
import type { ModeId, TierId, NarrativeContext } from "../../types/index.js";
import type { PipelineTemplateId } from "../templates.js";
import type { NeedsKey, NeedsScore } from "../universal-agent/types.js";
import { planPipeline } from "../planner/index.js";
import { STEP_REGISTRY } from "../step-registry.js";
import { getAgentDef, hasAgentDef } from "./agent-def-registry.js";
import { PromptResolver } from "./prompt-resolver.js";
import { getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { getModeConfig } from "../modes.js";
import type { NarrativeType } from "../../knowledge/genre-narrative-type.js";
import { STEP_IDS as S } from "../modes.js";

export interface AssemblerInput {
  genreCode: string;
  mode: ModeId;
  tier: TierId;
  complexity?: number;
  /** narrative_type 用于 planner；缺省时从 genre taxonomy 推断 */
  narrativeType?: NarrativeType;
  /** 直接提供步骤序列（跳过 planner 选步）；用于 resume/rerun */
  overrideSteps?: string[];
  /** 用于向后兼容的 ctx 快照（PromptComposer 桥接路径需要） */
  ctx?: NarrativeContext;
}

/**
 * 组装管线蓝图。
 *
 * @param input  组装所需的全部参数
 * @returns 不可变的 PipelineBlueprint
 */
export function assembleBlueprint(input: AssemblerInput): PipelineBlueprint {
  const { genreCode, mode, tier, complexity = 0.5 } = input;

  // ────── Step 1: 确定步骤序列 ──────

  let stepIds: string[];
  let parallelGroups: number[][] = [];
  let pipelineTemplate: PipelineTemplateId | "needs-driven" = "needs-driven";
  let plannerMeta: { selectedSteps: string[]; skippedByThreshold: string[] } | undefined;

  if (input.overrideSteps) {
    stepIds = input.overrideSteps;
  } else {
    const modeConfig = getModeConfig(mode);

    if (modeConfig && modeConfig.steps.length > 0 && !modeConfig.isDynamic) {
      stepIds = flattenStepGroups(modeConfig.steps);
      parallelGroups = extractParallelGroupIndices(modeConfig.steps);
      pipelineTemplate = modeConfig.pipeline_template ?? "needs-driven";
    } else {
      const genreEntry = findGenreByCode(genreCode);
      const needs: Partial<Record<NeedsKey, NeedsScore>> = genreEntry?.needs ?? {};
      const narrativeType = input.narrativeType ?? genreEntry?.narrative_type ?? "linear";

      const planResult = planPipeline({
        genre_code: genreCode,
        tier,
        needs,
        narrative_type: narrativeType,
        pipelineTemplate: genreEntry?.pipelineTemplate,
      });

      stepIds = flattenStepGroups(planResult.stepGroups);
      parallelGroups = extractParallelGroupIndices(planResult.stepGroups);
      pipelineTemplate = planResult.metadata.resolvedTemplate;
      plannerMeta = {
        selectedSteps: planResult.metadata.selectedSteps,
        skippedByThreshold: planResult.metadata.skippedByThreshold,
      };
    }
  }

  // ────── Step 1.5: VN v2 E2 旁路 ──────
  // 用户上传剧本时，替换 E1 中下层步骤为 E2 路径
  if (input.ctx?.uploaded_script?.content) {
    const before = stepIds.length;
    stepIds = injectVnV2E2(stepIds);
    if (stepIds.length !== before) {
      // 步骤数量变化后并行组索引失效，重新计算（VN v2 管线无并行组，安全清空）
      parallelGroups = [];
    }
  }

  // ────── Step 2: 为每个步骤组装 StepBlueprint ──────

  const steps: StepBlueprint[] = stepIds.map((stepId, index) => {
    return buildStepBlueprint(stepId, index, genreCode, complexity, input.ctx);
  });

  // ────── Step 3: 构建最终 Blueprint ──────

  return {
    id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    genreCode,
    mode,
    tier,
    complexity,
    pipelineTemplate,
    steps,
    parallelGroups,
    createdAt: new Date().toISOString(),
    plannerMetadata: plannerMeta,
  };
}

// ════════════════════════════════════════════════════════
// 内部辅助
// ════════════════════════════════════════════════════════

function buildStepBlueprint(
  stepId: string,
  index: number,
  genreCode: string,
  complexity: number,
  ctx?: NarrativeContext,
): StepBlueprint {
  const agentDef = resolveAgentDef(stepId);
  const skill = getStepSkill(genreCode, stepId);
  let resolvedPrompts: ResolvedPrompts;

  if (hasAgentDef(stepId)) {
    resolvedPrompts = PromptResolver.resolveFromTemplate(agentDef.prompts, skill, genreCode);
  } else {
    const stepDesc = STEP_REGISTRY.get(stepId);
    if (stepDesc?.composer && ctx) {
      resolvedPrompts = PromptResolver.resolveFromComposer(stepDesc.composer, ctx);
    } else {
      resolvedPrompts = {
        systemPrompt: "",
        userPromptTemplate: "",
      };
    }
  }

  const baseConfig = agentDef.structure.type === "single-turn"
    ? agentDef.structure.config
    : { temperature: 0.7, responseFormat: "json" as const, retryCount: 3, streaming: false };

  return {
    stepId,
    index,
    agentDef,
    resolvedPrompts,
    executionParams: {
      temperature: scaleTemperature(
        ("temperature" in baseConfig ? baseConfig.temperature : undefined) ?? 0.7,
        complexity,
      ),
      retryCount: ("retryCount" in baseConfig ? baseConfig.retryCount : undefined) ?? 3,
      streaming: ("streaming" in baseConfig ? baseConfig.streaming : undefined) ?? false,
      responseFormat: ("responseFormat" in baseConfig ? baseConfig.responseFormat : undefined) ?? "json",
    },
  };
}

/**
 * 从 AgentDef 注册表或 StepDescriptor 桥接获取 AgentDef。
 */
function resolveAgentDef(stepId: string): AgentDef {
  const registered = getAgentDef(stepId);
  if (registered) return registered;

  const stepDesc = STEP_REGISTRY.get(stepId);
  if (!stepDesc) {
    throw new Error(`Step '${stepId}' not found in AgentDef registry or StepDescriptor registry`);
  }

  return bridgeStepDescriptorToAgentDef(stepDesc);
}

/**
 * 桥接层：将旧 StepDescriptor 转换为 AgentDef。
 * 过渡期使用，使未迁移的 step 也能参与 Blueprint 流程。
 */
function bridgeStepDescriptorToAgentDef(
  desc: import("../step-registry.js").StepDescriptor,
): AgentDef {
  return {
    id: desc.id,
    name: desc.name,
    structure: {
      type: "single-turn",
      config: {
        temperature: desc.temperature ?? 0.7,
        responseFormat: desc.responseFormat ?? "json",
        retryCount: 3,
        streaming: false,
      },
    },
    prompts: {
      templateId: desc.id,
      skillSlots: desc.composer?.skillSlots ?? [],
    },
    io: {
      requiredInputs: [],
      outputField: desc.outputFields[0] ?? desc.id,
      derivedFields: desc.derivedFields,
    },
    dependencies: desc.dependsOn,
    needsThreshold: desc.needsThreshold,
    needsDesignContext: desc.needsDesignContext,
    extractOutputKey: desc.extractOutputKey,
    supportsNodeFilter: desc.supportsNodeFilter,
    supportsSubEmit: desc.supportsSubEmit,
  };
}

/**
 * 根据 complexity 微调 temperature。
 * complexity 高 → temperature 略低（更保守）；complexity 低 → 略高（更创意）。
 */
function scaleTemperature(base: number, complexity: number): number {
  const adjustment = (0.5 - complexity) * 0.2;
  return Math.max(0, Math.min(1.5, base + adjustment));
}

/**
 * 将 (string | string[])[] 展平为有序 string[]。
 */
function flattenStepGroups(groups: (string | string[])[]): string[] {
  const result: string[] = [];
  for (const g of groups) {
    if (Array.isArray(g)) {
      result.push(...g);
    } else {
      result.push(g);
    }
  }
  return result;
}

/**
 * VN v2 E2 旁路：用户上传剧本时，替换 E1 中下层步骤。
 * 与 pipeline.ts 的 injectVnV2E2Steps 逻辑一致，但操作展平后的 stepId 数组。
 */
function injectVnV2E2(stepIds: string[]): string[] {
  const REPLACED = new Set<string>([S.VN_OUTLINE_ACTS, S.VN_SCENES, S.VN_BEATS]);
  const REPLACEMENTS = [S.VN_SCRIPT_NORMALIZE, S.VN_SEGMENT_CONFIRM];

  const hasAnyReplaced = stepIds.some((id) => REPLACED.has(id));
  if (!hasAnyReplaced) return stepIds;

  const alreadyInjected = stepIds.some(
    (id) => id === S.VN_SCRIPT_NORMALIZE || id === S.VN_SEGMENT_CONFIRM,
  );
  if (alreadyInjected) return stepIds;

  const result: string[] = [];
  let injected = false;
  for (const id of stepIds) {
    if (REPLACED.has(id)) {
      if (!injected) {
        result.push(...REPLACEMENTS);
        injected = true;
      }
      continue;
    }
    result.push(id);
  }
  return result;
}

/**
 * 从 stepGroups 提取并行组的索引信息。
 */
function extractParallelGroupIndices(groups: (string | string[])[]): number[][] {
  const parallelGroups: number[][] = [];
  let currentIndex = 0;
  for (const g of groups) {
    if (Array.isArray(g)) {
      const indices = g.map((_, i) => currentIndex + i);
      parallelGroups.push(indices);
      currentIndex += g.length;
    } else {
      currentIndex++;
    }
  }
  return parallelGroups;
}
