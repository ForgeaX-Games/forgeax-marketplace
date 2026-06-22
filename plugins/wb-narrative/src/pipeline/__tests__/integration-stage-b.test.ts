/**
 * integration-stage-b.test.ts (B-INTEG)
 * ─────────────────────────────────────────────────────────────────
 * 阶段 B 端到端集成验收。覆盖：
 *
 *   ① 7 stub 全部走 universal-agent 包装、行为兼容
 *   ② needs 驱动正确：低 needs 品类的可选能力跳过执行（不调 LLM）
 *   ③ D0-D4 策划 skill 注入率 100%（94 品类 × 5 step）
 *   ④ D1/D3 接入 system skill 摘要
 *   ⑤ RPG L0-L5 链路结构未被破坏（与 A 阶段保持一致）
 *   ⑥ 8 个 PipelineTemplate 各自正确路由（不互相串扰）
 */

import { describe, it, expect, vi } from "vitest";
import "../../knowledge/game-narrative/skill-bootstrap.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";
import { loadSkill, getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { buildAutoSteps } from "../design-steps/auto-narrative-builder.js";
import type { NarrativeRequirements } from "../../types/game-design.js";
import { branchTree } from "../steps/branch-tree.js";
import { dialogueScript } from "../steps/dialogue-script.js";
import { cinematicStoryboard } from "../steps/cinematic-storyboard.js";
import { regionDesign } from "../steps/region-design.js";
import { emergentEvent } from "../steps/emergent-event.js";
import { cardLore } from "../steps/card-lore.js";
import { eventPool } from "../steps/event-pool.js";
import { buildArchitectureSkillSummary, buildValueSkillSummary } from "../../knowledge/game-design/system-skill-recommender.js";

const PLANNING_STEPS = ["core_concept", "system_architecture", "system_detail", "value_framework", "design_doc"] as const;

const FULL_NEEDS: Record<string, number> = { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 3, L: 3 };

function buildReq(
  needs: Record<string, number>,
  narrativeType: NarrativeRequirements["narrative_type"],
): NarrativeRequirements {
  return {
    needs,
    narrative_type: narrativeType,
    depth: "standard",
    available_modes: [],
  } as unknown as NarrativeRequirements;
}

function stepsForGenre(genreCode: string): string[] {
  const entry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  if (!entry) throw new Error(`unknown genre ${genreCode}`);
  return buildAutoSteps(buildReq(entry.needs, entry.narrative_type), { genreCode });
}

/** 用 FULL_NEEDS 跑 — 验证模板"全量"路径 */
function stepsForGenreFull(genreCode: string, narrativeType: NarrativeRequirements["narrative_type"] = "linear"): string[] {
  return buildAutoSteps(buildReq(FULL_NEEDS, narrativeType), { genreCode });
}

function makeMinimalCtx(needs: Record<string, number>, genreCode: string): NarrativeContext {
  return {
    user_input: "smoke test",
    tier_detection: {
      tier: "tier1",
      genre_code: genreCode,
      genre_name: "test",
      reasoning: "",
    },
    demand_analysis: {
      genre_code: genreCode,
      genre_name: "test",
      tier: "tier1",
      narrative_needs: needs,
      narrative_routing: { available_modes: [], recommended_mode: "" },
    } as never,
  } as NarrativeContext;
}

function makeLLM(payloads: unknown[]): LLMClient {
  let i = 0;
  return {
    callWithRetry: vi.fn().mockImplementation(() => {
      const p = payloads[i++] ?? payloads[payloads.length - 1];
      return Promise.resolve(JSON.stringify(p));
    }),
  } as unknown as LLMClient;
}

describe("B-INTEG ① 7 stub all wrapped via universal-agent", () => {
  it("all 7 wrappers tolerate empty needs (走 fallback / preflight skip)", async () => {
    const ctx = makeMinimalCtx({ S: 0, D: 0, Q: 0, E: 0, I: 0, L: 0 }, "puz-match");
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await branchTree(ctx, llm);
    await dialogueScript(ctx, llm);
    await cinematicStoryboard(ctx, llm);
    await regionDesign(ctx, llm);
    await emergentEvent(ctx, llm);
    await cardLore(ctx, llm);
    await eventPool(ctx, llm);

    expect(llm.callWithRetry).not.toHaveBeenCalled();
    // 7 个输出字段都被写入了占位（不会保留 undefined）
    const c = ctx as Record<string, unknown>;
    expect(c.branch_tree).toBeDefined();
    expect(c.dialogue_script).toBeDefined();
    expect(c.cinematic_storyboard).toBeDefined();
    expect(c.regions).toBeDefined();
    expect(c.emergent_events).toBeDefined();
    expect(c.card_lore).toBeDefined();
    expect(c.event_pool).toBeDefined();
  });
});

describe("B-INTEG ② needs-driven activation", () => {
  it("VN-like genre (S=3, D=3) triggers branch_tree + dialogue_script LLM calls", async () => {
    const ctx = makeMinimalCtx(
      { S: 3, D: 3, C: 3, W: 2 },
      "adv-vn",
    );

    // step 1: branch_tree（合法最小树：N1 → 结局，确保结构质量门为 no-op）
    const llmBT = makeLLM([
      { branch_tree: { root_id: "N1", nodes: [{ id: "N1", next: [{ to: "E1" }] }], endings: [{ id: "E1", title: "结局" }] } },
    ]);
    await branchTree(ctx, llmBT);
    expect(llmBT.callWithRetry).toHaveBeenCalledOnce();

    // step 2: dialogue_script (依赖 branch_tree)
    const llmDS = makeLLM([{ scripts: [{ node: "N1" }] }]);
    await dialogueScript(ctx, llmDS);
    expect(llmDS.callWithRetry).toHaveBeenCalledOnce();
  });

  it("rhythm-game (S=0) does NOT trigger branch_tree LLM call", async () => {
    const ctx = makeMinimalCtx({ S: 0, D: 0 }, "rhy-pure");
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await branchTree(ctx, llm);

    expect(llm.callWithRetry).not.toHaveBeenCalled();
    expect((ctx as Record<string, unknown>).branch_tree).toEqual({ nodes: [] });
  });
});

describe("B-INTEG ③ D0-D4 planning skill coverage 100%", () => {
  it("every genre has all 5 D0-D4 stepSkills", () => {
    const missing: Array<{ genre: string; step: string }> = [];
    for (const entry of GENRE_TAXONOMY) {
      const skill = loadSkill(entry.code);
      for (const step of PLANNING_STEPS) {
        if (!skill?.stepSkills[step]) missing.push({ genre: entry.code, step });
      }
    }
    expect(missing).toEqual([]);
  });

  it("rendered planning prompts differ across tiers (Tier1 vs Tier4)", () => {
    const tier1 = getStepSkill("rpg-jrpg", "design_doc");
    const tier4 = getStepSkill("puz-match", "design_doc");
    expect(tier1?.systemPromptAddition).toBeDefined();
    expect(tier4?.systemPromptAddition).toBeDefined();
    expect(tier1?.systemPromptAddition).not.toBe(tier4?.systemPromptAddition);
  });
});

describe("B-INTEG ④ D1/D3 system skill summaries", () => {
  it("D1 architecture summary differs across genres", () => {
    const rpg = buildArchitectureSkillSummary("rpg-jrpg");
    const puz = buildArchitectureSkillSummary("puz-match");
    expect(rpg.length).toBeGreaterThan(50);
    expect(puz).not.toBe(rpg);
  });

  it("D3 value summary is subset focus (combat/economy/growth)", () => {
    const text = buildValueSkillSummary("rpg-jrpg");
    expect(/战斗|装备|经济|成长|属性/.test(text)).toBe(true);
  });
});

describe("B-INTEG ⑤ RPG L0-L5 chain integrity (zero regression)", () => {
  // 这些品类的 pipelineTemplate 是 tpl-rpg，给 FULL_NEEDS 时必须返回完整 L0-L5
  const TPL_RPG_GENRES = [
    "rpg-jrpg",
    "rpg-crpg",
    "rpg-arpg",
    "rpg-mmorpg",
    "rpg-srpg",
    "rpg-gacha",
    "rpg-roguelike",
    "rpg-wuxia",
  ];

  it.each(TPL_RPG_GENRES)("%s with FULL_NEEDS produces full RPG L0-L5 chain", (code) => {
    const stepIds = stepsForGenreFull(code);
    expect(stepIds).toContain("story_framework");      // L0
    expect(stepIds).toContain("outline_batch");         // L1
    expect(stepIds).toContain("detailed_outline");      // L2
    expect(stepIds).toContain("plot_generation");       // L3
    expect(stepIds).toContain("script_generation");     // L4
    expect(stepIds).toContain("quest_generation");      // L5
  });

  it("rpg-srpg with default needs (D=2) gracefully drops L4 script (needs-driven)", () => {
    // 这是 needs 驱动的正确行为：低对话品类不强制跑 script_generation
    const ids = stepsForGenre("rpg-srpg");
    expect(ids).toContain("story_framework"); // L0 仍要
    expect(ids).not.toContain("script_generation"); // L4 跳过
  });
});

describe("B-INTEG ⑥ 8 pipeline templates routing differentiation", () => {
  it("tpl-vn produces branch_tree + dialogue_script (not full RPG chain)", () => {
    const ids = stepsForGenreFull("adv-vn", "branching");
    expect(ids).toContain("branch_tree");
    expect(ids).toContain("dialogue_script");
    expect(ids).not.toContain("script_generation");
  });

  it("tpl-card-game produces card_lore + event_pool (not script_generation)", () => {
    const ids = stepsForGenreFull("card-ccg");
    expect(ids).toContain("card_lore");
    expect(ids).toContain("event_pool");
    expect(ids).not.toContain("script_generation");
  });

  it("tpl-narrative-card (Tier4) produces only narrative_card", () => {
    const ids = stepsForGenreFull("puz-match", "minimal");
    expect(ids).toContain("narrative_card");
    // Tier4 不跑 RPG 主链
    expect(ids).not.toContain("story_framework");
    expect(ids).not.toContain("script_generation");
  });

  it("tpl-open-world produces region_design + emergent_event (open-world specific path)", () => {
    const ids = stepsForGenreFull("rpg-open-world");
    expect(ids).toContain("region_design");
    expect(ids).toContain("emergent_event");
    // open-world 不走经典 L0-L5，专走 region 驱动的开放世界路径
    expect(ids).not.toContain("story_framework");
  });
});
