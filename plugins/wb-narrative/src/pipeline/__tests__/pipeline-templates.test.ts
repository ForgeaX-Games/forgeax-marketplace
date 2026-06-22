/**
 * pipeline-templates.test.ts (F5 — 5 模板 × 5 品类回归测试)
 * ─────────────────────────────────────────────────────────────────
 * 不发起任何 LLM 调用，专注验证：
 *   1. buildAutoSteps 在每种 (template, genre) 组合下输出正确的 step 序列
 *   2. skill-loader 能正确返回品类专属 skill 的 stepSkills
 *   3. PromptComposer 能注入 skill slots 内容（branch_tree / region_design / card_lore）
 *   4. cinematic_storyboard 仅在 enableSteps 声明时激活
 *   5. 长尾 catch-all 为所有 79 品类提供至少一个 stub skill
 */
import { describe, expect, it } from "vitest";

import "../../knowledge/game-narrative/skill-bootstrap.js";
import { buildAutoSteps } from "../design-steps/auto-narrative-builder.js";
import {
  loadSkill,
  listRegisteredSkills,
  getStepSkill,
} from "../../knowledge/game-narrative/skill-loader.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";
import {
  composeSystemPrompt,
  type PromptComposer,
} from "../prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";
import type { NarrativeRequirements } from "../../types/game-design.js";

function buildReq(
  needs: Record<string, number>,
  narrativeType: NarrativeRequirements["narrative_type"],
): NarrativeRequirements {
  return {
    needs,
    narrative_type: narrativeType,
    depth: "standard",
    available_modes: [],
    recommended_mode: "",
    priority_content: [],
    constraints: [],
    system_context: [],
    loops_summary: { gameplay_loop: "", resource_loop: "" },
  };
}

const FULL_NEEDS = { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 3, L: 3 };

