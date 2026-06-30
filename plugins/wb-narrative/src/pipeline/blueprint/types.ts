/**
 * blueprint/types.ts — Blueprint + Stateless Agent Framework 核心类型
 *
 * 两大职责分离：
 *   Blueprint  = "跑什么"（步骤序列、预解析提示词、品类配置）
 *   AgentDef   = "怎么跑"（结构类型、执行参数、I/O 契约）
 *
 * 所有类型纯数据，不含运行时函数引用（可序列化、可持久化）。
 */
import type { NeedsKey, NeedsScore, NeedsMatrix } from "../universal-agent/types.js";
import type { ModeId, TierId } from "../../types/index.js";
import type { PipelineTemplateId } from "../templates.js";

// ════════════════════════════════════════════════════════
// 一、Agent 结构类型（5 种可组合原语）
// ════════════════════════════════════════════════════════

export type AgentStructureType =
  | "single-turn"
  | "chunked"
  | "sequence"
  | "conditional"
  | "deterministic";

export interface SingleTurnConfig {
  temperature?: number;
  responseFormat: "json" | "text";
  retryCount?: number;
  streaming?: boolean;
}

export interface ChunkedConfig {
  chunkStrategy: "by-act" | "by-scene" | "by-parent" | "by-batch" | "topological-wave";
  /** "serial" = 逐个串行；数字 = 最大并行度 */
  concurrency: "serial" | number;
  /** 分块专用 user prompt 模板 ID（覆盖主模板的 user prompt） */
  perChunkTemplateId?: string;
  mergeStrategy: "concat" | "deep-merge" | "custom";
  /** SingleTurn 层的 LLM 配置 */
  llm?: SingleTurnConfig;
}

export interface SequenceStage {
  type: "llm" | "deterministic";
  /** LLM 阶段的提示词模板 ID（指向 agent-templates/ 下的 .md） */
  templateId?: string;
  /** 确定性阶段的处理器名称（注册在 PROCESSOR_REGISTRY） */
  processor?: string;
  /** 条件表达式；为空表示无条件执行 */
  condition?: string;
  /** LLM 配置覆盖 */
  llm?: SingleTurnConfig;
}

export interface SequenceConfig {
  stages: SequenceStage[];
}

export interface ConditionalConfig {
  /** 运行时条件表达式，如 "ctx.target_acts > 1" */
  condition: string;
  /** 条件为 true 时执行的 agent 定义引用 */
  ifTrue: string;
  /** 条件为 false 时执行的 agent 定义引用 */
  ifFalse: string;
}

export interface DeterministicConfig {
  processor: string;
}

export type AgentStructure =
  | { type: "single-turn"; config: SingleTurnConfig }
  | { type: "chunked"; config: ChunkedConfig }
  | { type: "sequence"; config: SequenceConfig }
  | { type: "conditional"; config: ConditionalConfig }
  | { type: "deterministic"; config: DeterministicConfig };

// ════════════════════════════════════════════════════════
// 二、Agent 定义（纯数据配置，无函数引用）
// ════════════════════════════════════════════════════════

/**
 * IP DNA 算子消费声明（§7 / §7.2b）。
 * 形状与 ip-dna/injection/slot-registry 的 StepSlotSpec 一致：
 * 当 AgentDef 声明本字段时，它即为该 step 算子消费的"单一事实源"，
 * 覆盖 OPERATOR_SLOT_REGISTRY 的默认值（registry 退化为默认提供器）。
 */
export interface ConsumesIpDnaSpec {
  /** 需要的三视角算子槽位名（顺序即注入顺序）。 */
  slots: string[];
  /** 是否注入 KAG 关系网络子图（§8）。 */
  kag?: boolean;
  /** 是否注入长记忆账本一致性约束（§10）。 */
  ledger?: boolean;
  /** 检索 query 侧重提示。 */
  queryHint?: string;
}

export interface AgentIOContract {
  /** 必需的 ctx 字段（step 执行前断言存在） */
  requiredInputs: string[];
  /** 可选的 ctx 字段（存在时注入到 prompt，缺失不报错） */
  optionalInputs?: string[];
  /** 写入 ctx 的主字段名 */
  outputField: string;
  /** 派生字段（如 validation_result、player_name） */
  derivedFields?: string[];
  /**
   * IP DNA 算子消费声明（§7.2b）。声明后该 step 在 IP DNA 驱动时装备三视角算子
   * /KAG/账本，由统一注入服务读取本声明（消除与 slot-registry 的双重事实源）。
   */
  consumesIpDna?: ConsumesIpDnaSpec;
}

export interface AgentPromptConfig {
  /** 提示词模板 ID（指向 agent-templates/<templateId>.md） */
  templateId: string;
  /** Skill 白名单（空数组=拒绝所有 skill 注入） */
  skillSlots: string[];
}

