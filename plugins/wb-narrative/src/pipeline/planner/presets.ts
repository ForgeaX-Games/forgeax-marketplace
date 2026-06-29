/**
 * presets.ts — 管线模板预置方案
 *
 * 将现有 9 个 buildXxxAutoSteps 的逻辑转为声明式数据。
 * Planner Step 1 根据 pipelineTemplate 查此表。
 */
import type { PresetConfig } from "./types.js";
import type { PipelineTemplateId } from "../templates.js";

// 与 templates.ts / modes.ts 的 tpl-vn-v2 规范链严格对齐（9 步）。
// vn_state_ledger（G-01.5 世界状态账本）必须在 vn_branched_beats 与 vn_screenplay 之间，
// 否则 Planner 路径会漏掉账本步，导致剧本/分镜失去世界状态一致性约束。
const VN_V2_STEPS = [
  "vn_logline",
  "vn_outline_acts",
  "worldview",
  "vn_scenes",
  "vn_beats",
  "vn_branched_beats",
  "vn_state_ledger",
  "vn_screenplay",
  "vn_storyboard",
] as const;

export const PIPELINE_PRESETS: Partial<Record<PipelineTemplateId, PresetConfig>> = {
  "tpl-rpg": {
    baseSteps: [],
    optional: {
      worldview: { W: 1 },
      character_enrichment: { C: 2 },
      item_database: { I: 2 },
      story_framework: { S: 2 },
      outline_batch: { S: 2 },
      detailed_outline: { S: 3 },
      plot_generation: { S: 3 },
      script_generation: { D: 3 },
      quest_generation: { Q: 2 },
      scene_generation: { E: 2 },
    },
  },

  "tpl-narrative-card": {
    fixedSteps: ["narrative_card"],
    skipPreference: true,
  },

  "tpl-vn-v2": {
    fixedSteps: [...VN_V2_STEPS],
    skipPreference: true,
  },

  "tpl-vn": {
    baseSteps: ["branch_tree", "dialogue_script"],
    optional: {
      worldview: { W: 1 },
      character_enrichment: { C: 2 },
      cinematic_storyboard: { E: 2 },
    },
  },

  "tpl-open-world": {
    baseSteps: ["worldview", "region_design", "emergent_event"],
    optional: {
      character_enrichment: { C: 2 },
    },
  },

  "tpl-card-game": {
    baseSteps: ["worldview", "card_lore", "event_pool"],
    optional: {},
  },

  "tpl-emergent": {
    baseSteps: ["worldview", "emergent_event"],
    optional: {},
  },

  "tpl-fragmented": {
    baseSteps: ["worldview"],
    optional: {
      character_enrichment: { C: 1 },
      item_database: { I: 1 },
      scene_generation: { E: 1 },
    },
  },

  "tpl-light": {
    baseSteps: [],
    optional: {
      worldview: { W: 1 },
      character_enrichment: { C: 1 },
    },
  },
};

export function getPreset(template: PipelineTemplateId): PresetConfig | undefined {
  return PIPELINE_PRESETS[template];
}