describe("F5: pipeline templates × genres regression", () => {
  describe("tpl-rpg (rpg-jrpg / rpg-crpg)", () => {
    for (const code of ["rpg-jrpg", "rpg-crpg"]) {
      it(`${code} → classic L0-L5 step path`, () => {
        const steps = buildAutoSteps(buildReq(FULL_NEEDS, "linear"), {
          genreCode: code,
        });
        expect(steps).toContain("worldview");
        expect(steps).toContain("character_enrichment");
        expect(steps).toContain("story_framework");
        expect(steps).toContain("script_generation");
        // RPG 模板不应出现 VN/卡牌/开放世界专属 step
        expect(steps).not.toContain("branch_tree");
        expect(steps).not.toContain("card_lore");
        expect(steps).not.toContain("region_design");
      });
    }
  });

  // ── RPG L0-L5 严格回归：保证 RPG 思路品类的 11 步链条 + 场景仍然完整 ──
  describe("tpl-rpg L0-L5 完整性（确保未被 narrative_type 兜底破坏）", () => {
    const RPG_THINKING_GENRES = [
      "rpg-jrpg", "rpg-crpg", "rpg-arpg", "rpg-mmorpg", "rpg-srpg",
      "rpg-gacha", "rpg-wuxia", "act-linear", "act-adventure",
      "act-character", "act-stealth", "fps-story", "tps-adventure",
      "fps-looter", "misc-pokemon",
    ];
    const REQUIRED_STEPS_FULL_RPG = [
      "preference_summary",
      "preference_analysis",
      "initial_plan",
      "worldview",
      "character_enrichment",
      "item_database",
      "story_framework",      // L0
      "outline_batch",        // L1
      "detailed_outline",     // L2
      "plot_generation",      // L3
      "script_generation",    // L4
      "quest_generation",     // L5
      "scene_generation",
      // Lore 已集成至通用叙事 agent（按 needs.L 内嵌产出），不再独立 step
      // UI 文案已从叙事模块移除
    ];
    for (const code of RPG_THINKING_GENRES) {
      it(`${code} (FULL_NEEDS, linear) → 11 步 RPG 链 + 场景 全部存在且按序（Lore 已内嵌至叙事 agent）`, () => {
        const steps = buildAutoSteps(buildReq(FULL_NEEDS, "linear"), {
          genreCode: code,
        });
        // 全部 step 必须存在
        for (const required of REQUIRED_STEPS_FULL_RPG) {
          expect(steps, `${code} 缺少 ${required}`).toContain(required);
        }
        // 顺序约束：L0 < L1 < L2 < L3 < L4 < L5
        const order = ["story_framework","outline_batch","detailed_outline","plot_generation","script_generation","quest_generation"];
        let lastIdx = -1;
        for (const id of order) {
          const idx = steps.indexOf(id);
          expect(idx, `${code}: ${id} 顺序错误`).toBeGreaterThan(lastIdx);
          lastIdx = idx;
        }
        // 关键模块顺序：worldview < character_enrichment < story_framework
        expect(steps.indexOf("worldview")).toBeLessThan(steps.indexOf("character_enrichment"));
        expect(steps.indexOf("character_enrichment")).toBeLessThan(steps.indexOf("story_framework"));
        // RPG 不应误入 VN/卡牌/开放世界/碎片化 专属 step
        for (const exclude of [
          "branch_tree", "dialogue_script", "cinematic_storyboard",
          "card_lore", "event_pool", "region_design", "emergent_event",
          "narrative_card",
        ]) {
          expect(steps, `${code} 不应包含 ${exclude}`).not.toContain(exclude);
        }
      });
    }
  });

  describe("tpl-vn (adv-vn / adv-interactive)", () => {
    it("adv-vn → branch_tree + dialogue_script, NO cinematic_storyboard", () => {
      const steps = buildAutoSteps(
        buildReq({ ...FULL_NEEDS }, "branching"),
        { genreCode: "adv-vn" },
      );
      expect(steps).toContain("branch_tree");
      expect(steps).toContain("dialogue_script");
      expect(steps).not.toContain("cinematic_storyboard");
      // VN 模板不跑 L0-L5
      expect(steps).not.toContain("story_framework");
      expect(steps).not.toContain("script_generation");
    });

    it("adv-interactive → tpl-vn-v2 9 步专属管线（vn_logline … vn_storyboard）", () => {
      // adv-interactive 已迁移到 tpl-vn-v2 专属重型管线，不再借用
      // branch_tree / dialogue_script / cinematic_storyboard 旧 step。
      const steps = buildAutoSteps(
        buildReq({ ...FULL_NEEDS }, "branching"),
        { genreCode: "adv-interactive" },
      );
      expect(steps).toContain("vn_logline");
      expect(steps).toContain("vn_screenplay");
      expect(steps).toContain("vn_storyboard");
      expect(steps).toContain("worldview");
      // vn-v2 不跑旧 VN step
      expect(steps).not.toContain("branch_tree");
      expect(steps).not.toContain("dialogue_script");
      expect(steps).not.toContain("cinematic_storyboard");
      // vn_storyboard（分镜）必须排在 vn_screenplay（剧本）之后
      expect(steps.indexOf("vn_storyboard")).toBeGreaterThan(steps.indexOf("vn_screenplay"));
    });
  });

  describe("tpl-open-world (rpg-open-world)", () => {
    it("rpg-open-world → region_design + emergent_event", () => {
      const steps = buildAutoSteps(buildReq(FULL_NEEDS, "linear"), {
        genreCode: "rpg-open-world",
      });
      expect(steps).toContain("region_design");
      expect(steps).toContain("emergent_event");
      // 开放世界不跑 VN / 卡牌专属 step
      expect(steps).not.toContain("branch_tree");
      expect(steps).not.toContain("card_lore");
      // 开放世界不跑 L0-L5 标准 RPG 链
      expect(steps).not.toContain("story_framework");
    });
  });

  describe("tpl-card-game (card-ccg / card-narrative)", () => {
    for (const code of ["card-ccg", "card-narrative"]) {
      it(`${code} → card_lore + event_pool`, () => {
        const steps = buildAutoSteps(buildReq(FULL_NEEDS, "linear"), {
          genreCode: code,
        });
        expect(steps).toContain("card_lore");
        expect(steps).toContain("event_pool");
        // 卡牌模板不应出现非卡牌 step
        expect(steps).not.toContain("region_design");
        expect(steps).not.toContain("branch_tree");
      });
    }
  });

  describe("tpl-light (tier3 genres)", () => {
    for (const code of ["spt-sim", "cas-puzzle", "race-sim"]) {
      it(`${code} → minimal initial_plan + worldview + character`, () => {
        const steps = buildAutoSteps(buildReq({ W: 1, C: 1, U: 1 }, "minimal"), {
          genreCode: code,
        });
        expect(steps).toContain("worldview");
        expect(steps).toContain("character_enrichment");
        // tpl-light 不跑分支 / 卡牌 / 开放世界 / L0-L5
        expect(steps).not.toContain("branch_tree");
        expect(steps).not.toContain("card_lore");
        expect(steps).not.toContain("region_design");
        expect(steps).not.toContain("story_framework");
      });
    }
  });

  describe("tpl-fragmented (souls-like / metroidvania / horror)", () => {
    for (const code of [
      "rpg-soulslike",
      "act-metroidvania",
      "hor-psychological",
    ]) {
      it(`${code} → worldview + scene_generation + (item_database 替代 Lore), NO L0-L5`, () => {
        const steps = buildAutoSteps(
          buildReq({ W: 3, C: 1, S: 1, I: 2, E: 3, L: 3, U: 1 }, "fragmented"),
          { genreCode: code },
        );
        expect(steps).toContain("worldview");
        expect(steps).toContain("scene_generation");
        // I≥1 时 item_database 进入步骤序列（取代旧 lore_generation 的位置）
        expect(steps).toContain("item_database");
        // Lore 已内嵌至通用叙事 agent，不再独立 step
        expect(steps).not.toContain("lore_generation");
        // 碎片化叙事不跑 L0-L5 / VN / 卡牌
        expect(steps).not.toContain("story_framework");
        expect(steps).not.toContain("branch_tree");
        expect(steps).not.toContain("card_lore");
      });
    }
  });

  describe("tpl-emergent (4X / sandbox / survival)", () => {
    for (const code of ["str-4x", "sim-sandbox", "srv-open"]) {
      it(`${code} → worldview + emergent_event, NO L0-L5`, () => {
        const steps = buildAutoSteps(
          buildReq({ W: 3, C: 1, S: 1, U: 2 }, "emergent"),
          { genreCode: code },
        );
        expect(steps).toContain("worldview");
        expect(steps).toContain("emergent_event");
        // 涌现叙事不跑 L0-L5 / VN / 卡牌
        expect(steps).not.toContain("story_framework");
        expect(steps).not.toContain("branch_tree");
        expect(steps).not.toContain("card_lore");
      });
    }
  });

  describe("tpl-narrative-card (tier4 genres)", () => {
    // tier4 品类（GENRE_TAXONOMY 中真实存在的 5 个）
    for (const code of [
      "puz-match",
      "rhy-pure",
      "cas-hyper",
      "cas-io",
      "misc-pinball",
    ]) {
      it(`${code} → only [narrative_card]`, () => {
        const steps = buildAutoSteps(buildReq({ W: 1, U: 1 }, "minimal"), {
          genreCode: code,
        });
        expect(steps).toEqual(["narrative_card"]);
      });
    }
  });
});

