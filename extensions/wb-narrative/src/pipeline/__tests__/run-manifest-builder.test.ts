import { describe, it, expect } from "vitest";
import { buildRunManifest, buildEntryManifests } from "../run-manifest-builder.js";
import { splitCompositionByStartNodes } from "../../types/run-manifest.js";

describe("buildRunManifest", () => {
  it("plans jrpg preset into ordered agents with pending lifecycle", () => {
    const m = buildRunManifest({
      entryKey: "test-jrpg",
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "planning",
      },
    });
    expect(m.status).toBe("planned");
    expect(m.complete).toBe(true);
    expect(m.agents.length).toBeGreaterThan(3);
    expect(m.agents.every((a) => a.lifecycle.status === "pending")).toBe(true);
    expect(m.agents[0]!.agentId).toBeTruthy();
    expect(m.promptLibrary).toBe("v1"); // rpg-jrpg → tpl-jrpg → V1 槽位库
  });

  it("honors requestedSteps over preset (free composition wins)", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg" },
      requestedSteps: ["worldview", "character_enrichment"],
    });
    expect(m.agents.map((a) => a.agentId)).toEqual([
      "worldview",
      "character_enrichment",
    ]);
  });

  /**
   * 专家组的默认步序 = 该品类的席位管线，**不含** D0-D4。
   * D0-D4 是游戏策划案（核心概念/系统架构/玩法设计/价值框架/策划文档整合），
   * 不在 PRD v1.4 §3.2.3 的通用流程里；它只在调用方显式选 design_* 时出现。
   */
  it("planning route runs the seat pipeline, with no D0-D4 prefix", () => {
    const ids = buildRunManifest({
      config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    // 与专家组 CSV 第 7 列逐环节对应：需求清单 → 策划文档 → 世界观设定 → 角色档案
    // → 道具清单 → 场景列表 → 故事大纲 → 故事结构 → 故事情节 → 任务 → 质检
    expect(ids).toEqual([
      "preference_summary",
      "preference_analysis",
      "initial_plan",
      "worldview",
      "character_enrichment",
      "item_database",
      "scene_generation",
      "story_framework",
      "outline_batch",
      "detailed_outline",
      "plot_generation",
      "quest_generation",
      "structure_check",
    ]);
    for (const d of ["core_concept", "system_architecture", "value_framework", "design_doc"]) {
      expect(ids).not.toContain(d);
    }
  });

  it("design_* still prefixes D0-D4, then joins the same seat pipeline", () => {
    const ids = buildRunManifest({
      config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning", mode: "design_auto" },
    }).agents.map((a) => a.agentId);
    expect(ids.slice(0, 5)).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
    // 叙事段与纯叙事路径同源：两条路不该跑出不同步序
    expect(ids.slice(5)).toEqual(
      buildRunManifest({
        config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
      }).agents.map((a) => a.agentId),
    );
  });

  // 选了层级但没选品类时，按层级归到四条之一（层级本就是"这游戏有多少叙事"的度量）。
  it("tier-only planning preview routes by tier alone", () => {
    const t4 = buildRunManifest({
      config: { tier: "tier4", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    expect(t4).toEqual([
      "preference_summary",
      "preference_analysis",
      "initial_plan",
      "worldview",
      "narrative_card",
    ]);

    const t3 = buildRunManifest({
      config: { tier: "tier3", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    // 设定集线不产剧情树，交付物是设定集
    expect(t3).not.toContain("quest_generation");
    expect(t3).not.toContain("plot_generation");
    expect(t3).toContain("worldview");
    expect(t3).toContain("lore_generation");
  });

  it("static narrative mode uses modeConfig.steps verbatim (no design prefix)", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "worldview",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[ids.length - 1]).toBe("worldview");
  });

  it("vn v2 E2 bypass swaps outline/beats for normalize+confirm when a script is uploaded", () => {
    const cfg = {
      genreCode: "rpg-jrpg",
      tier: "tier1" as const,
      routeGroup: "narrative" as const,
      mode: "vn_script" as const,
    };
    const e1 = buildRunManifest({ config: cfg }).agents.map((a) => a.agentId);
    const e2 = buildRunManifest({ config: cfg, hasUploadedScript: true }).agents.map(
      (a) => a.agentId,
    );
    expect(e1).toContain("vn_outline_acts");
    expect(e2).not.toContain("vn_outline_acts");
    expect(e2).not.toContain("vn_beats");
    expect(e2).toContain("vn_script_normalize");
    expect(e2).toContain("vn_segment_confirm");
  });

  it("narrative_auto stays planner-driven (no mode step list to mirror)", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "narrative_auto",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[0]).toBe("preference_summary");
  });

  it("builds multi-pipeline entry from canvas starts", () => {
    const graphs = splitCompositionByStartNodes(
      [
        { id: "in1", catalogId: "input.text", category: "input", config: {} },
        { id: "in2", catalogId: "input.tags", category: "input", config: {} },
        { id: "ex", catalogId: "expert.jrpg", category: "expert", config: {} },
      ],
      [{ id: "e", source: "in1", target: "ex" }],
    );
    const manifests = buildEntryManifests("entry-multi", graphs, {
      genreCode: "rpg-jrpg",
    });
    expect(manifests).toHaveLength(2);
    expect(manifests.every((m) => m.entryKey === "entry-multi")).toBe(true);
    const complete = manifests.find((m) => m.compositionGraph?.startNodeId === "in1");
    const incomplete = manifests.find((m) => m.compositionGraph?.startNodeId === "in2");
    expect(complete?.complete).toBe(true);
    expect(incomplete?.complete).toBe(false);
  });
});
