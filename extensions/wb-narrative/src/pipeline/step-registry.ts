/**
 * step-registry.ts — Phase 1: StepDescriptor 结构化注册表
 *
 * 聚合散落在 pipeline.ts（ALL_STEPS）、modes.ts（STEP_OUTPUT_FIELDS）和
 * 各 step 文件内部的元数据。每个 step 注册 6 类配置后即可被 Planner、
 * 执行器和前端 SSE 统一查询。
 */
import type { PipelineStep } from "./pipeline.js";
import type { PromptComposer } from "./prompt-composer.js";
import type { NeedsKey } from "./universal-agent/types.js";

// ────────────────────────────────────────────
// StepDescriptor 接口
// ────────────────────────────────────────────

export interface StepDescriptor {
  // A. 身份
  id: string;
  name: string;
  fn: PipelineStep;
  /** SSE 输出提取键（用于替代旧 extractStepOutput 映射） */
  extractOutputKey?: string;

  // B. Prompt
  composer?: PromptComposer;
  /** skill 查找键，默认等于 id */
  skillStepId?: string;
  /** 策划+叙事联合模式（需要 design context） */
  needsDesignContext?: boolean;

  // C. 数据依赖
  /** 前置 step ID（用于 Planner 拓扑排序和 rerun 下游计算） */
  dependsOn: string[];
  /**
   * 执行前必须已存在的 ctx 字段。
   * 缺省时由 dependsOn 的主输出字段派生（见 getStepRequiredInputs）——
   * 只在派生结果不准时才显式声明，避免两份事实源。
   */
  requiredInputs?: string[];
  /** 存在则用、缺失不拦的 ctx 字段。 */
  optionalInputs?: string[];
  /** 是否支持节点级重跑（多节点进度 step） */
  supportsNodeFilter?: boolean;

  // D. LLM（可选覆盖，step 内部仍可自行控制）
  responseFormat?: "json" | "text";
  temperature?: number;

  // E. 输出
  /** 写入 ctx 的主字段（替代 STEP_OUTPUT_FIELDS 散表） */
  outputFields: string[];
  /** 派生字段（如 validation 结果） */
  derivedFields?: string[];
  /** 是否支持多节点进度回调（sub-emit） */
  supportsSubEmit?: boolean;

  // F. Planner
  /** needs 阈值（各维度最低分数要求），Planner 据此决定是否选入 */
  needsThreshold?: Partial<Record<NeedsKey, number>>;
}

// ────────────────────────────────────────────
// 全局注册表
// ────────────────────────────────────────────

export const STEP_REGISTRY = new Map<string, StepDescriptor>();

export function registerStep(desc: StepDescriptor): void {
  STEP_REGISTRY.set(desc.id, desc);
}

/** 获取指定 step 的所有输出字段（主字段 + 派生字段） */
export function getStepOutputFields(stepId: string): string[] {
  const desc = STEP_REGISTRY.get(stepId);
  if (!desc) return [];
  return [...desc.outputFields, ...(desc.derivedFields ?? [])];
}

/** 获取指定 step 的 SSE 输出提取键 */
export function getExtractOutputKey(stepId: string): string | undefined {
  return STEP_REGISTRY.get(stepId)?.extractOutputKey;
}

/** 获取指定 step 的前置依赖 */
export function getStepDependencies(stepId: string): string[] {
  return STEP_REGISTRY.get(stepId)?.dependsOn ?? [];
}

/**
 * 执行前必须存在的 ctx 字段。
 *
 * 显式声明优先；否则每个直接前置取**一个**字段——它的主输出。
 *
 * 只取主输出而不是前置产出的全部字段，是为了让这条断言不会假阳性：
 * 「主输出在」等价于「这一步跑过了」，而副产物（validation 结果、target_acts
 * 这类）本来就可能条件性缺席，拿它们卡单跑会把正常的重跑拦在门外。
 */
export function getStepRequiredInputs(stepId: string): string[] {
  const desc = STEP_REGISTRY.get(stepId);
  if (!desc) return [];
  if (desc.requiredInputs) return [...desc.requiredInputs];
  const fields = new Set<string>();
  for (const dep of desc.dependsOn) {
    const primary = STEP_REGISTRY.get(dep)?.outputFields[0];
    if (primary) fields.add(primary);
  }
  return [...fields];
}

/**
 * 单步/单席位调用前的输入体检：返回缺失字段名。
 *
 * 只报告不抛错——是否放行由调用方决定（前端据此灰置入口并提示"需先跑 X"，
 * 全量管线因拓扑有序永远不缺）。
 */
export function missingStepInputs(
  stepId: string,
  ctx: Record<string, unknown>,
): string[] {
  return getStepRequiredInputs(stepId).filter((f) => {
    const v = ctx[f];
    return v === undefined || v === null;
  });
}

/**
 * 从 step ID 获取下游所有受影响的 step（含递归下游），
 * 用于 rerunFromStep 时决定需要清除哪些字段。
 */
export function getDownstreamSteps(stepId: string): string[] {
  const downstream = new Set<string>();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [id, desc] of STEP_REGISTRY) {
      if (desc.dependsOn.includes(current) && !downstream.has(id)) {
        downstream.add(id);
        queue.push(id);
      }
    }
  }
  return [...downstream];
}
