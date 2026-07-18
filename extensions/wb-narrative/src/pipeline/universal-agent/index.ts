/**
 * universal-agent (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * 通用三件套 agent 框架。M3-M5 把以下 7 个 stub step 迁移过来：
 *   - branch_tree, dialogue_script, cinematic_storyboard (M3 narrative)
 *   - emergent_event, region_design                      (M4 quest/region)
 *   - card_lore, event_pool                              (M5 scene/lore)
 */

export { runUniversalAgent } from "./runner.js";
export { planAgent, extractNeedsMatrix } from "./planner.js";
export { evaluateOutput } from "./evaluator.js";
export {
  createAdaptiveCapability,
  type ActPlan,
  type AdaptiveCapabilitySpec,
  type ChunkedConfig,
  type SingleShotConfig,
} from "./chunked-capability.js";
export type {
  UniversalAgentSpec,
  Capability,
  CapabilityContext,
  CapabilityExecutor,
  CapabilityResult,
  AgentPlan,
  EvaluatorSpec,
  EvaluatorVerdict,
  NeedsKey,
  NeedsScore,
  NeedsMatrix,
} from "./types.js";
