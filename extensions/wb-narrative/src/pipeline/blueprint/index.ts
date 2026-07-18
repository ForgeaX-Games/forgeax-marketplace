/**
 * blueprint/ — Blueprint + Stateless Agent Framework
 *
 * 统一入口，按模块导出。
 */

// 核心类型
export type {
  AgentStructureType,
  SingleTurnConfig,
  ChunkedConfig,
  SequenceStage,
  SequenceConfig,
  ConditionalConfig,
  DeterministicConfig,
  AgentStructure,
  AgentIOContract,
  AgentPromptConfig,
  AgentDef,
  ResolvedPrompts,
  StepBlueprint,
  PipelineBlueprint,
  AgentRunner,
  AgentRunnerCallbacks,
  ValidatorFn,
  NormalizerFn,
  ProcessorFn,
  ChunkSplitterFn,
  ChunkMergerFn,
} from "./types.js";

// Agent 定义注册表
export {
  registerAgentDef,
  getAgentDef,
  hasAgentDef,
  getAllAgentDefs,
  getAgentDefOrThrow,
  AGENT_DEF_REGISTRY,
} from "./agent-def-registry.js";

// 业务逻辑处理器注册表
export {
  registerValidator,
  registerNormalizer,
  registerProcessor,
  registerSplitter,
  registerMerger,
  getValidator,
  getNormalizer,
  getProcessor,
  getSplitter,
  getMerger,
  hasValidator,
  hasNormalizer,
  hasProcessor,
  hasSplitter,
  hasMerger,
} from "./processor-registry.js";

// Prompt 解析器
export { PromptResolver } from "./prompt-resolver.js";

// Blueprint 组装器
export { assembleBlueprint } from "./assembler.js";

// Agent Runner（执行器）
export { getRunnerForStructure } from "./runners/index.js";
