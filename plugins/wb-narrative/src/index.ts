export { NarrativePipeline } from "./pipeline/pipeline.js";
export type { PipelineStep, RerunOptions } from "./pipeline/pipeline.js";
export { LLMClient, parseJSON, extractJSON } from "./pipeline/llm-client.js";
export type { LLMCallOptions } from "./pipeline/llm-client.js";
export { getModeConfig, getModesForTier, TIER_DEFAULT_MODE, STEP_IDS, STEP_OUTPUT_FIELDS } from "./pipeline/modes.js";
export { detectTier } from "./pipeline/tier-router.js";
export { GENRE_TAXONOMY, matchGenre } from "./knowledge/genre-taxonomy.js";
export { TIER4_PRESETS, matchPreset, CATEGORY_KEYWORDS } from "./knowledge/game-narrative/tier4-presets.js";
export type * from "./types/index.js";

// Workbench integration
export { NarrativeWorkbenchClient } from "./integration/workbench-client.js";
export type {
  ReviewStatusValue,
  ReviewEntry,
  ReviewState,
  RegenerateRequest,
  RegenerateResponse,
  StaleStepsResponse,
  NarrativeStatusSummary,
  NarrativeBridgeOutbound,
  NarrativeBridgeInbound,
} from "./integration/workbench-types.js";
