import { describe, it, expect } from "vitest";
import { IP_DNA_SLOT_BLOCK, type PromptComposer } from "../prompt-composer.js";
import { PROMPT_SLOT_ORDER } from "../prompt/skeleton.js";

import { WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";
import { CHARACTER_ENRICHMENT_COMPOSER } from "../steps/character-enrichment.js";
import {
  STORY_FRAMEWORK_PLAN_COMPOSER,
  STORY_FRAMEWORK_FILL_COMPOSER,
} from "../steps/story-framework.js";
import { OUTLINE_PLAN_COMPOSER, OUTLINE_FILL_COMPOSER, OUTLINE_GAP_COMPOSER } from "../steps/outline-batch.js";
import {
  DETAIL_PLAN_COMPOSER,
  DETAIL_FILL_COMPOSER,
  DETAIL_GAP_COMPOSER,
} from "../steps/detailed-outline-batch.js";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import { SCENE_SKELETON_COMPOSER, SCENE_EXPAND_COMPOSER } from "../steps/scene-generation.js";
import { SCRIPT_SCENE_SKELETON_COMPOSER } from "../steps/script-scene-generation.js";
import { QUEST_GENERATION_COMPOSER } from "../steps/quest-generation.js";
import { LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";
import { ITEM_DATABASE_COMPOSER } from "../steps/item-database.js";
import { VN_OUTLINE_ACTS_COMPOSER } from "../steps/vn-v2/vn-outline-acts.js";
import { VN_SCENES_COMPOSER } from "../steps/vn-v2/vn-scenes.js";
import { VN_BEATS_COMPOSER } from "../steps/vn-v2/vn-beats.js";
import { VN_BRANCHED_BEATS_COMPOSER } from "../steps/vn-v2/vn-branched-beats.js";
import { VN_SCREENPLAY_COMPOSER } from "../steps/vn-v2/vn-screenplay.js";
import { VN_STORYBOARD_COMPOSER } from "../steps/vn-v2/vn-storyboard.js";

/**
 * P1.1 单一骨架契约（蓝图 §7.2b / skeleton.ts）。
 *
 * "段序集中化"的可执行形态：IP DNA 注入块（客观真相→三视角算子→关系→账本）
 * 是 **唯一的、集中定义的** `IP_DNA_SLOT_BLOCK` 常量；所有消费 step 必须：
 *   (1) 复用该集中常量，禁止手写自己的 IP DNA 段（杜绝段序/文案漂移）；
 *   (2) 把它放在骨架规定的位置——**身份/任务之后、品类风格与输出格式之前**。
 *
 * 物理上"逐 step 内联块迁出"在 P1.3（prompts/agents/*.md）完成；本契约保证
 * 在迁移完成前、以及未来新增 step 时，段序不会偏离 §7.2b 单一骨架。
 */

// 骨架中排在 IP DNA 段【之后】的插槽对应的 block 名（风格/约束/流程/输出）。
const POST_IPDNA_BLOCKS = new Set<string>([
  "genre_style",
  "style_guide",
  "worldview_archetype",
  "character_archetype",
  "archetypes",
  "examples",
  "constraints",
  "cot",
  "output",
  "output_format",
  "output_format_hint",
  "output_schema",
  "output_requirements",
]);

const CONSUMING_COMPOSERS: Array<[string, PromptComposer]> = [
  ["worldview", WORLDVIEW_COMPOSER],
  ["character_enrichment", CHARACTER_ENRICHMENT_COMPOSER],
  ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
  ["story_framework:fill", STORY_FRAMEWORK_FILL_COMPOSER],
  ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
  ["outline_batch:fill", OUTLINE_FILL_COMPOSER],
  ["outline_batch:gap", OUTLINE_GAP_COMPOSER],
  ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
  ["detailed_outline:fill", DETAIL_FILL_COMPOSER],
  ["detailed_outline:gap", DETAIL_GAP_COMPOSER],
  ["plot_generation", PLOT_GENERATION_COMPOSER],
  ["script_generation", SCRIPT_GENERATION_COMPOSER],
  ["scene_generation:skeleton", SCENE_SKELETON_COMPOSER],
  ["scene_generation:expand", SCENE_EXPAND_COMPOSER],
  ["script_scene_generation", SCRIPT_SCENE_SKELETON_COMPOSER],
  ["quest_generation", QUEST_GENERATION_COMPOSER],
  ["lore_generation", LORE_GENERATION_COMPOSER],
  ["narrative_card", NARRATIVE_CARD_COMPOSER],
  ["item_database", ITEM_DATABASE_COMPOSER],
  ["vn_outline_acts", VN_OUTLINE_ACTS_COMPOSER],
  ["vn_scenes", VN_SCENES_COMPOSER],
  ["vn_beats", VN_BEATS_COMPOSER],
  ["vn_branched_beats", VN_BRANCHED_BEATS_COMPOSER],
  ["vn_screenplay", VN_SCREENPLAY_COMPOSER],
  ["vn_storyboard", VN_STORYBOARD_COMPOSER],
];

describe("P1.1 单一骨架契约：IP DNA 段集中定义 + 段序合规", () => {
  it("skeleton.ts 段序与 §7.2b 一致（IP DNA 段位于身份之后、风格之前）", () => {
    const order = PROMPT_SLOT_ORDER;
    expect(order.indexOf("role")).toBe(0);
    expect(order.indexOf("objective_truth")).toBeGreaterThan(order.indexOf("role"));
    expect(order.indexOf("operators")).toBeGreaterThan(order.indexOf("objective_truth"));
    expect(order.indexOf("relations")).toBeGreaterThan(order.indexOf("operators"));
    expect(order.indexOf("ledger")).toBeGreaterThan(order.indexOf("relations"));
    expect(order.indexOf("genre_style")).toBeGreaterThan(order.indexOf("ledger"));
    expect(order.indexOf("output")).toBe(order.length - 1);
  });

  for (const [label, composer] of CONSUMING_COMPOSERS) {
    it(`[${label}] 复用集中的 IP_DNA_SLOT_BLOCK，且段序合规`, () => {
      const order = composer.systemBlockOrder ?? [];

      // (1) 必须复用集中常量，禁止手写。
      expect(composer.blocks?.ip_dna, `${label} 应声明 ip_dna 块`).toBeDefined();
      expect(composer.blocks?.ip_dna, `${label} 的 ip_dna 必须 === IP_DNA_SLOT_BLOCK`).toBe(
        IP_DNA_SLOT_BLOCK,
      );

      // (2) ip_dna 必须在块序里，且不在首位（身份块之后）。
      const iIp = order.indexOf("ip_dna");
      expect(iIp, `${label} systemBlockOrder 未含 ip_dna`).toBeGreaterThanOrEqual(1);

      // (3) ip_dna 必须排在所有"风格/约束/输出"类块之前。
      for (let i = 0; i < iIp; i++) {
        expect(
          POST_IPDNA_BLOCKS.has(order[i]!),
          `${label}: "${order[i]}" 属风格/输出段，不应排在 IP DNA 之前`,
        ).toBe(false);
      }
    });
  }
});