export interface AgentDef {
  /** Step ID（与 STEP_IDS 对应，全局唯一） */
  id: string;
  /** 人类可读名称（前端显示用） */
  name: string;
  /** 结构化执行类型 */
  structure: AgentStructure;
  /** 提示词配置 */
  prompts: AgentPromptConfig;
  /** I/O 契约 */
  io: AgentIOContract;
  /** 前置依赖（step ID 列表） */
  dependencies: string[];
  /** Planner needs 阈值 */
  needsThreshold?: Partial<Record<NeedsKey, number>>;
  /** 策划模式需要设计上下文 */
  needsDesignContext?: boolean;
  /**
   * 验证器名称列表（注册在 VALIDATOR_REGISTRY）。
   * 按顺序执行；任一抛错触发 LLM 重试。
   */
  validators?: string[];
  /**
   * 归一化处理器名称（注册在 PROCESSOR_REGISTRY）。
   * 在 LLM 输出通过验证后对结果执行归一化变换。
   */
  normalizer?: string;
  /** SSE 输出提取键（用于 extractStepOutput 映射） */
  extractOutputKey?: string;
  /** 是否支持节点级重跑 */
  supportsNodeFilter?: boolean;
  /** 是否支持 sub-emit 进度 */
  supportsSubEmit?: boolean;
  /**
   * 是否已完成迁移，可以走 AgentRunner 新路径。
   * false/undefined = 走旧 step 函数路径（向后兼容）。
   * true = 走新 Runner 路径（完整的 .md 模板 + 注册的 processors）。
   *
   * 过渡期使用：AgentDef 注册后默认走旧路径，直到模板和处理器迁移完成。
   */
  useNewRunner?: boolean;
}

// ════════════════════════════════════════════════════════
// 三、Blueprint（配置时组装的不可变管线描述）
// ════════════════════════════════════════════════════════

export interface ResolvedPrompts {
  /**
   * System prompt（已注入 skill slots，不依赖 ctx 的静态部分）。
   * 对于 template 文件中使用 {{ctx.*}} 的 system block，在运行时由 executor 二次渲染。
   */
  systemPrompt: string;
  /**
   * User prompt 模板（含 {{ctx.*}} 占位符）。
   * 运行时由 executor 填充 ctx 数据后生成最终 user prompt。
   */
  userPromptTemplate: string;
  /** 输出 JSON Schema（如有），用于结构化验证 */
  outputSchema?: Record<string, unknown>;
}

export interface StepBlueprint {
  /** 步骤 ID */
  stepId: string;
  /** 步骤在序列中的顺序号（从 0 开始） */
  index: number;
  /** 解析后的 agent 定义 */
  agentDef: AgentDef;
  /** 预解析的提示词（system 部分已注入 skill） */
  resolvedPrompts: ResolvedPrompts;
  /** 综合 complexity/genre 后的执行参数 */
  executionParams: {
    temperature: number;
    retryCount: number;
    streaming: boolean;
    responseFormat: "json" | "text";
  };
}

export interface PipelineBlueprint {
  /** 唯一 ID（可用于持久化引用） */
  id: string;
  /** 品类代码 */
  genreCode: string;
  /** 运行模式 */
  mode: ModeId;
  /** 品类层级 */
  tier: TierId;
  /** 复杂度（0-1） */
  complexity: number;
  /** 管线模板 ID（可能为 needs-driven 表示纯 needs 驱动） */
  pipelineTemplate: PipelineTemplateId | "needs-driven";
  /** 有序步骤蓝图列表 */
  steps: StepBlueprint[];
  /** 并行组标记（steps 中哪些索引构成并行组） */
  parallelGroups: number[][];
  /** 组装时间 */
  createdAt: string;
  /** Planner 决策元数据（调试用） */
  plannerMetadata?: {
    selectedSteps: string[];
    skippedByThreshold: string[];
  };
}

// ════════════════════════════════════════════════════════
// 四、AgentRunner（执行器接口）
// ════════════════════════════════════════════════════════

import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";

export interface AgentRunnerCallbacks {
  /** 步骤级进度上报 */
  onProgress?: (stepId: string, message: string) => void;
  /** LLM 流式输出 */
  onStream?: (chunk: string, accumulated: string) => void;
  /** 子节点进度 */
  onSubEmit?: (nodeId: string, done: number, total: number) => void;
}

/**
 * Agent 执行器接口。
 * 每种 AgentStructureType 实现一个 Runner。
 */
export interface AgentRunner {
  readonly structureType: AgentStructureType;

  execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown>;
}

// ════════════════════════════════════════════════════════
// 五、Processor 注册表类型（业务逻辑函数引用）
// ════════════════════════════════════════════════════════

/**
 * 验证函数：检查 LLM 输出是否合法。
 * 抛出异常 → 触发 LLM 重试。
 */
export type ValidatorFn = (raw: string, ctx: NarrativeContext) => void;

/**
 * 归一化函数：将 LLM 原始输出变换为标准格式。
 * 返回处理后的数据（写入 ctx）。
 */
export type NormalizerFn = (parsed: unknown, ctx: NarrativeContext) => unknown;

/**
 * 确定性处理器：无 LLM 调用的纯数据变换。
 * 用于 SequenceAgent 的确定性阶段和 DeterministicAgent。
 */
export type ProcessorFn = (ctx: NarrativeContext) => Promise<void> | void;

/**
 * 分块策略函数：将 ctx 中的数据拆分为多个 chunk。
 * 返回 chunk 数组，每个 chunk 附带渲染 user prompt 所需的数据。
 */
export type ChunkSplitterFn = (ctx: NarrativeContext) => Array<{
  chunkId: string;
  data: Record<string, unknown>;
}>;

/**
 * 分块合并函数：将多个 chunk 的 LLM 输出合并为最终结果。
 */
export type ChunkMergerFn = (
  chunks: Array<{ chunkId: string; output: unknown }>,
  ctx: NarrativeContext,
) => unknown;