describe("F5: 79 品类全量路由 sanity", () => {
  it("buildAutoSteps 对每个 GENRE_TAXONOMY 条目都返回非空步骤序列", () => {
    const empty: string[] = [];
    for (const entry of GENRE_TAXONOMY) {
      const steps = buildAutoSteps(
        buildReq(entry.needs, entry.narrative_type),
        { genreCode: entry.code },
      );
      if (!steps.length) empty.push(entry.code);
    }
    expect(empty).toEqual([]);
  });

  it("tier4 全部品类的 buildAutoSteps 必须返回 ['narrative_card']", () => {
    const wrong: { code: string; steps: string[] }[] = [];
    for (const entry of GENRE_TAXONOMY) {
      if (entry.tier !== "tier4") continue;
      const steps = buildAutoSteps(
        buildReq(entry.needs, entry.narrative_type),
        { genreCode: entry.code },
      );
      if (steps.length !== 1 || steps[0] !== "narrative_card") {
        wrong.push({ code: entry.code, steps });
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("F5: skill-loader 覆盖度", () => {
  it("所有 79 个 GENRE_TAXONOMY 条目都能解析到 skill（手写 + long-tail catch-all）", () => {
    const missing: string[] = [];
    for (const entry of GENRE_TAXONOMY) {
      const skill = loadSkill(entry.code);
      if (!skill) missing.push(entry.code);
    }
    expect(missing).toEqual([]);
    // SKILL_REGISTRY 至少容纳 GENRE_TAXONOMY 的全部条目
    expect(listRegisteredSkills().length).toBeGreaterThanOrEqual(GENRE_TAXONOMY.length);
  });

  it("rpg-jrpg 端到端示例 skill 至少含 4 个 step 的 slots", () => {
    const skill = loadSkill("rpg-jrpg");
    expect(skill).not.toBeNull();
    const stepIds = Object.keys(skill!.stepSkills);
    for (const required of [
      "worldview",
      "character_enrichment",
      "story_framework",
      "script_generation",
    ]) {
      expect(stepIds).toContain(required);
    }
  });

  it("adv-interactive 使用 tpl-vn-v2 专属管线（无需 enableSteps，默认 1 幕短剧）", () => {
    // tpl-vn-v2 已内置 9 步全量管线，不再依赖 enableSteps 启用分镜环节。
    const skill = loadSkill("adv-interactive");
    expect(skill).not.toBeNull();
    expect(skill?.enableSteps).toBeUndefined();
    expect(skill?.defaultActs).toBe(1);
  });
});

describe("F5: PromptComposer skill 注入", () => {
  function makeCtx(genreCode: string): NarrativeContext {
    return {
      user_input: "test",
      demand_analysis: {
        genre_code: genreCode,
        genre_name: "测试",
        tier: "tier1",
        theme: { code: "fantasy", name: "奇幻" },
        volume: { duration_minutes: 60, feasibility: "ok" },
        demand_type: "full_design_doc",
        narrative_needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 3, L: 3 },
        narrative_type: "linear",
        required_systems: [],
        recommended_systems: [],
        loop_templates: { system_loop: [], gameplay_loop: [] },
      } as unknown as NarrativeContext["demand_analysis"],
    } as NarrativeContext;
  }

  it("VN_BRANCH_STYLE 内容能被 branch_tree composer 注入", () => {
    const skill = loadSkill("adv-vn");
    const slot = skill?.stepSkills.branch_tree?.slots?.style_guide;
    expect(slot).toBeTruthy();

    const composer: PromptComposer = {
      stepId: "branch_tree",
      blocks: { style: "## TEST_STYLE\n{{SKILL.style_guide}}" },
      systemBlockOrder: ["style"],
      userBlockOrder: [],
      skillSlots: ["style_guide"],
    };
    const sp = composeSystemPrompt(composer, makeCtx("adv-vn"));
    expect(sp).toContain("TEST_STYLE");
    expect(sp).toContain(slot!);
  });

  it("getStepSkill('rpg-open-world','region_design') 含 faction_rules + density_rules", () => {
    const block = getStepSkill("rpg-open-world", "region_design");
    expect(block).not.toBeNull();
    expect(block!.slots?.faction_rules).toBeTruthy();
    expect(block!.slots?.density_rules).toBeTruthy();
  });

  it("card-ccg.card_lore 包含 rarity_rules + faction_rules", () => {
    const block = getStepSkill("card-ccg", "card_lore");
    expect(block).not.toBeNull();
    expect(block!.slots?.rarity_rules).toBeTruthy();
    expect(block!.slots?.faction_rules).toBeTruthy();
  });
});
