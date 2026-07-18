/**
 * Pipeline templates (frontend mirror of backend templates.ts) — D3.
 *
 * The backend is the source of truth for which steps each template runs.
 * This file mirrors the same step lists so the UI can show "the steps that
 * will run" before the SSE pipeline_steps_announce frame arrives.
 *
 * If you change templates.ts, update this file too.
 */
import type { TierId } from "./types";

export type PipelineTemplateId =
  | "tpl-rpg"
  | "tpl-vn"
  | "tpl-vn-v2"
  | "tpl-open-world"
  | "tpl-card-game"
  | "tpl-fragmented"
  | "tpl-emergent"
  | "tpl-narrative-card"
  | "tpl-light";

const PREF = ["preference_summary", "preference_analysis"];
const BASE = [...PREF, "initial_plan", "worldview"];
const ENTITIES = ["character_enrichment", "item_database"];
const DESIGN = [
  "core_concept",
  "system_architecture",
  "system_detail",
  "value_framework",
  "design_doc",
];

/**
 * Step ID lists per template (mirrors packages/narrative-studio/src/pipeline/templates.ts).
 * Parallel groups are flattened to a single list for UI display purposes.
 */
export const PIPELINE_TEMPLATE_STEPS: Record<PipelineTemplateId, string[]> = {
  "tpl-rpg": [
    ...BASE,
    ...ENTITIES,
    "story_framework",
    "outline_batch",
    "detailed_outline",
    "plot_generation",
    "script_generation",
    "quest_generation",
    "scene_generation",
    // Lore (L) 已由通用叙事 agent 内嵌产出，不再驱动独立 step
  ],
  "tpl-vn": [
    ...BASE,
    "character_enrichment",
    "branch_tree",
    "dialogue_script",
  ],
  // 互动影游 v2 专属管线（与后端 templates.ts 的 tpl-vn-v2 一一对应）
  // E1 / E2 互斥：上传剧本时由后端把 vn_outline_acts / vn_scenes / vn_beats 替换为
  // vn_script_normalize / vn_segment_confirm；前端 routeStepOrder 计算时镜像该规则
  "tpl-vn-v2": [
    "vn_logline",
    "vn_outline_acts",
    "worldview",
    "vn_scenes",
    "vn_beats",
    "vn_branched_beats",
    "vn_screenplay",
    "vn_storyboard",
  ],
  "tpl-open-world": [
    ...BASE,
    "region_design",
    "character_enrichment",
    "emergent_event",
    // Lore (L) 已由通用叙事 agent 内嵌产出，不再驱动独立 step
  ],
  "tpl-card-game": [
    ...BASE,
    "card_lore",
    "event_pool",
  ],
  "tpl-fragmented": [
    ...BASE,
    "character_enrichment",
    "item_database",
    "scene_generation",
  ],
  "tpl-emergent": [
    ...BASE,
    "emergent_event",
  ],
  "tpl-narrative-card": ["narrative_card"],
  "tpl-light": [...BASE, "character_enrichment"],
};

/**
 * Default template per tier (mirror of TIER_DEFAULT_TEMPLATE on backend).
 * Used by ROUTING manual/semi mode to preview which steps will run.
 */
export const TIER_DEFAULT_TEMPLATE: Record<TierId, PipelineTemplateId> = {
  tier1: "tpl-rpg",
  tier2: "tpl-fragmented",
  tier3: "tpl-light",
  tier4: "tpl-narrative-card",
};

/**
 * Compose the planning preview = D0-D4 + template steps.
 */
export function getTemplateStepsWithDesign(templateId: PipelineTemplateId): string[] {
  return [...DESIGN, ...PIPELINE_TEMPLATE_STEPS[templateId]];
}

/**
 * Resolve the steps to display for a given (tier) and routing mode.
 *  - In manual/semi mode: planning route shows D0-D4 + template steps for the tier
 *  - Auto mode: caller should fall back to the SSE pipeline_steps_announce frame
 */
export function getPlanningPreviewSteps(tier: TierId): string[] {
  const tpl = TIER_DEFAULT_TEMPLATE[tier] ?? "tpl-rpg";
  return getTemplateStepsWithDesign(tpl);
}

export const TEMPLATE_LABELS: Record<PipelineTemplateId, string> = {
  "tpl-rpg": "RPG 标准管线",
  "tpl-vn": "[已废弃] 视觉小说 / 互动影游 v1",
  "tpl-vn-v2": "互动影游 v2（专属管线）",
  "tpl-open-world": "开放世界 RPG",
  "tpl-card-game": "卡牌游戏叙事",
  "tpl-fragmented": "碎片化叙事",
  "tpl-emergent": "涌现性叙事",
  "tpl-narrative-card": "叙事卡（Tier4）",
  "tpl-light": "轻量管线（Tier3）",
};
